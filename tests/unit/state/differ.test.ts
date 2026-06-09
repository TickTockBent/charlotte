import { describe, it, expect } from "vitest";
import { diffRepresentations } from "../../../src/state/differ.js";
import type {
  PageRepresentation,
  InteractiveElement,
} from "../../../src/types/page-representation.js";

function createMockRepresentation(overrides?: Partial<PageRepresentation>): PageRepresentation {
  return {
    url: "https://example.com",
    title: "Test Page",
    viewport: { width: 1440, height: 900 },
    snapshot_id: 0,
    timestamp: new Date().toISOString(),
    structure: {
      landmarks: [],
      headings: [],
      content_summary: "",
    },
    interactive: [],
    forms: [],
    errors: { console: [], network: [] },
    ...overrides,
  };
}

function createInteractiveElement(overrides?: Partial<InteractiveElement>): InteractiveElement {
  return {
    id: "btn-0001",
    type: "button",
    label: "Click me",
    bounds: { x: 0, y: 0, w: 100, h: 40 },
    state: { enabled: true, visible: true },
    ...overrides,
  };
}

describe("diffRepresentations", () => {
  it("returns no changes for identical representations", () => {
    const representation = createMockRepresentation();
    const diff = diffRepresentations(representation, representation, 1, 2);

    expect(diff.changes).toHaveLength(0);
    expect(diff.summary).toBe("No changes detected.");
    expect(diff.from_snapshot).toBe(1);
    expect(diff.to_snapshot).toBe(2);
  });

  describe("landmark diffing", () => {
    it("detects added landmarks", () => {
      const before = createMockRepresentation();
      const after = createMockRepresentation({
        structure: {
          landmarks: [
            {
              id: "rgn-aaa111",
              role: "navigation",
              label: "Main Nav",
              bounds: { x: 0, y: 0, w: 100, h: 50 },
            },
          ],
          headings: [],
          content_summary: "",
        },
      });

      const diff = diffRepresentations(before, after, 1, 2);
      const addedChange = diff.changes.find(
        (change) => change.type === "added" && change.detail?.includes("navigation"),
      );
      expect(addedChange).toBeDefined();
    });

    it("keys by landmark id so duplicate unnamed landmarks do not collide", () => {
      const before = createMockRepresentation({
        structure: {
          landmarks: [
            {
              id: "rgn-nav001",
              role: "navigation",
              label: "",
              bounds: { x: 0, y: 0, w: 10, h: 10 },
            },
            {
              id: "rgn-nav002",
              role: "navigation",
              label: "",
              bounds: { x: 0, y: 20, w: 10, h: 10 },
            },
          ],
          headings: [],
          content_summary: "",
        },
      });
      const after = createMockRepresentation({
        structure: {
          landmarks: [
            {
              id: "rgn-nav001",
              role: "navigation",
              label: "",
              bounds: { x: 0, y: 0, w: 10, h: 10 },
            },
          ],
          headings: [],
          content_summary: "",
        },
      });

      const diff = diffRepresentations(before, after, 1, 2);
      // The second unnamed navigation landmark was removed. With role:label
      // keying both collapsed to one key and the removal produced no diff.
      const removedChange = diff.changes.find(
        (change) => change.type === "removed" && change.element === "rgn-nav002",
      );
      expect(removedChange).toBeDefined();
    });

    it("detects removed landmarks", () => {
      const before = createMockRepresentation({
        structure: {
          landmarks: [
            {
              id: "rgn-main01",
              role: "main",
              label: "Content",
              bounds: { x: 0, y: 0, w: 800, h: 600 },
            },
          ],
          headings: [],
          content_summary: "",
        },
      });
      const after = createMockRepresentation();

      const diff = diffRepresentations(before, after, 1, 2);
      const removedChange = diff.changes.find(
        (change) => change.type === "removed" && change.detail?.includes("main"),
      );
      expect(removedChange).toBeDefined();
    });

    it("detects moved landmarks", () => {
      const before = createMockRepresentation({
        structure: {
          landmarks: [
            {
              id: "rgn-main01",
              role: "main",
              label: "Content",
              bounds: { x: 0, y: 0, w: 800, h: 600 },
            },
          ],
          headings: [],
          content_summary: "",
        },
      });
      const after = createMockRepresentation({
        structure: {
          landmarks: [
            {
              id: "rgn-main01",
              role: "main",
              label: "Content",
              bounds: { x: 0, y: 50, w: 800, h: 600 },
            },
          ],
          headings: [],
          content_summary: "",
        },
      });

      const diff = diffRepresentations(before, after, 1, 2);
      const movedChange = diff.changes.find((change) => change.type === "moved");
      expect(movedChange).toBeDefined();
      expect(movedChange!.from).toEqual({ x: 0, y: 0, w: 800, h: 600 });
      expect(movedChange!.to).toEqual({ x: 0, y: 50, w: 800, h: 600 });
    });
  });

  describe("heading diffing", () => {
    it("detects added headings", () => {
      const before = createMockRepresentation();
      const after = createMockRepresentation({
        structure: {
          landmarks: [],
          headings: [{ level: 1, text: "Hello", id: "h-0001" }],
          content_summary: "",
        },
      });

      const diff = diffRepresentations(before, after, 1, 2);
      const addedChange = diff.changes.find(
        (change) => change.type === "added" && change.element === "h-0001",
      );
      expect(addedChange).toBeDefined();
    });

    it("detects changed heading text", () => {
      const before = createMockRepresentation({
        structure: {
          landmarks: [],
          headings: [{ level: 1, text: "Hello", id: "h-0001" }],
          content_summary: "",
        },
      });
      const after = createMockRepresentation({
        structure: {
          landmarks: [],
          headings: [{ level: 1, text: "World", id: "h-0001" }],
          content_summary: "",
        },
      });

      const diff = diffRepresentations(before, after, 1, 2);
      const changedHeading = diff.changes.find(
        (change) => change.type === "changed" && change.element === "h-0001",
      );
      expect(changedHeading).toBeDefined();
      expect(changedHeading!.property).toBe("text");
      expect(changedHeading!.from).toBe("Hello");
      expect(changedHeading!.to).toBe("World");
    });
  });

  describe("interactive element diffing", () => {
    it("detects added elements", () => {
      const before = createMockRepresentation();
      const after = createMockRepresentation({
        interactive: [createInteractiveElement({ id: "btn-new1" })],
      });

      const diff = diffRepresentations(before, after, 1, 2);
      const addedChange = diff.changes.find(
        (change) => change.type === "added" && change.element === "btn-new1",
      );
      expect(addedChange).toBeDefined();
    });

    it("detects removed elements", () => {
      const before = createMockRepresentation({
        interactive: [createInteractiveElement({ id: "btn-old1" })],
      });
      const after = createMockRepresentation();

      const diff = diffRepresentations(before, after, 1, 2);
      const removedChange = diff.changes.find(
        (change) => change.type === "removed" && change.element === "btn-old1",
      );
      expect(removedChange).toBeDefined();
    });

    it("detects moved elements", () => {
      const before = createMockRepresentation({
        interactive: [
          createInteractiveElement({
            id: "btn-0001",
            bounds: { x: 100, y: 200, w: 80, h: 40 },
          }),
        ],
      });
      const after = createMockRepresentation({
        interactive: [
          createInteractiveElement({
            id: "btn-0001",
            bounds: { x: 100, y: 250, w: 80, h: 40 },
          }),
        ],
      });

      const diff = diffRepresentations(before, after, 1, 2);
      const movedChange = diff.changes.find(
        (change) => change.type === "moved" && change.element === "btn-0001",
      );
      expect(movedChange).toBeDefined();
    });

    it("detects state changes", () => {
      const before = createMockRepresentation({
        interactive: [
          createInteractiveElement({
            id: "btn-0001",
            state: { enabled: true, visible: true },
          }),
        ],
      });
      const after = createMockRepresentation({
        interactive: [
          createInteractiveElement({
            id: "btn-0001",
            state: { enabled: false, visible: true },
          }),
        ],
      });

      const diff = diffRepresentations(before, after, 1, 2);
      const stateChange = diff.changes.find(
        (change) =>
          change.type === "changed" &&
          change.element === "btn-0001" &&
          change.property === "state.enabled",
      );
      expect(stateChange).toBeDefined();
      expect(stateChange!.from).toBe(true);
      expect(stateChange!.to).toBe(false);
    });

    it("detects value changes", () => {
      const before = createMockRepresentation({
        interactive: [
          createInteractiveElement({
            id: "inp-0001",
            type: "text_input",
            value: "old",
          }),
        ],
      });
      const after = createMockRepresentation({
        interactive: [
          createInteractiveElement({
            id: "inp-0001",
            type: "text_input",
            value: "new",
          }),
        ],
      });

      const diff = diffRepresentations(before, after, 1, 2);
      const valueChange = diff.changes.find(
        (change) =>
          change.type === "changed" && change.element === "inp-0001" && change.property === "value",
      );
      expect(valueChange).toBeDefined();
      expect(valueChange!.from).toBe("old");
      expect(valueChange!.to).toBe("new");
    });

    it("detects label changes", () => {
      const before = createMockRepresentation({
        interactive: [createInteractiveElement({ id: "btn-0001", label: "Save" })],
      });
      const after = createMockRepresentation({
        interactive: [createInteractiveElement({ id: "btn-0001", label: "Saving..." })],
      });

      const diff = diffRepresentations(before, after, 1, 2);
      const labelChange = diff.changes.find(
        (change) => change.type === "changed" && change.property === "label",
      );
      expect(labelChange).toBeDefined();
      expect(labelChange!.from).toBe("Save");
      expect(labelChange!.to).toBe("Saving...");
    });
  });

  describe("form diffing", () => {
    it("detects added forms", () => {
      const before = createMockRepresentation();
      const after = createMockRepresentation({
        forms: [{ id: "frm-0001", fields: ["inp-a"], submit: "btn-sub" }],
      });

      const diff = diffRepresentations(before, after, 1, 2);
      const addedForm = diff.changes.find(
        (change) => change.type === "added" && change.element === "frm-0001",
      );
      expect(addedForm).toBeDefined();
    });

    it("detects removed forms", () => {
      const before = createMockRepresentation({
        forms: [{ id: "frm-0001", fields: ["inp-a"], submit: "btn-sub" }],
      });
      const after = createMockRepresentation();

      const diff = diffRepresentations(before, after, 1, 2);
      const removedForm = diff.changes.find(
        (change) => change.type === "removed" && change.element === "frm-0001",
      );
      expect(removedForm).toBeDefined();
    });

    it("detects changed form fields", () => {
      const before = createMockRepresentation({
        forms: [{ id: "frm-0001", fields: ["inp-a"], submit: "btn-sub" }],
      });
      const after = createMockRepresentation({
        forms: [{ id: "frm-0001", fields: ["inp-a", "inp-b"], submit: "btn-sub" }],
      });

      const diff = diffRepresentations(before, after, 1, 2);
      const fieldChange = diff.changes.find(
        (change) =>
          change.type === "changed" &&
          change.element === "frm-0001" &&
          change.property === "fields",
      );
      expect(fieldChange).toBeDefined();
    });
  });

  describe("content diffing", () => {
    it("detects URL changes", () => {
      const before = createMockRepresentation({ url: "https://example.com/a" });
      const after = createMockRepresentation({ url: "https://example.com/b" });

      const diff = diffRepresentations(before, after, 1, 2);
      const urlChange = diff.changes.find((change) => change.property === "url");
      expect(urlChange).toBeDefined();
      expect(urlChange!.from).toBe("https://example.com/a");
      expect(urlChange!.to).toBe("https://example.com/b");
    });

    it("detects title changes", () => {
      const before = createMockRepresentation({ title: "Old Title" });
      const after = createMockRepresentation({ title: "New Title" });

      const diff = diffRepresentations(before, after, 1, 2);
      const titleChange = diff.changes.find((change) => change.property === "title");
      expect(titleChange).toBeDefined();
    });

    it("detects content summary changes", () => {
      const before = createMockRepresentation({
        structure: {
          landmarks: [],
          headings: [],
          content_summary: "main: 3 headings, 5 links",
        },
      });
      const after = createMockRepresentation({
        structure: {
          landmarks: [],
          headings: [],
          content_summary: "main: 3 headings, 6 links",
        },
      });

      const diff = diffRepresentations(before, after, 1, 2);
      const summaryChange = diff.changes.find((change) => change.property === "content_summary");
      expect(summaryChange).toBeDefined();
    });

    it("does not report a content_summary change when one side is undefined", () => {
      // A minimal-detail snapshot has no content_summary; a summary one does.
      // Diffing the two must not report the entire summary as a spurious change.
      const minimalSide = createMockRepresentation({
        structure: { landmarks: [], headings: [], content_summary: undefined },
      });
      const summarySide = createMockRepresentation({
        structure: { landmarks: [], headings: [], content_summary: "main: 5 links" },
      });

      const diff = diffRepresentations(minimalSide, summarySide, 1, 2);
      const summaryChange = diff.changes.find((change) => change.property === "content_summary");
      expect(summaryChange).toBeUndefined();
    });

    it("truncates very long content_summary diff values", () => {
      const longSummary = "x".repeat(1000);
      const before = createMockRepresentation({
        structure: { landmarks: [], headings: [], content_summary: "short" },
      });
      const after = createMockRepresentation({
        structure: { landmarks: [], headings: [], content_summary: longSummary },
      });

      const diff = diffRepresentations(before, after, 1, 2);
      const summaryChange = diff.changes.find((change) => change.property === "content_summary");
      expect(summaryChange).toBeDefined();
      expect((summaryChange!.to as string).length).toBeLessThan(longSummary.length);
      expect(summaryChange!.to).toContain("1000 chars");
    });
  });

  describe("tri-state checkbox diffing", () => {
    it("detects a mixed → checked transition", () => {
      const before = createMockRepresentation({
        interactive: [
          createInteractiveElement({
            id: "chk-0001",
            type: "checkbox",
            state: { checked: "mixed", visible: true },
          }),
        ],
      });
      const after = createMockRepresentation({
        interactive: [
          createInteractiveElement({
            id: "chk-0001",
            type: "checkbox",
            state: { checked: true, visible: true },
          }),
        ],
      });

      const diff = diffRepresentations(before, after, 1, 2);
      const checkedChange = diff.changes.find(
        (change) =>
          change.type === "changed" &&
          change.element === "chk-0001" &&
          change.property === "state.checked",
      );
      expect(checkedChange).toBeDefined();
      expect(checkedChange!.from).toBe("mixed");
      expect(checkedChange!.to).toBe(true);
    });
  });

  describe("scope filtering", () => {
    const before = createMockRepresentation({
      url: "https://example.com/a",
      structure: {
        landmarks: [
          {
            id: "rgn-main01",
            role: "main",
            label: "Content",
            bounds: { x: 0, y: 0, w: 800, h: 600 },
          },
        ],
        headings: [],
        content_summary: "original",
      },
      interactive: [createInteractiveElement({ id: "btn-0001" })],
    });

    const after = createMockRepresentation({
      url: "https://example.com/b",
      structure: {
        landmarks: [],
        headings: [{ level: 1, text: "New", id: "h-0001" }],
        content_summary: "updated",
      },
      interactive: [createInteractiveElement({ id: "btn-0002", label: "New Button" })],
    });

    it("scope 'structure' only includes landmarks and headings", () => {
      const diff = diffRepresentations(before, after, 1, 2, "structure");

      // Should have landmark/heading changes
      const hasStructuralChange = diff.changes.some(
        (change) =>
          change.detail?.includes("Landmark") ||
          change.detail?.includes("Heading") ||
          change.detail?.includes("heading"),
      );
      expect(hasStructuralChange).toBe(true);

      // Should NOT have interactive or content changes
      const hasInteractiveChange = diff.changes.some(
        (change) => change.element === "btn-0001" || change.element === "btn-0002",
      );
      expect(hasInteractiveChange).toBe(false);

      const hasContentChange = diff.changes.some(
        (change) => change.property === "url" || change.property === "content_summary",
      );
      expect(hasContentChange).toBe(false);
    });

    it("scope 'interactive' only includes elements and forms", () => {
      const diff = diffRepresentations(before, after, 1, 2, "interactive");

      const hasInteractiveChange = diff.changes.some(
        (change) => change.element === "btn-0001" || change.element === "btn-0002",
      );
      expect(hasInteractiveChange).toBe(true);

      const hasStructuralChange = diff.changes.some(
        (change) => change.detail?.includes("Landmark") || change.detail?.includes("Heading"),
      );
      expect(hasStructuralChange).toBe(false);
    });

    it("scope 'content' only includes URL, title, and content summary", () => {
      const diff = diffRepresentations(before, after, 1, 2, "content");

      const hasContentChange = diff.changes.some(
        (change) => change.property === "url" || change.property === "content_summary",
      );
      expect(hasContentChange).toBe(true);

      const hasStructuralChange = diff.changes.some((change) =>
        change.detail?.includes("Landmark"),
      );
      expect(hasStructuralChange).toBe(false);
    });

    it("scope 'all' includes everything", () => {
      const diff = diffRepresentations(before, after, 1, 2, "all");

      // Should have all types of changes
      expect(diff.changes.length).toBeGreaterThan(0);

      const changeTypes = new Set(diff.changes.map((change) => change.type));
      // Should have at least added and removed
      expect(changeTypes.has("added")).toBe(true);
      expect(changeTypes.has("removed")).toBe(true);
    });
  });

  describe("summary generation", () => {
    it("generates a summary with change counts", () => {
      const before = createMockRepresentation({
        interactive: [createInteractiveElement({ id: "btn-0001" })],
      });
      const after = createMockRepresentation({
        interactive: [
          createInteractiveElement({ id: "btn-0001", state: { enabled: false, visible: true } }),
          createInteractiveElement({ id: "btn-0002", label: "New" }),
        ],
      });

      const diff = diffRepresentations(before, after, 1, 2);
      expect(diff.summary).toContain("changes:");
      expect(diff.summary).toContain("added");
      expect(diff.summary).toContain("changed");
    });
  });
});
