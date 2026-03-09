import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
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
import type { ToolDependencies } from "../../src/tools/tool-helpers.js";
import {
  renderActivePage,
  resolveOutputPath,
  writeOutputFile,
  writeBinaryOutputFile,
  stripEmptyFields,
} from "../../src/tools/tool-helpers.js";

const SIMPLE_FIXTURE = `file://${path.resolve(import.meta.dirname, "../fixtures/pages/simple.html")}`;

describe("File output integration", () => {
  let browserManager: BrowserManager;
  let pageManager: PageManager;
  let cdpSessionManager: CDPSessionManager;
  let rendererPipeline: RendererPipeline;
  let elementIdGenerator: ElementIdGenerator;
  let deps: ToolDependencies;
  let outputDir: string;
  let artifactStoreDir: string;

  beforeAll(async () => {
    browserManager = new BrowserManager();
    await browserManager.launch();
    pageManager = new PageManager();
    await pageManager.openTab(browserManager);
    cdpSessionManager = new CDPSessionManager();
    elementIdGenerator = new ElementIdGenerator();
    rendererPipeline = new RendererPipeline(cdpSessionManager, elementIdGenerator);
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "charlotte-file-output-test-"));
    artifactStoreDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "charlotte-file-output-test-artifacts-"),
    );
    const config = createDefaultConfig();
    config.outputDir = outputDir;
    const artifactStore = new ArtifactStore(artifactStoreDir);
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
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.rm(artifactStoreDir, { recursive: true, force: true });
  });

  describe("observe with output_file", () => {
    it("writes valid JSON page representation to file", async () => {
      const page = pageManager.getActivePage();
      await page.goto(SIMPLE_FIXTURE, { waitUntil: "load" });

      const representation = await renderActivePage(deps, {
        detail: "summary",
        source: "observe",
      });

      const outputPath = await resolveOutputPath("observe-output.json", deps.config);
      const cleaned = stripEmptyFields(representation);
      const response = await writeOutputFile(outputPath, JSON.stringify(cleaned, null, 2));

      // Response should contain path and size
      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.output_file).toBe(outputPath);
      expect(parsed.size).toBeGreaterThan(0);

      // File should exist and contain valid JSON with expected fields
      const fileContent = await fs.readFile(outputPath, "utf-8");
      const pageData = JSON.parse(fileContent);
      expect(pageData.title).toBe("Simple Test Page");
      expect(pageData.url).toContain("simple.html");
      expect(pageData.viewport).toBeDefined();
    });

    it("writes pretty-printed JSON (not compact)", async () => {
      const page = pageManager.getActivePage();
      await page.goto(SIMPLE_FIXTURE, { waitUntil: "load" });

      const representation = await renderActivePage(deps, {
        detail: "summary",
        source: "observe",
      });

      const outputPath = await resolveOutputPath("observe-pretty.json", deps.config);
      const cleaned = stripEmptyFields(representation);
      await writeOutputFile(outputPath, JSON.stringify(cleaned, null, 2));

      const fileContent = await fs.readFile(outputPath, "utf-8");
      // Pretty-printed JSON has newlines and indentation
      expect(fileContent).toContain("\n");
      expect(fileContent).toMatch(/^\{\n\s+"/);
    });
  });

  describe("screenshot with output_file", () => {
    it("writes valid image data to file", async () => {
      const page = pageManager.getActivePage();
      await page.goto(SIMPLE_FIXTURE, { waitUntil: "load" });

      const screenshotBase64 = (await page.screenshot({
        type: "png",
        encoding: "base64",
        fullPage: true,
      })) as string;

      const buffer = Buffer.from(screenshotBase64, "base64");
      const outputPath = await resolveOutputPath("screenshot.png", deps.config);
      const response = await writeBinaryOutputFile(outputPath, buffer);

      // Response should confirm write
      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.output_file).toBe(outputPath);
      expect(parsed.size).toBe(buffer.length);

      // File should exist and start with PNG magic bytes
      const fileData = await fs.readFile(outputPath);
      expect(fileData.length).toBe(buffer.length);
      // PNG magic bytes: 0x89 0x50 0x4E 0x47
      expect(fileData[0]).toBe(0x89);
      expect(fileData[1]).toBe(0x50);
      expect(fileData[2]).toBe(0x4e);
      expect(fileData[3]).toBe(0x47);
    });
  });

  describe("console messages with output_file", () => {
    it("writes console messages to file", async () => {
      const page = pageManager.getActivePage();
      await page.goto(SIMPLE_FIXTURE, { waitUntil: "load" });

      // Generate some console messages
      await page.evaluate(() => {
        console.log("test-log-message");
        console.warn("test-warn-message");
      });

      // Small delay for message capture
      await new Promise((resolve) => setTimeout(resolve, 100));

      const messages = pageManager.getConsoleMessages("all");
      const consoleResult = {
        messages,
        count: messages.length,
        level: "all",
        cleared: false,
      };

      const outputPath = await resolveOutputPath("console.json", deps.config);
      const response = await writeOutputFile(outputPath, JSON.stringify(consoleResult, null, 2));

      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.output_file).toBe(outputPath);
      expect(parsed.size).toBeGreaterThan(0);

      // File should contain our messages
      const fileContent = await fs.readFile(outputPath, "utf-8");
      const data = JSON.parse(fileContent);
      expect(data.count).toBeGreaterThanOrEqual(2);
      const logMessages = data.messages.map((m: { text: string }) => m.text);
      expect(logMessages).toContain("test-log-message");
      expect(logMessages).toContain("test-warn-message");
    });
  });

  describe("path boundary enforcement", () => {
    it("rejects output_file that escapes outputDir", async () => {
      await expect(
        resolveOutputPath("/etc/evil-output.json", deps.config),
      ).rejects.toThrow(/resolves outside the allowed directory/);
    });

    it("rejects relative traversal above outputDir", async () => {
      await expect(
        resolveOutputPath("../../../etc/passwd", deps.config),
      ).rejects.toThrow(/resolves outside the allowed directory/);
    });

    it("allows nested subdirectories within outputDir", async () => {
      const outputPath = await resolveOutputPath("nested/deep/file.json", deps.config);
      expect(outputPath.startsWith(outputDir)).toBe(true);

      // Verify directory was created
      const parentDir = path.dirname(outputPath);
      const stat = await fs.stat(parentDir);
      expect(stat.isDirectory()).toBe(true);
    });
  });
});
