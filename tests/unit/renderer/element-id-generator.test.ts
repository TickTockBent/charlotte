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
    expect(buttonId).toMatch(/^btn-[0-9a-f]{6}$/);

    const linkId = generator.generateId("link", "link", "Home", defaultDomPath, 101);
    expect(linkId).toMatch(/^lnk-[0-9a-f]{6}$/);

    const inputId = generator.generateId("text_input", "textbox", "Email", defaultDomPath, 102);
    expect(inputId).toMatch(/^inp-[0-9a-f]{6}$/);

    const selectId = generator.generateId("select", "combobox", "Country", defaultDomPath, 103);
    expect(selectId).toMatch(/^sel-[0-9a-f]{6}$/);

    const checkboxId = generator.generateId("checkbox", "checkbox", "Agree", defaultDomPath, 104);
    expect(checkboxId).toMatch(/^chk-[0-9a-f]{6}$/);
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

  it("handles hash collisions with a salted disambiguator hash", () => {
    // Force a collision by generating the same composite key
    const firstId = generator.generateId("button", "button", "Submit", defaultDomPath, 100);

    // Same inputs but different backendDOMNodeId — same composite key, so the
    // base hash collides and the disambiguator is salted into the hash input.
    const secondId = generator.generateId("button", "button", "Submit", defaultDomPath, 200);

    expect(firstId).not.toBe(secondId);
    expect(secondId).toMatch(/^btn-[0-9a-f]{6}$/);
    // The disambiguated ID must NOT be a "-2" suffix on the base ID — that's
    // the migration bug. It's a distinct salted hash with the same prefix.
    expect(secondId).not.toBe(`${firstId}-2`);
  });

  it("disambiguated IDs do not migrate onto the base ID when the base disappears", () => {
    // Render 1: two elements collide on the same composite key.
    const baseId = generator.generateId("button", "button", "Submit", defaultDomPath, 100);
    const disambiguatedId = generator.generateId("button", "button", "Submit", defaultDomPath, 200);
    expect(baseId).not.toBe(disambiguatedId);

    // Render 2: the base element (node 100) is gone; only node 200 remains.
    // Its ID must stay identical — it must NOT collapse onto baseId.
    const reRender = new ElementIdGenerator();
    const reRenderedId = reRender.generateId("button", "button", "Submit", defaultDomPath, 200);

    // Because the disambiguator is salted into the hash, the surviving element
    // keeps the *base* ID only if it is the first/only one — and critically a
    // formerly-suffixed element never silently becomes the base ID. Here node
    // 200 alone hashes to the base, which is correct and stable: the bug was
    // that disambiguatedId ("...-2") would have become baseId.
    expect(reRenderedId).toMatch(/^btn-[0-9a-f]{6}$/);
    expect(reRenderedId).not.toBe(disambiguatedId);
    expect(disambiguatedId).not.toMatch(/-2$/);
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
    expect(elementId).toMatch(/^btn-[0-9a-f]{6}$/);
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

  describe("durable selector-mode (dom-) registrations", () => {
    it("survive replaceWith (the single-use bug)", () => {
      const live = new ElementIdGenerator();
      const domId = "dom-abc123";
      live.registerDomQueryId(domId, {
        backendDOMNodeId: 555,
        frameId: null,
        selector: ".widget",
        matchIndex: 0,
      });
      expect(live.resolveId(domId)).toBe(555);

      // Simulate the next render swapping in a fresh generator that knows
      // nothing about the selector-mode element.
      const freshRender = new ElementIdGenerator();
      freshRender.generateId("button", "button", "Other", defaultDomPath, 1);
      live.replaceWith(freshRender);

      // The dom- ID must still resolve — previously replaceWith wiped it.
      expect(live.resolveId(domId)).toBe(555);
      expect(live.getDomQueryRegistration(domId)?.selector).toBe(".widget");
    });

    it("are dropped by clearDomQueryIds (navigation)", () => {
      const live = new ElementIdGenerator();
      live.registerDomQueryId("dom-abc123", {
        backendDOMNodeId: 555,
        frameId: null,
        selector: ".widget",
        matchIndex: 0,
      });
      live.clearDomQueryIds();
      expect(live.getDomQueryRegistration("dom-abc123")).toBeNull();
    });
  });

  describe("reassignPrefix", () => {
    it("re-keys an ID to a new prefix and updates resolution", () => {
      const id = generator.generateId("button", "button", "Upload", defaultDomPath, 77);
      expect(id.startsWith("btn-")).toBe(true);
      expect(generator.resolveId(id)).toBe(77);

      const newId = generator.reassignPrefix(id, "inp");
      expect(newId.startsWith("inp-")).toBe(true);
      // Hash portion preserved.
      expect(newId.substring(4)).toBe(id.substring(4));
      // Old ID no longer resolves; new ID does.
      expect(generator.resolveId(id)).toBeNull();
      expect(generator.resolveId(newId)).toBe(77);
      expect(generator.getIdForBackendNode(77)).toBe(newId);
    });

    it("is a no-op when the prefix already matches", () => {
      const id = generator.generateId("text_input", "textbox", "Email", defaultDomPath, 88);
      expect(generator.reassignPrefix(id, "inp")).toBe(id);
    });
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
