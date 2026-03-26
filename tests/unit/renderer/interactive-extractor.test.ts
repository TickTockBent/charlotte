import { describe, it, expect, beforeEach } from "vitest";
import { InteractiveExtractor } from "../../../src/renderer/interactive-extractor.js";
import { ElementIdGenerator } from "../../../src/renderer/element-id-generator.js";
import type { ParsedAXNode } from "../../../src/renderer/accessibility-extractor.js";
import type { Bounds } from "../../../src/types/page-representation.js";

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
});
