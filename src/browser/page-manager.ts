import type { Page, Dialog, Browser } from "puppeteer";
import type { BrowserManager } from "./browser-manager.js";
import type { PendingDialog } from "../types/page-representation.js";
import { createDefaultConfig } from "../types/config.js";
import type { CharlotteConfig } from "../types/config.js";
import { CharlotteError, CharlotteErrorCode } from "../types/errors.js";
import { logger } from "../utils/logger.js";

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

  constructor(config?: CharlotteConfig) {
    // Accept optional config; callers without config get a permissive default
    this.config = config ?? createDefaultConfig();
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

    // Capture popups (target="_blank" links, window.open()) as managed tabs
    page.on("popup", (popupPage) => {
      if (popupPage) {
        this.registerPopupPage(popupPage);
      }
    });

    // Auto-clean when a page closes itself (window.close(), site-initiated)
    page.on("close", () => {
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

    managedPage.page.removeAllListeners("console");
    managedPage.page.removeAllListeners("response");
    managedPage.page.removeAllListeners("dialog");
    managedPage.page.removeAllListeners("framenavigated");
    managedPage.page.removeAllListeners("popup");
    managedPage.page.removeAllListeners("close");
    await managedPage.page.close();
    this.pages.delete(tabId);

    if (this.activeTabId === tabId) {
      // Switch to the first remaining tab
      const remaining = this.pages.keys().next();
      this.activeTabId = remaining.done ? null : remaining.value;
    }

    logger.info(`Closed tab ${tabId}`);
  }

  async listTabs(): Promise<TabInfo[]> {
    const tabs: TabInfo[] = [];
    for (const [id, managedPage] of this.pages) {
      tabs.push({
        id,
        url: managedPage.page.url(),
        title: await managedPage.page.title(),
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
