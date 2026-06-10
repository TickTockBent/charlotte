import { describe, it, expect, vi } from "vitest";
import type { CDPSession } from "puppeteer";
import {
  AccessibilityExtractor,
  isLandmarkRole,
  isHeadingRole,
  isInteractiveRole,
} from "../../../src/renderer/accessibility-extractor.js";

// ---------------------------------------------------------------------------
// Helpers to build raw AX node shapes that mimic Chromium CDP responses
// ---------------------------------------------------------------------------

interface RawAXNode {
  nodeId: string;
  ignored?: boolean;
  role?: { type: string; value: string };
  name?: { type: string; value: string };
  description?: { type: string; value: string };
  value?: { type: string; value: unknown };
  properties?: Array<{ name: string; value: { type: string; value: unknown } }>;
  childIds?: string[];
  parentId?: string;
  backendDOMNodeId?: number;
}

function rawNode(overrides: Partial<RawAXNode> & { nodeId: string }): RawAXNode {
  return {
    role: { type: "role", value: "none" },
    ...overrides,
  };
}

function mockSession(nodes: RawAXNode[]): CDPSession {
  return {
    send: vi.fn().mockResolvedValue({ nodes }),
  } as unknown as CDPSession;
}

describe("isLandmarkRole / isHeadingRole / isInteractiveRole", () => {
  describe("isLandmarkRole", () => {
    it.each([
      "banner",
      "navigation",
      "main",
      "complementary",
      "contentinfo",
      "form",
      "region",
      "search",
    ])("returns true for landmark role %s", (role) => {
      expect(isLandmarkRole(role)).toBe(true);
    });

    it("returns false for non-landmark roles", () => {
      expect(isLandmarkRole("heading")).toBe(false);
      expect(isLandmarkRole("button")).toBe(false);
      expect(isLandmarkRole("link")).toBe(false);
      expect(isLandmarkRole("image")).toBe(false);
      expect(isLandmarkRole("none")).toBe(false);
    });
  });

  describe("isHeadingRole", () => {
    it("returns true for heading", () => {
      expect(isHeadingRole("heading")).toBe(true);
    });

    it("returns false for non-heading roles", () => {
      expect(isHeadingRole("main")).toBe(false);
      expect(isHeadingRole("button")).toBe(false);
    });
  });

  describe("isInteractiveRole", () => {
    it.each([
      "button",
      "link",
      "textbox",
      "combobox",
      "listbox",
      "checkbox",
      "radio",
      "switch",
      "slider",
      "spinbutton",
      "searchbox",
      "menuitem",
      "menuitemcheckbox",
      "menuitemradio",
      "tab",
      "treeitem",
    ])("returns true for interactive role %s", (role) => {
      expect(isInteractiveRole(role)).toBe(true);
    });

    it("returns false for non-interactive roles", () => {
      expect(isInteractiveRole("main")).toBe(false);
      expect(isInteractiveRole("heading")).toBe(false);
      expect(isInteractiveRole("paragraph")).toBe(false);
      expect(isInteractiveRole("image")).toBe(false);
    });
  });
});

