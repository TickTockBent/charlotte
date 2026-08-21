import type { Page, Dialog, Browser } from "puppeteer";
import type { BrowserManager } from "./browser-manager.js";
import type { CDPSessionManager } from "./cdp-session.js";
import type { PendingDialog } from "../types/page-representation.js";
import { createDefaultConfig } from "../types/config.js";
import type { CharlotteConfig, InitScript } from "../types/config.js";
import { CharlotteError, CharlotteErrorCode } from "../types/errors.js";
import { logger } from "../utils/logger.js";
import type { NavigationDenyInfo } from "./navigation-guard.js";

export interface TabInfo {
  id: string;
  url: string;
  title: string;
  active: boolean;
}

export interface ConsoleMessage {
  level: string;
  text: string;
  timestamp: string;
}

export interface NetworkRequest {
  url: string;
  method: string;
  status: number;
  statusText: string;
  resourceType: string;
  timestamp: string;
}

const MAX_CONSOLE_MESSAGES = 1000;
const MAX_NETWORK_REQUESTS = 1000;

interface ManagedPage {
  id: string;
  page: Page;
  consoleMessages: ConsoleMessage[];
  networkRequests: NetworkRequest[];
  pendingDialog: Dialog | null;
  pendingDialogInfo: PendingDialog | null;
}

let nextTabIdCounter = 1;

function generateTabId(): string {
  return `tab-${nextTabIdCounter++}`;
}

export class PageManager {
  private pages = new Map<string, ManagedPage>();
  private activeTabId: string | null = null;
  private config: CharlotteConfig;
  /** Tab IDs of pages opened by popups since the last drain. */
  private newTabQueue: string[] = [];

  private cdpSessionManager?: CDPSessionManager;

  /**
   * Scripts applied to every managed page via `evaluateOnNewDocument` so they
   * run on each new document before page JS (issue #18). Seeded from
   * `config.initScripts` at construction; extended at runtime by
   * {@link registerInitScript}. Entries live for the process lifetime.
   */
  private initScripts: InitScript[] = [];

  /**
   * The most recent navigation refusal recorded by the SSRF filtering proxy
   * (D15), or null. The proxy fronts every target, so this is a single
   * session-level field (not per-tab): it is cleared at the start of each
   * navigation via {@link clearErrors} and read immediately after a `page.goto`
   * failure by the navigate tool to raise a NAVIGATION_BLOCKED error. Because it
   * is only read when a navigation throws, a stale value left by a background
   * subresource denial can never turn a successful navigation into a false block.
   */
  private lastNavigationBlock: NavigationDenyInfo | null = null;

  constructor(config?: CharlotteConfig, cdpSessionManager?: CDPSessionManager) {
    // Accept optional config; callers without config get a permissive default
    this.config = config ?? createDefaultConfig();
    this.cdpSessionManager = cdpSessionManager;
    this.initScripts = [...(this.config.initScripts ?? [])];
  }

  /**
   * Register a script to run on every new document in every tab for the rest
   * of the session. Applied immediately to all currently managed pages (it
   * takes effect on their next navigation) and to every page opened later.
   */
  async registerInitScript(source: string, content: string): Promise<void> {
    const script: InitScript = { source, content };
    this.initScripts.push(script);
    await Promise.all(
      [...this.pages.values()].map(async (managedPage) => {
        try {
          await managedPage.page.evaluateOnNewDocument(content);
        } catch (error) {
          logger.warn(`Failed to apply init script ${source} to ${managedPage.id}`, {
            error: (error as Error).message,
          });
        }
      }),
    );
    logger.info(`Registered init script ${source}`, { total: this.initScripts.length });
  }

  /** Read-only view of the registered init scripts (for tests/diagnostics). */
  getInitScripts(): readonly InitScript[] {
    return this.initScripts;
  }

  /**
   * Apply every registered init script to a page. Called once per page when
   * it enters management (openTab, popup capture, CDP adoption). Popups are
   * new targets and do not inherit the opener's scripts, so they need this
   * too (see the caveat in {@link registerPopupPage}).
   */
  private async applyInitScripts(page: Page): Promise<void> {
    if (this.initScripts.length === 0) return;
    for (const script of this.initScripts) {
      await page.evaluateOnNewDocument(script.content);
    }
    logger.info(`Applied ${this.initScripts.length} init scripts`, {
      sources: this.initScripts.map((script) => script.source),
    });
  }

