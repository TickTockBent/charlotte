import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import { BrowserManager } from "../../src/browser/browser-manager.js";
import { PageManager } from "../../src/browser/page-manager.js";
import { CDPSessionManager } from "../../src/browser/cdp-session.js";
import { RendererPipeline } from "../../src/renderer/renderer-pipeline.js";
import { ElementIdGenerator } from "../../src/renderer/element-id-generator.js";
import { SnapshotStore } from "../../src/state/snapshot-store.js";
import { createDefaultConfig } from "../../src/types/config.js";
import type { ToolDependencies } from "../../src/tools/tool-helpers.js";
import {
  renderActivePage,
  resolveElement,
  formatElementsResponse,
} from "../../src/tools/tool-helpers.js";
import type { InteractiveElement, Bounds } from "../../src/types/page-representation.js";

const SIMPLE_FIXTURE = `file://${path.resolve(import.meta.dirname, "../fixtures/pages/simple.html")}`;
const FORM_FIXTURE = `file://${path.resolve(import.meta.dirname, "../fixtures/pages/form.html")}`;
const DYNAMIC_FIXTURE = `file://${path.resolve(import.meta.dirname, "../fixtures/pages/dynamic.html")}`;

describe("Observation integration", () => {
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
    const config = createDefaultConfig();
    deps = {
      browserManager,
      pageManager,
      rendererPipeline,
      elementIdGenerator,
      snapshotStore: new SnapshotStore(config.snapshotDepth),
      config,
    };
  });

  afterAll(async () => {
    await browserManager.close();
  });

  describe("observe", () => {
    it("returns page representation with all detail levels", async () => {
      const page = pageManager.getActivePage();
      await page.goto(SIMPLE_FIXTURE, { waitUntil: "load" });

      const minimal = await renderActivePage(deps, { detail: "minimal" });
      const summary = await renderActivePage(deps, { detail: "summary" });
      const full = await renderActivePage(deps, { detail: "full" });

      // Minimal: no content summary, no full content
      expect(minimal.structure.content_summary).toBeUndefined();
      expect(minimal.structure.full_content).toBeUndefined();

      // Summary: has content summary, no full content
      expect(summary.structure.content_summary.length).toBeGreaterThan(0);
      expect(summary.structure.full_content).toBeUndefined();

      // Full: has both
      expect(full.structure.content_summary.length).toBeGreaterThan(0);
      expect(full.structure.full_content).toBeDefined();
    });

    it("includes interactive elements at all detail levels", async () => {
      const page = pageManager.getActivePage();
      await page.goto(SIMPLE_FIXTURE, { waitUntil: "load" });

      const minimal = await renderActivePage(deps, { detail: "minimal" });
      const summary = await renderActivePage(deps, { detail: "summary" });

      // Interactive elements should be present at all levels
      expect(minimal.interactive.length).toBeGreaterThan(0);
      expect(summary.interactive.length).toBe(minimal.interactive.length);
    });
  });

  describe("find by text", () => {
    it("finds elements by text content", async () => {
      const page = pageManager.getActivePage();
      await page.goto(SIMPLE_FIXTURE, { waitUntil: "load" });

      const representation = await renderActivePage(deps, { detail: "minimal" });

      // Filter by text
      const searchText = "dashboard";
      const matches = representation.interactive.filter(
        (element) =>
          element.label.toLowerCase().includes(searchText) ||
          element.value?.toLowerCase().includes(searchText) ||
          element.placeholder?.toLowerCase().includes(searchText),
      );

      expect(matches.length).toBeGreaterThan(0);
      expect(matches.some((m) => m.label === "Dashboard")).toBe(true);
    });

    it("finds elements by partial text match", async () => {
      const representation = await renderActivePage(deps, { detail: "minimal" });

      const searchText = "create";
      const matches = representation.interactive.filter((element) =>
        element.label.toLowerCase().includes(searchText),
      );

      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.label.includes("Create New Project"))).toBe(true);
    });
  });

  describe("find by type", () => {
    it("finds all buttons", async () => {
      const page = pageManager.getActivePage();
      await page.goto(SIMPLE_FIXTURE, { waitUntil: "load" });

      const representation = await renderActivePage(deps, { detail: "minimal" });
      const buttons = representation.interactive.filter(
        (element) => element.type === "button",
      );

      expect(buttons.length).toBeGreaterThanOrEqual(2);
    });

    it("finds all links", async () => {
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const links = representation.interactive.filter(
        (element) => element.type === "link",
      );

      expect(links.length).toBeGreaterThanOrEqual(5);
    });

    it("finds text inputs", async () => {
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const textInputs = representation.interactive.filter(
        (element) => element.type === "text_input",
      );

      expect(textInputs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("find on form page", () => {
    it("finds various form input types", async () => {
      const page = pageManager.getActivePage();
      await page.goto(FORM_FIXTURE, { waitUntil: "load" });

      const representation = await renderActivePage(deps, { detail: "minimal" });

      const textInputs = representation.interactive.filter(
        (element) => element.type === "text_input",
      );
      const selects = representation.interactive.filter(
        (element) => element.type === "select",
      );
      const checkboxes = representation.interactive.filter(
        (element) => element.type === "checkbox",
      );
      const radios = representation.interactive.filter(
        (element) => element.type === "radio",
      );

      // form.html has: first name, last name, email, phone, search — all text-like inputs
      expect(textInputs.length).toBeGreaterThanOrEqual(3);
      // Country select
      expect(selects.length).toBeGreaterThanOrEqual(1);
      // Newsletter checkbox
      expect(checkboxes.length).toBeGreaterThanOrEqual(1);
      // Radio buttons for notification preference
      expect(radios.length).toBeGreaterThanOrEqual(2);
    });

    it("detects form representations", async () => {
      const page = pageManager.getActivePage();
      await page.goto(FORM_FIXTURE, { waitUntil: "load" });

      const representation = await renderActivePage(deps, { detail: "minimal" });

      // Should have at least the registration form and search form
      expect(representation.forms.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("element ID resolution", () => {
    it("resolves interactive element IDs to backend node IDs", async () => {
      const page = pageManager.getActivePage();
      await page.goto(SIMPLE_FIXTURE, { waitUntil: "load" });

      const representation = await renderActivePage(deps, { detail: "minimal" });

      let resolvedCount = 0;
      for (const element of representation.interactive) {
        const backendNodeId = elementIdGenerator.resolveId(element.id);
        if (backendNodeId !== null) {
          resolvedCount++;
          expect(typeof backendNodeId).toBe("number");
        }
      }

      expect(resolvedCount).toBeGreaterThan(0);
    });

    it("resolves element via resolveElement helper", async () => {
      const page = pageManager.getActivePage();
      await page.goto(SIMPLE_FIXTURE, { waitUntil: "load" });

      const representation = await renderActivePage(deps, { detail: "minimal" });

      // Pick the first interactive element that has a backend node ID
      const elementWithBackendNode = representation.interactive.find(
        (el) => elementIdGenerator.resolveId(el.id) !== null,
      );
      expect(elementWithBackendNode).toBeDefined();

      const resolved = await resolveElement(deps, elementWithBackendNode!.id);
      expect(resolved.backendNodeId).toBeGreaterThan(0);
      expect(resolved.page).toBeDefined();
    });

    it("throws ELEMENT_NOT_FOUND for unknown IDs", async () => {
      await expect(
        resolveElement(deps, "btn-zzzz"),
      ).rejects.toThrow("not found");
    });
  });

  describe("screenshot", () => {
    it("takes a full page screenshot", async () => {
      const page = pageManager.getActivePage();
      await page.goto(SIMPLE_FIXTURE, { waitUntil: "load" });

      const screenshotBuffer = await page.screenshot({
        type: "png",
        encoding: "base64",
        fullPage: true,
      });

      expect(typeof screenshotBuffer).toBe("string");
      expect((screenshotBuffer as string).length).toBeGreaterThan(0);
    });

    it("takes a screenshot of a specific element", async () => {
      const page = pageManager.getActivePage();
      await page.goto(SIMPLE_FIXTURE, { waitUntil: "load" });

      const element = await page.$("#create-btn");
      expect(element).not.toBeNull();

      const screenshotBuffer = await element!.screenshot({
        type: "png",
        encoding: "base64",
      });

      expect(typeof screenshotBuffer).toBe("string");
      expect((screenshotBuffer as string).length).toBeGreaterThan(0);
    });
  });

  describe("spatial filtering", () => {
    it("elements have bounds for spatial queries", async () => {
      const page = pageManager.getActivePage();
      await page.goto(SIMPLE_FIXTURE, { waitUntil: "load" });

      const representation = await renderActivePage(deps, { detail: "minimal" });

      const elementsWithBounds = representation.interactive.filter(
        (element) =>
          element.bounds !== null &&
          element.bounds.w > 0 &&
          element.bounds.h > 0,
      );

      // Most visible elements should have bounds
      expect(elementsWithBounds.length).toBeGreaterThan(0);
    });

    it("can compute distances between elements", async () => {
      const representation = await renderActivePage(deps, { detail: "minimal" });

      const elementsWithBounds = representation.interactive.filter(
        (element): element is InteractiveElement & { bounds: Bounds } =>
          element.bounds !== null &&
          element.bounds.w > 0 &&
          element.bounds.h > 0,
      );

      if (elementsWithBounds.length >= 2) {
        const [elementA, elementB] = elementsWithBounds;
        const centerAx = elementA.bounds.x + elementA.bounds.w / 2;
        const centerAy = elementA.bounds.y + elementA.bounds.h / 2;
        const centerBx = elementB.bounds.x + elementB.bounds.w / 2;
        const centerBy = elementB.bounds.y + elementB.bounds.h / 2;
        const distance = Math.sqrt(
          (centerAx - centerBx) ** 2 + (centerAy - centerBy) ** 2,
        );

        expect(distance).toBeGreaterThanOrEqual(0);
        expect(typeof distance).toBe("number");
        expect(Number.isFinite(distance)).toBe(true);
      }
    });
  });

  describe("formatElementsResponse", () => {
    it("formats element arrays as MCP tool response", async () => {
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const buttons = representation.interactive.filter(
        (element) => element.type === "button",
      );

      const response = formatElementsResponse(buttons);

      expect(response.content).toHaveLength(1);
      expect(response.content[0].type).toBe("text");

      const parsed = JSON.parse(response.content[0].text);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(buttons.length);
    });
  });

  describe("dynamic page observation", () => {
    it("observes dynamic page with JS-driven content", async () => {
      const page = pageManager.getActivePage();
      await page.goto(DYNAMIC_FIXTURE, { waitUntil: "load" });

      const representation = await renderActivePage(deps, { detail: "summary" });

      expect(representation.title).toBe("Dynamic Test Page");
      expect(representation.interactive.length).toBeGreaterThan(0);

      // Should see the buttons
      const buttons = representation.interactive.filter(
        (element) => element.type === "button",
      );
      expect(buttons.length).toBeGreaterThanOrEqual(3);
    });

    it("reflects DOM changes after JS execution", async () => {
      const page = pageManager.getActivePage();
      await page.goto(DYNAMIC_FIXTURE, { waitUntil: "load" });

      // Get initial content
      const beforeMutation = await renderActivePage(deps, { detail: "full" });
      const initialFullContent = beforeMutation.structure.full_content ?? "";

      // Trigger DOM mutation via evaluate
      await page.evaluate(() => {
        (document.getElementById("add-item-btn") as HTMLElement).click();
      });

      // Re-render and check for new content
      const afterMutation = await renderActivePage(deps, { detail: "full" });
      const updatedFullContent = afterMutation.structure.full_content ?? "";

      // The new item should appear in full content
      expect(updatedFullContent).toContain("Item 3");
    });
  });
});
