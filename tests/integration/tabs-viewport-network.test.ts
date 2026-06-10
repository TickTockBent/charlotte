import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import { BrowserManager } from "../../src/browser/browser-manager.js";
import { PageManager } from "../../src/browser/page-manager.js";
import { CDPSessionManager } from "../../src/browser/cdp-session.js";
import { RendererPipeline } from "../../src/renderer/renderer-pipeline.js";
import { ElementIdGenerator } from "../../src/renderer/element-id-generator.js";
import { SnapshotStore } from "../../src/state/snapshot-store.js";
import { ArtifactStore } from "../../src/state/artifact-store.js";
import { createDefaultConfig } from "../../src/types/config.js";
import type { ToolDependencies } from "../../src/tools/tool-helpers.js";
import { renderActivePage } from "../../src/tools/tool-helpers.js";
import { StaticServer } from "../../src/dev/static-server.js";

const SIMPLE_FIXTURE = `file://${path.resolve(import.meta.dirname, "../fixtures/pages/simple.html")}`;
const DYNAMIC_FIXTURE = `file://${path.resolve(import.meta.dirname, "../fixtures/pages/dynamic.html")}`;

describe("Tabs, viewport, and network integration", () => {
  let browserManager: BrowserManager;
  let pageManager: PageManager;
  let cdpSessionManager: CDPSessionManager;
  let elementIdGenerator: ElementIdGenerator;
  let rendererPipeline: RendererPipeline;
  let deps: ToolDependencies;
  let artifactDirectory: string;

  beforeAll(async () => {
    browserManager = new BrowserManager(undefined, { noSandbox: true });
    await browserManager.launch();
    pageManager = new PageManager();
    await pageManager.openTab(browserManager);
    cdpSessionManager = new CDPSessionManager();
    elementIdGenerator = new ElementIdGenerator();
    rendererPipeline = new RendererPipeline(cdpSessionManager, elementIdGenerator);
    const config = createDefaultConfig();
    artifactDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "charlotte-tvn-test-"));
    const artifactStore = new ArtifactStore(artifactDirectory);
    await artifactStore.initialize();
    deps = {
      browserManager,
      pageManager,
      cdpSessionManager,
      rendererPipeline,
      elementIdGenerator,
      snapshotStore: new SnapshotStore(config.snapshotDepth),
      artifactStore,
      config,
    };
  });

  afterAll(async () => {
    await browserManager.close();
    await fs.rm(artifactDirectory, { recursive: true, force: true }).catch(() => {});
  });

  describe("tab management", () => {
    it("lists the initial tab", async () => {
      const tabs = await pageManager.listTabs();

      expect(tabs).toHaveLength(1);
      expect(tabs[0].active).toBe(true);
    });

    it("opens a new tab and navigates to URL", async () => {
      const tabId = await pageManager.openTab(browserManager, SIMPLE_FIXTURE);

      expect(tabId).toMatch(/^tab-\d+$/);

      const tabs = await pageManager.listTabs();
      const newTab = tabs.find((t) => t.id === tabId);
      expect(newTab).toBeDefined();
      expect(newTab!.active).toBe(true);
      expect(newTab!.title).toBe("Simple Test Page");
    });

    it("switches between tabs and preserves page state", async () => {
      const page = pageManager.getActivePage();
      await page.goto(SIMPLE_FIXTURE, { waitUntil: "load" });

      const tabIdA = pageManager.getActiveTabId();

      // Open second tab with different page
      const tabIdB = await pageManager.openTab(browserManager, DYNAMIC_FIXTURE);

      // Verify we're on the dynamic page
      let currentPage = pageManager.getActivePage();
      expect(await currentPage.title()).toBe("Dynamic Test Page");

      // Switch back to first tab
      await pageManager.switchTab(tabIdA);
      currentPage = pageManager.getActivePage();
      expect(await currentPage.title()).toBe("Simple Test Page");

      // Switch back to second tab
      await pageManager.switchTab(tabIdB);
      currentPage = pageManager.getActivePage();
      expect(await currentPage.title()).toBe("Dynamic Test Page");
    });

    it("renders active page after tab switch", async () => {
      // Navigate a known tab to a page with content
      const page = pageManager.getActivePage();
      await page.goto(DYNAMIC_FIXTURE, { waitUntil: "load" });
      const currentTabId = pageManager.getActiveTabId();

      // Open a second tab with a different page
      const otherTabId = await pageManager.openTab(browserManager, SIMPLE_FIXTURE);

      // Switch back to the first tab and render
      await pageManager.switchTab(currentTabId);

      const representation = await renderActivePage(deps, {
        source: "action",
      });

      expect(representation.title).toBe("Dynamic Test Page");
      expect(representation.url).toContain("dynamic.html");

      // Clean up extra tab
      await pageManager.closeTab(otherTabId);
    });

    it("closes a tab and updates active tab", async () => {
      const tabsBefore = await pageManager.listTabs();
      const tabCountBefore = tabsBefore.length;

      // Open a disposable tab
      const disposableTabId = await pageManager.openTab(browserManager);
      expect((await pageManager.listTabs()).length).toBe(tabCountBefore + 1);

      // Close it
      await pageManager.closeTab(disposableTabId);

      const tabsAfter = await pageManager.listTabs();
      expect(tabsAfter.length).toBe(tabCountBefore);

      // Active tab should still work
      const activeTab = tabsAfter.find((t) => t.active);
      expect(activeTab).toBeDefined();
    });

    it("switches to remaining tab when active tab is closed", async () => {
      // Start fresh-ish: get current state
      const tabsBefore = await pageManager.listTabs();

      // Open a new tab — it becomes active
      const newTabId = await pageManager.openTab(browserManager, DYNAMIC_FIXTURE);
      expect(pageManager.getActiveTabId()).toBe(newTabId);

      // Close the active (new) tab
      await pageManager.closeTab(newTabId);

      // Should auto-switch to a remaining tab
      const tabsAfter = await pageManager.listTabs();
      expect(tabsAfter.length).toBe(tabsBefore.length);

      const activeTab = tabsAfter.find((t) => t.active);
      expect(activeTab).toBeDefined();
    });

    it("tab list includes URLs and titles", async () => {
      // Navigate current tab to a known page
      const page = pageManager.getActivePage();
      await page.goto(SIMPLE_FIXTURE, { waitUntil: "load" });

      const tabs = await pageManager.listTabs();
      const activeTab = tabs.find((t) => t.active);

      expect(activeTab).toBeDefined();
      expect(activeTab!.url).toContain("simple.html");
      expect(activeTab!.title).toBe("Simple Test Page");
    });
  });

  describe("viewport", () => {
    it("sets viewport to custom dimensions", async () => {
      const page = pageManager.getActivePage();
      await page.goto(SIMPLE_FIXTURE, { waitUntil: "load" });

      await page.setViewport({ width: 800, height: 600 });

      const representation = await renderActivePage(deps, {
        source: "action",
      });

      expect(representation.viewport.width).toBe(800);
      expect(representation.viewport.height).toBe(600);
    });

    it("sets viewport to mobile preset dimensions", async () => {
      const page = pageManager.getActivePage();

      await page.setViewport({ width: 393, height: 852 });

      const representation = await renderActivePage(deps, {
        source: "action",
      });

      expect(representation.viewport.width).toBe(393);
      expect(representation.viewport.height).toBe(852);
    });

    it("sets viewport to tablet preset dimensions", async () => {
      const page = pageManager.getActivePage();

      await page.setViewport({ width: 768, height: 1024 });

      const representation = await renderActivePage(deps, {
        source: "action",
      });

      expect(representation.viewport.width).toBe(768);
      expect(representation.viewport.height).toBe(1024);
    });

    it("sets viewport to desktop preset dimensions", async () => {
      const page = pageManager.getActivePage();

      await page.setViewport({ width: 1440, height: 900 });

      const representation = await renderActivePage(deps, {
        source: "action",
      });

      expect(representation.viewport.width).toBe(1440);
      expect(representation.viewport.height).toBe(900);
    });

    it("layout changes after viewport resize", async () => {
      const page = pageManager.getActivePage();
      await page.goto(SIMPLE_FIXTURE, { waitUntil: "load" });

      // Render at desktop size
      await page.setViewport({ width: 1440, height: 900 });
      const desktopRepresentation = await renderActivePage(deps, {
        source: "action",
      });

      // Render at mobile size
      await page.setViewport({ width: 393, height: 852 });
      const mobileRepresentation = await renderActivePage(deps, {
        source: "action",
      });

      // The viewport values should differ
      expect(desktopRepresentation.viewport.width).toBe(1440);
      expect(mobileRepresentation.viewport.width).toBe(393);

      // Interactive elements should still be detected at both sizes
      expect(desktopRepresentation.interactive.length).toBeGreaterThan(0);
      expect(mobileRepresentation.interactive.length).toBeGreaterThan(0);
    });
  });

  describe("network", () => {
    it("applies network throttling via CDP", async () => {
      const page = pageManager.getActivePage();
      const session = await page.createCDPSession();

      // Apply 3g throttling — should not throw
      await session.send("Network.emulateNetworkConditions", {
        offline: false,
        downloadThroughput: (1.6 * 1024 * 1024) / 8,
        uploadThroughput: (750 * 1024) / 8,
        latency: 150,
      });

      // Disable throttling
      await session.send("Network.emulateNetworkConditions", {
        offline: false,
        downloadThroughput: -1,
        uploadThroughput: -1,
        latency: 0,
      });
    });

    it("blocks URL patterns via CDP (legacy direct-session test)", async () => {
      const page = pageManager.getActivePage();
      const session = await page.createCDPSession();

      // Block patterns — should not throw
      await session.send("Network.setBlockedURLs", {
        urls: ["*.ads.example.com", "tracking.js"],
      });

      // Clear blocked patterns
      await session.send("Network.setBlockedURLs", { urls: [] });
    });

    it("blocks URL patterns via CDPSessionManager (issue #192 — blocking actually works)", async () => {
      // This test verifies that using the cached CDPSessionManager session (which has
      // Network domain enabled) actually causes Network.setBlockedURLs to block requests,
      // unlike a fresh session without Network.enable.

      const staticServer = new StaticServer();
      const fixturesDir = path.resolve(import.meta.dirname, "../fixtures/pages");
      const serverInfo = await staticServer.start({ directoryPath: fixturesDir });

      try {
        const page = pageManager.getActivePage();

        // Navigate to our test fixture (served over HTTP so fetch works)
        await page.goto(`${serverInfo.url}/network-block.html`, { waitUntil: "load" });

        // Mirror the charlotte_network handler: the cached session does NOT
        // pre-enable Network (the render path doesn't need it), so the handler
        // enables it explicitly before setBlockedURLs (#192).
        const session = await cdpSessionManager.getSession(page);
        await session.send("Network.enable");

        // Block requests to simple.html
        await session.send("Network.setBlockedURLs", { urls: [`${serverInfo.url}/simple.html`] });

        // Attempt to fetch the blocked URL from within the page
        const resultBlocked = await page.evaluate(async (url: string) => {
          try {
            await fetch(url);
            return { blocked: false };
          } catch (err) {
            return { blocked: true, error: (err as Error).message };
          }
        }, `${serverInfo.url}/simple.html`);

        // The fetch should have been blocked (net::ERR_BLOCKED_BY_CLIENT)
        expect(resultBlocked.blocked).toBe(true);

        // Now clear the block and verify the URL becomes reachable again
        await session.send("Network.setBlockedURLs", { urls: [] });

        const resultUnblocked = await page.evaluate(async (url: string) => {
          try {
            const response = await fetch(url);
            return { blocked: false, status: response.status };
          } catch {
            return { blocked: true };
          }
        }, `${serverInfo.url}/simple.html`);

        // After clearing, the fetch should succeed
        expect(resultUnblocked.blocked).toBe(false);
        expect(resultUnblocked.status).toBe(200);
      } finally {
        // Restore clean state: clear any remaining block patterns
        const page = pageManager.getActivePage();
        const session = await cdpSessionManager.getSession(page);
        await session.send("Network.setBlockedURLs", { urls: [] });
        await staticServer.stop();
      }
    });

    it("emulates offline mode and restores", async () => {
      const page = pageManager.getActivePage();
      const session = await page.createCDPSession();

      // Go offline
      await session.send("Network.emulateNetworkConditions", {
        offline: true,
        downloadThroughput: 0,
        uploadThroughput: 0,
        latency: 0,
      });

      // Restore network
      await session.send("Network.emulateNetworkConditions", {
        offline: false,
        downloadThroughput: -1,
        uploadThroughput: -1,
        latency: 0,
      });

      // Verify page still works after restoring network
      await page.goto(SIMPLE_FIXTURE, { waitUntil: "load" });
      const title = await page.title();
      expect(title).toBe("Simple Test Page");
    });
  });
});
