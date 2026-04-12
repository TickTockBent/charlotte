import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { Page, Browser } from "puppeteer";
import { BrowserManager } from "../../../src/browser/browser-manager.js";
import { PageManager } from "../../../src/browser/page-manager.js";
import { createDefaultConfig } from "../../../src/types/config.js";

describe("PageManager", () => {
  let browserManager: BrowserManager;

  beforeAll(async () => {
    browserManager = new BrowserManager();
    await browserManager.launch();
  });

  afterAll(async () => {
    await browserManager.close();
  });

  describe("tab lifecycle", () => {
    let pageManager: PageManager;

    beforeEach(() => {
      pageManager = new PageManager();
    });

    it("starts with no pages", () => {
      expect(pageManager.hasPages()).toBe(false);
    });

    it("opens a tab and sets it as active", async () => {
      const tabId = await pageManager.openTab(browserManager);

      expect(tabId).toMatch(/^tab-\d+$/);
      expect(pageManager.hasPages()).toBe(true);
      expect(pageManager.getActiveTabId()).toBe(tabId);
    });

    it("opens a tab with a URL", async () => {
      const tabId = await pageManager.openTab(browserManager, "about:blank");

      expect(tabId).toBeTruthy();
      const page = pageManager.getActivePage();
      expect(page.url()).toBe("about:blank");
    });

    it("lists tabs with correct info", async () => {
      const tabIdA = await pageManager.openTab(browserManager);
      const tabIdB = await pageManager.openTab(browserManager);

      const tabs = await pageManager.listTabs();

      expect(tabs).toHaveLength(2);
      expect(tabs.find((t) => t.id === tabIdA)).toBeDefined();
      expect(tabs.find((t) => t.id === tabIdB)).toBeDefined();

      // Most recent tab should be active
      const activeTab = tabs.find((t) => t.active);
      expect(activeTab).toBeDefined();
      expect(activeTab!.id).toBe(tabIdB);
    });

    it("switches tabs", async () => {
      const tabIdA = await pageManager.openTab(browserManager);
      await pageManager.openTab(browserManager);

      await pageManager.switchTab(tabIdA);

      expect(pageManager.getActiveTabId()).toBe(tabIdA);
    });

    it("throws when switching to non-existent tab", async () => {
      await pageManager.openTab(browserManager);

      await expect(pageManager.switchTab("tab-nonexistent")).rejects.toThrow("not found");
    });

    it("closes a tab", async () => {
      const tabIdA = await pageManager.openTab(browserManager);
      const tabIdB = await pageManager.openTab(browserManager);

      await pageManager.closeTab(tabIdA);

      const tabs = await pageManager.listTabs();
      expect(tabs).toHaveLength(1);
      expect(tabs[0].id).toBe(tabIdB);
    });

    it("switches to remaining tab when active tab is closed", async () => {
      const tabIdA = await pageManager.openTab(browserManager);
      const tabIdB = await pageManager.openTab(browserManager);

      // tabIdB is active, close it
      await pageManager.closeTab(tabIdB);

      expect(pageManager.getActiveTabId()).toBe(tabIdA);
    });

    it("throws when closing non-existent tab", async () => {
      await pageManager.openTab(browserManager);

      await expect(pageManager.closeTab("tab-nonexistent")).rejects.toThrow("not found");
    });

    it("throws when no active tab and getActivePage is called", () => {
      expect(() => pageManager.getActivePage()).toThrow("No active tab");
    });
  });

  describe("console and network accessors", () => {
    let pageManager: PageManager;

    beforeEach(() => {
      pageManager = new PageManager(createDefaultConfig());
    });

    it("getConsoleMessages returns empty array when no pages", () => {
      expect(pageManager.getConsoleMessages()).toEqual([]);
    });

    it("getConsoleMessages with level filter returns empty array when no pages", () => {
      expect(pageManager.getConsoleMessages("error")).toEqual([]);
    });

    it("getNetworkRequests returns empty array when no pages", () => {
      expect(pageManager.getNetworkRequests()).toEqual([]);
    });

    it("clearConsoleMessages does not throw when no pages", () => {
      expect(() => pageManager.clearConsoleMessages()).not.toThrow();
    });

    it("clearNetworkRequests does not throw when no pages", () => {
      expect(() => pageManager.clearNetworkRequests()).not.toThrow();
    });

    it("getConsoleErrors returns empty array when no pages", () => {
      expect(pageManager.getConsoleErrors()).toEqual([]);
    });

    it("getNetworkErrors returns empty array when no pages", () => {
      expect(pageManager.getNetworkErrors()).toEqual([]);
    });
  });

  describe("dialog tracking", () => {
    let pageManager: PageManager;

    beforeEach(() => {
      pageManager = new PageManager(createDefaultConfig());
    });

    it("getPendingDialogInfo returns null when no dialog pending", async () => {
      await pageManager.openTab(browserManager);
      expect(pageManager.getPendingDialogInfo()).toBeNull();
    });

    it("getPendingDialog returns null when no dialog pending", async () => {
      await pageManager.openTab(browserManager);
      expect(pageManager.getPendingDialog()).toBeNull();
    });

    it("clearPendingDialog does not throw when no dialog pending", async () => {
      await pageManager.openTab(browserManager);
      expect(() => pageManager.clearPendingDialog()).not.toThrow();
    });

    it("clearPendingDialog does not throw when no pages exist", () => {
      expect(() => pageManager.clearPendingDialog()).not.toThrow();
    });
  });
});

describe("PageManager.adoptExistingPages", () => {
  function createMockPage(url: string, title: string): Page {
    const listeners = new Map<string, Function>();
    return {
      url: () => url,
      title: () => Promise.resolve(title),
      on: (event: string, handler: Function) => { listeners.set(event, handler); },
      removeAllListeners: () => {},
      mainFrame: () => ({}),
      bringToFront: () => Promise.resolve(),
      close: () => Promise.resolve(),
    } as unknown as Page;
  }

  function createMockBrowser(pages: Page[]): Browser {
    return {
      pages: () => Promise.resolve(pages),
    } as unknown as Browser;
  }

  it("adopts all existing pages and sets first as active", async () => {
    const pageManager = new PageManager();
    const mockPages = [
      createMockPage("https://example.com", "Example"),
      createMockPage("https://google.com", "Google"),
      createMockPage("about:blank", "Blank"),
    ];
    const mockBrowser = createMockBrowser(mockPages);

    await pageManager.adoptExistingPages(mockBrowser);

    const tabs = await pageManager.listTabs();
    expect(tabs).toHaveLength(3);
    expect(tabs[0].active).toBe(true);
    expect(tabs[0].url).toBe("https://example.com");
  });

  it("does nothing when browser has no pages", async () => {
    const pageManager = new PageManager();
    const mockBrowser = createMockBrowser([]);

    await pageManager.adoptExistingPages(mockBrowser);

    expect(pageManager.hasPages()).toBe(false);
  });

  it("wires listeners on adopted pages", async () => {
    const pageManager = new PageManager();
    const mockPage = createMockPage("https://example.com", "Example");
    const onSpy = vi.spyOn(mockPage, "on" as never);
    const mockBrowser = createMockBrowser([mockPage]);

    await pageManager.adoptExistingPages(mockBrowser);

    // wirePageListeners registers: console, response, dialog, framenavigated, popup, close
    const registeredEvents = onSpy.mock.calls.map((call) => call[0]);
    expect(registeredEvents).toContain("console");
    expect(registeredEvents).toContain("response");
    expect(registeredEvents).toContain("dialog");
    expect(registeredEvents).toContain("close");
  });
});
