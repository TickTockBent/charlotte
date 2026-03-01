import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import { BrowserManager } from "../../src/browser/browser-manager.js";
import { CDPSessionManager } from "../../src/browser/cdp-session.js";
import { RendererPipeline } from "../../src/renderer/renderer-pipeline.js";
import { ElementIdGenerator } from "../../src/renderer/element-id-generator.js";
import type { Page } from "puppeteer";

const FIXTURE_PATH = path.resolve(
  import.meta.dirname,
  "../fixtures/pages/pseudo-elements.html",
);

describe("Pseudo-element content deduplication", () => {
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

  describe("heading text extraction", () => {
    it("does not duplicate ::before pseudo-element content in heading text", async () => {
      const result = await pipeline.render(page, { detail: "minimal" });

      const h1 = result.structure.headings.find((h) => h.level === 1);
      expect(h1).toBeDefined();
      // The heading text should contain "Welcome to the Site" and possibly the star,
      // but it should NOT have the star duplicated (e.g., "★ ★ Welcome to the Site")
      expect(h1!.text).not.toMatch(/★.*★/);
      // Also check it doesn't have doubled content in general
      expect(h1!.text).not.toMatch(/Welcome.*Welcome/);
    });

    it("does not duplicate ::after pseudo-element content in heading text", async () => {
      const result = await pipeline.render(page, { detail: "minimal" });

      const gettingStarted = result.structure.headings.find(
        (h) => h.text.includes("Getting Started"),
      );
      expect(gettingStarted).toBeDefined();
      // Should not have the arrow duplicated
      expect(gettingStarted!.text).not.toMatch(/→.*→/);
      // Should not have doubled content
      expect(gettingStarted!.text).not.toMatch(/Getting Started.*Getting Started/);
    });

    it("does not duplicate ::before and ::after pseudo-element content in heading text", async () => {
      const result = await pipeline.render(page, { detail: "minimal" });

      const features = result.structure.headings.find(
        (h) => h.text.includes("Features Overview"),
      );
      expect(features).toBeDefined();
      // Should not have brackets duplicated
      expect(features!.text).not.toMatch(/\[.*\[/);
      expect(features!.text).not.toMatch(/\].*\]/);
      // Should not have doubled content
      expect(features!.text).not.toMatch(/Features Overview.*Features Overview/);
    });

    it("includes pseudo-element content in heading text from AX tree", async () => {
      const result = await pipeline.render(page, { detail: "minimal" });

      // The AX tree correctly computes heading names that include pseudo-element content
      const h1 = result.structure.headings.find((h) => h.level === 1);
      expect(h1).toBeDefined();
      expect(h1!.text).toContain("Welcome to the Site");
      // The star from ::before should be present in the heading text
      expect(h1!.text).toContain("\u2605");

      const gettingStarted = result.structure.headings.find(
        (h) => h.text.includes("Getting Started"),
      );
      expect(gettingStarted).toBeDefined();
      // The arrow from ::after should be present
      expect(gettingStarted!.text).toContain("\u2192");
    });

    it("leaves plain headings unchanged", async () => {
      const result = await pipeline.render(page, { detail: "minimal" });

      const plain = result.structure.headings.find(
        (h) => h.text.includes("Plain Heading"),
      );
      expect(plain).toBeDefined();
      expect(plain!.text).toBe("Plain Heading");
    });
  });

  describe("full content extraction", () => {
    it("does not duplicate pseudo-element content in full content output", async () => {
      const result = await pipeline.render(page, { detail: "full" });
      const fullContent = result.structure.full_content!;

      expect(fullContent).toBeDefined();
      // Count occurrences of "Welcome to the Site" — should appear exactly once
      const welcomeMatches = fullContent.match(/Welcome to the Site/g);
      expect(welcomeMatches).not.toBeNull();
      expect(welcomeMatches!.length).toBe(1);

      // "Getting Started" should appear exactly once
      const gettingStartedMatches = fullContent.match(/Getting Started/g);
      expect(gettingStartedMatches).not.toBeNull();
      expect(gettingStartedMatches!.length).toBe(1);

      // "Features Overview" should appear exactly once
      const featuresMatches = fullContent.match(/Features Overview/g);
      expect(featuresMatches).not.toBeNull();
      expect(featuresMatches!.length).toBe(1);

      // "Plain Heading" should also appear exactly once (was duplicated even without pseudo-elements)
      const plainMatches = fullContent.match(/Plain Heading/g);
      expect(plainMatches).not.toBeNull();
      expect(plainMatches!.length).toBe(1);
    });

    it("preserves non-heading content in full output", async () => {
      const result = await pipeline.render(page, { detail: "full" });
      const fullContent = result.structure.full_content!;

      // Paragraphs and other non-heading content should still appear
      expect(fullContent).toContain("This section covers the basics.");
      expect(fullContent).toContain("A list of features available.");
    });
  });
});
