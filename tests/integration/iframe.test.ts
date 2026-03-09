import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import { BrowserManager } from "../../src/browser/browser-manager.js";
import { PageManager } from "../../src/browser/page-manager.js";
import { CDPSessionManager } from "../../src/browser/cdp-session.js";
import { RendererPipeline } from "../../src/renderer/renderer-pipeline.js";
import { ElementIdGenerator } from "../../src/renderer/element-id-generator.js";
import { SnapshotStore } from "../../src/state/snapshot-store.js";
import { ArtifactStore } from "../../src/state/artifact-store.js";
import { createDefaultConfig } from "../../src/types/config.js";
import { StaticServer } from "../../src/dev/static-server.js";
import type { ToolDependencies } from "../../src/tools/tool-helpers.js";
import { renderActivePage, resolveElement } from "../../src/tools/tool-helpers.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures/pages");

describe("Iframe content extraction", () => {
  let browserManager: BrowserManager;
  let pageManager: PageManager;
  let cdpSessionManager: CDPSessionManager;
  let elementIdGenerator: ElementIdGenerator;
  let deps: ToolDependencies;
  let staticServer: StaticServer;
  let baseUrl: string;

  beforeAll(async () => {
    // Serve fixtures over HTTP (iframes need HTTP, not file://)
    staticServer = new StaticServer();
    const serverInfo = await staticServer.start({ directoryPath: FIXTURES_DIR });
    baseUrl = serverInfo.url;

    browserManager = new BrowserManager();
    await browserManager.launch();
    pageManager = new PageManager();
    await pageManager.openTab(browserManager);
    cdpSessionManager = new CDPSessionManager();
    elementIdGenerator = new ElementIdGenerator();

    const config = createDefaultConfig();
    config.includeIframes = true;
    config.iframeDepth = 3;

    const rendererPipeline = new RendererPipeline(
      cdpSessionManager,
      elementIdGenerator,
      config,
    );
    const artifactStore = new ArtifactStore(
      path.join(os.tmpdir(), "charlotte-iframe-test-artifacts"),
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
    await staticServer.stop();
  });

  it("extracts iframe content when includeIframes is enabled", async () => {
    const page = pageManager.getActivePage();
    await page.goto(`${baseUrl}/iframe-parent.html`, { waitUntil: "networkidle0" });

    const representation = await renderActivePage(deps, { detail: "summary" });

    // Main frame content should be present
    expect(representation.title).toBe("Iframe Parent");
    expect(representation.structure.headings.some((h) => h.text === "Parent Page")).toBe(true);

    // Iframe content should be merged in
    const iframeHeading = representation.structure.headings.find(
      (h) => h.text === "Iframe Content",
    );
    expect(iframeHeading).toBeDefined();
    expect(iframeHeading!.frame).toContain("iframe-child.html");

    // Iframe interactive elements should be present
    const iframeButton = representation.interactive.find((el) => el.label === "Iframe Button");
    expect(iframeButton).toBeDefined();
    expect(iframeButton!.frame).toContain("iframe-child.html");

    const iframeLink = representation.interactive.find((el) => el.label === "Iframe Link");
    expect(iframeLink).toBeDefined();
    expect(iframeLink!.frame).toContain("iframe-child.html");

    // Main frame elements should NOT have frame annotation
    const parentLink = representation.interactive.find((el) => el.label === "Parent Link");
    expect(parentLink).toBeDefined();
    expect(parentLink!.frame).toBeUndefined();

    // iframes metadata should include both child and grandchild
    expect(representation.iframes).toBeDefined();
    expect(representation.iframes!.length).toBe(2);
    expect(representation.iframes![0].url).toContain("iframe-child.html");
    expect(representation.iframes![0].bounds).toBeDefined();
    expect(representation.iframes![1].url).toContain("iframe-grandchild.html");
  });

  it("iframe elements have page-level bounds (offset by iframe position)", async () => {
    const page = pageManager.getActivePage();
    await page.goto(`${baseUrl}/iframe-parent.html`, { waitUntil: "networkidle0" });

    const representation = await renderActivePage(deps, { detail: "summary" });

    const iframeInfo = representation.iframes![0];
    const iframeButton = representation.interactive.find((el) => el.label === "Iframe Button");

    // The iframe button's bounds should be offset by the iframe's position
    // (its page-level x/y should be >= the iframe element's x/y)
    if (iframeInfo.bounds && iframeButton?.bounds) {
      expect(iframeButton.bounds.x).toBeGreaterThanOrEqual(iframeInfo.bounds.x);
      expect(iframeButton.bounds.y).toBeGreaterThanOrEqual(iframeInfo.bounds.y);
    }
  });

  it("iframe element IDs are resolvable via resolveElement", async () => {
    const page = pageManager.getActivePage();
    await page.goto(`${baseUrl}/iframe-parent.html`, { waitUntil: "networkidle0" });

    const representation = await renderActivePage(deps, { detail: "summary" });

    const iframeButton = representation.interactive.find((el) => el.label === "Iframe Button");
    expect(iframeButton).toBeDefined();

    // resolveElement should succeed for iframe elements
    const resolved = await resolveElement(deps, iframeButton!.id);
    expect(resolved.backendNodeId).toBeDefined();
    expect(resolved.frameId).toBeTruthy();
  });

  it("does not extract iframes when includeIframes is disabled", async () => {
    // Temporarily disable
    deps.config.includeIframes = false;

    const page = pageManager.getActivePage();
    await page.goto(`${baseUrl}/iframe-parent.html`, { waitUntil: "networkidle0" });

    const representation = await renderActivePage(deps, { detail: "summary" });

    // Should only have main frame content
    expect(representation.structure.headings.every((h) => !h.frame)).toBe(true);
    expect(representation.interactive.every((el) => !el.frame)).toBe(true);
    expect(representation.iframes).toBeUndefined();

    // Re-enable for subsequent tests
    deps.config.includeIframes = true;
  });

  it("includes iframe content in full content extraction", async () => {
    const page = pageManager.getActivePage();
    await page.goto(`${baseUrl}/iframe-parent.html`, { waitUntil: "networkidle0" });

    const representation = await renderActivePage(deps, { detail: "full" });

    expect(representation.structure.full_content).toBeDefined();
    expect(representation.structure.full_content).toContain("iframe-child.html");
    expect(representation.structure.full_content).toContain("This is content inside an iframe.");
  });

  it("includes iframe content in content summary", async () => {
    const page = pageManager.getActivePage();
    await page.goto(`${baseUrl}/iframe-parent.html`, { waitUntil: "networkidle0" });

    const representation = await renderActivePage(deps, { detail: "summary" });

    expect(representation.structure.content_summary).toBeDefined();
    expect(representation.structure.content_summary).toContain("iframe");
  });

  it("extracts nested iframes (depth > 1)", async () => {
    const page = pageManager.getActivePage();
    await page.goto(`${baseUrl}/iframe-parent.html`, { waitUntil: "networkidle0" });

    const representation = await renderActivePage(deps, { detail: "summary" });

    // Grandchild iframe heading should be present
    const nestedHeading = representation.structure.headings.find(
      (h) => h.text === "Nested Iframe Content",
    );
    expect(nestedHeading).toBeDefined();
    expect(nestedHeading!.frame).toContain("iframe-grandchild.html");

    // Grandchild interactive element should be present
    const nestedButton = representation.interactive.find((el) => el.label === "Nested Button");
    expect(nestedButton).toBeDefined();
    expect(nestedButton!.frame).toContain("iframe-grandchild.html");
  });

  it("respects iframeDepth limit", async () => {
    // Set depth to 1 — should get child but not grandchild
    deps.config.iframeDepth = 1;

    const page = pageManager.getActivePage();
    await page.goto(`${baseUrl}/iframe-parent.html`, { waitUntil: "networkidle0" });

    const representation = await renderActivePage(deps, { detail: "summary" });

    // Child iframe content should be present
    const childHeading = representation.structure.headings.find(
      (h) => h.text === "Iframe Content",
    );
    expect(childHeading).toBeDefined();

    // Grandchild iframe content should NOT be present
    const nestedHeading = representation.structure.headings.find(
      (h) => h.text === "Nested Iframe Content",
    );
    expect(nestedHeading).toBeUndefined();

    // Only 1 iframe should be discovered
    expect(representation.iframes).toBeDefined();
    expect(representation.iframes!.length).toBe(1);
    expect(representation.iframes![0].url).toContain("iframe-child.html");

    // Restore depth for subsequent tests
    deps.config.iframeDepth = 3;
  });
});
