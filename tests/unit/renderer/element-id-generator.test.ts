import { describe, it, expect, beforeEach } from "vitest";
import { ElementIdGenerator } from "../../../src/renderer/element-id-generator.js";
import type { DOMPathSignature } from "../../../src/types/element-id.js";

describe("ElementIdGenerator", () => {
  let generator: ElementIdGenerator;

  const defaultDomPath: DOMPathSignature = {
    nearestLandmarkRole: "main",
    nearestLandmarkLabel: "Content",
    nearestLabelledContainer: null,
    siblingIndex: 0,
  };

  beforeEach(() => {
    generator = new ElementIdGenerator();
  });

  it("generates IDs with correct type prefix", () => {
    const buttonId = generator.generateId("button", "button", "Submit", defaultDomPath, 100);
    expect(buttonId).toMatch(/^btn-[0-9a-f]{4}$/);

    const linkId = generator.generateId("link", "link", "Home", defaultDomPath, 101);
    expect(linkId).toMatch(/^lnk-[0-9a-f]{4}$/);

    const inputId = generator.generateId("text_input", "textbox", "Email", defaultDomPath, 102);
    expect(inputId).toMatch(/^inp-[0-9a-f]{4}$/);

    const selectId = generator.generateId("select", "combobox", "Country", defaultDomPath, 103);
    expect(selectId).toMatch(/^sel-[0-9a-f]{4}$/);

    const checkboxId = generator.generateId("checkbox", "checkbox", "Agree", defaultDomPath, 104);
    expect(checkboxId).toMatch(/^chk-[0-9a-f]{4}$/);
  });

  it("generates stable IDs for the same inputs", () => {
    const firstId = generator.generateId("button", "button", "Submit", defaultDomPath, 100);

    // Create a new generator (simulating re-render)
    const newGenerator = new ElementIdGenerator();
    const secondId = newGenerator.generateId("button", "button", "Submit", defaultDomPath, 100);

    expect(firstId).toBe(secondId);
  });

  it("generates different IDs for elements with different names", () => {
    const submitId = generator.generateId("button", "button", "Submit", defaultDomPath, 100);
    const cancelId = generator.generateId("button", "button", "Cancel", defaultDomPath, 101);
    expect(submitId).not.toBe(cancelId);
  });

  it("generates different IDs for elements in different landmarks", () => {
    const mainPath: DOMPathSignature = {
      nearestLandmarkRole: "main",
      nearestLandmarkLabel: "Content",
      nearestLabelledContainer: null,
      siblingIndex: 0,
    };

    const navPath: DOMPathSignature = {
      nearestLandmarkRole: "navigation",
      nearestLandmarkLabel: "Sidebar",
      nearestLabelledContainer: null,
      siblingIndex: 0,
    };

    const mainId = generator.generateId("link", "link", "Settings", mainPath, 100);
    const navId = generator.generateId("link", "link", "Settings", navPath, 101);
    expect(mainId).not.toBe(navId);
  });

  it("handles hash collisions with disambiguator", () => {
    // Force a collision by generating the same composite key
    const firstId = generator.generateId("button", "button", "Submit", defaultDomPath, 100);

    // Same inputs but different backendDOMNodeId — same hash, different element
    const secondId = generator.generateId("button", "button", "Submit", defaultDomPath, 200);

    expect(firstId).not.toBe(secondId);
    expect(secondId).toMatch(/^btn-[0-9a-f]{4}-2$/);
  });

  it("resolves element IDs to backend node IDs", () => {
    const elementId = generator.generateId("button", "button", "Submit", defaultDomPath, 42);
    expect(generator.resolveId(elementId)).toBe(42);
  });

  it("returns null for unknown element IDs", () => {
    expect(generator.resolveId("btn-ffff")).toBeNull();
  });

  it("handles null backendDOMNodeId", () => {
    const elementId = generator.generateId("button", "button", "Submit", defaultDomPath, null);
    expect(elementId).toMatch(/^btn-[0-9a-f]{4}$/);
    expect(generator.resolveId(elementId)).toBeNull();
  });

  it("clears all state", () => {
    const elementId = generator.generateId("button", "button", "Submit", defaultDomPath, 42);
    expect(generator.resolveId(elementId)).toBe(42);

    generator.clear();
    expect(generator.resolveId(elementId)).toBeNull();
  });

  it("replaceWith atomically swaps state", () => {
    const original = new ElementIdGenerator();
    original.generateId("button", "button", "Old", defaultDomPath, 1);

    const replacement = new ElementIdGenerator();
    const newId = replacement.generateId("link", "link", "New", defaultDomPath, 2);

    original.replaceWith(replacement);

    expect(original.resolveId(newId)).toBe(2);
  });

  describe("findSimilar", () => {
    it("finds a single element of the same type", () => {
      const elements = [
        {
          id: "btn-1234",
          type: "button" as const,
          label: "Submit",
          bounds: { x: 0, y: 0, w: 100, h: 40 },
          state: { enabled: true, visible: true },
        },
      ];

      const result = generator.findSimilar("btn-abcd", elements);
      expect(result).toBe(elements[0]);
    });

    it("returns null when multiple same-type elements exist", () => {
      const elements = [
        {
          id: "btn-1234",
          type: "button" as const,
          label: "Submit",
          bounds: { x: 0, y: 0, w: 100, h: 40 },
          state: { enabled: true, visible: true },
        },
        {
          id: "btn-5678",
          type: "button" as const,
          label: "Cancel",
          bounds: { x: 110, y: 0, w: 100, h: 40 },
          state: { enabled: true, visible: true },
        },
      ];

      const result = generator.findSimilar("btn-abcd", elements);
      expect(result).toBeNull();
    });

    it("returns null when no same-type elements exist", () => {
      const elements = [
        {
          id: "lnk-1234",
          type: "link" as const,
          label: "Home",
          bounds: { x: 0, y: 0, w: 100, h: 40 },
          state: { enabled: true, visible: true },
        },
      ];

      const result = generator.findSimilar("btn-abcd", elements);
      expect(result).toBeNull();
    });
  });
});
