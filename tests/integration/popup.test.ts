import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as http from "node:http";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
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
import { waitForPossibleNavigation } from "../../src/tools/interaction.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures/pages");

describe("Popup tab capture", () => {
  let browserManager: BrowserManager;
  let pageManager: PageManager;
  let cdpSessionManager: CDPSessionManager;
  let elementIdGenerator: ElementIdGenerator;
  let rendererPipeline: RendererPipeline;
  let deps: ToolDependencies;
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    // HTTP server required — target="_blank" doesn't work with file:// URLs
    server = http.createServer((req, res) => {
      const requestedPath = req.url === "/" ? "/popup.html" : req.url!;
      const filePath = path.join(FIXTURES_DIR, requestedPath);
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;

    browserManager = new BrowserManager();
    await browserManager.launch();
    pageManager = new PageManager();
    await pageManager.openTab(browserManager);
    cdpSessionManager = new CDPSessionManager();
    elementIdGenerator = new ElementIdGenerator();
    rendererPipeline = new RendererPipeline(cdpSessionManager, elementIdGenerator);
    const config = createDefaultConfig();
    const artifactStore = new ArtifactStore(
      path.join(os.tmpdir(), "charlotte-popup-test-artifacts"),
    );
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
    server.close();
  });

  beforeEach(async () => {
    // Navigate to the popup fixture and drain any stale new-tab events
    const page = pageManager.getActivePage();
    await page.goto(`${baseUrl}/popup.html`, { waitUntil: "load" });
    pageManager.consumeNewTabs();
  });

  it("captures target=_blank link clicks as new tabs", async () => {
    const page = pageManager.getActivePage();

    // Use evaluate to click — Puppeteer's page.click on target="_blank" links
    // waits for a navigation event that never fires on the current page
    await page.evaluate(() => {
      document.getElementById("blank-link")!.click();
    });
    await new Promise((resolve) => setTimeout(resolve, 500));

    const newTabs = pageManager.consumeNewTabs();
    expect(newTabs.length).toBe(1);

    const tabs = await pageManager.listTabs();
    const popupTab = tabs.find((t) => t.id === newTabs[0]);
    expect(popupTab).toBeDefined();
    expect(popupTab!.url).toContain("/simple.html");
  });

  it("captures window.open() popups as new tabs", async () => {
    const page = pageManager.getActivePage();

    // Use evaluate to trigger window.open — page.click("#window-open") hangs
    // because Puppeteer waits for navigation that never happens on the current page
    await page.evaluate(() => {
      document.getElementById("window-open")!.click();
    });
    await new Promise((resolve) => setTimeout(resolve, 500));

    const newTabs = pageManager.consumeNewTabs();
    expect(newTabs.length).toBe(1);

    const tabs = await pageManager.listTabs();
    const popupTab = tabs.find((t) => t.id === newTabs[0]);
    expect(popupTab).toBeDefined();
    expect(popupTab!.url).toContain("/simple.html");
  });

  it("surfaces opened_tabs in renderActivePage response", async () => {
    const page = pageManager.getActivePage();

    // Use evaluate to click — page.click on target="_blank" links hangs
    await page.evaluate(() => {
      document.getElementById("blank-link")!.click();
    });
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Render should include opened_tabs (drains the queue)
    const representation = await renderActivePage(deps, { source: "action" });
    expect(representation.opened_tabs).toBeDefined();
    expect(representation.opened_tabs!.length).toBe(1);

    // Subsequent render should NOT include opened_tabs (single-consumption)
    const representation2 = await renderActivePage(deps, { source: "action" });
    expect(representation2.opened_tabs).toBeUndefined();
  });

  it("does not report opened_tabs for same-tab navigation", async () => {
    const page = pageManager.getActivePage();

    await waitForPossibleNavigation(page, async () => {
      await page.click("#same-tab-link");
    });

    const newTabs = pageManager.consumeNewTabs();
    expect(newTabs.length).toBe(0);
  });

  it("auto-cleans tabs when page closes itself", async () => {
    const page = pageManager.getActivePage();

    // Open a popup via window.open and capture a reference
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>)._popup = window.open("about:blank", "_blank");
    });
    await new Promise((resolve) => setTimeout(resolve, 500));

    const newTabs = pageManager.consumeNewTabs();
    expect(newTabs.length).toBe(1);
    const popupTabId = newTabs[0];

    const tabsBefore = await pageManager.listTabs();
    const popupTabExists = tabsBefore.some((t) => t.id === popupTabId);
    expect(popupTabExists).toBe(true);

    // Close the popup from the opener
    await page.evaluate(() => {
      ((window as unknown as Record<string, unknown>)._popup as Window).close();
    });
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Tab should have been auto-removed
    const tabsAfter = await pageManager.listTabs();
    const popupTabStillExists = tabsAfter.some((t) => t.id === popupTabId);
    expect(popupTabStillExists).toBe(false);
  });
});
