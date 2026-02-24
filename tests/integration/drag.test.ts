import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
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
import type { CharlotteConfig } from "../../src/types/config.js";
import type { ToolDependencies } from "../../src/tools/tool-helpers.js";
import {
  renderActivePage,
  renderAfterAction,
} from "../../src/tools/tool-helpers.js";

const DRAG_FIXTURE = `file://${path.resolve(import.meta.dirname, "../fixtures/pages/drag.html")}`;

describe("Drag and drop integration", () => {
  let browserManager: BrowserManager;
  let config: CharlotteConfig;
  let pageManager: PageManager;
  let elementIdGenerator: ElementIdGenerator;
  let deps: ToolDependencies;

  beforeAll(async () => {
    browserManager = new BrowserManager();
    await browserManager.launch();
    config = createDefaultConfig();
    pageManager = new PageManager(config);
    await pageManager.openTab(browserManager);
    const cdpSessionManager = new CDPSessionManager();
    elementIdGenerator = new ElementIdGenerator();
    const rendererPipeline = new RendererPipeline(cdpSessionManager, elementIdGenerator);
    const artifactStore = new ArtifactStore(
      path.join(os.tmpdir(), "charlotte-drag-test-artifacts"),
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
    };
  });

  afterAll(async () => {
    await browserManager.close();
  });

  beforeEach(async () => {
    const page = pageManager.getActivePage();
    await page.goto(DRAG_FIXTURE, { waitUntil: "load" });
    // Render to populate element IDs
    await renderActivePage(deps, { source: "action" });
  });

  async function getResultText(): Promise<string> {
    const page = pageManager.getActivePage();
    return page.evaluate(() => {
      return document.getElementById("result")?.textContent ?? "";
    });
  }

  async function getZoneChildren(zoneId: string): Promise<string[]> {
    const page = pageManager.getActivePage();
    return page.evaluate((id) => {
      const zone = document.getElementById(id);
      if (!zone) return [];
      return Array.from(zone.querySelectorAll(".draggable")).map(
        (el) => el.id,
      );
    }, zoneId);
  }

  function findInteractiveByLabel(
    representation: Awaited<ReturnType<typeof renderActivePage>>,
    label: string,
  ) {
    return representation.interactive.find((el) => el.label === label);
  }

  function findLandmarkByLabel(
    representation: Awaited<ReturnType<typeof renderActivePage>>,
    label: string,
  ) {
    return representation.structure.landmarks.find((lm) => lm.label === label);
  }

  /** Get the center coordinates of an element by its backend node ID. */
  async function getCenter(backendNodeId: number) {
    const page = pageManager.getActivePage();
    const session = await page.createCDPSession();
    try {
      await session.send("DOM.scrollIntoViewIfNeeded", { backendNodeId });
      const { model } = await session.send("DOM.getBoxModel", { backendNodeId });
      const quad = model.content;
      return {
        x: (quad[0] + quad[2] + quad[4] + quad[6]) / 4,
        y: (quad[1] + quad[3] + quad[5] + quad[7]) / 4,
      };
    } finally {
      await session.detach();
    }
  }

  /** Perform a drag from source to target by backend node IDs. */
  async function performDrag(sourceNodeId: number, targetNodeId: number) {
    const page = pageManager.getActivePage();
    const sourceCenter = await getCenter(sourceNodeId);
    const targetCenter = await getCenter(targetNodeId);

    await page.mouse.move(sourceCenter.x, sourceCenter.y);
    await page.mouse.down();
    // Intermediate move to trigger drag start
    await page.mouse.move(
      sourceCenter.x + (targetCenter.x - sourceCenter.x) * 0.25,
      sourceCenter.y + (targetCenter.y - sourceCenter.y) * 0.25,
      { steps: 5 },
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    await page.mouse.move(targetCenter.x, targetCenter.y, { steps: 10 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await page.mouse.up();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  describe("basic drag operations", () => {
    it("drags an item from zone A to zone B", async () => {
      const representation = await renderActivePage(deps, { source: "action" });
      const item1 = findInteractiveByLabel(representation, "Item 1");
      const zoneB = findLandmarkByLabel(representation, "Zone B");
      expect(item1).toBeDefined();
      expect(zoneB).toBeDefined();

      const sourceNodeId = elementIdGenerator.resolveId(item1!.id);
      const targetNodeId = elementIdGenerator.resolveId(zoneB!.id);
      expect(sourceNodeId).not.toBeNull();
      expect(targetNodeId).not.toBeNull();

      await performDrag(sourceNodeId!, targetNodeId!);

      // Verify item moved to zone B
      const zoneBChildren = await getZoneChildren("zone-b");
      expect(zoneBChildren).toContain("item-1");

      const resultText = await getResultText();
      expect(resultText).toContain("dropped");
      expect(resultText).toContain("item-1");
      expect(resultText).toContain("zone-b");
    });

    it("item remains in original zone if dropped outside a valid target", async () => {
      // Item should stay in zone A if mouse is released elsewhere
      const zoneAChildrenBefore = await getZoneChildren("zone-a");
      expect(zoneAChildrenBefore).toContain("item-1");
      expect(zoneAChildrenBefore).toContain("item-2");

      const representation = await renderActivePage(deps, { source: "action" });
      const item1 = findInteractiveByLabel(representation, "Item 1");
      expect(item1).toBeDefined();

      const sourceNodeId = elementIdGenerator.resolveId(item1!.id);
      expect(sourceNodeId).not.toBeNull();

      const sourceCenter = await getCenter(sourceNodeId!);

      const page = pageManager.getActivePage();
      // Drag to empty area (outside any dropzone) and release
      await page.mouse.move(sourceCenter.x, sourceCenter.y);
      await page.mouse.down();
      await page.mouse.move(sourceCenter.x + 10, sourceCenter.y + 10, { steps: 3 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      await page.mouse.move(600, 400, { steps: 5 }); // empty area
      await page.mouse.up();

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Items should still be in zone A
      const zoneAChildrenAfter = await getZoneChildren("zone-a");
      expect(zoneAChildrenAfter).toContain("item-1");
    });

    it("can drag multiple items sequentially", async () => {
      const representation = await renderActivePage(deps, { source: "action" });
      const item1 = findInteractiveByLabel(representation, "Item 1");
      const item2 = findInteractiveByLabel(representation, "Item 2");
      const zoneB = findLandmarkByLabel(representation, "Zone B");
      expect(item1).toBeDefined();
      expect(item2).toBeDefined();
      expect(zoneB).toBeDefined();

      // Drag item 1 to zone B
      await performDrag(
        elementIdGenerator.resolveId(item1!.id)!,
        elementIdGenerator.resolveId(zoneB!.id)!,
      );

      let zoneBChildren = await getZoneChildren("zone-b");
      expect(zoneBChildren).toContain("item-1");

      // Re-render to get updated element positions and IDs
      const updatedRep = await renderActivePage(deps, { source: "action" });
      const freshItem2 = findInteractiveByLabel(updatedRep, "Item 2");
      const freshZoneB = findLandmarkByLabel(updatedRep, "Zone B");
      expect(freshItem2).toBeDefined();
      expect(freshZoneB).toBeDefined();

      // Drag item 2 to zone B
      await performDrag(
        elementIdGenerator.resolveId(freshItem2!.id)!,
        elementIdGenerator.resolveId(freshZoneB!.id)!,
      );

      zoneBChildren = await getZoneChildren("zone-b");
      expect(zoneBChildren).toContain("item-1");
      expect(zoneBChildren).toContain("item-2");

      // Zone A should be empty of draggables
      const zoneAChildren = await getZoneChildren("zone-a");
      expect(zoneAChildren).toHaveLength(0);
    });
  });

  describe("page representation after drag", () => {
    it("renderAfterAction produces a delta diff", async () => {
      const representation = await renderActivePage(deps, { source: "action" });
      const item1 = findInteractiveByLabel(representation, "Item 1");
      const zoneB = findLandmarkByLabel(representation, "Zone B");
      expect(item1).toBeDefined();
      expect(zoneB).toBeDefined();

      await performDrag(
        elementIdGenerator.resolveId(item1!.id)!,
        elementIdGenerator.resolveId(zoneB!.id)!,
      );

      const afterDrag = await renderAfterAction(deps);

      // The representation should still be valid
      expect(afterDrag.url).toContain("drag.html");
      expect(afterDrag.title).toBe("Drag and Drop Test Page");
      // Delta should be present (snapshot was taken before the action)
      expect(afterDrag.delta).toBeDefined();
    });
  });
});
