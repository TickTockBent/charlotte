import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import type { KeyInput } from "puppeteer";
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
} from "../../src/tools/tool-helpers.js";

const KEYBOARD_FIXTURE = `file://${path.resolve(import.meta.dirname, "../fixtures/pages/keyboard.html")}`;

describe("Keyboard integration", () => {
  let browserManager: BrowserManager;
  let pageManager: PageManager;
  let elementIdGenerator: ElementIdGenerator;
  let deps: ToolDependencies;

  beforeAll(async () => {
    browserManager = new BrowserManager();
    await browserManager.launch();
    const config = createDefaultConfig();
    pageManager = new PageManager(config);
    await pageManager.openTab(browserManager);
    const cdpSessionManager = new CDPSessionManager();
    elementIdGenerator = new ElementIdGenerator();
    const rendererPipeline = new RendererPipeline(cdpSessionManager, elementIdGenerator);
    const artifactStore = new ArtifactStore(
      path.join(os.tmpdir(), "charlotte-keyboard-test-artifacts"),
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
    await page.goto(KEYBOARD_FIXTURE, { waitUntil: "load" });
  });

  /** Get the text content of an element by CSS selector */
  async function getResultText(selector: string): Promise<string> {
    const page = pageManager.getActivePage();
    return page.evaluate(
      (sel) => document.querySelector(sel)?.textContent ?? "",
      selector,
    );
  }

  /**
   * Register an element with Charlotte's ID generator via CDP, simulating
   * what charlotte:find({ selector }) does. Returns the assigned element ID.
   */
  async function registerElementBySelector(selector: string): Promise<string> {
    const page = pageManager.getActivePage();
    const cdpSession = await page.createCDPSession();
    try {
      const { root } = await cdpSession.send("DOM.getDocument");
      const { nodeIds } = await cdpSession.send("DOM.querySelectorAll", {
        nodeId: root.nodeId,
        selector,
      });
      if (nodeIds.length === 0) throw new Error(`No element found for ${selector}`);
      const { node } = await cdpSession.send("DOM.describeNode", { nodeId: nodeIds[0] });
      const backendNodeId = node.backendNodeId;
      const elementId = elementIdGenerator.generateId(
        "dom_element",
        node.nodeName.toLowerCase(),
        selector,
        {
          nearestLandmarkRole: null,
          nearestLandmarkLabel: null,
          nearestLabelledContainer: null,
          siblingIndex: 0,
        },
        backendNodeId,
      );
      return elementId;
    } finally {
      await cdpSession.detach();
    }
  }

  describe("single key to focused non-input element", () => {
    it("sends a named key (ArrowDown) to a div with keydown listener", async () => {
      const page = pageManager.getActivePage();
      await page.focus("#key-target");

      await page.keyboard.press("ArrowDown" as KeyInput);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const resultText = await getResultText("#result");
      expect(resultText).toContain("key:ArrowDown");
    });

    it("sends a single character key", async () => {
      const page = pageManager.getActivePage();
      await page.focus("#key-target");

      await page.keyboard.press("a" as KeyInput);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const resultText = await getResultText("#result");
      expect(resultText).toContain("key:a");
    });

    it("sends Space key", async () => {
      const page = pageManager.getActivePage();
      await page.focus("#key-target");

      await page.keyboard.press("Space" as KeyInput);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const resultText = await getResultText("#result");
      expect(resultText).toContain("key: ");
    });
  });

  describe("element_id targeting via CDP focus", () => {
    it("focuses element by registered ID before sending key", async () => {
      const page = pageManager.getActivePage();

      // Register the element (simulates charlotte:find with selector)
      const elementId = await registerElementBySelector("#key-target");
      const backendNodeId = elementIdGenerator.resolveId(elementId);
      expect(backendNodeId).not.toBeNull();

      // Focus via CDP (what charlotte:key does with element_id)
      const cdpSession = await page.createCDPSession();
      try {
        await cdpSession.send("DOM.focus", { backendNodeId: backendNodeId! });
      } finally {
        await cdpSession.detach();
      }

      await page.keyboard.press("ArrowUp" as KeyInput);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const resultText = await getResultText("#result");
      expect(resultText).toContain("key:ArrowUp");
    });

    it("focuses grid element and sends arrow keys", async () => {
      const page = pageManager.getActivePage();

      const elementId = await registerElementBySelector("#grid");
      const backendNodeId = elementIdGenerator.resolveId(elementId);

      const cdpSession = await page.createCDPSession();
      try {
        await cdpSession.send("DOM.focus", { backendNodeId: backendNodeId! });
      } finally {
        await cdpSession.detach();
      }

      await page.keyboard.press("ArrowRight" as KeyInput);
      await page.keyboard.press("ArrowDown" as KeyInput);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const resultText = await getResultText("#grid-result");
      expect(resultText).toBe("1,1");
    });
  });

  describe("key sequences", () => {
    it("sends a sequence of character keys", async () => {
      const page = pageManager.getActivePage();
      await page.focus("#sequence-target");

      const keysToPress = ["a", "b", "c"];
      for (const k of keysToPress) {
        await page.keyboard.press(k as KeyInput);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));

      const resultText = await getResultText("#sequence-result");
      expect(resultText).toBe("a,b,c");
    });

    it("sends arrow key sequence to navigate grid", async () => {
      const page = pageManager.getActivePage();
      await page.focus("#grid");

      // Move right twice, down once
      const keysToPress = ["ArrowRight", "ArrowRight", "ArrowDown"];
      for (const k of keysToPress) {
        await page.keyboard.press(k as KeyInput);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));

      const resultText = await getResultText("#grid-result");
      expect(resultText).toBe("2,1");
    });

    it("sends sequence with delay between keys", async () => {
      const page = pageManager.getActivePage();
      await page.focus("#sequence-target");

      const startTime = Date.now();
      const keysToPress = ["x", "y", "z"];
      const delayMs = 50;
      for (let i = 0; i < keysToPress.length; i++) {
        await page.keyboard.press(keysToPress[i] as KeyInput);
        if (i < keysToPress.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
      const elapsed = Date.now() - startTime;

      const resultText = await getResultText("#sequence-result");
      expect(resultText).toBe("x,y,z");
      // At least 2 delays of 50ms each
      expect(elapsed).toBeGreaterThanOrEqual(80);
    });
  });

  describe("modifier keys on non-input elements", () => {
    it("sends Ctrl+key — ctrl modifier detected by page listener", async () => {
      const page = pageManager.getActivePage();
      await page.focus("#key-target");

      await page.keyboard.down("Control" as KeyInput);
      await page.keyboard.press("c" as KeyInput);
      await page.keyboard.up("Control" as KeyInput);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const resultText = await getResultText("#result");
      expect(resultText).toContain("key:c");
      expect(resultText).toContain("ctrl:true");
    });

    it("sends Shift+key — shift modifier detected by page listener", async () => {
      const page = pageManager.getActivePage();
      await page.focus("#key-target");

      await page.keyboard.down("Shift" as KeyInput);
      await page.keyboard.press("a" as KeyInput);
      await page.keyboard.up("Shift" as KeyInput);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const resultText = await getResultText("#result");
      // Puppeteer sends e.key as lowercase even with shift held
      expect(resultText).toContain("shift:true");
    });

    it("sends Alt+key — alt modifier detected", async () => {
      const page = pageManager.getActivePage();
      await page.focus("#key-target");

      await page.keyboard.down("Alt" as KeyInput);
      await page.keyboard.press("x" as KeyInput);
      await page.keyboard.up("Alt" as KeyInput);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const resultText = await getResultText("#result");
      expect(resultText).toContain("alt:true");
    });
  });

  describe("tool integration path", () => {
    it("full element_id → focus → sequence → render path", async () => {
      const page = pageManager.getActivePage();

      // Register grid element (simulates charlotte:find)
      const elementId = await registerElementBySelector("#grid");
      const backendNodeId = elementIdGenerator.resolveId(elementId);

      // Focus (what charlotte:key does with element_id)
      const cdpSession = await page.createCDPSession();
      try {
        await cdpSession.send("DOM.focus", { backendNodeId: backendNodeId! });
      } finally {
        await cdpSession.detach();
      }

      // Send key sequence (what charlotte:key does with keys param)
      const keysToPress = ["ArrowRight", "ArrowRight", "ArrowDown", "ArrowDown"];
      for (const k of keysToPress) {
        await page.keyboard.press(k as KeyInput);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify page state
      const gridResult = await getResultText("#grid-result");
      expect(gridResult).toBe("2,2");

      // Render should complete without errors
      const representation = await renderActivePage(deps, { source: "action" });
      expect(representation.url).toContain("keyboard.html");
    });

    it("keys work on text input elements too", async () => {
      const page = pageManager.getActivePage();

      // Register the text input
      const elementId = await registerElementBySelector("#text-input");
      const backendNodeId = elementIdGenerator.resolveId(elementId);

      const cdpSession = await page.createCDPSession();
      try {
        await cdpSession.send("DOM.focus", { backendNodeId: backendNodeId! });
      } finally {
        await cdpSession.detach();
      }

      // Type via keyboard (not charlotte:type, just raw keys)
      await page.keyboard.press("h" as KeyInput);
      await page.keyboard.press("i" as KeyInput);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const inputValue = await page.evaluate(
        () => (document.getElementById("text-input") as HTMLInputElement).value,
      );
      expect(inputValue).toBe("hi");
    });
  });
});
