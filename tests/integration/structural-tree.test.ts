import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import { BrowserManager } from "../../src/browser/browser-manager.js";
import { CDPSessionManager } from "../../src/browser/cdp-session.js";
import { RendererPipeline } from "../../src/renderer/renderer-pipeline.js";
import { ElementIdGenerator } from "../../src/renderer/element-id-generator.js";
import type { Page } from "puppeteer";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures/pages");
const SANDBOX_DIR = path.resolve(import.meta.dirname, "../sandbox");

describe("Structural tree view integration", () => {
  let browserManager: BrowserManager;
  let cdpSessionManager: CDPSessionManager;
  let pipeline: RendererPipeline;
  let page: Page;

  beforeAll(async () => {
    browserManager = new BrowserManager();
    await browserManager.launch();
    page = await browserManager.newPage();
    cdpSessionManager = new CDPSessionManager();
    const elementIdGenerator = new ElementIdGenerator();
    pipeline = new RendererPipeline(cdpSessionManager, elementIdGenerator);
  });

  afterAll(async () => {
    await browserManager.close();
  });

  it("renders sandbox index page as a compact structural tree", async () => {
    await page.goto(`file://${SANDBOX_DIR}/index.html`, { waitUntil: "load" });
    const tree = await pipeline.renderTree(page);

    // Should include page title
    expect(tree).toContain("Charlotte Test Sandbox");

    // Should include landmark structure
    expect(tree).toContain("[banner]");
    expect(tree).toContain("[navigation");
    expect(tree).toContain("[main]");
    expect(tree).toContain("[contentinfo]");

    // Should include headings with text
    expect(tree).toMatch(/h1/);
    expect(tree).toMatch(/h2/);

    // Should collapse consecutive links in nav
    expect(tree).toMatch(/link × \d+/);

    // Should be compact — the whole page in under 1KB
    expect(tree.length).toBeLessThan(1024);

    // Print the tree for visual inspection
    console.log("\n=== Sandbox Index ===");
    console.log(tree);
    console.log(`\n(${tree.length} chars)\n`);
  });

  it("renders sandbox forms page", async () => {
    await page.goto(`file://${SANDBOX_DIR}/forms.html`, { waitUntil: "load" });
    const tree = await pipeline.renderTree(page);

    // Forms should appear as landmark containers with children
    expect(tree).toContain("[form");

    // Should have interactive elements inside forms
    expect(tree).toContain("input");
    expect(tree).toContain("button");

    console.log("\n=== Sandbox Forms ===");
    console.log(tree);
    console.log(`\n(${tree.length} chars)\n`);
  });

  it("renders simple fixture page", async () => {
    await page.goto(`file://${FIXTURES_DIR}/simple.html`, { waitUntil: "load" });
    const tree = await pipeline.renderTree(page);

    expect(tree).toMatch(/\[main/);
    expect(tree).toMatch(/h1/);

    console.log("\n=== Simple Fixture ===");
    console.log(tree);
    console.log(`\n(${tree.length} chars)\n`);
  });

  it("renders form fixture page", async () => {
    await page.goto(`file://${FIXTURES_DIR}/form.html`, { waitUntil: "load" });
    const tree = await pipeline.renderTree(page);

    expect(tree).toContain("[form");
    expect(tree).toContain("input");

    console.log("\n=== Form Fixture ===");
    console.log(tree);
    console.log(`\n(${tree.length} chars)\n`);
  });

  it("tree view is significantly smaller than minimal JSON", async () => {
    await page.goto(`file://${SANDBOX_DIR}/index.html`, { waitUntil: "load" });

    const tree = await pipeline.renderTree(page);
    const minimalRender = await pipeline.render(page, { detail: "minimal" });
    const minimalJson = JSON.stringify(minimalRender);

    const treeTokenEstimate = tree.length / 4;
    const jsonTokenEstimate = minimalJson.length / 3.5;

    console.log("\n=== Token Comparison ===");
    console.log(`Tree view: ${tree.length} chars (~${Math.round(treeTokenEstimate)} tokens)`);
    console.log(`Minimal JSON: ${minimalJson.length} chars (~${Math.round(jsonTokenEstimate)} tokens)`);
    console.log(`Savings: ${Math.round((1 - treeTokenEstimate / jsonTokenEstimate) * 100)}%\n`);

    // Tree should be at least 50% smaller than minimal JSON
    expect(treeTokenEstimate).toBeLessThan(jsonTokenEstimate * 0.5);
  });
});
