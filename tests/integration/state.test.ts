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
  renderAfterAction,
} from "../../src/tools/tool-helpers.js";
import { diffRepresentations } from "../../src/state/differ.js";

const INTERACTION_FIXTURE = `file://${path.resolve(import.meta.dirname, "../fixtures/pages/interaction.html")}`;
const DYNAMIC_FIXTURE = `file://${path.resolve(import.meta.dirname, "../fixtures/pages/dynamic.html")}`;

describe("State management integration", () => {
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

  describe("snapshot store integration", () => {
    it("auto-snapshots on observe when config is every_action", async () => {
      const page = pageManager.getActivePage();
      await page.goto(INTERACTION_FIXTURE, { waitUntil: "load" });

      deps.config.autoSnapshot = "every_action";
      deps.snapshotStore.clear();

      await renderActivePage(deps, { source: "observe" });

      expect(deps.snapshotStore.size).toBe(1);
      const latestSnapshot = deps.snapshotStore.getLatest();
      expect(latestSnapshot).not.toBeNull();
      expect(latestSnapshot!.representation.title).toBe("Interaction Test Page");
    });

    it("auto-snapshots on action when config is every_action", async () => {
      deps.snapshotStore.clear();
      deps.config.autoSnapshot = "every_action";

      await renderActivePage(deps, { source: "action" });

      expect(deps.snapshotStore.size).toBe(1);
    });

    it("does not snapshot on action when config is observe_only", async () => {
      deps.snapshotStore.clear();
      deps.config.autoSnapshot = "observe_only";

      await renderActivePage(deps, { source: "action" });
      expect(deps.snapshotStore.size).toBe(0);

      await renderActivePage(deps, { source: "observe" });
      expect(deps.snapshotStore.size).toBe(1);
    });

    it("does not auto-snapshot when config is manual", async () => {
      deps.snapshotStore.clear();
      deps.config.autoSnapshot = "manual";

      await renderActivePage(deps, { source: "observe" });
      await renderActivePage(deps, { source: "action" });
      expect(deps.snapshotStore.size).toBe(0);
    });

    it("snapshots on forceSnapshot even when manual", async () => {
      deps.snapshotStore.clear();
      deps.config.autoSnapshot = "manual";

      await renderActivePage(deps, { source: "observe", forceSnapshot: true });
      expect(deps.snapshotStore.size).toBe(1);
    });

    it("does not snapshot on internal renders", async () => {
      deps.snapshotStore.clear();
      deps.config.autoSnapshot = "every_action";

      // "internal" source (default) should not snapshot
      await renderActivePage(deps, { detail: "minimal" });
      expect(deps.snapshotStore.size).toBe(0);
    });

    it("stamps snapshot_id on representation", async () => {
      deps.snapshotStore.clear();
      deps.config.autoSnapshot = "every_action";

      const representation = await renderActivePage(deps, { source: "observe" });
      expect(representation.snapshot_id).toBeGreaterThan(0);
    });
  });

  describe("diff integration", () => {
    it("detects DOM mutation in diff", async () => {
      const page = pageManager.getActivePage();
      await page.goto(DYNAMIC_FIXTURE, { waitUntil: "load" });

      deps.snapshotStore.clear();
      deps.config.autoSnapshot = "every_action";

      // Take a snapshot of the initial state
      const beforeRepresentation = await renderActivePage(deps, {
        source: "observe",
      });

      // Toggle the section — this hides the "Toggleable section" landmark
      // and the link inside it, which should produce structural/interactive changes
      await page.evaluate(() => {
        const toggleButton = document.getElementById("toggle-section-btn");
        if (toggleButton) toggleButton.click();
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Take a snapshot of the mutated state
      const afterRepresentation = await renderActivePage(deps, {
        source: "observe",
      });

      const diff = diffRepresentations(
        beforeRepresentation,
        afterRepresentation,
        beforeRepresentation.snapshot_id,
        afterRepresentation.snapshot_id,
      );

      // There should be changes — the toggled section's content changed
      // At minimum, content_summary should differ since elements were hidden
      expect(diff.changes.length).toBeGreaterThan(0);
      expect(diff.from_snapshot).toBe(beforeRepresentation.snapshot_id);
      expect(diff.to_snapshot).toBe(afterRepresentation.snapshot_id);
    });

    it("detects navigation changes in diff", async () => {
      const page = pageManager.getActivePage();
      await page.goto(INTERACTION_FIXTURE, { waitUntil: "load" });

      deps.snapshotStore.clear();
      deps.config.autoSnapshot = "every_action";

      const beforeNavigation = await renderActivePage(deps, { source: "observe" });

      await page.goto(DYNAMIC_FIXTURE, { waitUntil: "load" });

      const afterNavigation = await renderActivePage(deps, { source: "observe" });

      const diff = diffRepresentations(
        beforeNavigation,
        afterNavigation,
        beforeNavigation.snapshot_id,
        afterNavigation.snapshot_id,
      );

      // Should detect URL and title changes
      const urlChange = diff.changes.find((change) => change.property === "url");
      expect(urlChange).toBeDefined();

      const titleChange = diff.changes.find((change) => change.property === "title");
      expect(titleChange).toBeDefined();
    });
  });

  describe("delta on interaction responses", () => {
    it("attaches delta to renderAfterAction result", async () => {
      const page = pageManager.getActivePage();
      await page.goto(INTERACTION_FIXTURE, { waitUntil: "load" });

      deps.snapshotStore.clear();
      deps.config.autoSnapshot = "every_action";

      // Create an initial snapshot (simulating an observe)
      await renderActivePage(deps, { source: "observe" });

      // Click a button to change state
      await page.evaluate(() => {
        const button = document.getElementById("click-btn");
        if (button) button.click();
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      // renderAfterAction should produce a representation with a delta
      const representationWithDelta = await renderAfterAction(deps);

      expect(representationWithDelta.delta).toBeDefined();
      expect(representationWithDelta.delta!.from_snapshot).toBeGreaterThan(0);
      expect(representationWithDelta.delta!.to_snapshot).toBe(
        representationWithDelta.snapshot_id,
      );
      expect(representationWithDelta.delta!.changes).toBeInstanceOf(Array);
      expect(representationWithDelta.delta!.summary).toBeTruthy();
    });
  });

  describe("configure integration", () => {
    it("changes snapshot depth at runtime", async () => {
      deps.config.snapshotDepth = 50;
      deps.snapshotStore.setDepth(50);
      deps.snapshotStore.clear();
      deps.config.autoSnapshot = "every_action";

      // Push many snapshots
      for (let i = 0; i < 20; i++) {
        await renderActivePage(deps, { source: "observe" });
      }
      expect(deps.snapshotStore.size).toBe(20);

      // Resize to 10 — should evict oldest 10
      deps.snapshotStore.setDepth(10);
      deps.config.snapshotDepth = 10;

      expect(deps.snapshotStore.size).toBe(10);
    });

    it("changes auto_snapshot mode at runtime", async () => {
      deps.snapshotStore.clear();

      // Start in every_action
      deps.config.autoSnapshot = "every_action";
      await renderActivePage(deps, { source: "action" });
      expect(deps.snapshotStore.size).toBe(1);

      // Switch to manual
      deps.config.autoSnapshot = "manual";
      await renderActivePage(deps, { source: "action" });
      expect(deps.snapshotStore.size).toBe(1); // No new snapshot

      // Switch back to every_action
      deps.config.autoSnapshot = "every_action";
      await renderActivePage(deps, { source: "action" });
      expect(deps.snapshotStore.size).toBe(2); // New snapshot added
    });

    it("SNAPSHOT_EXPIRED when requesting evicted snapshot", async () => {
      const store = new SnapshotStore(5);
      deps.snapshotStore = store;
      deps.config.autoSnapshot = "every_action";

      // Fill the buffer
      for (let i = 0; i < 8; i++) {
        await renderActivePage(deps, { source: "observe" });
      }

      // Snapshot 1 should be evicted
      expect(store.get(1)).toBeNull();

      // Oldest available should be 4
      expect(store.getOldestId()).toBe(4);
    });
  });
});
