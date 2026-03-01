import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { BrowserManager } from "../../src/browser/browser-manager.js";
import { PageManager } from "../../src/browser/page-manager.js";
import { CDPSessionManager } from "../../src/browser/cdp-session.js";
import { RendererPipeline } from "../../src/renderer/renderer-pipeline.js";
import { ElementIdGenerator } from "../../src/renderer/element-id-generator.js";
import { SnapshotStore } from "../../src/state/snapshot-store.js";
import { ArtifactStore } from "../../src/state/artifact-store.js";
import { createDefaultConfig } from "../../src/types/config.js";
import { DevModeState } from "../../src/dev/dev-mode-state.js";
import { Auditor } from "../../src/dev/auditor.js";
import type { ToolDependencies } from "../../src/tools/tool-helpers.js";
import {
  renderActivePage,
  renderAfterAction,
} from "../../src/tools/tool-helpers.js";

let TEMP_FIXTURES_DIR: string;
let FIXTURES_DIR = path.resolve(
  import.meta.dirname,
  "../fixtures/pages",
);
const AUDIT_TARGET_FIXTURE = `file://${path.resolve(FIXTURES_DIR, "audit-target.html")}`;

describe("Dev mode integration", () => {
  let browserManager: BrowserManager;
  let pageManager: PageManager;
  let cdpSessionManager: CDPSessionManager;
  let elementIdGenerator: ElementIdGenerator;
  let rendererPipeline: RendererPipeline;
  let devModeState: DevModeState;
  let deps: ToolDependencies;

  beforeAll(async () => {
    browserManager = new BrowserManager();
    await browserManager.launch();
    pageManager = new PageManager();
    await pageManager.openTab(browserManager);
    cdpSessionManager = new CDPSessionManager();
    elementIdGenerator = new ElementIdGenerator();
    rendererPipeline = new RendererPipeline(
      cdpSessionManager,
      elementIdGenerator,
    );
    const config = createDefaultConfig();
    config.allowedWorkspaceRoot = os.tmpdir(); // Set allowed root for tests
    devModeState = new DevModeState(config);

    // Create a temporary directory for fixtures and copy them over
    TEMP_FIXTURES_DIR = path.join(os.tmpdir(), "charlotte-test-fixtures-");
    fs.mkdirSync(TEMP_FIXTURES_DIR);
    fs.cpSync(FIXTURES_DIR, TEMP_FIXTURES_DIR, { recursive: true });
    // IMPORTANT: Update FIXTURES_DIR reference for the tests that use it
    FIXTURES_DIR = TEMP_FIXTURES_DIR;
    const artifactStore = new ArtifactStore(
      path.join(os.tmpdir(), "charlotte-devmode-test-artifacts"),
    );
    await artifactStore.initialize();
    deps = {
      browserManager,
      pageManager,
      rendererPipeline,
      elementIdGenerator,
      snapshotStore: new SnapshotStore(config.snapshotDepth),
      artifactStore,
      config,
      devModeState,
    };
  });

  afterAll(async () => {
    await devModeState.stopAll();
    await browserManager.close();
  });

  describe("dev_serve", () => {
    it("serves a fixture directory and renders the page", async () => {
      const serverInfo = await devModeState.startServing({
        directoryPath: FIXTURES_DIR,
        watch: false,
        pageManager,
      });

      expect(serverInfo.url).toMatch(/^http:\/\/localhost:\d+$/);
      expect(serverInfo.port).toBeGreaterThan(0);

      // Navigate to the served page
      const page = pageManager.getActivePage();
      await page.goto(`${serverInfo.url}/simple.html`, {
        waitUntil: "load",
      });

      const representation = await renderActivePage(deps, {
        source: "action",
      });

      expect(representation.title).toBe("Simple Test Page");
      expect(representation.url).toContain("simple.html");

      await devModeState.stopAll();
    });

    it("auto-assigns a port when none specified", async () => {
      const serverInfo = await devModeState.startServing({
        directoryPath: FIXTURES_DIR,
        watch: false,
        pageManager,
      });

      expect(serverInfo.port).toBeGreaterThan(0);

      // Verify the server is accessible
      const response = await fetch(
        `${serverInfo.url}/simple.html`,
      );
      expect(response.ok).toBe(true);

      await devModeState.stopAll();
    });

    it("restarts when called twice", async () => {
      const firstInfo = await devModeState.startServing({
        directoryPath: FIXTURES_DIR,
        watch: false,
        pageManager,
      });

      const secondInfo = await devModeState.startServing({
        directoryPath: FIXTURES_DIR,
        watch: false,
        pageManager,
      });

      // First server should be stopped
      await expect(
        fetch(`${firstInfo.url}/simple.html`),
      ).rejects.toThrow();

      // Second server should work
      const response = await fetch(
        `${secondInfo.url}/simple.html`,
      );
      expect(response.ok).toBe(true);

      await devModeState.stopAll();
    });
  });

  describe("dev_inject", () => {
    it("injects CSS into the page", async () => {
      const page = pageManager.getActivePage();
      await page.goto(
        `file://${path.resolve(FIXTURES_DIR, "simple.html")}`,
        { waitUntil: "load" },
      );

      // Take a baseline snapshot
      await renderActivePage(deps, { source: "observe" });

      // Inject CSS
      await page.addStyleTag({
        content: "body { background-color: rgb(255, 0, 0) !important; }",
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      const representation = await renderAfterAction(deps);

      // The page should still render correctly
      expect(representation.title).toBe("Simple Test Page");
      expect(representation.interactive.length).toBeGreaterThan(0);
    });

    it("injects JS that modifies the DOM", async () => {
      const page = pageManager.getActivePage();
      await page.goto(
        `file://${path.resolve(FIXTURES_DIR, "simple.html")}`,
        { waitUntil: "load" },
      );

      // Inject JS that changes the title
      await page.evaluate(() => {
        document.title = "Injected Title";
      });

      const representation = await renderActivePage(deps, {
        source: "action",
      });

      expect(representation.title).toBe("Injected Title");
    });
  });

  describe("dev_audit", () => {
    let auditor: Auditor;

    beforeAll(() => {
      auditor = new Auditor();
    });

    it("detects accessibility issues on audit target page", async () => {
      const page = pageManager.getActivePage();
      await page.goto(AUDIT_TARGET_FIXTURE, { waitUntil: "load" });

      const session = await page.createCDPSession();
      try {
        const result = await auditor.audit(page, session, ["a11y"]);

        expect(result.categories_checked).toEqual(["a11y"]);
        expect(result.findings.length).toBeGreaterThan(0);

        // Should find missing alt text
        const missingAltFinding = result.findings.find(
          (f) =>
            f.category === "a11y" &&
            f.message.includes("alt"),
        );
        expect(missingAltFinding).toBeDefined();

        // Should find empty button
        const emptyButtonFinding = result.findings.find(
          (f) =>
            f.category === "a11y" &&
            f.message.includes("Button") &&
            f.message.includes("no accessible name"),
        );
        expect(emptyButtonFinding).toBeDefined();
      } finally {
        await session.detach();
      }
    });

    it("detects SEO issues on audit target page", async () => {
      const page = pageManager.getActivePage();
      await page.goto(AUDIT_TARGET_FIXTURE, { waitUntil: "load" });

      const session = await page.createCDPSession();
      try {
        const result = await auditor.audit(page, session, ["seo"]);

        expect(result.categories_checked).toEqual(["seo"]);

        // Should find missing meta description
        const missingDescriptionFinding = result.findings.find(
          (f) =>
            f.category === "seo" &&
            f.message.includes("description"),
        );
        expect(missingDescriptionFinding).toBeDefined();

        // Should find missing lang attribute
        const missingLangFinding = result.findings.find(
          (f) =>
            f.category === "seo" &&
            f.message.includes("lang"),
        );
        expect(missingLangFinding).toBeDefined();

        // Should find duplicate h1
        const duplicateH1Finding = result.findings.find(
          (f) =>
            f.category === "seo" &&
            f.message.includes("h1"),
        );
        expect(duplicateH1Finding).toBeDefined();
      } finally {
        await session.detach();
      }
    });

    it("runs performance audit", async () => {
      const page = pageManager.getActivePage();
      await page.goto(AUDIT_TARGET_FIXTURE, { waitUntil: "load" });

      const session = await page.createCDPSession();
      try {
        const result = await auditor.audit(page, session, [
          "performance",
        ]);

        expect(result.categories_checked).toEqual(["performance"]);

        // Should have at least an info finding with performance metrics
        const metricsInfoFinding = result.findings.find(
          (f) =>
            f.category === "performance" &&
            f.severity === "info",
        );
        expect(metricsInfoFinding).toBeDefined();
        expect(metricsInfoFinding!.message).toContain("Performance metrics");
      } finally {
        await session.detach();
      }
    });

    it("runs contrast audit on page with low-contrast text", async () => {
      const page = pageManager.getActivePage();
      await page.goto(AUDIT_TARGET_FIXTURE, { waitUntil: "load" });

      const session = await page.createCDPSession();
      try {
        const result = await auditor.audit(page, session, [
          "contrast",
        ]);

        expect(result.categories_checked).toEqual(["contrast"]);

        // Should find low contrast issue
        const lowContrastFinding = result.findings.find(
          (f) =>
            f.category === "contrast" &&
            f.message.includes("contrast ratio"),
        );
        expect(lowContrastFinding).toBeDefined();
      } finally {
        await session.detach();
      }
    });

    it("runs all categories by default", async () => {
      const page = pageManager.getActivePage();
      await page.goto(AUDIT_TARGET_FIXTURE, { waitUntil: "load" });

      const session = await page.createCDPSession();
      try {
        const result = await auditor.audit(page, session);

        expect(result.categories_checked).toEqual([
          "a11y",
          "performance",
          "seo",
          "contrast",
          "links",
        ]);
        expect(result.findings.length).toBeGreaterThan(0);
        expect(result.summary).toMatch(/\d+ finding/);
      } finally {
        await session.detach();
      }
    });

    it("generates a correct summary", async () => {
      const page = pageManager.getActivePage();
      await page.goto(AUDIT_TARGET_FIXTURE, { waitUntil: "load" });

      const session = await page.createCDPSession();
      try {
        const result = await auditor.audit(page, session, [
          "a11y",
          "seo",
        ]);

        expect(result.summary).toMatch(/\d+ finding/);
        // Should have at least some errors or warnings
        const hasErrors = result.findings.some(
          (f) => f.severity === "error",
        );
        const hasWarnings = result.findings.some(
          (f) => f.severity === "warning",
        );
        expect(hasErrors || hasWarnings).toBe(true);
      } finally {
        await session.detach();
      }
    });
  });

  describe("reload event buffering", () => {
    it("surfaces reload event in renderActivePage after file change", async () => {
      // Create a temp directory with a simple HTML file
      const tempServDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "charlotte-reload-test-"),
      );
      const htmlFilePath = path.join(tempServDir, "index.html");
      fs.writeFileSync(
        htmlFilePath,
        '<html><head><title>Reload Test</title></head><body><p>Original</p></body></html>',
      );

      try {
        const serverInfo = await devModeState.startServing({
          directoryPath: tempServDir,
          watch: true,
          pageManager,
          usePolling: true,
        });

        // Navigate to the served page
        const page = pageManager.getActivePage();
        await page.goto(serverInfo.url, { waitUntil: "load" });

        // Verify no pending reload event initially
        expect(devModeState.consumePendingReloadEvent()).toBeNull();

        // Modify the file to trigger a reload event
        fs.writeFileSync(
          htmlFilePath,
          '<html><head><title>Reload Test Updated</title></head><body><p>Updated</p></body></html>',
        );

        // Wait for the file watcher to detect the change, debounce, and reload
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // The render should include the reload event
        const representation = await renderActivePage(deps, {
          source: "observe",
        });

        expect(representation.reload_event).toBeDefined();
        expect(representation.reload_event!.trigger).toBe("file_change");
        expect(representation.reload_event!.files_changed).toContain(
          "index.html",
        );
        expect(representation.reload_event!.timestamp).toBeTruthy();

        // Second render should NOT have the reload event (consumed)
        const secondRepresentation = await renderActivePage(deps, {
          source: "observe",
        });
        expect(secondRepresentation.reload_event).toBeUndefined();
      } finally {
        await devModeState.stopAll();
        fs.rmSync(tempServDir, { recursive: true, force: true });
      }
    }, 15000);

    it("consumePendingReloadEvent returns null when no events", () => {
      expect(devModeState.consumePendingReloadEvent()).toBeNull();
    });
  });
});
