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
import type { ToolDependencies } from "../../src/tools/tool-helpers.js";
import {
  renderActivePage,
  resolveElement,
} from "../../src/tools/tool-helpers.js";

const MODIFIER_CLICK_FIXTURE = `file://${path.resolve(import.meta.dirname, "../fixtures/pages/modifier-click.html")}`;

describe("Modifier click integration", () => {
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
    const artifactStore = new ArtifactStore(
      path.join(os.tmpdir(), "charlotte-modifier-click-test-artifacts"),
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

  /**
   * Helper: get the text content of the #result div
   */
  async function getResultText(): Promise<string> {
    const page = pageManager.getActivePage();
    return page.evaluate(() => {
      return document.getElementById("result")?.textContent ?? "";
    });
  }

  /**
   * Helper: find the modifier test button element
   */
  function findModifierButton(
    representation: Awaited<ReturnType<typeof renderActivePage>>,
  ) {
    return representation.interactive.find((el) =>
      el.label.toLowerCase().includes("modifier test button"),
    );
  }

  /**
   * Helper: click an element by backend node ID via CDP with optional modifier keys.
   * Mirrors the production clickElementByBackendNodeId function.
   */
  async function clickWithModifiers(
    backendNodeId: number,
    clickType: "left" | "right" | "double" = "left",
    modifiers: Array<"ctrl" | "shift" | "alt" | "meta"> = [],
  ): Promise<void> {
    const page = pageManager.getActivePage();
    const cdpSession = await page.createCDPSession();
    try {
      await cdpSession.send("DOM.scrollIntoViewIfNeeded", { backendNodeId });
      const { model } = await cdpSession.send("DOM.getBoxModel", {
        backendNodeId,
      });
      if (!model) throw new Error("No box model");
      const contentQuad = model.content;
      const centerX =
        (contentQuad[0] + contentQuad[2] + contentQuad[4] + contentQuad[6]) / 4;
      const centerY =
        (contentQuad[1] + contentQuad[3] + contentQuad[5] + contentQuad[7]) / 4;

      const modifierKeyMap: Record<string, string> = {
        ctrl: "Control",
        shift: "Shift",
        alt: "Alt",
        meta: "Meta",
      };

      // Hold down modifier keys
      for (const modifier of modifiers) {
        await page.keyboard.down(modifierKeyMap[modifier] as import("puppeteer").KeyInput);
      }

      try {
        if (clickType === "right") {
          await page.mouse.click(centerX, centerY, { button: "right" });
        } else if (clickType === "double") {
          await page.mouse.click(centerX, centerY, { clickCount: 2 });
        } else {
          await page.mouse.click(centerX, centerY);
        }
      } finally {
        // Release modifier keys in reverse order
        for (const modifier of [...modifiers].reverse()) {
          await page.keyboard.up(modifierKeyMap[modifier] as import("puppeteer").KeyInput);
        }
      }
    } finally {
      await cdpSession.detach();
    }
  }

  describe("single modifier clicks", () => {
    beforeEach(async () => {
      const page = pageManager.getActivePage();
      await page.goto(MODIFIER_CLICK_FIXTURE, { waitUntil: "load" });
    });

    it("clicks without modifiers and reports none", async () => {
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const modifierButton = findModifierButton(representation);
      expect(modifierButton).toBeDefined();

      const { backendNodeId } = await resolveElement(deps, modifierButton!.id);
      await clickWithModifiers(backendNodeId);

      const resultText = await getResultText();
      expect(resultText).toBe("clicked:none");
    });

    it("ctrl+click sets ctrlKey on the event", async () => {
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const modifierButton = findModifierButton(representation);
      expect(modifierButton).toBeDefined();

      const { backendNodeId } = await resolveElement(deps, modifierButton!.id);
      await clickWithModifiers(backendNodeId, "left", ["ctrl"]);

      const resultText = await getResultText();
      expect(resultText).toBe("clicked:ctrl");
    });

    it("shift+click sets shiftKey on the event", async () => {
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const modifierButton = findModifierButton(representation);
      expect(modifierButton).toBeDefined();

      const { backendNodeId } = await resolveElement(deps, modifierButton!.id);
      await clickWithModifiers(backendNodeId, "left", ["shift"]);

      const resultText = await getResultText();
      expect(resultText).toBe("clicked:shift");
    });

    it("alt+click sets altKey on the event", async () => {
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const modifierButton = findModifierButton(representation);
      expect(modifierButton).toBeDefined();

      const { backendNodeId } = await resolveElement(deps, modifierButton!.id);
      await clickWithModifiers(backendNodeId, "left", ["alt"]);

      const resultText = await getResultText();
      expect(resultText).toBe("clicked:alt");
    });

    it("meta+click sets metaKey on the event", async () => {
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const modifierButton = findModifierButton(representation);
      expect(modifierButton).toBeDefined();

      const { backendNodeId } = await resolveElement(deps, modifierButton!.id);
      await clickWithModifiers(backendNodeId, "left", ["meta"]);

      const resultText = await getResultText();
      expect(resultText).toBe("clicked:meta");
    });
  });

  describe("combined modifier clicks", () => {
    beforeEach(async () => {
      const page = pageManager.getActivePage();
      await page.goto(MODIFIER_CLICK_FIXTURE, { waitUntil: "load" });
    });

    it("ctrl+shift+click sets both modifier keys", async () => {
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const modifierButton = findModifierButton(representation);
      expect(modifierButton).toBeDefined();

      const { backendNodeId } = await resolveElement(deps, modifierButton!.id);
      await clickWithModifiers(backendNodeId, "left", ["ctrl", "shift"]);

      const resultText = await getResultText();
      expect(resultText).toBe("clicked:ctrl+shift");
    });

    it("alt+shift+click sets both modifier keys", async () => {
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const modifierButton = findModifierButton(representation);
      expect(modifierButton).toBeDefined();

      const { backendNodeId } = await resolveElement(deps, modifierButton!.id);
      await clickWithModifiers(backendNodeId, "left", ["alt", "shift"]);

      const resultText = await getResultText();
      expect(resultText).toBe("clicked:alt+shift");
    });
  });

  describe("modifiers with different click types", () => {
    beforeEach(async () => {
      const page = pageManager.getActivePage();
      await page.goto(MODIFIER_CLICK_FIXTURE, { waitUntil: "load" });
    });

    it("ctrl+right-click sets ctrlKey on contextmenu event", async () => {
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const modifierButton = findModifierButton(representation);
      expect(modifierButton).toBeDefined();

      const { backendNodeId } = await resolveElement(deps, modifierButton!.id);
      await clickWithModifiers(backendNodeId, "right", ["ctrl"]);

      const resultText = await getResultText();
      expect(resultText).toBe("rightclicked:ctrl");
    });

    it("shift+double-click sets shiftKey on dblclick event", async () => {
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const modifierButton = findModifierButton(representation);
      expect(modifierButton).toBeDefined();

      const { backendNodeId } = await resolveElement(deps, modifierButton!.id);
      await clickWithModifiers(backendNodeId, "double", ["shift"]);

      const resultText = await getResultText();
      expect(resultText).toBe("dblclicked:shift");
    });
  });
});
