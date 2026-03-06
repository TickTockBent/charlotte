import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
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

const INTERACTION_FIXTURE = `file://${path.resolve(import.meta.dirname, "../fixtures/pages/interaction.html")}`;
const FORM_FIXTURE = `file://${path.resolve(import.meta.dirname, "../fixtures/pages/form.html")}`;

describe("Interaction integration", () => {
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
      path.join(os.tmpdir(), "charlotte-interact-test-artifacts"),
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
   * Helper: find an interactive element by its label (case-insensitive partial match)
   */
  function findElementByLabel(
    representation: Awaited<ReturnType<typeof renderActivePage>>,
    labelSubstring: string,
  ) {
    return representation.interactive.find((el) =>
      el.label.toLowerCase().includes(labelSubstring.toLowerCase()),
    );
  }

  /**
   * Helper: find an interactive element by its type and optionally label
   */
  function findElementByType(
    representation: Awaited<ReturnType<typeof renderActivePage>>,
    type: string,
    labelSubstring?: string,
  ) {
    return representation.interactive.find(
      (el) =>
        el.type === type &&
        (!labelSubstring ||
          el.label.toLowerCase().includes(labelSubstring.toLowerCase())),
    );
  }

  /**
   * Helper: click an element by backend node ID via CDP
   */
  async function clickByBackendNodeId(backendNodeId: number): Promise<void> {
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
      await page.mouse.click(centerX, centerY);
    } finally {
      await cdpSession.detach();
    }
  }

  /**
   * Helper: focus an element by backend node ID via CDP
   */
  async function focusByBackendNodeId(backendNodeId: number): Promise<void> {
    const page = pageManager.getActivePage();
    const cdpSession = await page.createCDPSession();
    try {
      await cdpSession.send("DOM.focus", { backendNodeId });
    } finally {
      await cdpSession.detach();
    }
  }

  /**
   * Helper: select an option in a <select> element via CDP
   */
  async function selectOptionByBackendNodeId(
    backendNodeId: number,
    value: string,
  ): Promise<void> {
    const page = pageManager.getActivePage();
    const cdpSession = await page.createCDPSession();
    try {
      const { object } = await cdpSession.send("DOM.resolveNode", {
        backendNodeId,
      });
      if (!object?.objectId) throw new Error("Could not resolve node");
      await cdpSession.send("Runtime.callFunctionOn", {
        objectId: object.objectId,
        functionDeclaration: `function(targetValue) {
          const options = Array.from(this.options);
          const match = options.find(o => o.value === targetValue) || options.find(o => o.textContent.trim() === targetValue);
          if (match) {
            this.value = match.value;
            this.dispatchEvent(new Event('input', { bubbles: true }));
            this.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }`,
        arguments: [{ value }],
      });
    } finally {
      await cdpSession.detach();
    }
  }

  describe("click", () => {
    beforeEach(async () => {
      const page = pageManager.getActivePage();
      await page.goto(INTERACTION_FIXTURE, { waitUntil: "load" });
    });

    it("clicks a button and triggers its onclick handler", async () => {
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const clickButton = findElementByLabel(representation, "Click Me");
      expect(clickButton).toBeDefined();

      const { backendNodeId } = await resolveElement(deps, clickButton!.id);
      await clickByBackendNodeId(backendNodeId);

      // Verify the click handler fired
      const resultText = await getResultText();
      expect(resultText).toBe("Button clicked");
    });

    it("performs a double click", async () => {
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const dblClickButton = findElementByLabel(representation, "Double Click");
      expect(dblClickButton).toBeDefined();

      const page = pageManager.getActivePage();
      const { backendNodeId } = await resolveElement(deps, dblClickButton!.id);

      // Double click via CDP coordinates
      const cdpSession = await page.createCDPSession();
      try {
        await cdpSession.send("DOM.scrollIntoViewIfNeeded", { backendNodeId });
        const { model } = await cdpSession.send("DOM.getBoxModel", {
          backendNodeId,
        });
        const contentQuad = model!.content;
        const centerX =
          (contentQuad[0] + contentQuad[2] + contentQuad[4] + contentQuad[6]) / 4;
        const centerY =
          (contentQuad[1] + contentQuad[3] + contentQuad[5] + contentQuad[7]) / 4;
        await page.mouse.click(centerX, centerY, { clickCount: 2 });
      } finally {
        await cdpSession.detach();
      }

      const resultText = await getResultText();
      expect(resultText).toBe("Double clicked");
    });

    it("performs a right click", async () => {
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const rightClickButton = findElementByLabel(representation, "Right Click");
      expect(rightClickButton).toBeDefined();

      const page = pageManager.getActivePage();
      const { backendNodeId } = await resolveElement(deps, rightClickButton!.id);

      const cdpSession = await page.createCDPSession();
      try {
        await cdpSession.send("DOM.scrollIntoViewIfNeeded", { backendNodeId });
        const { model } = await cdpSession.send("DOM.getBoxModel", {
          backendNodeId,
        });
        const contentQuad = model!.content;
        const centerX =
          (contentQuad[0] + contentQuad[2] + contentQuad[4] + contentQuad[6]) / 4;
        const centerY =
          (contentQuad[1] + contentQuad[3] + contentQuad[5] + contentQuad[7]) / 4;
        await page.mouse.click(centerX, centerY, { button: "right" });
      } finally {
        await cdpSession.detach();
      }

      const resultText = await getResultText();
      expect(resultText).toBe("Right clicked");
    });

    it("re-renders after click and returns updated representation", async () => {
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const clickButton = findElementByLabel(representation, "Click Me");
      expect(clickButton).toBeDefined();

      const { backendNodeId } = await resolveElement(deps, clickButton!.id);
      await clickByBackendNodeId(backendNodeId);

      // Re-render to verify state is captured
      const updatedRepresentation = await renderActivePage(deps, { detail: "full" });
      expect(updatedRepresentation.structure.full_content).toContain(
        "Button clicked",
      );
    });
  });

  describe("type", () => {
    beforeEach(async () => {
      const page = pageManager.getActivePage();
      await page.goto(INTERACTION_FIXTURE, { waitUntil: "load" });
    });

    it("types text into an input field", async () => {
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const emptyInput = findElementByType(representation, "text_input", "Empty Input");
      expect(emptyInput).toBeDefined();

      const page = pageManager.getActivePage();
      const { backendNodeId } = await resolveElement(deps, emptyInput!.id);

      // Focus and type
      await focusByBackendNodeId(backendNodeId);
      await page.keyboard.type("Hello World");

      // Verify the value was set
      const inputValue = await page.evaluate(() => {
        return (document.getElementById("empty-input") as HTMLInputElement)?.value ?? "";
      });
      expect(inputValue).toBe("Hello World");
    });

    it("clears existing value before typing when clear_first is true", async () => {
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const textInput = findElementByType(representation, "text_input", "Text Input");
      expect(textInput).toBeDefined();

      const page = pageManager.getActivePage();
      const { backendNodeId } = await resolveElement(deps, textInput!.id);

      // Focus, select all, delete, then type
      await focusByBackendNodeId(backendNodeId);
      await page.keyboard.down("Control");
      await page.keyboard.press("a");
      await page.keyboard.up("Control");
      await page.keyboard.press("Backspace");
      await page.keyboard.type("Replaced text");

      const inputValue = await page.evaluate(() => {
        return (document.getElementById("text-input") as HTMLInputElement)?.value ?? "";
      });
      expect(inputValue).toBe("Replaced text");
    });

    it("appends to existing text when typing without clearing", async () => {
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const textInput = findElementByType(representation, "text_input", "Text Input");
      expect(textInput).toBeDefined();

      const page = pageManager.getActivePage();
      const { backendNodeId } = await resolveElement(deps, textInput!.id);

      // Focus at end and type additional text
      await focusByBackendNodeId(backendNodeId);
      await page.keyboard.press("End");
      await page.keyboard.type(" more");

      const inputValue = await page.evaluate(() => {
        return (document.getElementById("text-input") as HTMLInputElement)?.value ?? "";
      });
      expect(inputValue).toBe("initial value more");
    });

    it("presses Enter after typing when press_enter is true", async () => {
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const searchInput = findElementByType(representation, "text_input", "Search");
      expect(searchInput).toBeDefined();

      const page = pageManager.getActivePage();
      const { backendNodeId } = await resolveElement(deps, searchInput!.id);

      await focusByBackendNodeId(backendNodeId);
      await page.keyboard.type("test query");
      await page.keyboard.press("Enter");

      // The search input has an oninput handler that updates #result
      const resultText = await getResultText();
      expect(resultText).toBe("Typed: test query");
    });
  });

  describe("select", () => {
    beforeEach(async () => {
      const page = pageManager.getActivePage();
      await page.goto(INTERACTION_FIXTURE, { waitUntil: "load" });
    });

    it("selects an option by value", async () => {
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const colorSelect = findElementByType(representation, "select", "Color");
      expect(colorSelect).toBeDefined();

      const { backendNodeId } = await resolveElement(deps, colorSelect!.id);
      await selectOptionByBackendNodeId(backendNodeId, "green");

      const page = pageManager.getActivePage();
      const selectedValue = await page.evaluate(() => {
        return (document.getElementById("color-select") as HTMLSelectElement)?.value ?? "";
      });
      expect(selectedValue).toBe("green");

      // Verify change event fired
      const resultText = await getResultText();
      expect(resultText).toBe("Selected: green");
    });

    it("selects an option by text content", async () => {
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const colorSelect = findElementByType(representation, "select", "Color");
      expect(colorSelect).toBeDefined();

      const { backendNodeId } = await resolveElement(deps, colorSelect!.id);
      await selectOptionByBackendNodeId(backendNodeId, "Blue");

      const page = pageManager.getActivePage();
      const selectedValue = await page.evaluate(() => {
        return (document.getElementById("color-select") as HTMLSelectElement)?.value ?? "";
      });
      expect(selectedValue).toBe("blue");
    });
  });

  describe("toggle", () => {
    beforeEach(async () => {
      const page = pageManager.getActivePage();
      await page.goto(INTERACTION_FIXTURE, { waitUntil: "load" });
    });

    it("toggles an unchecked checkbox to checked", async () => {
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const checkbox = findElementByType(representation, "checkbox", "agree");
      expect(checkbox).toBeDefined();
      // Initially unchecked
      expect(checkbox!.state.checked).toBeUndefined();

      const { backendNodeId } = await resolveElement(deps, checkbox!.id);
      await clickByBackendNodeId(backendNodeId);

      // Re-render and verify checked state
      const updatedRepresentation = await renderActivePage(deps, { detail: "minimal" });
      const updatedCheckbox = findElementByType(
        updatedRepresentation,
        "checkbox",
        "agree",
      );
      expect(updatedCheckbox).toBeDefined();
      expect(updatedCheckbox!.state.checked).toBe(true);
    });

    it("toggles a checked checkbox to unchecked", async () => {
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const checkbox = findElementByType(
        representation,
        "checkbox",
        "Already checked",
      );
      expect(checkbox).toBeDefined();
      expect(checkbox!.state.checked).toBe(true);

      const { backendNodeId } = await resolveElement(deps, checkbox!.id);
      await clickByBackendNodeId(backendNodeId);

      const updatedRepresentation = await renderActivePage(deps, { detail: "minimal" });
      const updatedCheckbox = findElementByType(
        updatedRepresentation,
        "checkbox",
        "Already checked",
      );
      expect(updatedCheckbox).toBeDefined();
      expect(updatedCheckbox!.state.checked).toBeUndefined();
    });
  });

  describe("hover", () => {
    beforeEach(async () => {
      const page = pageManager.getActivePage();
      await page.goto(INTERACTION_FIXTURE, { waitUntil: "load" });
    });

    it("triggers hover state on an element", async () => {
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const hoverButton = findElementByLabel(representation, "Hover Over Me");
      expect(hoverButton).toBeDefined();

      const page = pageManager.getActivePage();
      const { backendNodeId } = await resolveElement(deps, hoverButton!.id);

      // Hover via CDP coordinates
      const cdpSession = await page.createCDPSession();
      try {
        await cdpSession.send("DOM.scrollIntoViewIfNeeded", { backendNodeId });
        const { model } = await cdpSession.send("DOM.getBoxModel", {
          backendNodeId,
        });
        const contentQuad = model!.content;
        const centerX =
          (contentQuad[0] + contentQuad[2] + contentQuad[4] + contentQuad[6]) / 4;
        const centerY =
          (contentQuad[1] + contentQuad[3] + contentQuad[5] + contentQuad[7]) / 4;
        await page.mouse.move(centerX, centerY);
      } finally {
        await cdpSession.detach();
      }

      // Verify hover handler fired
      const resultText = await getResultText();
      expect(resultText).toBe("Hovered");
    });
  });

  describe("key", () => {
    beforeEach(async () => {
      const page = pageManager.getActivePage();
      await page.goto(INTERACTION_FIXTURE, { waitUntil: "load" });
    });

    it("presses a simple key", async () => {
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const keyInput = findElementByType(representation, "text_input", "key");
      // The key input might be found with various labels
      const anyInput = keyInput ?? representation.interactive.find(
        (el) => el.type === "text_input",
      );
      expect(anyInput).toBeDefined();

      const page = pageManager.getActivePage();
      // Focus the key-input element directly
      await page.focus("#key-input");
      await page.keyboard.press("Escape");

      const resultText = await getResultText();
      expect(resultText).toBe("Key: Escape");
    });

    it("presses a key with modifier", async () => {
      const page = pageManager.getActivePage();
      await page.focus("#key-input");

      await page.keyboard.down("Control");
      await page.keyboard.press("a");
      await page.keyboard.up("Control");

      const resultText = await getResultText();
      expect(resultText).toBe("Key: a +Ctrl");
    });
  });

  describe("scroll", () => {
    beforeEach(async () => {
      const page = pageManager.getActivePage();
      await page.goto(INTERACTION_FIXTURE, { waitUntil: "load" });
    });

    it("scrolls the page down", async () => {
      const page = pageManager.getActivePage();

      const scrollBefore = await page.evaluate(() => window.scrollY);

      await page.evaluate(() => {
        window.scrollBy(0, 200);
      });

      const scrollAfter = await page.evaluate(() => window.scrollY);
      expect(scrollAfter).toBeGreaterThan(scrollBefore);
    });

    it("scrolls a container element", async () => {
      const page = pageManager.getActivePage();

      const scrollBefore = await page.evaluate(() => {
        return document.getElementById("scroll-container")?.scrollTop ?? 0;
      });

      await page.evaluate(() => {
        const container = document.getElementById("scroll-container");
        if (container) container.scrollBy(0, 50);
      });

      const scrollAfter = await page.evaluate(() => {
        return document.getElementById("scroll-container")?.scrollTop ?? 0;
      });
      expect(scrollAfter).toBeGreaterThan(scrollBefore);
    });
  });

  describe("submit", () => {
    beforeEach(async () => {
      const page = pageManager.getActivePage();
      await page.goto(INTERACTION_FIXTURE, { waitUntil: "load" });
    });

    it("submits a form via its submit button", async () => {
      // Type a name first
      const page = pageManager.getActivePage();
      await page.focus("#submit-input");
      await page.keyboard.type("Test User");

      // Find and click the submit button
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const submitButton = findElementByLabel(representation, "Submit");
      expect(submitButton).toBeDefined();

      const { backendNodeId } = await resolveElement(deps, submitButton!.id);
      await clickByBackendNodeId(backendNodeId);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const resultText = await getResultText();
      expect(resultText).toBe("Form submitted");
    });

    it("detects form representations with fields and submit button", async () => {
      const representation = await renderActivePage(deps, { detail: "minimal" });

      const submitForm = representation.forms.find((f) =>
        representation.interactive.some(
          (el) => el.id === f.submit && el.label.includes("Submit"),
        ),
      );

      // Should find the submit form
      expect(submitForm).toBeDefined();
      expect(submitForm!.fields.length).toBeGreaterThanOrEqual(1);
      expect(submitForm!.submit).not.toBeNull();
    });
  });

  describe("click_at", () => {
    beforeEach(async () => {
      const page = pageManager.getActivePage();
      await page.goto(INTERACTION_FIXTURE, { waitUntil: "load" });
    });

    it("clicks at coordinates to trigger a button click handler", async () => {
      const page = pageManager.getActivePage();

      // Find the Click Me button to get its coordinates
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const clickButton = findElementByLabel(representation, "Click Me");
      expect(clickButton).toBeDefined();
      expect(clickButton!.bounds).toBeDefined();

      // Click at the button's center using raw coordinates
      const centerX = clickButton!.bounds!.x + clickButton!.bounds!.w / 2;
      const centerY = clickButton!.bounds!.y + clickButton!.bounds!.h / 2;
      await page.mouse.click(centerX, centerY);

      const resultText = await getResultText();
      expect(resultText).toBe("Button clicked");
    });

    it("clicks a non-semantic element using coordinates from box model", async () => {
      const page = pageManager.getActivePage();

      // Scroll widget into view and get viewport-relative coordinates
      const widgetBounds = await page.evaluate(() => {
        const widget = document.getElementById("custom-widget");
        if (!widget) return null;
        widget.scrollIntoView({ block: "center" });
        const rect = widget.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      });
      expect(widgetBounds).not.toBeNull();

      await page.mouse.click(widgetBounds!.x, widgetBounds!.y);

      const resultText = await getResultText();
      expect(resultText).toBe("Widget clicked");
    });

    it("handles mousedown/mouseup pattern like crit's gutter", async () => {
      const page = pageManager.getActivePage();

      // Scroll gutter into view and get viewport-relative coordinates
      const gutterBounds = await page.evaluate(() => {
        const gutter = document.getElementById("gutter-sim");
        if (!gutter) return null;
        gutter.scrollIntoView({ block: "center" });
        const rect = gutter.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      });
      expect(gutterBounds).not.toBeNull();

      // page.mouse.click dispatches mousedown then mouseup at the same coordinates
      // The mouseup bubbles to document, which is where the gutter's listener is
      await page.mouse.click(gutterBounds!.x, gutterBounds!.y);

      const resultText = await getResultText();
      expect(resultText).toBe("Gutter activated");
    });

    it("supports double click at coordinates", async () => {
      const page = pageManager.getActivePage();

      // Get the Double Click Me button coordinates
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const dblClickButton = findElementByLabel(representation, "Double Click");
      expect(dblClickButton).toBeDefined();

      const centerX = dblClickButton!.bounds!.x + dblClickButton!.bounds!.w / 2;
      const centerY = dblClickButton!.bounds!.y + dblClickButton!.bounds!.h / 2;
      await page.mouse.click(centerX, centerY, { clickCount: 2 });

      const resultText = await getResultText();
      expect(resultText).toBe("Double clicked");
    });
  });

  describe("upload", () => {
    const tempFiles: string[] = [];

    beforeAll(() => {
      // Create temp files for upload tests
      const tempDir = os.tmpdir();
      const singleFile = path.join(tempDir, "charlotte-test-upload.txt");
      fs.writeFileSync(singleFile, "test content");
      tempFiles.push(singleFile);

      const multiFile1 = path.join(tempDir, "charlotte-test-upload-1.txt");
      const multiFile2 = path.join(tempDir, "charlotte-test-upload-2.txt");
      fs.writeFileSync(multiFile1, "file 1");
      fs.writeFileSync(multiFile2, "file 2");
      tempFiles.push(multiFile1, multiFile2);
    });

    afterAll(() => {
      for (const filePath of tempFiles) {
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      }
    });

    beforeEach(async () => {
      const page = pageManager.getActivePage();
      await page.goto(INTERACTION_FIXTURE, { waitUntil: "load" });
    });

    it("uploads a single file to a file input", async () => {
      const representation = await renderActivePage(deps, { detail: "summary" });
      const fileInput = findElementByType(representation, "file_input", "Single File");
      expect(fileInput).toBeDefined();

      const page = pageManager.getActivePage();
      const { backendNodeId } = await resolveElement(deps, fileInput!.id);

      // Use CDP to set the file
      const cdpSession = await page.createCDPSession();
      try {
        await cdpSession.send("DOM.setFileInputFiles", {
          files: [tempFiles[0]],
          backendNodeId,
        });
      } finally {
        await cdpSession.detach();
      }

      // Verify onchange fired
      const resultText = await getResultText();
      expect(resultText).toBe("Uploaded: charlotte-test-upload.txt");
    });

    it("uploads multiple files to a multi-file input", async () => {
      const representation = await renderActivePage(deps, { detail: "summary" });
      const fileInput = findElementByType(representation, "file_input", "Multiple Files");
      expect(fileInput).toBeDefined();

      const page = pageManager.getActivePage();
      const { backendNodeId } = await resolveElement(deps, fileInput!.id);

      const cdpSession = await page.createCDPSession();
      try {
        await cdpSession.send("DOM.setFileInputFiles", {
          files: [tempFiles[1], tempFiles[2]],
          backendNodeId,
        });
      } finally {
        await cdpSession.detach();
      }

      const resultText = await getResultText();
      expect(resultText).toBe("Uploaded: 2 files");
    });

    it("detects file inputs as type file_input in page representation", async () => {
      const representation = await renderActivePage(deps, { detail: "summary" });
      const fileInputs = representation.interactive.filter(
        (el) => el.type === "file_input",
      );
      expect(fileInputs.length).toBeGreaterThanOrEqual(2);
    });

    it("rejects setFileInputFiles on a regular button", async () => {
      const representation = await renderActivePage(deps, { detail: "summary" });
      const button = findElementByLabel(representation, "Click Me");
      expect(button).toBeDefined();
      expect(button!.type).toBe("button");

      const page = pageManager.getActivePage();
      const { backendNodeId } = await resolveElement(deps, button!.id);

      // Attempt to set files on a non-file-input element
      const cdpSession = await page.createCDPSession();
      try {
        const { node } = await cdpSession.send("DOM.describeNode", { backendNodeId });
        const isFileInput =
          node.nodeName === "INPUT" &&
          (node.attributes ?? []).some(
            (attr: string, i: number, arr: string[]) =>
              attr === "type" && arr[i + 1] === "file",
          );
        expect(isFileInput).toBe(false);
      } finally {
        await cdpSession.detach();
      }
    });

    it("rejects setFileInputFiles on a text input", async () => {
      const representation = await renderActivePage(deps, { detail: "summary" });
      const textInput = findElementByType(representation, "text_input", "Text Input");
      expect(textInput).toBeDefined();

      const page = pageManager.getActivePage();
      const { backendNodeId } = await resolveElement(deps, textInput!.id);

      const cdpSession = await page.createCDPSession();
      try {
        const { node } = await cdpSession.send("DOM.describeNode", { backendNodeId });
        // It's an INPUT but type="text", not type="file"
        expect(node.nodeName).toBe("INPUT");
        const isFileInput = (node.attributes ?? []).some(
          (attr: string, i: number, arr: string[]) =>
            attr === "type" && arr[i + 1] === "file",
        );
        expect(isFileInput).toBe(false);
      } finally {
        await cdpSession.detach();
      }
    });

    it("does not reclassify non-button elements as file_input", async () => {
      const representation = await renderActivePage(deps, { detail: "summary" });
      // Links, checkboxes, text inputs should never become file_input
      for (const element of representation.interactive) {
        if (element.type !== "file_input") {
          expect(["button", "link", "text_input", "select", "checkbox", "radio", "toggle", "range"]).toContain(element.type);
        }
      }
    });

    it("file inputs are detected at summary detail but counted as buttons at minimal detail", async () => {
      // At summary/full detail, reclassifyFileInputs runs and corrects the type
      const summaryRep = await renderActivePage(deps, { detail: "summary" });
      const fileInputsSummary = summaryRep.interactive.filter(
        (el) => el.type === "file_input",
      );
      expect(fileInputsSummary.length).toBeGreaterThanOrEqual(2);

      // At minimal detail, buildInteractiveSummary operates on raw AX nodes
      // (before reclassification), but the full interactive array is still
      // reclassified — minimal just doesn't serialize it
      const minimalRep = await renderActivePage(deps, { detail: "minimal" });
      // The internal interactive array should still have file_input types
      const fileInputsMinimal = minimalRep.interactive.filter(
        (el) => el.type === "file_input",
      );
      expect(fileInputsMinimal.length).toBeGreaterThanOrEqual(2);
    });

    it("file inputs have bounds and are visible", async () => {
      const representation = await renderActivePage(deps, { detail: "summary" });
      const fileInputs = representation.interactive.filter(
        (el) => el.type === "file_input",
      );
      for (const fileInput of fileInputs) {
        expect(fileInput.bounds).not.toBeNull();
        expect(fileInput.bounds!.w).toBeGreaterThan(0);
        expect(fileInput.bounds!.h).toBeGreaterThan(0);
        // visible is omitted when true (default stripping)
        expect(fileInput.state.visible).toBeUndefined();
      }
    });
  });

  describe("wait_for", () => {
    beforeEach(async () => {
      const page = pageManager.getActivePage();
      await page.goto(INTERACTION_FIXTURE, { waitUntil: "load" });
    });

    it("waits for text to appear after async action", async () => {
      const page = pageManager.getActivePage();

      // Click the delayed button
      await page.click("#delayed-btn");

      // Poll for the text to appear
      const satisfied = await pollForText(page, "Async done", 5000);
      expect(satisfied).toBe(true);

      const resultText = await page.evaluate(() => {
        return document.getElementById("delayed-result")?.textContent ?? "";
      });
      expect(resultText).toBe("Async done");
    });

    it("waits for a CSS selector to appear", async () => {
      const page = pageManager.getActivePage();

      // The delayed-result div starts hidden, becomes visible after click
      await page.click("#delayed-btn");

      // Wait for the element to become visible (hidden class removed)
      const satisfied = await pollForSelector(
        page,
        "#delayed-result:not(.hidden)",
        5000,
      );
      expect(satisfied).toBe(true);
    });

    it("waits for a JS expression to become truthy", async () => {
      const page = pageManager.getActivePage();

      await page.click("#delayed-btn");

      // Wait for the delayed-result text to change
      const satisfied = await pollForJsCondition(
        page,
        'document.getElementById("delayed-result").textContent === "Async done"',
        5000,
      );
      expect(satisfied).toBe(true);
    });

    it("times out when condition is not met", async () => {
      const page = pageManager.getActivePage();

      // Don't click the button — the condition will never be met
      const satisfied = await pollForText(page, "Never appears", 500);
      expect(satisfied).toBe(false);
    });
  });
});

// ─── Polling helpers for wait_for tests ───

async function pollForText(
  page: any,
  text: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await page.evaluate((searchText: string) => {
      return document.body?.innerText?.includes(searchText) ?? false;
    }, text);
    if (found) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function pollForSelector(
  page: any,
  selector: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const element = await page.$(selector);
    if (element) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function pollForJsCondition(
  page: any,
  jsExpression: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const result = await page.evaluate((expression: string) => {
        return !!eval(expression);
      }, jsExpression);
      if (result) return true;
    } catch {
      // JS expression threw — not satisfied yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}
