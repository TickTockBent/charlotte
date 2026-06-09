import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { BrowserManager } from "../../src/browser/browser-manager.js";
import { PageManager } from "../../src/browser/page-manager.js";
import { CDPSessionManager } from "../../src/browser/cdp-session.js";
import { RendererPipeline } from "../../src/renderer/renderer-pipeline.js";
import { ElementIdGenerator } from "../../src/renderer/element-id-generator.js";
import { SnapshotStore } from "../../src/state/snapshot-store.js";
import { ArtifactStore } from "../../src/state/artifact-store.js";
import { createDefaultConfig } from "../../src/types/config.js";
import type { ToolDependencies } from "../../src/tools/tool-helpers.js";
import { renderActivePage, resolveElement } from "../../src/tools/tool-helpers.js";
import { typeIntoElement } from "../../src/tools/interaction-helpers.js";
import {
  setupMcpHarness,
  parseToolJson,
  parseToolText,
  type McpHarness,
} from "../helpers/mcp-harness.js";
import type { InteractiveElement } from "../../src/types/page-representation.js";

const INTERACTION_FIXTURE = `file://${path.resolve(import.meta.dirname, "../fixtures/pages/interaction.html")}`;
const FORM_FIXTURE = `file://${path.resolve(import.meta.dirname, "../fixtures/pages/form.html")}`;

