import type { Page } from "puppeteer";
import type { BrowserManager } from "./browser-manager.js";
import { CharlotteError, CharlotteErrorCode } from "../types/errors.js";
import { logger } from "../utils/logger.js";

export interface TabInfo {
  id: string;
  url: string;
  title: string;
  active: boolean;
}

interface ManagedPage {
  id: string;
  page: Page;
  consoleErrors: Array<{ level: string; text: string }>;
  networkErrors: Array<{ url: string; status: number; statusText: string }>;
}

let nextTabIdCounter = 1;

function generateTabId(): string {
  return `tab-${nextTabIdCounter++}`;
}

export class PageManager {
  private pages = new Map<string, ManagedPage>();
  private activeTabId: string | null = null;

  async openTab(browserManager: BrowserManager, url?: string): Promise<string> {
    const page = await browserManager.newPage();
    const tabId = generateTabId();

    const managedPage: ManagedPage = {
      id: tabId,
      page,
      consoleErrors: [],
      networkErrors: [],
    };

    // Collect console errors
    page.on("console", (msg) => {
      const level = msg.type();
      if (level === "error" || level === "warn") {
        managedPage.consoleErrors.push({
          level,
          text: msg.text(),
        });
      }
    });

    // Collect network errors
    page.on("response", (response) => {
      if (response.status() >= 400) {
        managedPage.networkErrors.push({
          url: response.url(),
          status: response.status(),
          statusText: response.statusText(),
        });
      }
    });

    this.pages.set(tabId, managedPage);
    this.activeTabId = tabId;

    if (url) {
      await page.goto(url, { waitUntil: "load" });
    }

    logger.info(`Opened tab ${tabId}`, { url });
    return tabId;
  }

  async switchTab(tabId: string): Promise<Page> {
    const managedPage = this.pages.get(tabId);
    if (!managedPage) {
      throw new CharlotteError(
        CharlotteErrorCode.SESSION_ERROR,
        `Tab '${tabId}' not found`,
      );
    }

    this.activeTabId = tabId;
    await managedPage.page.bringToFront();
    return managedPage.page;
  }

  async closeTab(tabId: string): Promise<void> {
    const managedPage = this.pages.get(tabId);
    if (!managedPage) {
      throw new CharlotteError(
        CharlotteErrorCode.SESSION_ERROR,
        `Tab '${tabId}' not found`,
      );
    }

    await managedPage.page.close();
    this.pages.delete(tabId);

    if (this.activeTabId === tabId) {
      // Switch to the first remaining tab
      const remaining = this.pages.keys().next();
      this.activeTabId = remaining.done ? null : remaining.value;
    }

    logger.info(`Closed tab ${tabId}`);
  }

  listTabs(): TabInfo[] {
    const tabs: TabInfo[] = [];
    for (const [id, managedPage] of this.pages) {
      tabs.push({
        id,
        url: managedPage.page.url(),
        title: "", // Would need await page.title(), but this is sync
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
      throw new CharlotteError(
        CharlotteErrorCode.SESSION_ERROR,
        "No active tab",
      );
    }
    return this.activeTabId;
  }

  getConsoleErrors(): Array<{ level: string; text: string }> {
    if (!this.activeTabId) return [];
    const managedPage = this.pages.get(this.activeTabId);
    return managedPage?.consoleErrors ?? [];
  }

  getNetworkErrors(): Array<{
    url: string;
    status: number;
    statusText: string;
  }> {
    if (!this.activeTabId) return [];
    const managedPage = this.pages.get(this.activeTabId);
    return managedPage?.networkErrors ?? [];
  }

  clearErrors(): void {
    if (!this.activeTabId) return;
    const managedPage = this.pages.get(this.activeTabId);
    if (managedPage) {
      managedPage.consoleErrors = [];
      managedPage.networkErrors = [];
    }
  }

  hasPages(): boolean {
    return this.pages.size > 0;
  }
}
