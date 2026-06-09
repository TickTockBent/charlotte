import { describe, it, expect, beforeEach, vi } from "vitest";
import type { CDPSession } from "puppeteer";
import {
  InteractiveExtractor,
  reclassifyFileInputs,
} from "../../../src/renderer/interactive-extractor.js";
import { ElementIdGenerator } from "../../../src/renderer/element-id-generator.js";
import type { ParsedAXNode } from "../../../src/renderer/accessibility-extractor.js";
import type { Bounds, InteractiveElement } from "../../../src/types/page-representation.js";

function createMockNode(overrides: Partial<ParsedAXNode> = {}): ParsedAXNode {
  return {
    nodeId: "1",
    role: "combobox",
    name: "Country",
    description: "",
    value: null,
    properties: {},
    backendDOMNodeId: 100,
    children: [],
    parent: null,
    frameId: null,
    ...overrides,
  };
}

function createOptionNode(name: string, nodeId: string): ParsedAXNode {
  return createMockNode({
    nodeId,
    role: "option",
    name,
    backendDOMNodeId: null,
  });
}

describe("InteractiveExtractor", () => {
  let extractor: InteractiveExtractor;
  let idGenerator: ElementIdGenerator;
  let boundsMap: Map<number, Bounds>;

  beforeEach(() => {
    extractor = new InteractiveExtractor();
    idGenerator = new ElementIdGenerator();
    boundsMap = new Map();
    boundsMap.set(100, { x: 0, y: 0, w: 200, h: 30 });
  });

  describe("select option cap", () => {
    it("collects all options when under the cap", () => {
      const options = Array.from({ length: 5 }, (_, i) =>
        createOptionNode(`Option ${i + 1}`, `opt-${i}`),
      );
      const selectNode = createMockNode({ children: options });
      for (const opt of options) opt.parent = selectNode;

      const result = extractor.extractInteractiveElements([selectNode], boundsMap, idGenerator);
      const selectElement = result.elements[0];

      expect(selectElement.options).toHaveLength(5);
      expect(selectElement.options![0]).toBe("Option 1");
      expect(selectElement.options![4]).toBe("Option 5");
    });

    it("caps options at 50 and appends truncation indicator", () => {
      const totalOptions = 200;
      const options = Array.from({ length: totalOptions }, (_, i) =>
        createOptionNode(`Option ${i + 1}`, `opt-${i}`),
      );
      const selectNode = createMockNode({ children: options });
      for (const opt of options) opt.parent = selectNode;

      const result = extractor.extractInteractiveElements([selectNode], boundsMap, idGenerator);
      const selectElement = result.elements[0];

      // 50 options + 1 truncation indicator
      expect(selectElement.options).toHaveLength(51);
      expect(selectElement.options![0]).toBe("Option 1");
      expect(selectElement.options![49]).toBe("Option 50");
      expect(selectElement.options![50]).toBe("... and 150 more options");
    });

    it("does not truncate when exactly at the cap", () => {
      const options = Array.from({ length: 50 }, (_, i) =>
        createOptionNode(`Option ${i + 1}`, `opt-${i}`),
      );
      const selectNode = createMockNode({ children: options });
      for (const opt of options) opt.parent = selectNode;

      const result = extractor.extractInteractiveElements([selectNode], boundsMap, idGenerator);
      const selectElement = result.elements[0];

      expect(selectElement.options).toHaveLength(50);
      expect(selectElement.options!.some((o) => o.startsWith("..."))).toBe(false);
    });

    it("counts nested options in listbox groups", () => {
      // Simulate optgroup > option nesting
      const groupChildren = Array.from({ length: 60 }, (_, i) =>
        createOptionNode(`Nested ${i + 1}`, `nested-${i}`),
      );
      const optgroup = createMockNode({
        nodeId: "group-1",
        role: "group",
        name: "Group",
        backendDOMNodeId: null,
        children: groupChildren,
      });
      for (const child of groupChildren) child.parent = optgroup;

      const selectNode = createMockNode({ children: [optgroup] });
      optgroup.parent = selectNode;

      const result = extractor.extractInteractiveElements([selectNode], boundsMap, idGenerator);
      const selectElement = result.elements[0];

      expect(selectElement.options).toHaveLength(51);
      expect(selectElement.options![50]).toBe("... and 10 more options");
    });
  });

  describe("tri-state checkbox", () => {
    it("preserves checked: 'mixed' for indeterminate checkboxes", () => {
      const node = createMockNode({
        role: "checkbox",
        name: "Select all",
        properties: { checked: "mixed" },
      });

      const result = extractor.extractInteractiveElements([node], boundsMap, idGenerator);
      expect(result.elements[0].state.checked).toBe("mixed");
    });

    it("maps checked: true for fully-checked checkboxes", () => {
      const node = createMockNode({
        role: "checkbox",
        name: "Agree",
        properties: { checked: "true" },
      });

      const result = extractor.extractInteractiveElements([node], boundsMap, idGenerator);
      expect(result.elements[0].state.checked).toBe(true);
    });

    it("omits checked for unchecked checkboxes", () => {
      const node = createMockNode({
        role: "checkbox",
        name: "Subscribe",
        properties: { checked: "false" },
      });

      const result = extractor.extractInteractiveElements([node], boundsMap, idGenerator);
      expect(result.elements[0].state.checked).toBeUndefined();
    });
  });

  describe("form-field matching (#196)", () => {
    function makeForm(fieldCount: number): { formNode: ParsedAXNode; bounds: Map<number, Bounds> } {
      const fields: ParsedAXNode[] = [];
      const bounds = new Map<number, Bounds>();
      for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex++) {
        const backendId = 1000 + fieldIndex;
        bounds.set(backendId, { x: 0, y: 0, w: 100, h: 20 });
        fields.push(
          createMockNode({
            nodeId: `field-${fieldIndex}`,
            role: "textbox",
            name: `Field ${fieldIndex}`,
            backendDOMNodeId: backendId,
          }),
        );
      }
      const submit = createMockNode({
        nodeId: "submit",
        role: "button",
        name: "Submit",
        backendDOMNodeId: 9999,
      });
      bounds.set(9999, { x: 0, y: 0, w: 80, h: 30 });
      const formNode = createMockNode({
        nodeId: "form-1",
        role: "form",
        name: "Signup",
        backendDOMNodeId: 500,
        children: [...fields, submit],
      });
      bounds.set(500, { x: 0, y: 0, w: 300, h: 400 });
      for (const child of formNode.children) child.parent = formNode;
      return { formNode, bounds };
    }

    it("associates every field and the submit button with the form", () => {
      const { formNode, bounds } = makeForm(5);
      const result = extractor.extractInteractiveElements([formNode], bounds, idGenerator);

      expect(result.forms).toHaveLength(1);
      const form = result.forms[0];
      // 5 textboxes are fields; the submit button is separated out.
      expect(form.fields).toHaveLength(5);
      expect(form.submit).not.toBeNull();

      // Each reported field id resolves back to a real extracted element.
      const elementIds = new Set(result.elements.map((el) => el.id));
      for (const fieldId of form.fields) {
        expect(elementIds.has(fieldId)).toBe(true);
      }
      expect(elementIds.has(form.submit!)).toBe(true);
    });

    it("does not call resolveId per descendant (uses the O(1) reverse lookup)", () => {
      const { formNode, bounds } = makeForm(30);
      const resolveSpy = vi.spyOn(idGenerator, "resolveId");
      const reverseSpy = vi.spyOn(idGenerator, "getIdForBackendNode");

      extractor.extractInteractiveElements([formNode], bounds, idGenerator);

      // Old code called resolveId once per (descendant × element) candidate.
      // The new path resolves each descendant via getIdForBackendNode instead,
      // so resolveId is not used for field matching at all.
      expect(resolveSpy).not.toHaveBeenCalled();
      // One reverse lookup per interactive descendant (31: 30 fields + submit).
      expect(reverseSpy.mock.calls.length).toBeLessThanOrEqual(31);
    });
  });

  describe("role → type classification (#209)", () => {
    it.each([
      ["button", "button"],
      ["link", "link"],
      ["textbox", "text_input"],
      ["searchbox", "text_input"],
      ["combobox", "select"],
      ["listbox", "select"],
      ["checkbox", "checkbox"],
      ["radio", "radio"],
      ["switch", "toggle"],
      ["slider", "range"],
      ["spinbutton", "range"],
      ["menuitem", "button"],
      ["menuitemcheckbox", "checkbox"],
      ["menuitemradio", "radio"],
      ["tab", "button"],
      ["treeitem", "button"],
    ])("maps role %s to element type %s", (role, expectedType) => {
      const node = createMockNode({ role, name: `${role} element` });
      const result = extractor.extractInteractiveElements([node], boundsMap, idGenerator);
      expect(result.elements).toHaveLength(1);
      expect(result.elements[0].type).toBe(expectedType);
    });

    it("populates href only for links", () => {
      const link = createMockNode({ role: "link", name: "Home", value: "/home" });
      const button = createMockNode({
        nodeId: "2",
        role: "button",
        name: "Go",
        value: "ignored",
        backendDOMNodeId: 101,
      });
      boundsMap.set(101, { x: 0, y: 0, w: 50, h: 20 });

      const result = extractor.extractInteractiveElements([link, button], boundsMap, idGenerator);
      const linkEl = result.elements.find((e) => e.type === "link")!;
      const buttonEl = result.elements.find((e) => e.type === "button")!;
      expect(linkEl.href).toBe("/home");
      expect(buttonEl.href).toBeUndefined();
    });

    it("populates value for text inputs and selects (defaulting to empty string)", () => {
      const textbox = createMockNode({ role: "textbox", name: "Name", value: "Ada" });
      const emptyTextbox = createMockNode({
        nodeId: "2",
        role: "textbox",
        name: "Empty",
        value: null,
        backendDOMNodeId: 101,
      });
      boundsMap.set(101, { x: 0, y: 0, w: 50, h: 20 });

      const result = extractor.extractInteractiveElements(
        [textbox, emptyTextbox],
        boundsMap,
        idGenerator,
      );
      expect(result.elements[0].value).toBe("Ada");
      // value defaults to "" (not undefined) for text-like inputs with null value.
      expect(result.elements[1].value).toBe("");
    });

    it("skips non-interactive roles entirely", () => {
      const heading = createMockNode({ role: "heading", name: "Title" });
      const paragraph = createMockNode({
        nodeId: "2",
        role: "paragraph",
        name: "Body",
        backendDOMNodeId: 101,
      });
      const result = extractor.extractInteractiveElements(
        [heading, paragraph],
        boundsMap,
        idGenerator,
      );
      expect(result.elements).toHaveLength(0);
    });

    it("recurses into children so nested interactive elements are found", () => {
      const nestedButton = createMockNode({
        nodeId: "child",
        role: "button",
        name: "Nested",
        backendDOMNodeId: 101,
      });
      boundsMap.set(101, { x: 0, y: 0, w: 50, h: 20 });
      const container = createMockNode({
        nodeId: "container",
        role: "generic",
        name: "",
        backendDOMNodeId: null,
        children: [nestedButton],
      });
      nestedButton.parent = container;

      const result = extractor.extractInteractiveElements([container], boundsMap, idGenerator);
      expect(result.elements).toHaveLength(1);
      expect(result.elements[0].label).toBe("Nested");
    });
  });

  describe("state extraction (#209)", () => {
    it("sets enabled:false only when disabled is true", () => {
      const disabled = createMockNode({
        role: "button",
        name: "Save",
        properties: { disabled: true },
      });
      const result = extractor.extractInteractiveElements([disabled], boundsMap, idGenerator);
      expect(result.elements[0].state.enabled).toBe(false);
    });

    it("omits enabled for the default (enabled) case", () => {
      const node = createMockNode({ role: "button", name: "Save", properties: {} });
      const result = extractor.extractInteractiveElements([node], boundsMap, idGenerator);
      expect(result.elements[0].state.enabled).toBeUndefined();
    });

    it("records focused only when focused is true", () => {
      const focused = createMockNode({
        role: "textbox",
        name: "Field",
        properties: { focused: true },
      });
      const result = extractor.extractInteractiveElements([focused], boundsMap, idGenerator);
      expect(result.elements[0].state.focused).toBe(true);
    });

    it("captures expanded/selected booleans (both true and false)", () => {
      const expandedTrue = createMockNode({
        role: "combobox",
        name: "Menu",
        properties: { expanded: true, selected: false },
      });
      const result = extractor.extractInteractiveElements([expandedTrue], boundsMap, idGenerator);
      expect(result.elements[0].state.expanded).toBe(true);
      expect(result.elements[0].state.selected).toBe(false);
    });

    it("records required and invalid flags", () => {
      const node = createMockNode({
        role: "textbox",
        name: "Email",
        properties: { required: true, invalid: "true" },
      });
      const result = extractor.extractInteractiveElements([node], boundsMap, idGenerator);
      expect(result.elements[0].state.required).toBe(true);
      expect(result.elements[0].state.invalid).toBe(true);
    });

    it("treats invalid:'false' as not invalid", () => {
      const node = createMockNode({
        role: "textbox",
        name: "Email",
        properties: { invalid: "false" },
      });
      const result = extractor.extractInteractiveElements([node], boundsMap, idGenerator);
      expect(result.elements[0].state.invalid).toBeUndefined();
    });

    it("marks visible:false and nulls bounds when no bounds are available", () => {
      const noBounds = createMockNode({
        role: "button",
        name: "Hidden",
        backendDOMNodeId: 777, // not in boundsMap
      });
      const result = extractor.extractInteractiveElements([noBounds], boundsMap, idGenerator);
      expect(result.elements[0].bounds).toBeNull();
      expect(result.elements[0].state.visible).toBe(false);
    });

    it("marks visible:false and nulls bounds for zero-sized elements", () => {
      const zeroSized = createMockNode({
        role: "button",
        name: "Collapsed",
        backendDOMNodeId: 888,
      });
      boundsMap.set(888, { x: 10, y: 10, w: 0, h: 0 });
      const result = extractor.extractInteractiveElements([zeroSized], boundsMap, idGenerator);
      expect(result.elements[0].bounds).toBeNull();
      expect(result.elements[0].state.visible).toBe(false);
    });

    it("falls back to description when name is empty for the label", () => {
      const node = createMockNode({
        role: "button",
        name: "",
        description: "Submit the form",
      });
      const result = extractor.extractInteractiveElements([node], boundsMap, idGenerator);
      expect(result.elements[0].label).toBe("Submit the form");
    });
  });

  describe("form grouping branches (#209)", () => {
    it("returns an empty forms array when there are no form nodes", () => {
      const button = createMockNode({ role: "button", name: "Standalone" });
      const result = extractor.extractInteractiveElements([button], boundsMap, idGenerator);
      expect(result.forms).toEqual([]);
    });

    it("classifies a button as the submit when its type is submit", () => {
      const submit = createMockNode({
        nodeId: "submit",
        role: "button",
        name: "Go",
        properties: { type: "submit" },
        backendDOMNodeId: 9999,
      });
      const field = createMockNode({
        nodeId: "field",
        role: "textbox",
        name: "Query",
        backendDOMNodeId: 1000,
      });
      const bounds = new Map<number, Bounds>([
        [9999, { x: 0, y: 0, w: 80, h: 30 }],
        [1000, { x: 0, y: 0, w: 100, h: 20 }],
        [500, { x: 0, y: 0, w: 300, h: 100 }],
      ]);
      const formNode = createMockNode({
        nodeId: "form",
        role: "form",
        name: "Search",
        backendDOMNodeId: 500,
        children: [field, submit],
      });
      for (const child of formNode.children) child.parent = formNode;

      const result = extractor.extractInteractiveElements([formNode], bounds, idGenerator);
      expect(result.forms).toHaveLength(1);
      expect(result.forms[0].fields).toHaveLength(1);
      expect(result.forms[0].submit).not.toBeNull();
    });

    it("classifies a button whose name contains 'submit' as the submit button", () => {
      const submit = createMockNode({
        nodeId: "submit",
        role: "button",
        name: "Submit Application",
        backendDOMNodeId: 9999,
      });
      const bounds = new Map<number, Bounds>([
        [9999, { x: 0, y: 0, w: 80, h: 30 }],
        [500, { x: 0, y: 0, w: 300, h: 100 }],
      ]);
      const formNode = createMockNode({
        nodeId: "form",
        role: "form",
        name: "Apply",
        backendDOMNodeId: 500,
        children: [submit],
      });
      submit.parent = formNode;

      const result = extractor.extractInteractiveElements([formNode], bounds, idGenerator);
      expect(result.forms[0].submit).not.toBeNull();
      expect(result.forms[0].fields).toHaveLength(0);
    });

    it("leaves submit null when a form has only non-submit fields", () => {
      const field = createMockNode({
        nodeId: "field",
        role: "textbox",
        name: "Notes",
        backendDOMNodeId: 1000,
      });
      const bounds = new Map<number, Bounds>([
        [1000, { x: 0, y: 0, w: 100, h: 20 }],
        [500, { x: 0, y: 0, w: 300, h: 100 }],
      ]);
      const formNode = createMockNode({
        nodeId: "form",
        role: "form",
        name: "Notes form",
        backendDOMNodeId: 500,
        children: [field],
      });
      field.parent = formNode;

      const result = extractor.extractInteractiveElements([formNode], bounds, idGenerator);
      expect(result.forms[0].submit).toBeNull();
      expect(result.forms[0].fields).toHaveLength(1);
    });
  });

  describe("reclassifyFileInputs (#194)", () => {
    function makeButton(id: string, backendNodeId: number): InteractiveElement {
      // Register the backend node id with the generator so resolveId works.
      idGenerator.generateId(
        "button",
        "button",
        id,
        {
          nearestLandmarkRole: null,
          nearestLandmarkLabel: null,
          nearestLabelledContainer: null,
          siblingIndex: 0,
        },
        backendNodeId,
      );
      const generatedId = idGenerator.getIdForBackendNode(backendNodeId)!;
      return {
        id: generatedId,
        type: "button",
        label: id,
        bounds: { x: 0, y: 0, w: 50, h: 20 },
        state: {},
      };
    }

    it("probes each button once and does not block serially", async () => {
      const buttons = Array.from({ length: 20 }, (_, i) => makeButton(`btn${i}`, 200 + i));
      // The 7th button is actually <input type=file>.
      const fileButtonBackendId = 206;

      let inFlight = 0;
      let maxInFlight = 0;
      const send = vi.fn(async (_method: string, params: { backendNodeId: number }) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight--;
        if (params.backendNodeId === fileButtonBackendId) {
          return { node: { nodeName: "INPUT", attributes: ["type", "file"] } };
        }
        return { node: { nodeName: "BUTTON", attributes: [] } };
      });
      const session = { send } as unknown as CDPSession;

      await reclassifyFileInputs(buttons, session, idGenerator);

      // describeNode called at most once per button (no extra probes), and
      // never more than the number of buttons.
      expect(send).toHaveBeenCalledTimes(buttons.length);
      for (const call of send.mock.calls) {
        expect(call[0]).toBe("DOM.describeNode");
      }
      // Concurrency proves the calls are dispatched together rather than awaited
      // strictly one-after-another.
      expect(maxInFlight).toBeGreaterThan(1);
    });

    it("reclassifies a file input and re-keys its id prefix to inp-", async () => {
      const button = makeButton("upload", 300);
      const originalId = button.id;
      expect(originalId.startsWith("btn-")).toBe(true);

      const session = {
        send: vi.fn(async () => ({
          node: { nodeName: "INPUT", attributes: ["type", "file"] },
        })),
      } as unknown as CDPSession;

      await reclassifyFileInputs([button], session, idGenerator);

      expect(button.type).toBe("file_input");
      expect(button.id.startsWith("inp-")).toBe(true);
      // Hash portion preserved.
      expect(button.id.slice(4)).toBe(originalId.slice(4));
    });

    it("issues no CDP calls when there are no button-typed elements", async () => {
      const link: InteractiveElement = {
        id: "lnk-abc123",
        type: "link",
        label: "Home",
        bounds: null,
        state: {},
      };
      const send = vi.fn();
      const session = { send } as unknown as CDPSession;

      await reclassifyFileInputs([link], session, idGenerator);
      expect(send).not.toHaveBeenCalled();
    });
  });
});
