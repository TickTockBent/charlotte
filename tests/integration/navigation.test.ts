import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import { BrowserManager } from "../../src/browser/browser-manager.js";
import { PageManager } from "../../src/browser/page-manager.js";
import { CDPSessionManager } from "../../src/browser/cdp-session.js";
import { RendererPipeline } from "../../src/renderer/renderer-pipeline.js";
import { ElementIdGenerator } from "../../src/renderer/element-id-generator.js";
import type { ToolDependencies } from "../../src/tools/tool-helpers.js";
import {
  renderActivePage,
  formatPageResponse,
} from "../../src/tools/tool-helpers.js";

const SIMPLE_FIXTURE = `file://${path.resolve(import.meta.dirname, "../fixtures/pages/simple.html")}`;
const SPA_FIXTURE = `file://${path.resolve(import.meta.dirname, "../fixtures/pages/spa.html")}`;
const DYNAMIC_FIXTURE = `file://${path.resolve(import.meta.dirname, "../fixtures/pages/dynamic.html")}`;

describe("Navigation integration", () => {
  let browserManager: BrowserManager;
  let pageManager: PageManager;
  let cdpSessionManager: CDPSessionManager;
  let elementIdGenerator: ElementIdGenerator;
  let rendererPipeline: RendererPipeline;
  let deps: ToolDependencies;

  beforeAll(async () => {
    browserManager = new BrowserManager();
    await browserManager.launch();
    pageManager = new PageManager();
    await pageManager.openTab(browserManager);
    cdpSessionManager = new CDPSessionManager();
    elementIdGenerator = new ElementIdGenerator();
    rendererPipeline = new RendererPipeline(cdpSessionManager, elementIdGenerator);
    deps = {
      browserManager,
      pageManager,
      rendererPipeline,
      elementIdGenerator,
    };
  });

  afterAll(async () => {
    await browserManager.close();
  });

  describe("navigate to file URLs", () => {
    it("navigates to a page and renders it", async () => {
      const page = pageManager.getActivePage();
      await page.goto(SIMPLE_FIXTURE, { waitUntil: "load" });

      const representation = await renderActivePage(deps, "summary");

      expect(representation.url).toContain("simple.html");
      expect(representation.title).toBe("Simple Test Page");
      expect(representation.structure.landmarks.length).toBeGreaterThan(0);
      expect(representation.interactive.length).toBeGreaterThan(0);
    });

    it("navigates to a different page and reflects new content", async () => {
      const page = pageManager.getActivePage();
      await page.goto(SPA_FIXTURE, { waitUntil: "load" });

      const representation = await renderActivePage(deps, "summary");

      expect(representation.url).toContain("spa.html");
      expect(representation.title).toContain("SPA");
      expect(representation.structure.headings.some((h) => h.text === "SPA App")).toBe(true);
    });
  });

  describe("back/forward navigation", () => {
    it("navigates back to the previous page", async () => {
      const page = pageManager.getActivePage();

      // Navigate to simple, then to SPA
      await page.goto(SIMPLE_FIXTURE, { waitUntil: "load" });
      await page.goto(SPA_FIXTURE, { waitUntil: "load" });

      // Go back
      const backResponse = await page.goBack({ waitUntil: "load" });
      expect(backResponse).not.toBeNull();

      const representation = await renderActivePage(deps, "minimal");
      expect(representation.url).toContain("simple.html");
      expect(representation.title).toBe("Simple Test Page");
    });

    it("navigates forward after going back", async () => {
      const page = pageManager.getActivePage();

      // Should still be on simple.html from previous test
      // Go forward to SPA
      const forwardResponse = await page.goForward({ waitUntil: "load" });
      expect(forwardResponse).not.toBeNull();

      const representation = await renderActivePage(deps, "minimal");
      expect(representation.url).toContain("spa.html");
    });
  });

  describe("reload", () => {
    it("reloads the current page and preserves content", async () => {
      const page = pageManager.getActivePage();
      await page.goto(SIMPLE_FIXTURE, { waitUntil: "load" });

      const beforeReload = await renderActivePage(deps, "minimal");
      await page.reload({ waitUntil: "load" });
      const afterReload = await renderActivePage(deps, "minimal");

      // Same page content after reload
      expect(afterReload.url).toBe(beforeReload.url);
      expect(afterReload.title).toBe(beforeReload.title);
      expect(afterReload.structure.landmarks.length).toBe(
        beforeReload.structure.landmarks.length,
      );
    });
  });

  describe("errors collection", () => {
    it("collects errors from page manager after navigation", async () => {
      const page = pageManager.getActivePage();
      pageManager.clearErrors();
      await page.goto(SIMPLE_FIXTURE, { waitUntil: "load" });

      const representation = await renderActivePage(deps, "minimal");

      // errors should be arrays (possibly empty for a clean local page)
      expect(Array.isArray(representation.errors.console)).toBe(true);
      expect(Array.isArray(representation.errors.network)).toBe(true);
    });
  });

  describe("render at different detail levels after navigation", () => {
    it("renders minimal detail after navigation", async () => {
      const page = pageManager.getActivePage();
      await page.goto(SIMPLE_FIXTURE, { waitUntil: "load" });

      const representation = await renderActivePage(deps, "minimal");

      expect(representation.structure.content_summary).toBe("");
      expect(representation.structure.full_content).toBeUndefined();
      expect(representation.interactive.length).toBeGreaterThan(0);
    });

    it("renders summary detail after navigation", async () => {
      const representation = await renderActivePage(deps, "summary");

      expect(representation.structure.content_summary.length).toBeGreaterThan(0);
      expect(representation.structure.full_content).toBeUndefined();
    });

    it("renders full detail after navigation", async () => {
      const representation = await renderActivePage(deps, "full");

      expect(representation.structure.content_summary.length).toBeGreaterThan(0);
      expect(representation.structure.full_content).toBeDefined();
      expect(representation.structure.full_content!.length).toBeGreaterThan(0);
    });
  });

  describe("formatPageResponse", () => {
    it("formats representation as MCP tool response", async () => {
      const representation = await renderActivePage(deps, "minimal");
      const response = formatPageResponse(representation);

      expect(response.content).toHaveLength(1);
      expect(response.content[0].type).toBe("text");

      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.url).toBeDefined();
      expect(parsed.title).toBeDefined();
      expect(parsed.interactive).toBeDefined();
    });
  });
});
