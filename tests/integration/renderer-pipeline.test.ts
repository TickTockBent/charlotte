import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import { BrowserManager } from "../../src/browser/browser-manager.js";
import { CDPSessionManager } from "../../src/browser/cdp-session.js";
import { RendererPipeline } from "../../src/renderer/renderer-pipeline.js";
import { ElementIdGenerator } from "../../src/renderer/element-id-generator.js";
import type { Page } from "puppeteer";

const FIXTURE_PATH = path.resolve(
  import.meta.dirname,
  "../fixtures/pages/simple.html",
);

describe("RendererPipeline integration", () => {
  let browserManager: BrowserManager;
  let cdpSessionManager: CDPSessionManager;
  let elementIdGenerator: ElementIdGenerator;
  let pipeline: RendererPipeline;
  let page: Page;

  beforeAll(async () => {
    browserManager = new BrowserManager();
    await browserManager.launch();
    page = await browserManager.newPage();
    cdpSessionManager = new CDPSessionManager();
    elementIdGenerator = new ElementIdGenerator();
    pipeline = new RendererPipeline(cdpSessionManager, elementIdGenerator);

    await page.goto(`file://${FIXTURE_PATH}`, { waitUntil: "load" });
  });

  afterAll(async () => {
    await browserManager.close();
  });

  describe("render at minimal detail", () => {
    it("returns landmarks, headings, and interactive elements", async () => {
      const result = await pipeline.render(page, { detail: "minimal" });

      expect(result.url).toContain("simple.html");
      expect(result.title).toBe("Simple Test Page");
      expect(result.viewport).toBeDefined();
      expect(result.timestamp).toBeDefined();

      // Landmarks
      expect(result.structure.landmarks.length).toBeGreaterThanOrEqual(3);
      const landmarkRoles = result.structure.landmarks.map((l) => l.role);
      expect(landmarkRoles).toContain("banner");
      expect(landmarkRoles).toContain("navigation");
      expect(landmarkRoles).toContain("main");

      // Headings
      expect(result.structure.headings.length).toBeGreaterThanOrEqual(1);
      const h1 = result.structure.headings.find((h) => h.level === 1);
      expect(h1).toBeDefined();
      expect(h1!.text).toBe("Test Dashboard");

      // Interactive elements
      expect(result.interactive.length).toBeGreaterThan(0);

      // Content summary should be empty for minimal
      expect(result.structure.content_summary).toBe("");
    });
  });

  describe("render at summary detail", () => {
    it("includes content summary", async () => {
      const result = await pipeline.render(page, { detail: "summary" });

      expect(result.structure.content_summary).toBeTruthy();
      expect(result.structure.content_summary.length).toBeGreaterThan(0);
      expect(result.structure.full_content).toBeUndefined();
    });
  });

  describe("render at full detail", () => {
    it("includes full content", async () => {
      const result = await pipeline.render(page, { detail: "full" });

      expect(result.structure.full_content).toBeDefined();
      expect(result.structure.full_content!.length).toBeGreaterThan(0);
      expect(result.structure.content_summary).toBeTruthy();
    });
  });

  describe("interactive elements", () => {
    it("detects buttons with correct types", async () => {
      const result = await pipeline.render(page, { detail: "minimal" });

      const buttons = result.interactive.filter((el) => el.type === "button");
      expect(buttons.length).toBeGreaterThanOrEqual(2);

      const createButton = buttons.find((b) =>
        b.label.includes("Create New Project"),
      );
      expect(createButton).toBeDefined();
      expect(createButton!.state.enabled).toBe(true);

      const exportButton = buttons.find((b) =>
        b.label.includes("Export Data"),
      );
      expect(exportButton).toBeDefined();
      expect(exportButton!.state.enabled).toBe(false);
    });

    it("detects links", async () => {
      const result = await pipeline.render(page, { detail: "minimal" });

      const links = result.interactive.filter((el) => el.type === "link");
      expect(links.length).toBeGreaterThanOrEqual(5); // 5 nav links

      const dashboardLink = links.find((l) => l.label === "Dashboard");
      expect(dashboardLink).toBeDefined();
    });

    it("detects text inputs", async () => {
      const result = await pipeline.render(page, { detail: "minimal" });

      const textInputs = result.interactive.filter(
        (el) => el.type === "text_input",
      );
      expect(textInputs.length).toBeGreaterThanOrEqual(1);

      const searchInput = textInputs.find((i) =>
        i.label.toLowerCase().includes("search"),
      );
      expect(searchInput).toBeDefined();
    });

    it("detects select elements", async () => {
      const result = await pipeline.render(page, { detail: "minimal" });

      const selects = result.interactive.filter((el) => el.type === "select");
      expect(selects.length).toBeGreaterThanOrEqual(1);
    });

    it("detects checkboxes", async () => {
      const result = await pipeline.render(page, { detail: "minimal" });

      const checkboxes = result.interactive.filter(
        (el) => el.type === "checkbox",
      );
      expect(checkboxes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("element ID stability", () => {
    it("generates the same IDs across consecutive renders", async () => {
      const firstRender = await pipeline.render(page, { detail: "minimal" });
      const secondRender = await pipeline.render(page, { detail: "minimal" });

      // Same number of interactive elements
      expect(firstRender.interactive.length).toBe(
        secondRender.interactive.length,
      );

      // Same IDs in same order
      const firstIds = firstRender.interactive.map((el) => el.id);
      const secondIds = secondRender.interactive.map((el) => el.id);
      expect(firstIds).toEqual(secondIds);
    });

    it("generates IDs with correct type prefixes", async () => {
      const result = await pipeline.render(page, { detail: "minimal" });

      for (const element of result.interactive) {
        const prefix = element.id.split("-")[0];
        switch (element.type) {
          case "button":
            expect(prefix).toBe("btn");
            break;
          case "link":
            expect(prefix).toBe("lnk");
            break;
          case "text_input":
            expect(prefix).toBe("inp");
            break;
          case "select":
            expect(prefix).toBe("sel");
            break;
          case "checkbox":
            expect(prefix).toBe("chk");
            break;
        }
      }
    });
  });

  describe("bounds", () => {
    it("provides bounds for landmarks", async () => {
      const result = await pipeline.render(page, { detail: "minimal" });

      for (const landmark of result.structure.landmarks) {
        expect(landmark.bounds).toBeDefined();
        // At least some landmarks should have non-zero bounds
      }

      const mainLandmark = result.structure.landmarks.find(
        (l) => l.role === "main",
      );
      expect(mainLandmark).toBeDefined();
      expect(mainLandmark!.bounds.w).toBeGreaterThan(0);
      expect(mainLandmark!.bounds.h).toBeGreaterThan(0);
    });

    it("provides bounds for interactive elements", async () => {
      const result = await pipeline.render(page, { detail: "minimal" });

      const visibleElements = result.interactive.filter(
        (el) => el.state.visible,
      );
      expect(visibleElements.length).toBeGreaterThan(0);

      for (const element of visibleElements) {
        expect(element.bounds).toBeDefined();
        expect(element.bounds!.w).toBeGreaterThan(0);
        expect(element.bounds!.h).toBeGreaterThan(0);
      }
    });
  });

  describe("element ID resolution", () => {
    it("resolves generated IDs to backend node IDs", async () => {
      const result = await pipeline.render(page, { detail: "minimal" });

      // At least some elements should be resolvable
      let resolvedCount = 0;
      for (const element of result.interactive) {
        const backendNodeId = elementIdGenerator.resolveId(element.id);
        if (backendNodeId !== null) {
          resolvedCount++;
          expect(typeof backendNodeId).toBe("number");
        }
      }

      expect(resolvedCount).toBeGreaterThan(0);
    });
  });
});
