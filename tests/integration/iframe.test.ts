import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import { BrowserManager } from "../../src/browser/browser-manager.js";
import { PageManager } from "../../src/browser/page-manager.js";
import { CDPSessionManager, frameClient } from "../../src/browser/cdp-session.js";
import { RendererPipeline } from "../../src/renderer/renderer-pipeline.js";
import { ElementIdGenerator } from "../../src/renderer/element-id-generator.js";
import { SnapshotStore } from "../../src/state/snapshot-store.js";
import { ArtifactStore } from "../../src/state/artifact-store.js";
import { createDefaultConfig } from "../../src/types/config.js";
import { StaticServer } from "../../src/dev/static-server.js";
import type { ToolDependencies } from "../../src/tools/tool-helpers.js";
import {
  renderActivePage,
  resolveElement,
  getSessionForElement,
} from "../../src/tools/tool-helpers.js";
import {
  clickElementByBackendNodeId,
  hoverElementByBackendNodeId,
  typeIntoElement,
  selectOptionByBackendNodeId,
  focusElementByBackendNodeId,
} from "../../src/tools/interaction-helpers.js";

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

    browserManager = new BrowserManager(undefined, { noSandbox: true });
    await browserManager.launch();
    cdpSessionManager = new CDPSessionManager();
    pageManager = new PageManager(undefined, cdpSessionManager);
    await pageManager.openTab(browserManager);
    elementIdGenerator = new ElementIdGenerator();

    const config = createDefaultConfig();
    config.includeIframes = true;
    config.iframeDepth = 3;

    const rendererPipeline = new RendererPipeline(cdpSessionManager, elementIdGenerator, config);
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

  // Regression for #183: same-origin iframe content shares the main-frame CDP
  // session, so DOM.getBoxModel already returns page-viewport coordinates. The
  // iframe contentOffset must NOT be applied a second time. We assert that
  // Charlotte's reported bounds match Puppeteer's boundingBox() ground truth
  // (which is computed independently against the live page) within a few px.
  // The old >= assertion above passes under the double-offset bug; this one
  // does not. We compare center points because Charlotte's bounds use the AX
  // content box while boundingBox() uses the border box.
  it("same-origin iframe element bounds match Puppeteer ground truth (no double offset)", async () => {
    const page = pageManager.getActivePage();
    await page.goto(`${baseUrl}/iframe-parent.html`, { waitUntil: "networkidle0" });

    const representation = await renderActivePage(deps, { detail: "summary" });

    const childFrame = page.frames().find((f) => f.url().includes("iframe-child.html"));
    expect(childFrame).toBeDefined();

    const centerOf = (b: { x: number; y: number; w: number; h: number }) => ({
      x: b.x + b.w / 2,
      y: b.y + b.h / 2,
    });

    // Check several element types inside the iframe against their selectors.
    const cases: { label: string; selector: string }[] = [
      { label: "Iframe Button", selector: "#iframe-btn" },
      { label: "Iframe Input", selector: "#iframe-input" },
      { label: "Iframe Select", selector: "#iframe-select" },
    ];

    const TOLERANCE_PX = 6;

    for (const { label, selector } of cases) {
      const element = representation.interactive.find((el) => el.label === label);
      expect(element, `expected to find iframe element "${label}"`).toBeDefined();
      expect(element!.bounds, `expected bounds for "${label}"`).toBeDefined();

      const handle = await childFrame!.$(selector);
      expect(handle, `expected DOM node for ${selector}`).not.toBeNull();
      const groundTruth = await handle!.boundingBox();
      expect(groundTruth, `expected boundingBox for ${selector}`).not.toBeNull();

      const charlotteCenter = centerOf(element!.bounds!);
      const truthCenter = centerOf({
        x: groundTruth!.x,
        y: groundTruth!.y,
        w: groundTruth!.width,
        h: groundTruth!.height,
      });

      // Under the double-offset bug the y is off by the iframe's ~150px top
      // offset (and x by ~10px), far outside tolerance.
      expect(
        Math.abs(charlotteCenter.x - truthCenter.x),
        `${label} x center off: charlotte=${charlotteCenter.x} truth=${truthCenter.x}`,
      ).toBeLessThanOrEqual(TOLERANCE_PX);
      expect(
        Math.abs(charlotteCenter.y - truthCenter.y),
        `${label} y center off: charlotte=${charlotteCenter.y} truth=${truthCenter.y}`,
      ).toBeLessThanOrEqual(TOLERANCE_PX);
    }
  });

  // Regression for #183: nested same-origin iframe (grandchild) is also
  // same-process and must not be double-offset by the accumulated content
  // offset of two iframe levels.
  it("nested same-origin iframe element bounds match Puppeteer ground truth", async () => {
    const page = pageManager.getActivePage();
    await page.goto(`${baseUrl}/iframe-parent.html`, { waitUntil: "networkidle0" });

    const representation = await renderActivePage(deps, { detail: "summary" });

    const grandchildFrame = page.frames().find((f) => f.url().includes("iframe-grandchild.html"));
    expect(grandchildFrame).toBeDefined();

    const nestedButton = representation.interactive.find((el) => el.label === "Nested Button");
    expect(nestedButton).toBeDefined();
    expect(nestedButton!.bounds).toBeDefined();

    const handle = await grandchildFrame!.$("button");
    const groundTruth = await handle!.boundingBox();
    expect(groundTruth).not.toBeNull();

    const charlotteCenterX = nestedButton!.bounds!.x + nestedButton!.bounds!.w / 2;
    const charlotteCenterY = nestedButton!.bounds!.y + nestedButton!.bounds!.h / 2;
    const truthCenterX = groundTruth!.x + groundTruth!.width / 2;
    const truthCenterY = groundTruth!.y + groundTruth!.height / 2;

    expect(Math.abs(charlotteCenterX - truthCenterX)).toBeLessThanOrEqual(6);
    expect(Math.abs(charlotteCenterY - truthCenterY)).toBeLessThanOrEqual(6);
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
    const childHeading = representation.structure.headings.find((h) => h.text === "Iframe Content");
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

  // #68: with detail=minimal and iframes enabled, the interactive summary must
  // preserve per-landmark grouping for BOTH main-frame and iframe elements,
  // instead of collapsing everything into "(page root)" / "(iframe)".
  describe("interactive summary preserves landmark context with iframes (#68)", () => {
    it("groups iframe elements under their frame + landmark, not a flat (iframe) bucket", async () => {
      const page = pageManager.getActivePage();
      await page.goto(`${baseUrl}/iframe-parent.html`, { waitUntil: "networkidle0" });

      const representation = await renderActivePage(deps, { detail: "minimal" });

      const summary = representation.interactive_summary;
      expect(summary).toBeDefined();

      const keys = Object.keys(summary!.by_landmark);

      // The old buildInteractiveSummaryFromElements produced exactly these two
      // keys and nothing else; the fix must NOT collapse into them.
      expect(keys).not.toContain("(iframe)");

      // Main-frame elements retain landmark grouping: the parent link lives in
      // a <nav> landmark, so a "navigation" key must exist (not "(page root)").
      const navKey = keys.find((k) => k.startsWith("navigation") && !k.includes("iframe ("));
      expect(
        navKey,
        `expected a main-frame navigation landmark key in ${JSON.stringify(keys)}`,
      ).toBeDefined();
      expect(summary!.by_landmark[navKey!].link).toBeGreaterThanOrEqual(1);

      // Iframe elements are attributed to their frame and inner landmark. The
      // child iframe wraps its controls in <main>.
      const childMainKey = keys.find(
        (k) => k.includes("iframe-child.html") && k.endsWith("> main"),
      );
      expect(
        childMainKey,
        `expected an iframe-child main landmark key in ${JSON.stringify(keys)}`,
      ).toBeDefined();
      const childCounts = summary!.by_landmark[childMainKey!];
      expect(childCounts.button).toBeGreaterThanOrEqual(1);
      expect(childCounts.link).toBeGreaterThanOrEqual(1);
      expect(childCounts.text_input).toBeGreaterThanOrEqual(1);

      // Grandchild iframe content is also grouped under its own frame key.
      const grandchildKey = keys.find((k) => k.includes("iframe-grandchild.html"));
      expect(
        grandchildKey,
        `expected an iframe-grandchild key in ${JSON.stringify(keys)}`,
      ).toBeDefined();

      // Total must still equal the number of interactive elements found.
      const sumOfCounts = Object.values(summary!.by_landmark)
        .flatMap((counts) => Object.values(counts))
        .reduce((acc, n) => acc + n, 0);
      expect(summary!.total).toBe(sumOfCounts);
    });
  });

  describe("frame session cleanup", () => {
    it("cleans up frame sessions when navigating away from an iframe page", async () => {
      const page = pageManager.getActivePage();
      await page.goto(`${baseUrl}/iframe-parent.html`, { waitUntil: "networkidle0" });

      // Render to trigger frame session creation
      await renderActivePage(deps, { detail: "summary" });
      expect(cdpSessionManager.frameSessionCount).toBeGreaterThan(0);

      // Navigate to a non-iframe page — child frames detach
      await page.goto(`${baseUrl}/simple.html`, { waitUntil: "load" });

      // Frame sessions should be cleaned up via framedetached events
      expect(cdpSessionManager.frameSessionCount).toBe(0);
    });

    it("cleans up frame sessions on tab close", async () => {
      // Open a fresh tab for this test
      const tabId = await pageManager.openTab(browserManager);
      const page = pageManager.getActivePage();
      await page.goto(`${baseUrl}/iframe-parent.html`, { waitUntil: "networkidle0" });

      await renderActivePage(deps, { detail: "summary" });
      expect(cdpSessionManager.frameSessionCount).toBeGreaterThan(0);

      await pageManager.closeTab(tabId);

      expect(cdpSessionManager.frameSessionCount).toBe(0);
    });
  });

  describe("Iframe element interaction", () => {
    it("clicks a button inside an iframe", async () => {
      const page = pageManager.getActivePage();
      await page.goto(`${baseUrl}/iframe-parent.html`, { waitUntil: "networkidle0" });

      const representation = await renderActivePage(deps, { detail: "summary" });
      const iframeButton = representation.interactive.find((el) => el.label === "Iframe Button");
      expect(iframeButton).toBeDefined();

      const resolved = await resolveElement(deps, iframeButton!.id);
      expect(resolved.frameId).toBeTruthy();

      const session = await getSessionForElement(deps, resolved);
      // Should not throw — clicking an iframe element via frame-specific session
      await clickElementByBackendNodeId(resolved.page, resolved.backendNodeId, "left", [], session);
    });

    it("types into an input inside an iframe", async () => {
      const page = pageManager.getActivePage();
      await page.goto(`${baseUrl}/iframe-parent.html`, { waitUntil: "networkidle0" });

      const representation = await renderActivePage(deps, { detail: "summary" });
      const iframeInput = representation.interactive.find((el) => el.label === "Iframe Input");
      expect(iframeInput).toBeDefined();

      const resolved = await resolveElement(deps, iframeInput!.id);
      const session = await getSessionForElement(deps, resolved);

      await typeIntoElement(
        resolved.page,
        resolved.backendNodeId,
        "hello from iframe",
        true,
        false,
        undefined,
        session,
      );

      // Verify the value was typed into the iframe input
      const childFrame = page.frames().find((f) => f.url().includes("iframe-child.html"));
      expect(childFrame).toBeDefined();
      const inputValue = await childFrame!.evaluate(() => {
        const input = document.getElementById("iframe-input") as HTMLInputElement;
        return input?.value ?? "";
      });
      expect(inputValue).toBe("hello from iframe");
    });

    it("selects an option in a select inside an iframe", async () => {
      const page = pageManager.getActivePage();
      await page.goto(`${baseUrl}/iframe-parent.html`, { waitUntil: "networkidle0" });

      const representation = await renderActivePage(deps, { detail: "summary" });
      const iframeSelect = representation.interactive.find((el) => el.label === "Iframe Select");
      expect(iframeSelect).toBeDefined();

      const resolved = await resolveElement(deps, iframeSelect!.id);
      const session = await getSessionForElement(deps, resolved);

      await selectOptionByBackendNodeId(resolved.page, resolved.backendNodeId, "beta", session);

      // Verify the value was selected
      const childFrame = page.frames().find((f) => f.url().includes("iframe-child.html"));
      expect(childFrame).toBeDefined();
      const selectedValue = await childFrame!.evaluate(() => {
        const select = document.getElementById("iframe-select") as HTMLSelectElement;
        return select?.value ?? "";
      });
      expect(selectedValue).toBe("beta");
    });

    it("toggles a checkbox inside an iframe", async () => {
      const page = pageManager.getActivePage();
      await page.goto(`${baseUrl}/iframe-parent.html`, { waitUntil: "networkidle0" });

      const representation = await renderActivePage(deps, { detail: "summary" });
      const iframeCheckbox = representation.interactive.find(
        (el) => el.label === "Iframe Checkbox",
      );
      expect(iframeCheckbox).toBeDefined();

      const resolved = await resolveElement(deps, iframeCheckbox!.id);
      const session = await getSessionForElement(deps, resolved);

      // Click to check
      await clickElementByBackendNodeId(resolved.page, resolved.backendNodeId, "left", [], session);

      const childFrame = page.frames().find((f) => f.url().includes("iframe-child.html"));
      expect(childFrame).toBeDefined();
      const isChecked = await childFrame!.evaluate(() => {
        const checkbox = document.getElementById("iframe-checkbox") as HTMLInputElement;
        return checkbox?.checked ?? false;
      });
      expect(isChecked).toBe(true);
    });

    it("hovers over an element inside an iframe", async () => {
      const page = pageManager.getActivePage();
      await page.goto(`${baseUrl}/iframe-parent.html`, { waitUntil: "networkidle0" });

      const representation = await renderActivePage(deps, { detail: "summary" });
      const iframeButton = representation.interactive.find((el) => el.label === "Iframe Button");
      expect(iframeButton).toBeDefined();

      const resolved = await resolveElement(deps, iframeButton!.id);
      const session = await getSessionForElement(deps, resolved);

      // Should not throw
      await hoverElementByBackendNodeId(resolved.page, resolved.backendNodeId, session);
    });

    it("focuses an element inside an iframe", async () => {
      const page = pageManager.getActivePage();
      await page.goto(`${baseUrl}/iframe-parent.html`, { waitUntil: "networkidle0" });

      const representation = await renderActivePage(deps, { detail: "summary" });
      const iframeInput = representation.interactive.find((el) => el.label === "Iframe Input");
      expect(iframeInput).toBeDefined();

      const resolved = await resolveElement(deps, iframeInput!.id);
      const session = await getSessionForElement(deps, resolved);

      // Should not throw
      await focusElementByBackendNodeId(resolved.page, resolved.backendNodeId, session);
    });
  });

  describe("Puppeteer internals smoke test", () => {
    // #84: Frame._id has no public Puppeteer accessor in 24.x, so
    // CDPSessionManager.getFrameId still reads the internal field. Assert it
    // exists so a Puppeteer upgrade that removes it fails loudly here.
    it("Frame._id is a non-empty string (still required, no public accessor)", () => {
      const page = pageManager.getActivePage();
      const mainFrame = page.mainFrame();
      const frameId = (mainFrame as unknown as { _id?: unknown })._id;

      expect(typeof frameId).toBe("string");
      expect((frameId as string).length).toBeGreaterThan(0);
    });

    // #84: Frame.client is not on the public abstract Frame type in puppeteer
    // 24.x (only the internal CdpFrame subclass exposes it), so we read it via
    // the frameClient() helper. Assert it resolves so an upgrade that removes
    // it fails loudly here.
    it("Frame.client resolves to a CDPSession with a send method", () => {
      const page = pageManager.getActivePage();
      const mainFrame = page.mainFrame();
      const client = frameClient(mainFrame);

      expect(client).toBeDefined();
      expect(typeof client!.send).toBe("function");
    });

    // #183: same-process child frames share the main frame's client; OOPIFs do
    // not. Our offset logic depends on this identity holding for same-origin
    // frames. The fixtures are all same-origin, so every discovered frame must
    // share the main frame client.
    it("same-origin child frames share the main frame CDP client", async () => {
      const page = pageManager.getActivePage();
      await page.goto(`${baseUrl}/iframe-parent.html`, { waitUntil: "networkidle0" });

      const mainFrameClient = frameClient(page.mainFrame());
      const childFrames = page.frames().filter((f) => f !== page.mainFrame());
      expect(childFrames.length).toBeGreaterThan(0);
      for (const child of childFrames) {
        expect(frameClient(child)).toBe(mainFrameClient);
      }
    });
  });
});
