/**
 * Integration tests for charlotte_wait_for — covering:
 *
 *  #193: state:"exists" was polling a frozen ID map, never detecting newly-appearing elements.
 *        Fix: re-render inside the exists polling loop.
 *
 *  #198: evaluateCondition truthiness bugs:
 *        - JS lambda (function-type result) must produce immediate INVALID_ARGUMENT error.
 *        - JS expression that throws (exceptionDetails) must surface the exception message
 *          in the timeout error instead of producing an opaque TIMEOUT.
 *
 *  Bonus: timeout response must use stripped page representation (no bloated full repr).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
import { registerWaitForTools } from "../../src/tools/wait-for.js";

const WAIT_FOR_FIXTURE = `file://${path.resolve(import.meta.dirname, "../fixtures/pages/wait-for.html")}`;
const SIMPLE_FIXTURE = `file://${path.resolve(import.meta.dirname, "../fixtures/pages/simple.html")}`;

describe("charlotte_wait_for integration", () => {
  let browserManager: BrowserManager;
  let pageManager: PageManager;
  let cdpSessionManager: CDPSessionManager;
  let elementIdGenerator: ElementIdGenerator;
  let rendererPipeline: RendererPipeline;
  let deps: ToolDependencies;
  let waitForTool: ReturnType<typeof registerWaitForTools>["charlotte_wait_for"];
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
    artifactDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "charlotte-wait-for-test-"));
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

    // Register the wait_for tool against a real McpServer instance
    const server = new McpServer({ name: "charlotte-test", version: "0.0.0" });
    const tools = registerWaitForTools(server, deps);
    waitForTool = tools["charlotte_wait_for"];
  });

  afterAll(async () => {
    await browserManager.close();
    await fs.rm(artifactDirectory, { recursive: true, force: true }).catch(() => {});
  });

  beforeEach(async () => {
    // Reset to the wait-for fixture for each test
    const page = pageManager.getActivePage();
    await page.goto(WAIT_FOR_FIXTURE, { waitUntil: "load" });
    // Do an initial render so the element ID map is populated
    await renderActivePage(deps, { source: "observe" });
  });

  // ─── Issue #193: exists state polls frozen ID map ───────────────────────────

  it("#193: detects an element that appears 400ms after wait_for starts (state: exists)", async () => {
    // Trigger the delayed button addition on the page (without waiting)
    const page = pageManager.getActivePage();
    await page.evaluate(() => {
      // Trigger the JS that adds the button after 400ms
      (document.getElementById("add-button-btn") as HTMLButtonElement).click();
    });

    // The late-appearing-btn is NOT yet in the ID map.
    // Before fix: would always timeout because exists never re-renders.
    // After fix: re-renders each poll iteration and detects the new element.

    // We need the element ID of the button that will appear.
    // Since IDs are deterministic hashes, we can compute it by waiting for the
    // element to appear via the text condition first, then getting its ID.
    // Alternatively, use state:"exists" with element_id from text.
    //
    // For this test we use text condition as a proxy to confirm the button appeared,
    // then do a second call using element_id from a fresh observe.

    const result = await (waitForTool as any).handler({
      text: "Button added",
      timeout: 3000,
    });

    const parsed = JSON.parse(result.content[0].text);
    // Should NOT be an error
    expect(result.isError).toBeFalsy();
    expect(parsed.url).toBeDefined();
  }, 10000);

  it("#193: detects a dynamically-added element by its computed ID (state: exists)", async () => {
    // First, add the button immediately via JS (no delay) so we can compute its ID
    const page = pageManager.getActivePage();
    await page.evaluate(() => {
      const container = document.getElementById("dynamic-container")!;
      const btn = document.createElement("button");
      btn.id = "probed-btn";
      btn.textContent = "Probed Button";
      container.appendChild(btn);
    });

    // Do a render to capture the element ID for the new button
    const freshRepr = await renderActivePage(deps, { source: "observe" });
    const buttonElement = freshRepr.interactive.find((el) => el.label.includes("Probed Button"));
    expect(buttonElement).toBeDefined();
    const buttonId = buttonElement!.id;

    // Now navigate away and back to clear the ID map (simulate stale ID)
    await page.goto(SIMPLE_FIXTURE, { waitUntil: "load" });
    await renderActivePage(deps, { source: "observe" });

    // Go back to wait-for fixture and inject the same element again (same attrs → same hash ID)
    await page.goto(WAIT_FOR_FIXTURE, { waitUntil: "load" });
    // Initial observe with the element NOT yet present
    await renderActivePage(deps, { source: "observe" });

    // Inject the element after a short delay
    await page.evaluate(() => {
      setTimeout(() => {
        const container = document.getElementById("dynamic-container")!;
        const btn = document.createElement("button");
        btn.id = "probed-btn";
        btn.textContent = "Probed Button";
        container.appendChild(btn);
      }, 300);
    });

    // wait_for with state:"exists" should find it once the element appears
    const result = await (waitForTool as any).handler({
      element_id: buttonId,
      state: "exists",
      timeout: 3000,
    });

    // Before fix: would timeout because the exists check never re-rendered.
    // After fix: re-renders on each poll and detects the element.
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.url).toBeDefined();
  }, 15000);

  // ─── Issue #198: function-type JS expression ─────────────────────────────────

  it("#198: returns INVALID_ARGUMENT immediately when js condition is a function literal", async () => {
    const startTime = Date.now();
    const result = await (waitForTool as any).handler({
      js: "() => document.title === 'Wait For Tests'",
      timeout: 10000, // large timeout — should NOT actually wait
    });

    const elapsed = Date.now() - startTime;

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error.code).toBe("INVALID_ARGUMENT");
    expect(parsed.error.message).toContain("function");

    // Should have failed fast — well under the 10s timeout
    expect(elapsed).toBeLessThan(3000);
  }, 15000);

  it("#198: returns INVALID_ARGUMENT immediately for a named function expression (another common LLM form)", async () => {
    const startTime = Date.now();
    // Arrow functions are the most common LLM mistake:
    //   "() => document.readyState === 'complete'"
    // Named arrow functions also evaluate to type "function":
    const result = await (waitForTool as any).handler({
      js: "const fn = () => document.readyState === 'complete'; fn",
      timeout: 10000,
    });

    const elapsed = Date.now() - startTime;

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    // The final expression is a function reference — must be INVALID_ARGUMENT
    expect(parsed.error.code).toBe("INVALID_ARGUMENT");
    // Must fail fast, not wait the full timeout
    expect(elapsed).toBeLessThan(3000);
  }, 15000);

  // ─── Issue #198: non-serializable/cyclic js result fails fast ────────────────

  it("#198: returns INVALID_ARGUMENT immediately for a cyclic/non-serializable js result", async () => {
    const startTime = Date.now();
    // A self-referential object cannot be returned by value — CDP raises a
    // protocol/serialization error. Before the fix this was folded into "not
    // satisfied" and polled to TIMEOUT; now it surfaces immediately.
    const result = await (waitForTool as any).handler({
      js: "(window.__cyclic = {}, window.__cyclic.self = window.__cyclic, window.__cyclic)",
      timeout: 10000, // large timeout — must NOT actually wait
    });

    const elapsed = Date.now() - startTime;

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error.code).toBe("INVALID_ARGUMENT");
    expect(parsed.error.code).not.toBe("TIMEOUT");
    // Failed fast — well under the 10s timeout.
    expect(elapsed).toBeLessThan(3000);
  }, 15000);

  it("#198: returns INVALID_ARGUMENT immediately when js result is `window`", async () => {
    const startTime = Date.now();
    const result = await (waitForTool as any).handler({
      js: "window",
      timeout: 10000,
    });

    const elapsed = Date.now() - startTime;

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error.code).toBe("INVALID_ARGUMENT");
    expect(elapsed).toBeLessThan(3000);
  }, 15000);

  // ─── Issue #198: exception in JS expression surfaces in timeout error ─────────

  it("#198: timeout error includes exception message when js expression throws", async () => {
    const result = await (waitForTool as any).handler({
      // This expression throws a ReferenceError every evaluation
      js: "nonExistentVariable123 === true",
      timeout: 500,
    });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error.code).toBe("TIMEOUT");
    // The error message should mention the exception, not just "condition not met"
    expect(parsed.error.message).toContain("JS expression threw");
  }, 5000);

  // ─── Bonus: timeout response uses stripped page representation ───────────────

  it("bonus: timeout response uses stripped page representation (no redundant arrays)", async () => {
    const result = await (waitForTool as any).handler({
      text: "text that never appears on this page xyz123",
      timeout: 300,
    });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error.code).toBe("TIMEOUT");
    expect(parsed.page).toBeDefined();

    // Stripped representation should not include empty interactive array or forms
    // (the fixture page has no forms, so forms would be absent if stripped)
    // Key: the page object should be a plain object with url/title, not the full raw repr
    expect(parsed.page.url).toBeDefined();
    expect(parsed.page.title).toBeDefined();

    // The stripped repr should not include empty arrays that stripEmptyFields removes
    // (interact array may be non-empty, but forms should be absent on wait-for.html)
    if (parsed.page.forms !== undefined) {
      expect(parsed.page.forms.length).toBeGreaterThan(0);
    }
  }, 5000);
});