  /**
   * Wire up event listeners on a managed page: console, network, dialog,
   * framenavigated, popup, and close. Shared by openTab() and the popup handler.
   */
  private wirePageListeners(managedPage: ManagedPage): void {
    const { page, id: tabId } = managedPage;

    // Collect all console messages
    page.on("console", (msg) => {
      if (managedPage.consoleMessages.length >= MAX_CONSOLE_MESSAGES) {
        managedPage.consoleMessages.shift();
      }
      managedPage.consoleMessages.push({
        level: msg.type(),
        text: msg.text(),
        timestamp: new Date().toISOString(),
      });
    });

    // Collect all network responses
    page.on("response", (response) => {
      if (managedPage.networkRequests.length >= MAX_NETWORK_REQUESTS) {
        managedPage.networkRequests.shift();
      }
      managedPage.networkRequests.push({
        url: response.url(),
        method: response.request().method(),
        status: response.status(),
        statusText: response.statusText(),
        resourceType: response.request().resourceType(),
        timestamp: new Date().toISOString(),
      });
    });

    // Handle JavaScript dialogs (alert, confirm, prompt, beforeunload)
    page.on("dialog", async (dialog) => {
      try {
        const dialogType = dialog.type() as PendingDialog["type"];
        const autoDismiss = this.config.dialogAutoDismiss;

        logger.info("Dialog appeared", { tabId, type: dialogType, message: dialog.message() });

        // Auto-dismiss logic
        if (
          autoDismiss === "accept_all" ||
          (autoDismiss === "accept_alerts" && dialogType === "alert")
        ) {
          await dialog.accept();
          return;
        }
        if (autoDismiss === "dismiss_all") {
          await dialog.dismiss();
          return;
        }

        // Queue for manual handling
        managedPage.pendingDialog = dialog;
        managedPage.pendingDialogInfo = {
          type: dialogType,
          message: dialog.message(),
          ...(dialogType === "prompt" ? { default_value: dialog.defaultValue() } : {}),
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        logger.warn("Dialog handler failed", { tabId, error });
      }
    });

    // Clear stale dialog references on main-frame navigation only.
    // Subframe navigations (iframes, ads, embeds) must not wipe dialog state.
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        managedPage.pendingDialog = null;
        managedPage.pendingDialogInfo = null;
      }
    });

    // Clean up stale frame session cache entries when a frame detaches.
    // Fires for individual iframe removal AND for all child frames on full-page navigation.
    if (this.cdpSessionManager) {
      page.on("framedetached", (frame) => {
        try {
          const frameId = this.cdpSessionManager!.getFrameId(frame);
          this.cdpSessionManager!.removeFrameSession(frameId);
        } catch {
          // Frame may already be destroyed — ignore errors in cleanup
        }
      });
    }

    // Capture popups (target="_blank" links, window.open()) as managed tabs
    page.on("popup", (popupPage) => {
      if (popupPage) {
        this.registerPopupPage(popupPage);
      }
    });

    // Auto-clean when a page closes itself (window.close(), site-initiated)
    page.on("close", () => {
      if (this.cdpSessionManager) {
        this.cdpSessionManager.clearPageFrameSessions(page);
      }
      if (this.pages.has(tabId)) {
        this.pages.delete(tabId);
        logger.info(`Tab ${tabId} closed by page`);
        if (this.activeTabId === tabId) {
          const remaining = this.pages.keys().next();
          this.activeTabId = remaining.done ? null : remaining.value;
        }
      }
    });
  }

  /**
   * Register a popup page as a managed tab. Called by the popup event handler.
   */
  private registerPopupPage(popupPage: Page): void {
    const popupTabId = generateTabId();
    const managedPopup: ManagedPage = {
      id: popupTabId,
      page: popupPage,
      consoleMessages: [],
      networkRequests: [],
      pendingDialog: null,
      pendingDialogInfo: null,
    };

    this.wirePageListeners(managedPopup);
    // The popup handler is synchronous; apply scripts best-effort in the
    // background. Known limitation: Puppeteer resumes a new popup target
    // (Runtime.runIfWaitingForDebugger) before it emits `popup`, so the
    // popup's *initial* document has usually already started by now and
    // misses the scripts; every document after it is covered.
    void this.applyInitScripts(popupPage).catch((error: unknown) => {
      logger.warn(`Failed to apply init scripts to popup ${popupTabId}`, {
        error: (error as Error).message,
      });
    });
    // No per-page guard install: the SSRF guard is the network-layer filtering
    // proxy (D15), which already fronts every target including this popup's
    // initial request. See src/browser/filtering-proxy.ts.
    this.pages.set(popupTabId, managedPopup);
    this.newTabQueue.push(popupTabId);

    logger.info(`Captured popup as ${popupTabId}`, { url: popupPage.url() });
  }

  /**
   * Drain the new-tab queue. Returns tab IDs of pages opened by popups since
   * the last call, then clears the queue (single-consumption semantics).
   */
  consumeNewTabs(): string[] {
    if (this.newTabQueue.length === 0) return [];
    const tabs = [...this.newTabQueue];
    this.newTabQueue = [];
    return tabs;
  }

  async openTab(browserManager: BrowserManager, url?: string): Promise<string> {
    const page = await browserManager.newPage();
    await this.applyInitScripts(page);
    const tabId = generateTabId();

    const managedPage: ManagedPage = {
      id: tabId,
      page,
      consoleMessages: [],
      networkRequests: [],
      pendingDialog: null,
      pendingDialogInfo: null,
    };

    this.wirePageListeners(managedPage);

    this.pages.set(tabId, managedPage);
    this.activeTabId = tabId;

    if (url) {
      await page.goto(url, { waitUntil: "load" });
    }

    logger.info(`Opened tab ${tabId}`, { url });
    return tabId;
  }

  /**
   * Adopt pages already open in a connected browser.
   * Called once after puppeteer.connect() in CDP mode.
   */
  async adoptExistingPages(browser: Browser): Promise<void> {
    const existingPages = await browser.pages();
    if (existingPages.length === 0) {
      logger.info("No existing pages to adopt");
      return;
    }

    for (const page of existingPages) {
      await this.applyInitScripts(page);
      const tabId = generateTabId();
      const managedPage: ManagedPage = {
        id: tabId,
        page,
        consoleMessages: [],
        networkRequests: [],
        pendingDialog: null,
        pendingDialogInfo: null,
      };

      this.wirePageListeners(managedPage);
      this.pages.set(tabId, managedPage);

      // First adopted page becomes active
      if (!this.activeTabId) {
        this.activeTabId = tabId;
      }
    }

    logger.info(`Adopted ${existingPages.length} existing page(s)`);
  }

  async switchTab(tabId: string): Promise<Page> {
    const managedPage = this.pages.get(tabId);
    if (!managedPage) {
      throw new CharlotteError(CharlotteErrorCode.SESSION_ERROR, `Tab '${tabId}' not found`);
    }

    this.activeTabId = tabId;
    await managedPage.page.bringToFront();
    return managedPage.page;
  }

  async closeTab(tabId: string): Promise<void> {
    const managedPage = this.pages.get(tabId);
    if (!managedPage) {
      throw new CharlotteError(CharlotteErrorCode.SESSION_ERROR, `Tab '${tabId}' not found`);
    }

    if (this.cdpSessionManager) {
      this.cdpSessionManager.clearPageFrameSessions(managedPage.page);
    }
    managedPage.page.removeAllListeners("console");
    managedPage.page.removeAllListeners("response");
    managedPage.page.removeAllListeners("dialog");
    managedPage.page.removeAllListeners("framenavigated");
    managedPage.page.removeAllListeners("framedetached");
    managedPage.page.removeAllListeners("popup");
    managedPage.page.removeAllListeners("close");

    // Remove from the map FIRST so cleanup always completes, even if the
    // underlying connection is dead. page.close() throws on a crashed browser;
    // if we awaited it before deleting, the tab could never be removed and the
    // server would wedge until restart (#201).
    this.pages.delete(tabId);

    if (this.activeTabId === tabId) {
      // Switch to the first remaining tab
      const remaining = this.pages.keys().next();
      this.activeTabId = remaining.done ? null : remaining.value;
    }

    try {
      await managedPage.page.close();
    } catch (error) {
      logger.warn(`page.close() failed for ${tabId} (already gone?)`, { error });
    }

    logger.info(`Closed tab ${tabId}`);
  }

  /**
   * Drop all per-session state. Called by BrowserManager's onDisconnected hook
   * when the browser transport drops (crash/kill/remote disconnect): the cached
   * Page objects are bound to the dead connection and every operation on them
   * throws, so we clear them and let the next ensureReady() open a fresh blank
   * tab against the relaunched browser (#201).
   */
  reset(): void {
    const tabCount = this.pages.size;
    this.pages.clear();
    this.activeTabId = null;
    this.newTabQueue = [];
    this.lastNavigationBlock = null;
    if (this.cdpSessionManager) {
      this.cdpSessionManager.clearAll();
    }
    logger.warn(`PageManager reset: cleared ${tabCount} dead tab(s) after browser disconnect`);
  }

  async listTabs(): Promise<TabInfo[]> {
    const tabs: TabInfo[] = [];
    for (const [id, managedPage] of this.pages) {
      // A single dead/crashed page must not take down the whole tab list:
      // page.title() rejects on a lost connection. Fall back gracefully (#202).
      let url: string;
      try {
        url = managedPage.page.url();
      } catch {
        url = "about:blank";
      }
      let title: string;
      try {
        title = await managedPage.page.title();
      } catch {
        title = "(unavailable)";
      }
      tabs.push({
        id,
        url,
        title,
        active: id === this.activeTabId,
      });
    }
    return tabs;
  }

  getActivePage(): Page {
    if (!this.activeTabId) {
      throw new CharlotteError(
        CharlotteErrorCode.SESSION_ERROR,
        "No active tab. Open a tab first.",
      );
    }

    const managedPage = this.pages.get(this.activeTabId);
    if (!managedPage) {
      throw new CharlotteError(
        CharlotteErrorCode.SESSION_ERROR,
        "Active tab not found. This is a bug.",
      );
    }

    return managedPage.page;
  }

  getActiveTabId(): string {
    if (!this.activeTabId) {
      throw new CharlotteError(CharlotteErrorCode.SESSION_ERROR, "No active tab");
    }
    return this.activeTabId;
  }

  /** Return only error/warn console messages (for PageRepresentation.errors). */
  getConsoleErrors(): Array<{ level: string; text: string }> {
    if (!this.activeTabId) return [];
    const managedPage = this.pages.get(this.activeTabId);
    if (!managedPage) return [];
    return managedPage.consoleMessages
      .filter((m) => m.level === "error" || m.level === "warn")
      .map(({ level, text }) => ({ level, text }));
  }

  /** Return only HTTP error responses (status >= 400, for PageRepresentation.errors). */
  getNetworkErrors(): Array<{
    url: string;
    status: number;
    statusText: string;
  }> {
    if (!this.activeTabId) return [];
    const managedPage = this.pages.get(this.activeTabId);
    if (!managedPage) return [];
    return managedPage.networkRequests
      .filter((r) => r.status >= 400)
      .map(({ url, status, statusText }) => ({ url, status, statusText }));
  }

  /** Return all console messages, optionally filtered by level. */
  getConsoleMessages(level?: string): ConsoleMessage[] {
    if (!this.activeTabId) return [];
    const managedPage = this.pages.get(this.activeTabId);
    if (!managedPage) return [];
    if (level && level !== "all") {
      return managedPage.consoleMessages.filter((m) => m.level === level);
    }
    return [...managedPage.consoleMessages];
  }

  /** Return all network requests, optionally filtered. */
  getNetworkRequests(): NetworkRequest[] {
    if (!this.activeTabId) return [];
    const managedPage = this.pages.get(this.activeTabId);
    if (!managedPage) return [];
    return [...managedPage.networkRequests];
  }

  clearConsoleMessages(): void {
    if (!this.activeTabId) return;
    const managedPage = this.pages.get(this.activeTabId);
    if (managedPage) {
      managedPage.consoleMessages = [];
    }
  }

  clearNetworkRequests(): void {
    if (!this.activeTabId) return;
    const managedPage = this.pages.get(this.activeTabId);
    if (managedPage) {
      managedPage.networkRequests = [];
    }
  }

  clearErrors(): void {
    if (!this.activeTabId) return;
    const managedPage = this.pages.get(this.activeTabId);
    if (managedPage) {
      managedPage.consoleMessages = [];
      managedPage.networkRequests = [];
    }
    // Cleared per navigation so a NAVIGATION_BLOCKED raised for one navigation
    // can never be attributed to a later one (D14). Session-level, independent
    // of the active tab, since the browser-level guard covers every target.
    this.lastNavigationBlock = null;
  }

  /**
   * Record a navigation refusal from the SSRF filtering proxy (D15). Called from
   * the proxy's `onDeny` (wired through BrowserManager); the navigate tool reads
   * it via
   * {@link getLastNavigationBlock} after a `page.goto` failure.
   */
  recordNavigationBlock(info: NavigationDenyInfo): void {
    this.lastNavigationBlock = info;
    logger.warn("Navigation blocked by SSRF guard", info);
  }

  /**
   * The SSRF guard's most recent refusal, or null (D15). The navigate tool reads
   * this after a `page.goto` failure to turn a proxy refusal (HTTP 403 →
   * `ERR_PROXY_CONNECTION_FAILED`-class, or a denied CONNECT →
   * `ERR_TUNNEL_CONNECTION_FAILED`) into a legible NAVIGATION_BLOCKED error.
   */
  getLastNavigationBlock(): NavigationDenyInfo | null {
    return this.lastNavigationBlock;
  }

  getPendingDialogInfo(): PendingDialog | null {
    if (!this.activeTabId) return null;
    const managedPage = this.pages.get(this.activeTabId);
    return managedPage?.pendingDialogInfo ?? null;
  }

  getPendingDialog(): Dialog | null {
    if (!this.activeTabId) return null;
    const managedPage = this.pages.get(this.activeTabId);
    return managedPage?.pendingDialog ?? null;
  }

  clearPendingDialog(): void {
    if (!this.activeTabId) return;
    const managedPage = this.pages.get(this.activeTabId);
    if (managedPage) {
      managedPage.pendingDialog = null;
      managedPage.pendingDialogInfo = null;
    }
  }

  hasPages(): boolean {
    return this.pages.size > 0;
  }
}