describe("Interaction integration", () => {
  let browserManager: BrowserManager;
  let pageManager: PageManager;
  let cdpSessionManager: CDPSessionManager;
  let elementIdGenerator: ElementIdGenerator;
  let rendererPipeline: RendererPipeline;
  let deps: ToolDependencies;
  let artifactDirectory: string;

  // Shared MCP harness so interaction tools are exercised through their real
  // registered handlers over the in-memory transport (#195) rather than via
  // raw-CDP reimplementations. `deps`/`pageManager` below remain for the small
  // set of tests that legitimately probe the renderer or interaction-helpers
  // (e.g. per-character typing timing, file-input reclassification) directly.
  let harness: McpHarness;

  beforeAll(async () => {
    browserManager = new BrowserManager(undefined, { noSandbox: true });
    await browserManager.launch();
    pageManager = new PageManager();
    await pageManager.openTab(browserManager);
    cdpSessionManager = new CDPSessionManager();
    elementIdGenerator = new ElementIdGenerator();
    rendererPipeline = new RendererPipeline(cdpSessionManager, elementIdGenerator);
    const config = createDefaultConfig();
    artifactDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), "charlotte-interact-test-"));
    const artifactStore = new ArtifactStore(artifactDirectory);
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

    harness = await setupMcpHarness({ profile: "full" });
  });

  afterAll(async () => {
    await browserManager.close();
    await harness.teardown();
    await fsp.rm(artifactDirectory, { recursive: true, force: true }).catch(() => {});
  });

  /** Navigate the harness page to a fixture via the real navigate handler. */
  async function harnessGoto(url: string): Promise<void> {
    const result = await harness.callTool("charlotte_navigate", { url });
    expect(result.isError).toBeFalsy();
  }

  /** Read the harness page's #result text via the real evaluate handler. */
  async function harnessResultText(): Promise<string> {
    const parsed = parseToolJson<{ value: string }>(
      await harness.callTool("charlotte_evaluate", {
        expression: "document.getElementById('result')?.textContent ?? ''",
      }),
    );
    return parsed.value;
  }

  /** Evaluate an arbitrary expression on the harness page and return its value. */
  async function harnessEval<T>(expression: string): Promise<T> {
    return parseToolJson<{ value: T }>(await harness.callTool("charlotte_evaluate", { expression }))
      .value;
  }

  /** Find one interactive element on the harness page via charlotte_find. */
  async function harnessFind(criteria: Record<string, unknown>): Promise<InteractiveElement> {
    const matches = parseToolJson<InteractiveElement[]>(
      await harness.callTool("charlotte_find", criteria),
    );
    expect(matches.length).toBeGreaterThan(0);
    return matches[0];
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
        (!labelSubstring || el.label.toLowerCase().includes(labelSubstring.toLowerCase())),
    );
  }

  describe("click", () => {
    beforeEach(async () => {
      await harnessGoto(INTERACTION_FIXTURE);
    });

    it("clicks a button and triggers its onclick handler", async () => {
      const clickButton = await harnessFind({ text: "Click Me" });
      const result = await harness.callTool("charlotte_click", { element_id: clickButton.id });
      expect(result.isError).toBeFalsy();
      expect(await harnessResultText()).toBe("Button clicked");
    });

    it("performs a double click", async () => {
      const dblClickButton = await harnessFind({ text: "Double Click" });
      const result = await harness.callTool("charlotte_click", {
        element_id: dblClickButton.id,
        click_type: "double",
      });
      expect(result.isError).toBeFalsy();
      expect(await harnessResultText()).toBe("Double clicked");
    });

    it("performs a right click", async () => {
      const rightClickButton = await harnessFind({ text: "Right Click" });
      const result = await harness.callTool("charlotte_click", {
        element_id: rightClickButton.id,
        click_type: "right",
      });
      expect(result.isError).toBeFalsy();
      expect(await harnessResultText()).toBe("Right clicked");
    });

    it("re-renders after click and returns a page representation with a delta", async () => {
      const clickButton = await harnessFind({ text: "Click Me" });
      // charlotte_click returns the post-action page representation (with a
      // structural delta vs the pre-click snapshot).
      const result = await harness.callTool("charlotte_click", { element_id: clickButton.id });
      expect(result.isError).toBeFalsy();
      const page = parseToolJson<{
        url: string;
        snapshot_id: number;
        delta?: { changes: unknown[] };
      }>(result);
      expect(page.url).toContain("interaction.html");
      expect(page.snapshot_id).toBeGreaterThan(0);
      expect(page.delta).toBeDefined();
      // The handler's effect is observable on the page (#result text changed).
      expect(await harnessResultText()).toBe("Button clicked");
    });

    it("returns ELEMENT_NOT_FOUND for a stale/unknown element id", async () => {
      const result = await harness.callTool("charlotte_click", { element_id: "btn-zzzzzz" });
      expect(result.isError).toBe(true);
      const parsed = parseToolJson<{ error: { code: string } }>(result);
      expect(parsed.error.code).toBe("ELEMENT_NOT_FOUND");
    });
  });

  describe("type", () => {
    beforeEach(async () => {
      await harnessGoto(INTERACTION_FIXTURE);
    });

    it("types text into an input field", async () => {
      const emptyInput = await harnessFind({ type: "text_input", text: "Empty Input" });
      const result = await harness.callTool("charlotte_type", {
        element_id: emptyInput.id,
        text: "Hello World",
      });
      expect(result.isError).toBeFalsy();
      expect(await harnessEval<string>("document.getElementById('empty-input').value")).toBe(
        "Hello World",
      );
    });

    it("clears existing value before typing when clear_first is true", async () => {
      const textInput = await harnessFind({ type: "text_input", text: "Text Input" });
      const result = await harness.callTool("charlotte_type", {
        element_id: textInput.id,
        text: "Replaced text",
        clear_first: true,
      });
      expect(result.isError).toBeFalsy();
      expect(await harnessEval<string>("document.getElementById('text-input').value")).toBe(
        "Replaced text",
      );
    });

    it("preserves existing text when clear_first is false", async () => {
      // With clear_first:false the handler focuses but does not move the caret,
      // so the typed text is inserted at the caret without wiping the original
      // value (the handler does NOT auto-append to the end). We assert both the
      // typed and original text survive rather than a specific concatenation.
      const textInput = await harnessFind({ type: "text_input", text: "Text Input" });
      const result = await harness.callTool("charlotte_type", {
        element_id: textInput.id,
        text: "more",
        clear_first: false,
      });
      expect(result.isError).toBeFalsy();
      const value = await harnessEval<string>("document.getElementById('text-input').value");
      expect(value).toContain("initial value");
      expect(value).toContain("more");
    });

    it("presses Enter after typing when press_enter is true", async () => {
      const searchInput = await harnessFind({ type: "text_input", text: "Search" });
      const result = await harness.callTool("charlotte_type", {
        element_id: searchInput.id,
        text: "test query",
        press_enter: true,
      });
      expect(result.isError).toBeFalsy();
      // The search input has an oninput handler that updates #result.
      expect(await harnessResultText()).toBe("Typed: test query");
    });

    // The per-character timing/eventing behaviors below live in
    // interaction-helpers (`typeIntoElement`), not the tool handler's
    // request/response contract, so they intentionally drive `deps` directly.
    describe("slow-typing timing (interaction-helpers)", () => {
      beforeEach(async () => {
        await pageManager.getActivePage().goto(INTERACTION_FIXTURE, { waitUntil: "load" });
      });

      it("types slowly with character delay", async () => {
        const representation = await renderActivePage(deps, { detail: "minimal" });
        const emptyInput = findElementByType(representation, "text_input", "Empty Input");
        expect(emptyInput).toBeDefined();

        const { backendNodeId } = await resolveElement(deps, emptyInput!.id);

        const page = pageManager.getActivePage();
        const textToType = "hello";
        const delayMs = 60;

        const startTime = Date.now();
        await typeIntoElement(
          page,
          backendNodeId,
          textToType,
          true,
          false,
          delayMs,
          await cdpSessionManager.getSession(page),
        );
        const elapsed = Date.now() - startTime;

        // Verify text was typed
        const inputValue = await page.evaluate(() => {
          return (document.getElementById("empty-input") as HTMLInputElement)?.value ?? "";
        });
        expect(inputValue).toBe("hello");

        // With 5 chars at 60ms delay, expect at least 4 inter-key delays (~240ms)
        expect(elapsed).toBeGreaterThanOrEqual(200);
      });

      it("slow typing fires per-character input events", async () => {
        const representation = await renderActivePage(deps, { detail: "minimal" });
        const searchInput = findElementByType(representation, "text_input", "Search");
        expect(searchInput).toBeDefined();

        const { backendNodeId } = await resolveElement(deps, searchInput!.id);

        const page = pageManager.getActivePage();

        // Set up a listener that records each input event value
        await page.evaluate(() => {
          (window as any).__inputEvents = [];
          document.getElementById("search-input")!.addEventListener("input", (e) => {
            (window as any).__inputEvents.push((e.target as HTMLInputElement).value);
          });
        });

        await typeIntoElement(
          page,
          backendNodeId,
          "abc",
          true,
          false,
          30,
          await cdpSessionManager.getSession(page),
        );

        const inputEvents = await page.evaluate(() => (window as any).__inputEvents);
        // Should see incremental values: "a", "ab", "abc"
        expect(inputEvents).toEqual(["a", "ab", "abc"]);
      });

      it("types at full speed without character delay", async () => {
        const representation = await renderActivePage(deps, { detail: "minimal" });
        const emptyInput = findElementByType(representation, "text_input", "Empty Input");
        expect(emptyInput).toBeDefined();

        const { backendNodeId } = await resolveElement(deps, emptyInput!.id);

        const page = pageManager.getActivePage();

        const fastText = "fast typing test";
        const startTime = Date.now();
        await typeIntoElement(
          page,
          backendNodeId,
          fastText,
          true,
          false,
          undefined,
          await cdpSessionManager.getSession(page),
        );
        const elapsed = Date.now() - startTime;

        const inputValue = await page.evaluate(() => {
          return (document.getElementById("empty-input") as HTMLInputElement)?.value ?? "";
        });
        expect(inputValue).toBe(fastText);

        // Without a per-key delay, typing must be far faster than the delayed path
        // would be (16 chars × the 60ms delay used above ≈ 900ms). A generous
        // ceiling avoids flaking on a loaded CI runner while still proving the
        // no-delay fast path is taken. (Brittle absolute < 500ms removed — #206.)
        expect(elapsed).toBeLessThan(fastText.length * 60);
      });
    });
  });

  describe("select", () => {
    beforeEach(async () => {
      await harnessGoto(INTERACTION_FIXTURE);
    });

    it("selects an option by value", async () => {
      const colorSelect = await harnessFind({ type: "select", text: "Color" });
      const result = await harness.callTool("charlotte_select", {
        element_id: colorSelect.id,
        value: "green",
      });
      expect(result.isError).toBeFalsy();
      expect(await harnessEval<string>("document.getElementById('color-select').value")).toBe(
        "green",
      );
      // The select's onchange handler updates #result.
      expect(await harnessResultText()).toBe("Selected: green");
    });

    it("selects an option by its visible text content", async () => {
      const colorSelect = await harnessFind({ type: "select", text: "Color" });
      const result = await harness.callTool("charlotte_select", {
        element_id: colorSelect.id,
        value: "Blue",
      });
      expect(result.isError).toBeFalsy();
      expect(await harnessEval<string>("document.getElementById('color-select').value")).toBe(
        "blue",
      );
    });
  });

  describe("toggle", () => {
    beforeEach(async () => {
      await harnessGoto(INTERACTION_FIXTURE);
    });

    it("toggles an unchecked checkbox to checked", async () => {
      expect(await harnessEval<boolean>("document.getElementById('agree-checkbox').checked")).toBe(
        false,
      );

      const checkbox = await harnessFind({ type: "checkbox", text: "agree" });
      const result = await harness.callTool("charlotte_toggle", { element_id: checkbox.id });
      expect(result.isError).toBeFalsy();

      expect(await harnessEval<boolean>("document.getElementById('agree-checkbox').checked")).toBe(
        true,
      );
    });

    it("toggles a checked checkbox to unchecked", async () => {
      expect(
        await harnessEval<boolean>("document.getElementById('checked-checkbox').checked"),
      ).toBe(true);

      const checkbox = await harnessFind({ type: "checkbox", text: "Already checked" });
      const result = await harness.callTool("charlotte_toggle", { element_id: checkbox.id });
      expect(result.isError).toBeFalsy();

      expect(
        await harnessEval<boolean>("document.getElementById('checked-checkbox').checked"),
      ).toBe(false);
    });

    it("rejects charlotte_toggle on a non-toggleable element", async () => {
      const button = await harnessFind({ text: "Click Me" });
      const result = await harness.callTool("charlotte_toggle", { element_id: button.id });
      expect(result.isError).toBe(true);
      expect(parseToolText(result)).toContain("not a checkbox/radio/switch");
    });
  });

  describe("hover", () => {
    beforeEach(async () => {
      await harnessGoto(INTERACTION_FIXTURE);
    });

    it("triggers hover state on an element", async () => {
      const hoverButton = await harnessFind({ text: "Hover Over Me" });
      const result = await harness.callTool("charlotte_hover", { element_id: hoverButton.id });
      expect(result.isError).toBeFalsy();
      // The button's onmouseenter handler updates #result.
      expect(await harnessResultText()).toBe("Hovered");
    });
  });

  describe("key", () => {
    beforeEach(async () => {
      await harnessGoto(INTERACTION_FIXTURE);
    });

    /** The key-input is found by CSS selector since it has no accessible label. */
    async function keyInputId(): Promise<string> {
      const matches = parseToolJson<Array<{ id: string }>>(
        await harness.callTool("charlotte_find", { selector: "#key-input" }),
      );
      expect(matches.length).toBe(1);
      return matches[0].id;
    }

    it("presses a simple key targeted at an element", async () => {
      const result = await harness.callTool("charlotte_key", {
        key: "Escape",
        element_id: await keyInputId(),
      });
      expect(result.isError).toBeFalsy();
      expect(await harnessResultText()).toBe("Key: Escape");
    });

    it("presses a key with a modifier", async () => {
      const result = await harness.callTool("charlotte_key", {
        key: "a",
        modifiers: ["ctrl"],
        element_id: await keyInputId(),
      });
      expect(result.isError).toBeFalsy();
      expect(await harnessResultText()).toBe("Key: a +Ctrl");
    });
  });

  describe("scroll", () => {
    beforeEach(async () => {
      await harnessGoto(INTERACTION_FIXTURE);
    });

    it("scrolls the page down", async () => {
      const before = await harnessEval<number>("window.scrollY");
      const result = await harness.callTool("charlotte_scroll", {
        direction: "down",
        amount: "200",
      });
      expect(result.isError).toBeFalsy();
      const after = await harnessEval<number>("window.scrollY");
      expect(after).toBeGreaterThan(before);
    });

    it("scrolls within a specific container element", async () => {
      const before = await harnessEval<number>(
        "document.getElementById('scroll-container').scrollTop",
      );
      const container = await harnessFind({ selector: "#scroll-container" });
      const result = await harness.callTool("charlotte_scroll", {
        direction: "down",
        amount: "50",
        element_id: container.id,
      });
      expect(result.isError).toBeFalsy();
      const after = await harnessEval<number>(
        "document.getElementById('scroll-container').scrollTop",
      );
      expect(after).toBeGreaterThan(before);
    });
  });

  describe("submit", () => {
    beforeEach(async () => {
      await harnessGoto(INTERACTION_FIXTURE);
    });

    /** Find the form whose submit button is labelled "Submit" via observe. */
    async function submitFormId(): Promise<string> {
      const page = parseToolJson<{
        forms: Array<{ id: string; submit: string | null }>;
        interactive: Array<{ id: string; label: string }>;
      }>(await harness.callTool("charlotte_observe", { detail: "summary" }));
      const form = page.forms.find((f) =>
        page.interactive.some((el) => el.id === f.submit && el.label.includes("Submit")),
      );
      expect(form).toBeDefined();
      return form!.id;
    }

    it("submits a form via its submit button (charlotte_submit)", async () => {
      const formId = await submitFormId();
      const result = await harness.callTool("charlotte_submit", { form_id: formId });
      expect(result.isError).toBeFalsy();
      expect(await harnessResultText()).toBe("Form submitted");
    });

    it("observe exposes the form with fields and a submit button", async () => {
      const page = parseToolJson<{
        forms: Array<{ id: string; submit: string | null; fields: string[] }>;
        interactive: Array<{ id: string; label: string }>;
      }>(await harness.callTool("charlotte_observe", { detail: "summary" }));
      const submitForm = page.forms.find((f) =>
        page.interactive.some((el) => el.id === f.submit && el.label.includes("Submit")),
      );
      expect(submitForm).toBeDefined();
      expect(submitForm!.fields.length).toBeGreaterThanOrEqual(1);
      expect(submitForm!.submit).not.toBeNull();
    });
  });

  describe("click_at", () => {
    beforeEach(async () => {
      await harnessGoto(INTERACTION_FIXTURE);
    });

    /** Center coordinates of an element's bounds, in page pixels. */
    function center(bounds: { x: number; y: number; w: number; h: number }): {
      x: number;
      y: number;
    } {
      return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
    }

    it("clicks at coordinates to trigger a button click handler", async () => {
      const clickButton = await harnessFind({ text: "Click Me" });
      expect(clickButton.bounds).toBeDefined();
      const { x, y } = center(clickButton.bounds!);
      const result = await harness.callTool("charlotte_click_at", { x, y });
      expect(result.isError).toBeFalsy();
      expect(await harnessResultText()).toBe("Button clicked");
    });

    /**
     * Scroll an element into view and return its viewport-relative center.
     * click_at dispatches CDP mouse events at viewport coordinates, so a target
     * below the fold must be scrolled into view first (as a real agent would).
     */
    async function scrollIntoViewCenter(selector: string): Promise<{ x: number; y: number }> {
      return harnessEval<{ x: number; y: number }>(
        `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          el.scrollIntoView({ block: 'center' });
          const r = el.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        })()`,
      );
    }

    it("clicks a non-semantic element via charlotte_find selector + click_at", async () => {
      // The custom widget isn't in the accessibility tree; reach it by selector.
      const widget = await harnessFind({ selector: "#custom-widget" });
      expect(widget.bounds).toBeDefined();
      const { x, y } = await scrollIntoViewCenter("#custom-widget");
      const result = await harness.callTool("charlotte_click_at", { x, y });
      expect(result.isError).toBeFalsy();
      expect(await harnessResultText()).toBe("Widget clicked");
    });

    it("handles mousedown/mouseup pattern like a code-editor gutter", async () => {
      const gutter = await harnessFind({ selector: "#gutter-sim" });
      expect(gutter.bounds).toBeDefined();
      const { x, y } = await scrollIntoViewCenter("#gutter-sim");
      // click_at dispatches mousedown then mouseup; the mouseup bubbles to
      // document, which is where the gutter's listener lives.
      const result = await harness.callTool("charlotte_click_at", { x, y });
      expect(result.isError).toBeFalsy();
      expect(await harnessResultText()).toBe("Gutter activated");
    });

    it("supports double click at coordinates", async () => {
      const dblClickButton = await harnessFind({ text: "Double Click" });
      expect(dblClickButton.bounds).toBeDefined();
      const { x, y } = center(dblClickButton.bounds!);
      const result = await harness.callTool("charlotte_click_at", {
        x,
        y,
        click_type: "double",
      });
      expect(result.isError).toBeFalsy();
      expect(await harnessResultText()).toBe("Double clicked");
    });
  });

  describe("upload", () => {
    const tempFiles: string[] = [];
    let uploadDir: string;

    beforeAll(async () => {
      // Create temp files in a unique per-run dir so parallel runs never collide.
      uploadDir = await fsp.mkdtemp(path.join(os.tmpdir(), "charlotte-upload-test-"));
      const singleFile = path.join(uploadDir, "charlotte-test-upload.txt");
      fs.writeFileSync(singleFile, "test content");
      tempFiles.push(singleFile);

      const multiFile1 = path.join(uploadDir, "charlotte-test-upload-1.txt");
      const multiFile2 = path.join(uploadDir, "charlotte-test-upload-2.txt");
      fs.writeFileSync(multiFile1, "file 1");
      fs.writeFileSync(multiFile2, "file 2");
      tempFiles.push(multiFile1, multiFile2);
    });

    afterAll(async () => {
      await fsp.rm(uploadDir, { recursive: true, force: true }).catch(() => {});
    });

    // The renderer-classification tests below drive `deps` directly (they probe
    // reclassifyFileInputs, not the handler), so keep the deps page on-fixture.
    beforeEach(async () => {
      const page = pageManager.getActivePage();
      await page.goto(INTERACTION_FIXTURE, { waitUntil: "load" });
    });

    it("uploads a single file to a file input via charlotte_upload", async () => {
      await harnessGoto(INTERACTION_FIXTURE);
      const fileInput = await harnessFind({ type: "file_input", text: "Single File" });
      const result = await harness.callTool("charlotte_upload", {
        element_id: fileInput.id,
        paths: [tempFiles[0]],
      });
      expect(result.isError).toBeFalsy();
      // The input's onchange handler reports the uploaded file name in #result.
      expect(await harnessResultText()).toBe("Uploaded: charlotte-test-upload.txt");
    });

    it("uploads multiple files to a multi-file input via charlotte_upload", async () => {
      await harnessGoto(INTERACTION_FIXTURE);
      const fileInput = await harnessFind({ type: "file_input", text: "Multiple Files" });
      const result = await harness.callTool("charlotte_upload", {
        element_id: fileInput.id,
        paths: [tempFiles[1], tempFiles[2]],
      });
      expect(result.isError).toBeFalsy();
      expect(await harnessResultText()).toBe("Uploaded: 2 files");
    });

    it("rejects charlotte_upload when a path does not exist", async () => {
      await harnessGoto(INTERACTION_FIXTURE);
      const fileInput = await harnessFind({ type: "file_input", text: "Single File" });
      const result = await harness.callTool("charlotte_upload", {
        element_id: fileInput.id,
        paths: ["/nonexistent/charlotte-no-such-file.txt"],
      });
      expect(result.isError).toBe(true);
      expect(parseToolText(result)).toContain("File not found");
    });

    it("detects file inputs as type file_input in page representation", async () => {
      const representation = await renderActivePage(deps, { detail: "summary" });
      const fileInputs = representation.interactive.filter((el) => el.type === "file_input");
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
            (attr: string, i: number, arr: string[]) => attr === "type" && arr[i + 1] === "file",
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
          (attr: string, i: number, arr: string[]) => attr === "type" && arr[i + 1] === "file",
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
          expect([
            "button",
            "link",
            "text_input",
            "select",
            "checkbox",
            "radio",
            "toggle",
            "range",
          ]).toContain(element.type);
        }
      }
    });

    it("file inputs are detected at summary detail but counted as buttons at minimal detail", async () => {
      // At summary/full detail, reclassifyFileInputs runs and corrects the type
      const summaryRep = await renderActivePage(deps, { detail: "summary" });
      const fileInputsSummary = summaryRep.interactive.filter((el) => el.type === "file_input");
      expect(fileInputsSummary.length).toBeGreaterThanOrEqual(2);

      // At minimal detail, buildInteractiveSummary operates on raw AX nodes
      // (before reclassification), but the full interactive array is still
      // reclassified — minimal just doesn't serialize it
      const minimalRep = await renderActivePage(deps, { detail: "minimal" });
      // The internal interactive array should still have file_input types
      const fileInputsMinimal = minimalRep.interactive.filter((el) => el.type === "file_input");
      expect(fileInputsMinimal.length).toBeGreaterThanOrEqual(2);
    });

    it("file inputs have bounds and are visible", async () => {
      const representation = await renderActivePage(deps, { detail: "summary" });
      const fileInputs = representation.interactive.filter((el) => el.type === "file_input");
      for (const fileInput of fileInputs) {
        expect(fileInput.bounds).not.toBeNull();
        expect(fileInput.bounds!.w).toBeGreaterThan(0);
        expect(fileInput.bounds!.h).toBeGreaterThan(0);
        // visible is omitted when true (default stripping)
        expect(fileInput.state.visible).toBeUndefined();
      }
    });
  });

  describe("fill_form", () => {
    // Uses the shared MCP harness: tools are exercised through their real
    // registered handlers over the in-memory transport. The harness owns its
    // own browser/deps, so element IDs are discovered via `harness.deps`.
    let harness: McpHarness;

    beforeAll(async () => {
      harness = await setupMcpHarness({ profile: "full" });
    });

    afterAll(async () => {
      await harness.teardown();
    });

    beforeEach(async () => {
      const page = harness.pageManager.getActivePage();
      await page.goto(FORM_FIXTURE, { waitUntil: "load" });
    });

    it("fills multiple text inputs via the tool handler", async () => {
      // Render to discover element IDs
      const representation = await renderActivePage(harness.deps, { detail: "minimal" });
      const firstName = findElementByLabel(representation, "First Name");
      const lastName = findElementByLabel(representation, "Last Name");
      const email = findElementByLabel(representation, "Email");
      expect(firstName).toBeDefined();
      expect(lastName).toBeDefined();
      expect(email).toBeDefined();

      // Call the actual tool
      const result = await harness.callTool("charlotte_fill_form", {
        fields: [
          { element_id: firstName!.id, value: "Jane" },
          { element_id: lastName!.id, value: "Doe" },
          { element_id: email!.id, value: "jane@example.com" },
        ],
      });

      expect(result.isError).toBeFalsy();

      // Verify values were actually set in the DOM
      const page = harness.pageManager.getActivePage();
      const values = await page.evaluate(() => ({
        firstName: (document.getElementById("first-name") as HTMLInputElement).value,
        lastName: (document.getElementById("last-name") as HTMLInputElement).value,
        email: (document.getElementById("email") as HTMLInputElement).value,
      }));
      expect(values.firstName).toBe("Jane");
      expect(values.lastName).toBe("Doe");
      expect(values.email).toBe("jane@example.com");
    });

    it("fills a mix of text inputs, selects, and checkboxes via the tool handler", async () => {
      const representation = await renderActivePage(harness.deps, { detail: "minimal" });
      const firstName = findElementByLabel(representation, "First Name");
      const country = findElementByType(representation, "select", "Country");
      const newsletter = findElementByType(representation, "checkbox", "newsletter");
      expect(firstName).toBeDefined();
      expect(country).toBeDefined();
      expect(newsletter).toBeDefined();

      const result = await harness.callTool("charlotte_fill_form", {
        fields: [
          { element_id: firstName!.id, value: "Alice" },
          { element_id: country!.id, value: "ca" },
          { element_id: newsletter!.id, value: "toggle" },
        ],
      });

      expect(result.isError).toBeFalsy();

      const page = harness.pageManager.getActivePage();
      const values = await page.evaluate(() => ({
        firstName: (document.getElementById("first-name") as HTMLInputElement).value,
        country: (document.getElementById("country") as HTMLSelectElement).value,
        newsletter: (document.getElementById("newsletter") as HTMLInputElement).checked,
      }));
      expect(values.firstName).toBe("Alice");
      expect(values.country).toBe("ca");
      expect(values.newsletter).toBe(true);
    });

    it("#191: fills a text field via a dom- ID obtained from charlotte_find(selector)", async () => {
      // charlotte_find with a CSS selector returns a durable dom- ID that never
      // appears in representation.interactive (that array comes from the AX
      // tree). Before the fix fill_form rejected dom- IDs with ELEMENT_NOT_FOUND
      // before resolveElement ran; the CHANGELOG claims they work — verify it.
      const matches = parseToolJson<Array<{ id: string }>>(
        await harness.callTool("charlotte_find", { selector: "#first-name" }),
      );
      expect(matches.length).toBeGreaterThan(0);
      const domId = matches[0].id;
      expect(domId.startsWith("dom-")).toBe(true);

      const result = await harness.callTool("charlotte_fill_form", {
        fields: [{ element_id: domId, value: "FromDomId" }],
      });

      expect(result.isError).toBeFalsy();

      const page = harness.pageManager.getActivePage();
      const value = await page.evaluate(
        () => (document.getElementById("first-name") as HTMLInputElement).value,
      );
      expect(value).toBe("FromDomId");
    });

    it("#191: rejects a dom- ID pointing at a non-fillable element", async () => {
      const matches = parseToolJson<Array<{ id: string }>>(
        await harness.callTool("charlotte_find", { selector: "#submit-btn" }),
      );
      expect(matches.length).toBeGreaterThan(0);
      const domId = matches[0].id;
      expect(domId.startsWith("dom-")).toBe(true);

      const result = await harness.callTool("charlotte_fill_form", {
        fields: [{ element_id: domId, value: "nope" }],
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("ELEMENT_NOT_INTERACTIVE");
    });

    it("returns error for unsupported element types", async () => {
      const representation = await renderActivePage(harness.deps, { detail: "minimal" });
      const submitButton = findElementByLabel(representation, "Register");
      expect(submitButton).toBeDefined();
      expect(submitButton!.type).toBe("button");

      const result = await harness.callTool("charlotte_fill_form", {
        fields: [{ element_id: submitButton!.id, value: "anything" }],
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("cannot be filled");
      expect(text).toContain("ELEMENT_NOT_INTERACTIVE");
    });

    it("returns error for unknown element IDs", async () => {
      const result = await harness.callTool("charlotte_fill_form", {
        fields: [{ element_id: "inp-0000", value: "test" }],
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("not found");
    });

    it("does not mutate any fields when a later field is invalid (fail-fast)", async () => {
      const representation = await renderActivePage(harness.deps, { detail: "minimal" });
      const firstName = findElementByLabel(representation, "First Name");
      const submitButton = findElementByLabel(representation, "Register");
      expect(firstName).toBeDefined();
      expect(submitButton).toBeDefined();
      expect(submitButton!.type).toBe("button");

      // First field is valid, second is a button (unsupported) — should fail before any mutation
      const result = await harness.callTool("charlotte_fill_form", {
        fields: [
          { element_id: firstName!.id, value: "ShouldNotAppear" },
          { element_id: submitButton!.id, value: "invalid" },
        ],
      });

      expect(result.isError).toBe(true);

      // Verify the first field was NOT modified
      const page = harness.pageManager.getActivePage();
      const firstNameValue = await page.evaluate(
        () => (document.getElementById("first-name") as HTMLInputElement).value,
      );
      expect(firstNameValue).toBe("");
    });
  });

  describe("wait_for", () => {
    beforeEach(async () => {
      await harnessGoto(INTERACTION_FIXTURE);
    });

    /** Click #delayed-btn through the click handler to start the async action. */
    async function startDelayedAction(): Promise<void> {
      const button = await harnessFind({ selector: "#delayed-btn" });
      const result = await harness.callTool("charlotte_click", { element_id: button.id });
      expect(result.isError).toBeFalsy();
    }

    it("waits for text to appear after an async action", async () => {
      await startDelayedAction();
      const result = await harness.callTool("charlotte_wait_for", {
        text: "Async done",
        timeout: 5000,
      });
      expect(result.isError).toBeFalsy();
      expect(
        await harnessEval<string>("document.getElementById('delayed-result').textContent"),
      ).toBe("Async done");
    });

    it("waits for a CSS selector to match", async () => {
      await startDelayedAction();
      // The delayed-result div starts hidden, becomes visible after the click.
      const result = await harness.callTool("charlotte_wait_for", {
        selector: "#delayed-result:not(.hidden)",
        timeout: 5000,
      });
      expect(result.isError).toBeFalsy();
    });

    it("waits for a JS expression to become truthy", async () => {
      await startDelayedAction();
      const result = await harness.callTool("charlotte_wait_for", {
        js: 'document.getElementById("delayed-result").textContent === "Async done"',
        timeout: 5000,
      });
      expect(result.isError).toBeFalsy();
    });

    it("returns a TIMEOUT error when the condition is never met", async () => {
      // Don't start the async action — the text will never appear.
      const result = await harness.callTool("charlotte_wait_for", {
        text: "Never appears",
        timeout: 500,
      });
      expect(result.isError).toBe(true);
      const parsed = parseToolJson<{ error: { code: string } }>(result);
      expect(parsed.error.code).toBe("TIMEOUT");
    });
  });
});