describe("AccessibilityExtractor.extract", () => {
  const extractor = new AccessibilityExtractor();

  it("returns an empty array for an empty node list", async () => {
    const session = mockSession([]);
    const roots = await extractor.extract(session);
    expect(roots).toEqual([]);
  });

  it("parses a single root node with role and name", async () => {
    const nodes: RawAXNode[] = [
      rawNode({
        nodeId: "1",
        role: { type: "role", value: "WebArea" },
        name: { type: "computedString", value: "My Page" },
        backendDOMNodeId: 10,
      }),
    ];
    const session = mockSession(nodes);
    const roots = await extractor.extract(session);

    expect(roots).toHaveLength(1);
    expect(roots[0].nodeId).toBe("1");
    expect(roots[0].role).toBe("WebArea");
    expect(roots[0].name).toBe("My Page");
    expect(roots[0].backendDOMNodeId).toBe(10);
    expect(roots[0].children).toHaveLength(0);
    expect(roots[0].parent).toBeNull();
  });

  it("links parent-child relationships from childIds", async () => {
    const nodes: RawAXNode[] = [
      rawNode({
        nodeId: "root",
        role: { type: "role", value: "WebArea" },
        name: { type: "computedString", value: "Page" },
        childIds: ["child1", "child2"],
        backendDOMNodeId: 1,
      }),
      rawNode({
        nodeId: "child1",
        role: { type: "role", value: "heading" },
        name: { type: "computedString", value: "Title" },
        parentId: "root",
        backendDOMNodeId: 2,
      }),
      rawNode({
        nodeId: "child2",
        role: { type: "role", value: "paragraph" },
        name: { type: "computedString", value: "Body" },
        parentId: "root",
        backendDOMNodeId: 3,
      }),
    ];
    const session = mockSession(nodes);
    const roots = await extractor.extract(session);

    expect(roots).toHaveLength(1);
    const root = roots[0];
    expect(root.children).toHaveLength(2);
    expect(root.children[0].role).toBe("heading");
    expect(root.children[1].role).toBe("paragraph");
    expect(root.children[0].parent).toBe(root);
    expect(root.children[1].parent).toBe(root);
  });

  it("skips ignored nodes and does not include them in the tree", async () => {
    const nodes: RawAXNode[] = [
      rawNode({
        nodeId: "root",
        role: { type: "role", value: "WebArea" },
        name: { type: "computedString", value: "Page" },
        childIds: ["ignored", "visible"],
        backendDOMNodeId: 1,
      }),
      rawNode({
        nodeId: "ignored",
        ignored: true,
        parentId: "root",
        backendDOMNodeId: 2,
      }),
      rawNode({
        nodeId: "visible",
        role: { type: "role", value: "button" },
        name: { type: "computedString", value: "Submit" },
        parentId: "root",
        backendDOMNodeId: 3,
      }),
    ];
    const session = mockSession(nodes);
    const roots = await extractor.extract(session);

    const root = roots[0];
    expect(root.children).toHaveLength(1);
    expect(root.children[0].role).toBe("button");
  });

  it("reparents children of ignored nodes to the nearest non-ignored ancestor", async () => {
    // Tree: root → ignored1 → ignored2 → visible-leaf
    // Expected: visible-leaf should appear under root (after reparenting up 2 levels)
    const nodes: RawAXNode[] = [
      rawNode({
        nodeId: "root",
        role: { type: "role", value: "WebArea" },
        name: { type: "computedString", value: "Page" },
        childIds: ["ignored1"],
        backendDOMNodeId: 1,
      }),
      rawNode({
        nodeId: "ignored1",
        ignored: true,
        parentId: "root",
        childIds: ["ignored2"],
        backendDOMNodeId: 2,
      }),
      rawNode({
        nodeId: "ignored2",
        ignored: true,
        parentId: "ignored1",
        childIds: ["leaf"],
        backendDOMNodeId: 3,
      }),
      rawNode({
        nodeId: "leaf",
        role: { type: "role", value: "link" },
        name: { type: "computedString", value: "Click me" },
        parentId: "ignored2",
        backendDOMNodeId: 4,
      }),
    ];
    const session = mockSession(nodes);
    const roots = await extractor.extract(session);

    // The leaf should be reparented under root (skipping both ignored nodes)
    expect(roots).toHaveLength(1);
    const root = roots[0];
    expect(root.children).toHaveLength(1);
    expect(root.children[0].role).toBe("link");
    expect(root.children[0].name).toBe("Click me");
  });

  it("reparents across a single ignored ancestor (O(n) traversal path)", async () => {
    const nodes: RawAXNode[] = [
      rawNode({
        nodeId: "root",
        role: { type: "role", value: "main" },
        childIds: ["ignored", "direct"],
        backendDOMNodeId: 10,
      }),
      rawNode({
        nodeId: "ignored",
        ignored: true,
        parentId: "root",
        childIds: ["reparented"],
        backendDOMNodeId: 11,
      }),
      rawNode({
        nodeId: "reparented",
        role: { type: "role", value: "heading" },
        name: { type: "computedString", value: "Reparented Heading" },
        parentId: "ignored",
        backendDOMNodeId: 12,
      }),
      rawNode({
        nodeId: "direct",
        role: { type: "role", value: "paragraph" },
        name: { type: "computedString", value: "Direct Child" },
        parentId: "root",
        backendDOMNodeId: 13,
      }),
    ];
    const session = mockSession(nodes);
    const roots = await extractor.extract(session);

    const root = roots[0];
    const childRoles = root.children.map((c) => c.role);
    expect(childRoles).toContain("heading");
    expect(childRoles).toContain("paragraph");
    expect(root.children).toHaveLength(2);
  });

  // Pinned invariant: Chromium AX tree uses role "image" (not "img") for <img>.
  // This is documented in CLAUDE.md. The extractor must pass this role through
  // without mangling it.
  describe("'image' role invariant (CLAUDE.md documented)", () => {
    it("passes role 'image' through unchanged (Chromium AX tree uses 'image' for <img>)", async () => {
      const nodes: RawAXNode[] = [
        rawNode({
          nodeId: "img",
          role: { type: "role", value: "image" },
          name: { type: "computedString", value: "A photo of a cat" },
          backendDOMNodeId: 42,
        }),
      ];
      const session = mockSession(nodes);
      const roots = await extractor.extract(session);

      expect(roots[0].role).toBe("image");
      expect(roots[0].role).not.toBe("img");
    });

    it("does NOT normalize 'image' to 'img' or vice versa", async () => {
      const nodes: RawAXNode[] = [
        rawNode({
          nodeId: "img",
          role: { type: "role", value: "image" },
          name: { type: "computedString", value: "Logo" },
          backendDOMNodeId: 5,
        }),
      ];
      const session = mockSession(nodes);
      const roots = await extractor.extract(session);
      // The extractor must be a transparent pass-through for role values
      expect(roots[0].role).toBe("image");
    });
  });

  // Pinned invariant: backendDOMNodeId can be null on some AX nodes.
  describe("nullable backendDOMNodeId invariant (CLAUDE.md documented)", () => {
    it("sets backendDOMNodeId to null when absent from the raw node", async () => {
      const nodes: RawAXNode[] = [
        rawNode({
          nodeId: "1",
          role: { type: "role", value: "button" },
          name: { type: "computedString", value: "Click" },
          // No backendDOMNodeId
        }),
      ];
      const session = mockSession(nodes);
      const roots = await extractor.extract(session);

      expect(roots[0].backendDOMNodeId).toBeNull();
    });

    it("preserves non-null backendDOMNodeId when present", async () => {
      const nodes: RawAXNode[] = [
        rawNode({
          nodeId: "1",
          role: { type: "role", value: "link" },
          name: { type: "computedString", value: "Home" },
          backendDOMNodeId: 77,
        }),
      ];
      const session = mockSession(nodes);
      const roots = await extractor.extract(session);

      expect(roots[0].backendDOMNodeId).toBe(77);
    });

    it("correctly handles a mix of nodes with and without backendDOMNodeId", async () => {
      const nodes: RawAXNode[] = [
        rawNode({
          nodeId: "root",
          role: { type: "role", value: "main" },
          childIds: ["with-id", "without-id"],
          backendDOMNodeId: 100,
        }),
        rawNode({
          nodeId: "with-id",
          role: { type: "role", value: "button" },
          name: { type: "computedString", value: "Submit" },
          parentId: "root",
          backendDOMNodeId: 101,
        }),
        rawNode({
          nodeId: "without-id",
          role: { type: "role", value: "button" },
          name: { type: "computedString", value: "Cancel" },
          parentId: "root",
          // No backendDOMNodeId — this happens for virtual AX nodes
        }),
      ];
      const session = mockSession(nodes);
      const roots = await extractor.extract(session);

      const root = roots[0];
      const submitBtn = root.children.find((c) => c.name === "Submit");
      const cancelBtn = root.children.find((c) => c.name === "Cancel");

      expect(submitBtn?.backendDOMNodeId).toBe(101);
      expect(cancelBtn?.backendDOMNodeId).toBeNull();
    });
  });

  it("sets frameId on all parsed nodes when a frameId is provided", async () => {
    const nodes: RawAXNode[] = [
      rawNode({
        nodeId: "1",
        role: { type: "role", value: "button" },
        name: { type: "computedString", value: "Click" },
        backendDOMNodeId: 1,
      }),
    ];
    const session = mockSession(nodes);
    const roots = await extractor.extract(session, "frame-abc-123");

    expect(roots[0].frameId).toBe("frame-abc-123");
  });

  it("sets frameId to null when no frameId is provided (main frame)", async () => {
    const nodes: RawAXNode[] = [
      rawNode({
        nodeId: "1",
        role: { type: "role", value: "button" },
        name: { type: "computedString", value: "Click" },
        backendDOMNodeId: 1,
      }),
    ];
    const session = mockSession(nodes);
    const roots = await extractor.extract(session);

    expect(roots[0].frameId).toBeNull();
  });

  it("extracts description and value when present", async () => {
    const nodes: RawAXNode[] = [
      rawNode({
        nodeId: "1",
        role: { type: "role", value: "textbox" },
        name: { type: "computedString", value: "Email" },
        description: { type: "computedString", value: "Enter your email" },
        value: { type: "string", value: "user@example.com" },
        backendDOMNodeId: 1,
      }),
    ];
    const session = mockSession(nodes);
    const roots = await extractor.extract(session);

    expect(roots[0].description).toBe("Enter your email");
    expect(roots[0].value).toBe("user@example.com");
  });

  it("sets value to null when the raw value is null", async () => {
    const nodes: RawAXNode[] = [
      rawNode({
        nodeId: "1",
        role: { type: "role", value: "textbox" },
        name: { type: "computedString", value: "Search" },
        value: { type: "string", value: null },
        backendDOMNodeId: 1,
      }),
    ];
    const session = mockSession(nodes);
    const roots = await extractor.extract(session);

    expect(roots[0].value).toBeNull();
  });

  it("extracts properties from the raw properties array", async () => {
    const nodes: RawAXNode[] = [
      rawNode({
        nodeId: "1",
        role: { type: "role", value: "checkbox" },
        name: { type: "computedString", value: "Agree" },
        properties: [
          { name: "checked", value: { type: "boolean", value: true } },
          { name: "disabled", value: { type: "boolean", value: false } },
        ],
        backendDOMNodeId: 1,
      }),
    ];
    const session = mockSession(nodes);
    const roots = await extractor.extract(session);

    expect(roots[0].properties["checked"]).toBe(true);
    expect(roots[0].properties["disabled"]).toBe(false);
  });

  it("uses 'none' as role when raw node has no role", async () => {
    const nodes: RawAXNode[] = [
      rawNode({
        nodeId: "1",
        // No role property
        backendDOMNodeId: 1,
      }),
    ];
    const session = mockSession(nodes);
    const roots = await extractor.extract(session);

    expect(roots[0].role).toBe("none");
  });

  it("passes the frameId to Accessibility.getFullAXTree when provided", async () => {
    const session = mockSession([
      rawNode({
        nodeId: "1",
        role: { type: "role", value: "button" },
        name: { type: "computedString", value: "A" },
        backendDOMNodeId: 1,
      }),
    ]);
    await extractor.extract(session, "frame-xyz");

    expect(session.send).toHaveBeenCalledWith("Accessibility.getFullAXTree", {
      frameId: "frame-xyz",
    });
  });

  it("calls Accessibility.getFullAXTree without frameId for the main frame", async () => {
    const session = mockSession([
      rawNode({
        nodeId: "1",
        role: { type: "role", value: "button" },
        name: { type: "computedString", value: "A" },
        backendDOMNodeId: 1,
      }),
    ]);
    await extractor.extract(session);

    expect(session.send).toHaveBeenCalledWith("Accessibility.getFullAXTree", {});
  });

  it("produces multiple root nodes when nodes have no parent mapping", async () => {
    const nodes: RawAXNode[] = [
      rawNode({
        nodeId: "r1",
        role: { type: "role", value: "main" },
        name: { type: "computedString", value: "Root 1" },
        backendDOMNodeId: 1,
      }),
      rawNode({
        nodeId: "r2",
        role: { type: "role", value: "navigation" },
        name: { type: "computedString", value: "Root 2" },
        backendDOMNodeId: 2,
      }),
    ];
    const session = mockSession(nodes);
    const roots = await extractor.extract(session);

    expect(roots).toHaveLength(2);
    const roles = roots.map((r) => r.role);
    expect(roles).toContain("main");
    expect(roles).toContain("navigation");
  });
});
