import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { BrowserManager } from "../../src/browser/browser-manager.js";
import { PageManager } from "../../src/browser/page-manager.js";
import { CDPSessionManager } from "../../src/browser/cdp-session.js";
import { RendererPipeline } from "../../src/renderer/renderer-pipeline.js";
import { ElementIdGenerator } from "../../src/renderer/element-id-generator.js";
import { SnapshotStore } from "../../src/state/snapshot-store.js";
import { ArtifactStore } from "../../src/state/artifact-store.js";
import { createDefaultConfig } from "../../src/types/config.js";
import type { ToolDependencies } from "../../src/tools/tool-helpers.js";

const SIMPLE_FIXTURE = `file://${path.resolve(import.meta.dirname, "../fixtures/pages/simple.html")}`;

describe("Screenshot artifacts integration", () => {
  let browserManager: BrowserManager;
  let pageManager: PageManager;
  let artifactStore: ArtifactStore;
  let deps: ToolDependencies;
  let testDir: string;

  beforeAll(async () => {
    browserManager = new BrowserManager();
    await browserManager.launch();
    pageManager = new PageManager();
    await pageManager.openTab(browserManager);

    const cdpSessionManager = new CDPSessionManager();
    const elementIdGenerator = new ElementIdGenerator();
    const rendererPipeline = new RendererPipeline(cdpSessionManager, elementIdGenerator);
    const config = createDefaultConfig();

    testDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "charlotte-integration-artifacts-"),
    );
    artifactStore = new ArtifactStore(testDir);
    await artifactStore.initialize();

    deps = {
      browserManager,
      pageManager,
      rendererPipeline,
      elementIdGenerator,
      snapshotStore: new SnapshotStore(config.snapshotDepth),
      artifactStore,
      config,
    };
  });

  afterAll(async () => {
    await browserManager.close();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    // Clean up artifacts between tests
    for (const artifact of artifactStore.list()) {
      await artifactStore.delete(artifact.id);
    }
  });

  it("saves a full-page screenshot as an artifact", async () => {
    const page = pageManager.getActivePage();
    await page.goto(SIMPLE_FIXTURE, { waitUntil: "load" });

    // Take screenshot and get base64
    const screenshotBase64 = (await page.screenshot({
      type: "png",
      encoding: "base64",
      fullPage: true,
    })) as string;

    const buffer = Buffer.from(screenshotBase64, "base64");
    const artifact = await deps.artifactStore.save(buffer, {
      format: "png",
      url: page.url(),
      title: await page.title(),
    });

    expect(artifact.id).toMatch(/^ss-/);
    expect(artifact.format).toBe("png");
    expect(artifact.size).toBeGreaterThan(0);
    expect(artifact.url).toContain("simple.html");
    expect(artifact.title).toBeTruthy();

    // Verify file exists and has content
    const fileData = await fs.readFile(artifact.path);
    expect(fileData.length).toBe(artifact.size);
  });

  it("saves an element screenshot with selector metadata", async () => {
    const page = pageManager.getActivePage();
    await page.goto(SIMPLE_FIXTURE, { waitUntil: "load" });

    const element = await page.$("#create-btn");
    expect(element).not.toBeNull();

    const screenshotBase64 = (await element!.screenshot({
      type: "png",
      encoding: "base64",
    })) as string;

    const buffer = Buffer.from(screenshotBase64, "base64");
    const artifact = await deps.artifactStore.save(buffer, {
      format: "png",
      selector: "#create-btn",
      url: page.url(),
      title: await page.title(),
    });

    expect(artifact.selector).toBe("#create-btn");
    expect(artifact.size).toBeGreaterThan(0);
  });

  it("saves screenshots in different formats", async () => {
    const page = pageManager.getActivePage();
    await page.goto(SIMPLE_FIXTURE, { waitUntil: "load" });

    for (const format of ["png", "jpeg", "webp"] as const) {
      const screenshotBase64 = (await page.screenshot({
        type: format,
        encoding: "base64",
        quality: format !== "png" ? 80 : undefined,
      })) as string;

      const buffer = Buffer.from(screenshotBase64, "base64");
      const artifact = await deps.artifactStore.save(buffer, {
        format,
        url: page.url(),
        title: await page.title(),
      });

      expect(artifact.format).toBe(format);
      expect(artifact.size).toBeGreaterThan(0);

      const ext = format === "jpeg" ? "jpg" : format;
      expect(artifact.filename).toContain(`.${ext}`);
    }

    expect(deps.artifactStore.count).toBe(3);
  });

  it("lists, retrieves, and deletes artifacts", async () => {
    const page = pageManager.getActivePage();
    await page.goto(SIMPLE_FIXTURE, { waitUntil: "load" });

    // Save two screenshots
    const s1 = (await page.screenshot({ type: "png", encoding: "base64" })) as string;
    const s2 = (await page.screenshot({ type: "png", encoding: "base64" })) as string;

    const a1 = await deps.artifactStore.save(Buffer.from(s1, "base64"), {
      format: "png",
      url: "https://example.com/1",
      title: "Page 1",
    });

    await new Promise((r) => setTimeout(r, 10));

    const a2 = await deps.artifactStore.save(Buffer.from(s2, "base64"), {
      format: "png",
      url: "https://example.com/2",
      title: "Page 2",
    });

    // List: should be newest first
    const list = deps.artifactStore.list();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(a2.id);
    expect(list[1].id).toBe(a1.id);

    // Retrieve by ID
    const retrieved = deps.artifactStore.get(a1.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.title).toBe("Page 1");

    // Read file data
    const fileData = await deps.artifactStore.readFile(a1.id);
    expect(fileData).not.toBeNull();
    expect(fileData!.length).toBeGreaterThan(0);

    // Delete one
    const deleted = await deps.artifactStore.delete(a1.id);
    expect(deleted).toBe(true);
    expect(deps.artifactStore.count).toBe(1);
    expect(deps.artifactStore.get(a1.id)).toBeUndefined();
  });

  it("persists artifacts across store instances", async () => {
    const page = pageManager.getActivePage();
    await page.goto(SIMPLE_FIXTURE, { waitUntil: "load" });

    const screenshotBase64 = (await page.screenshot({
      type: "png",
      encoding: "base64",
    })) as string;

    const artifact = await deps.artifactStore.save(Buffer.from(screenshotBase64, "base64"), {
      format: "png",
      url: page.url(),
      title: await page.title(),
    });

    // Create a new store instance pointing at the same directory
    const store2 = new ArtifactStore(testDir);
    await store2.initialize();

    expect(store2.count).toBe(1);
    const loaded = store2.get(artifact.id);
    expect(loaded).toBeDefined();
    expect(loaded!.url).toBe(artifact.url);

    // Can read the file
    const fileData = await store2.readFile(artifact.id);
    expect(fileData).not.toBeNull();
    expect(fileData!.length).toBe(artifact.size);
  });
});
