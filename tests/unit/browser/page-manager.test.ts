import { describe, it, expect, vi } from "vitest";
import { PageManager } from "../../../src/browser/page-manager.js";
import type { BrowserManager } from "../../../src/browser/browser-manager.js";
import type { Page } from "puppeteer";
import { createDefaultConfig } from "../../../src/types/config.js";

/**
 * Minimal Puppeteer Page stand-in: records `evaluateOnNewDocument` calls and
 * keeps the listeners `wirePageListeners` installs so the popup handler can be
 * triggered by hand.
 */
function createFakePage(url = "about:blank") {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const fakePage = {
    evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners.set(event, handler);
    }),
    removeAllListeners: vi.fn(),
    mainFrame: vi.fn(),
    goto: vi.fn().mockResolvedValue(undefined),
    bringToFront: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(false),
    url: () => url,
  };
  return { fakePage, listeners, page: fakePage as unknown as Page };
}

function createFakeBrowserManager(page: Page): BrowserManager {
  return { newPage: vi.fn().mockResolvedValue(page) } as unknown as BrowserManager;
}

describe("PageManager init scripts (issue #18)", () => {
  it("applies config-seeded init scripts to pages opened via openTab", async () => {
    const config = createDefaultConfig();
    config.initScripts = [
      { source: "/scripts/a.js", content: "window.__a = 1" },
      { source: "/scripts/b.js", content: "window.__b = 2" },
    ];
    const pageManager = new PageManager(config);
    const { fakePage, page } = createFakePage();

    await pageManager.openTab(createFakeBrowserManager(page));

    expect(fakePage.evaluateOnNewDocument).toHaveBeenCalledTimes(2);
    expect(fakePage.evaluateOnNewDocument).toHaveBeenNthCalledWith(1, "window.__a = 1");
    expect(fakePage.evaluateOnNewDocument).toHaveBeenNthCalledWith(2, "window.__b = 2");
  });

  it("does not touch evaluateOnNewDocument when no scripts are registered", async () => {
    const pageManager = new PageManager();
    const { fakePage, page } = createFakePage();

    await pageManager.openTab(createFakeBrowserManager(page));

    expect(fakePage.evaluateOnNewDocument).not.toHaveBeenCalled();
  });

  it("activates a newly opened tab (focus before navigation) when it lacks focus", async () => {
    const pageManager = new PageManager();
    const { fakePage, page } = createFakePage();
    fakePage.evaluate.mockResolvedValue(false); // not the focused tab

    await pageManager.openTab(createFakeBrowserManager(page), "https://example.com/");

    expect(fakePage.bringToFront).toHaveBeenCalledTimes(1);
    expect(fakePage.goto).toHaveBeenCalledTimes(1);
    // Focus before navigation: the tab is focused even while it loads, the
    // same contract charlotte_navigate has.
    expect(fakePage.bringToFront.mock.invocationCallOrder[0]).toBeLessThan(
      fakePage.goto.mock.invocationCallOrder[0],
    );
  });

  it("skips bringToFront for a newly opened tab that already has focus", async () => {
    const pageManager = new PageManager();
    const { fakePage, page } = createFakePage();
    fakePage.evaluate.mockResolvedValue(true); // already frontmost (Chrome 156
    // reports hasFocus() === true for fresh browser.newPage() tabs)

    await pageManager.openTab(createFakeBrowserManager(page), "https://example.com/");

    expect(fakePage.bringToFront).not.toHaveBeenCalled();
    expect(fakePage.goto).toHaveBeenCalledTimes(1);
  });

  it("never focuses tabs when focusTabs is disabled (attached / visible browser)", async () => {
    const pageManager = new PageManager(undefined, undefined, { focusTabs: false });
    const { fakePage, page } = createFakePage();
    fakePage.evaluate.mockResolvedValue(false);

    await pageManager.openTab(createFakeBrowserManager(page), "https://example.com/");

    // Bookkeeping only: the user's visible tab is never switched.
    expect(fakePage.evaluate).not.toHaveBeenCalled();
    expect(fakePage.bringToFront).not.toHaveBeenCalled();
    expect(fakePage.goto).toHaveBeenCalledTimes(1);
  });

  it("switchTab focuses even when focusTabs is disabled (explicit switch)", async () => {
    const pageManager = new PageManager(undefined, undefined, { focusTabs: false });
    const first = createFakePage();
    const second = createFakePage();
    await pageManager.openTab(createFakeBrowserManager(first.page));
    const secondTabId = await pageManager.openTab(createFakeBrowserManager(second.page));
    second.fakePage.evaluate.mockResolvedValue(false);

    await pageManager.switchTab(secondTabId);

    // An explicit tab switch brings the tab to front in every browser
    // mode; the focusTabs gate covers only implicit activations.
    expect(second.fakePage.bringToFront).toHaveBeenCalledTimes(1);
    expect(pageManager.getActiveTabId()).toBe(secondTabId);
  });

  it("closeTab focuses the fallback tab so activeTabId cannot drift from focus", async () => {
    const pageManager = new PageManager();
    const first = createFakePage();
    const second = createFakePage();
    // The first tab is frontmost when opened (no focus steal), but loses
    // focus once the second tab is opened.
    first.fakePage.evaluate.mockResolvedValue(true);
    await pageManager.openTab(createFakeBrowserManager(first.page));
    first.fakePage.evaluate.mockResolvedValue(false);
    const secondTabId = await pageManager.openTab(createFakeBrowserManager(second.page));

    await pageManager.closeTab(secondTabId);

    // The remaining (first) tab becomes active and is brought to front.
    expect(first.fakePage.bringToFront).toHaveBeenCalledTimes(1);
    expect(pageManager.getActiveTabId()).not.toBe(secondTabId);
  });

  it("registerInitScript applies to existing pages and to pages opened afterwards", async () => {
    const pageManager = new PageManager();
    const existingTab = createFakePage();
    await pageManager.openTab(createFakeBrowserManager(existingTab.page));

    await pageManager.registerInitScript("dev_inject#1", "window.__marker = true");

    expect(existingTab.fakePage.evaluateOnNewDocument).toHaveBeenCalledWith(
      "window.__marker = true",
    );
    expect(pageManager.getInitScripts()).toEqual([
      { source: "dev_inject#1", content: "window.__marker = true" },
    ]);

    const laterTab = createFakePage();
    await pageManager.openTab(createFakeBrowserManager(laterTab.page));
    expect(laterTab.fakePage.evaluateOnNewDocument).toHaveBeenCalledWith("window.__marker = true");
  });

  it("applies registered scripts to captured popup pages", async () => {
    const config = createDefaultConfig();
    config.initScripts = [{ source: "/scripts/popup.js", content: "window.__popupInit = 1" }];
    const pageManager = new PageManager(config);
    const opener = createFakePage();
    await pageManager.openTab(createFakeBrowserManager(opener.page));

    const popup = createFakePage("https://example.com/popup");
    opener.listeners.get("popup")!(popup.page);
    // The popup handler applies scripts asynchronously (fire-and-forget).
    await new Promise((resolve) => setImmediate(resolve));

    expect(popup.fakePage.evaluateOnNewDocument).toHaveBeenCalledWith("window.__popupInit = 1");
    expect(pageManager.consumeNewTabs()).toHaveLength(1);
  });

  it("applies registered scripts to adopted CDP pages", async () => {
    const config = createDefaultConfig();
    config.initScripts = [{ source: "/scripts/adopt.js", content: "window.__adopted = 1" }];
    const pageManager = new PageManager(config);
    const adopted = createFakePage();
    const fakeBrowser = { pages: vi.fn().mockResolvedValue([adopted.page]) };

    await pageManager.adoptExistingPages(fakeBrowser as never);

    expect(adopted.fakePage.evaluateOnNewDocument).toHaveBeenCalledWith("window.__adopted = 1");
  });
});
