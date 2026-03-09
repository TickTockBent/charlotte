import { describe, it, expect } from "vitest";
import { extractStructuralTree } from "../../../src/renderer/structural-tree-extractor.js";
import type { ParsedAXNode } from "../../../src/renderer/accessibility-extractor.js";

function createNode(overrides: Partial<ParsedAXNode> = {}): ParsedAXNode {
  return {
    nodeId: "1",
    role: "generic",
    name: "",
    description: "",
    value: null,
    properties: {},
    backendDOMNodeId: null,
    children: [],
    parent: null,
    ...overrides,
  };
}

describe("extractStructuralTree", () => {
  it("returns empty string for empty tree", () => {
    expect(extractStructuralTree([])).toBe("");
  });

  it("includes page title at the top", () => {
    const root = createNode({
      role: "main",
      children: [],
    });
    const result = extractStructuralTree([root], "My Page");
    expect(result).toMatch(/^My Page\n/);
  });

  it("renders landmarks as bracketed containers", () => {
    const nav = createNode({ role: "navigation", name: "Primary" });
    const main = createNode({ role: "main" });

    const result = extractStructuralTree([nav, main]);

    expect(result).toContain('[navigation "Primary"]');
    expect(result).toContain("[main]");
  });

  it("omits landmark label when name equals role", () => {
    const main = createNode({ role: "main", name: "main" });
    const result = extractStructuralTree([main]);
    expect(result).toContain("[main]");
    expect(result).not.toContain('"main"');
  });

  it("renders headings with level and label", () => {
    const heading = createNode({
      role: "heading",
      name: "Welcome",
      properties: { level: 2 },
    });
    const result = extractStructuralTree([heading]);
    expect(result).toContain('h2 "Welcome"');
  });

  it("renders heading with link child as h→link", () => {
    const link = createNode({ role: "link", name: "About Us" });
    const heading = createNode({
      role: "heading",
      name: "About Us",
      properties: { level: 3 },
      children: [link],
    });
    link.parent = heading;

    const result = extractStructuralTree([heading]);
    expect(result).toContain('h3→link "About Us"');
  });

  it("collapses consecutive same-type interactive elements", () => {
    const main = createNode({
      role: "main",
      children: [
        createNode({ role: "link", name: "A" }),
        createNode({ role: "link", name: "B" }),
        createNode({ role: "link", name: "C" }),
        createNode({ role: "link", name: "D" }),
      ],
    });
    for (const child of main.children) child.parent = main;

    const result = extractStructuralTree([main]);
    expect(result).toContain("link × 4");
  });

  it("does not collapse headings", () => {
    const main = createNode({
      role: "main",
      children: [
        createNode({
          role: "heading",
          name: "First",
          properties: { level: 2 },
        }),
        createNode({
          role: "heading",
          name: "Second",
          properties: { level: 2 },
        }),
      ],
    });
    for (const child of main.children) child.parent = main;

    const result = extractStructuralTree([main]);
    expect(result).toContain('h2 "First"');
    expect(result).toContain('h2 "Second"');
    expect(result).not.toContain("×");
  });

  it("renders content-only list as marker with item count", () => {
    const list = createNode({
      role: "list",
      children: [
        createNode({
          role: "listitem",
          children: [createNode({ role: "StaticText", name: "Item 1" })],
        }),
        createNode({
          role: "listitem",
          children: [createNode({ role: "StaticText", name: "Item 2" })],
        }),
        createNode({
          role: "listitem",
          children: [createNode({ role: "StaticText", name: "Item 3" })],
        }),
      ],
    });

    const result = extractStructuralTree([list]);
    expect(result).toContain("list (3)");
  });

  it("makes list transparent when it contains interactive elements", () => {
    const list = createNode({
      role: "list",
      children: [
        createNode({
          role: "listitem",
          children: [createNode({ role: "link", name: "Home" })],
        }),
        createNode({
          role: "listitem",
          children: [createNode({ role: "link", name: "About" })],
        }),
      ],
    });

    const result = extractStructuralTree([list]);
    // Links should appear directly, collapsed
    expect(result).toContain("link × 2");
    // List marker should NOT appear
    expect(result).not.toContain("list");
  });

  it("renders content-only table as marker with dimensions", () => {
    const table = createNode({
      role: "table",
      children: [
        createNode({
          role: "row",
          children: [
            createNode({ role: "columnheader", name: "Name" }),
            createNode({ role: "columnheader", name: "Value" }),
          ],
        }),
        createNode({
          role: "row",
          children: [
            createNode({ role: "cell", name: "A" }),
            createNode({ role: "cell", name: "B" }),
          ],
        }),
        createNode({
          role: "row",
          children: [
            createNode({ role: "cell", name: "C" }),
            createNode({ role: "cell", name: "D" }),
          ],
        }),
      ],
    });

    const result = extractStructuralTree([table]);
    expect(result).toContain("table 3×2");
  });

  it("renders content markers (paragraph, image, blockquote)", () => {
    const main = createNode({
      role: "main",
      children: [
        createNode({ role: "paragraph" }),
        createNode({ role: "image", name: "A photo" }),
        createNode({ role: "blockquote" }),
      ],
    });
    for (const child of main.children) child.parent = main;

    const result = extractStructuralTree([main]);
    expect(result).toContain("paragraph");
    expect(result).toContain("image");
    expect(result).toContain("blockquote");
  });

  it("collapses consecutive paragraphs", () => {
    const main = createNode({
      role: "main",
      children: [
        createNode({ role: "paragraph" }),
        createNode({ role: "paragraph" }),
        createNode({ role: "paragraph" }),
      ],
    });
    for (const child of main.children) child.parent = main;

    const result = extractStructuralTree([main]);
    expect(result).toContain("paragraph × 3");
  });

  it("skips leaf text nodes", () => {
    const main = createNode({
      role: "main",
      children: [
        createNode({ role: "StaticText", name: "Hello world" }),
      ],
    });

    const result = extractStructuralTree([main]);
    expect(result).not.toContain("Hello world");
    expect(result).not.toContain("StaticText");
  });

  it("makes generic/group nodes transparent", () => {
    const main = createNode({
      role: "main",
      children: [
        createNode({
          role: "generic",
          children: [
            createNode({
              role: "heading",
              name: "Inside Div",
              properties: { level: 2 },
            }),
          ],
        }),
      ],
    });

    const result = extractStructuralTree([main]);
    // Heading should appear as direct child of main
    expect(result).toContain('h2 "Inside Div"');
    expect(result).not.toContain("generic");
  });

  it("uses correct tree-drawing characters", () => {
    const main = createNode({
      role: "main",
      children: [
        createNode({
          role: "heading",
          name: "First",
          properties: { level: 2 },
        }),
        createNode({
          role: "heading",
          name: "Last",
          properties: { level: 2 },
        }),
      ],
    });
    for (const child of main.children) child.parent = main;

    const result = extractStructuralTree([main]);
    // First child uses ├─, last child uses └─
    expect(result).toContain('├─ h2 "First"');
    expect(result).toContain('└─ h2 "Last"');
  });

  it("renders a realistic page structure compactly", () => {
    // Simulate: banner with h1, nav with 4 links, main with content, footer
    const banner = createNode({
      role: "banner",
      children: [
        createNode({
          role: "heading",
          name: "My Site",
          properties: { level: 1 },
        }),
      ],
    });
    const nav = createNode({
      role: "navigation",
      name: "Main",
      children: [
        createNode({ role: "link", name: "Home" }),
        createNode({ role: "link", name: "About" }),
        createNode({ role: "link", name: "Blog" }),
        createNode({ role: "link", name: "Contact" }),
      ],
    });
    const main = createNode({
      role: "main",
      children: [
        createNode({
          role: "heading",
          name: "Welcome",
          properties: { level: 2 },
        }),
        createNode({ role: "paragraph" }),
        createNode({
          role: "heading",
          name: "Features",
          properties: { level: 2 },
        }),
        createNode({
          role: "list",
          children: [
            createNode({ role: "listitem" }),
            createNode({ role: "listitem" }),
            createNode({ role: "listitem" }),
          ],
        }),
        createNode({
          role: "form",
          name: "Newsletter",
          children: [
            createNode({ role: "textbox", name: "Email" }),
            createNode({ role: "button", name: "Subscribe" }),
          ],
        }),
      ],
    });
    const footer = createNode({
      role: "contentinfo",
      children: [
        createNode({ role: "paragraph" }),
        createNode({ role: "link", name: "Privacy" }),
        createNode({ role: "link", name: "Terms" }),
      ],
    });

    const result = extractStructuralTree(
      [banner, nav, main, footer],
      "My Site",
    );

    // Verify key structural features
    expect(result).toContain("[banner]");
    expect(result).toContain('[navigation "Main"]');
    expect(result).toContain("link × 4");
    expect(result).toContain("[main]");
    expect(result).toContain('h2 "Welcome"');
    expect(result).toContain('h2 "Features"');
    expect(result).toContain("list (3)");
    expect(result).toContain('[form "Newsletter"]');
    expect(result).toContain("input");
    expect(result).toContain("button");
    expect(result).toContain("[contentinfo]");
    expect(result).toContain("link × 2");

    // Verify compactness — this whole page in ~300 chars
    expect(result.length).toBeLessThan(500);
  });

  it("normalizes img role to image", () => {
    const node = createNode({ role: "img", name: "Photo" });
    const result = extractStructuralTree([node]);
    expect(result).toContain("image");
    expect(result).not.toContain("img");
  });

  it("maps interactive roles to short display tags", () => {
    const main = createNode({
      role: "main",
      children: [
        createNode({ role: "textbox", name: "Email" }),
        createNode({ role: "searchbox", name: "Query" }),
        createNode({ role: "combobox", name: "Country" }),
        createNode({ role: "checkbox", name: "Agree" }),
        createNode({ role: "switch", name: "Dark mode" }),
      ],
    });
    for (const child of main.children) child.parent = main;

    const result = extractStructuralTree([main]);
    expect(result).toContain("input");
    expect(result).toContain("search");
    expect(result).toContain("select");
    expect(result).toContain("checkbox");
    expect(result).toContain("toggle");
  });

  // ─── labelInteractive option ───

  it("omits interactive labels by default", () => {
    const main = createNode({
      role: "main",
      children: [
        createNode({ role: "button", name: "Submit" }),
        createNode({ role: "link", name: "Home" }),
        createNode({ role: "textbox", name: "Email" }),
      ],
    });
    for (const child of main.children) child.parent = main;

    const result = extractStructuralTree([main]);
    expect(result).not.toContain("Submit");
    expect(result).not.toContain("Home");
    expect(result).not.toContain("Email");
  });

  it("includes interactive labels when labelInteractive is true", () => {
    const main = createNode({
      role: "main",
      children: [
        createNode({ role: "button", name: "Submit" }),
        createNode({ role: "link", name: "Home" }),
        createNode({ role: "textbox", name: "Email" }),
      ],
    });
    for (const child of main.children) child.parent = main;

    const result = extractStructuralTree([main], undefined, { labelInteractive: true });
    expect(result).toContain('button "Submit"');
    expect(result).toContain('link "Home"');
    expect(result).toContain('input "Email"');
  });

  it("labeled interactive elements are not collapsed", () => {
    const main = createNode({
      role: "main",
      children: [
        createNode({ role: "link", name: "Home" }),
        createNode({ role: "link", name: "About" }),
        createNode({ role: "link", name: "Contact" }),
      ],
    });
    for (const child of main.children) child.parent = main;

    const result = extractStructuralTree([main], undefined, { labelInteractive: true });
    expect(result).toContain('link "Home"');
    expect(result).toContain('link "About"');
    expect(result).toContain('link "Contact"');
    expect(result).not.toContain("×");
  });

  it("collapses unlabeled interactive elements even when labelInteractive is true", () => {
    const main = createNode({
      role: "main",
      children: [
        createNode({ role: "button", name: "" }),
        createNode({ role: "button", name: "" }),
        createNode({ role: "button", name: "" }),
      ],
    });
    for (const child of main.children) child.parent = main;

    const result = extractStructuralTree([main], undefined, { labelInteractive: true });
    expect(result).toContain("button × 3");
  });

  it("labeled option propagates into lists with interactive children", () => {
    const list = createNode({
      role: "list",
      children: [
        createNode({
          role: "listitem",
          children: [createNode({ role: "link", name: "Home" })],
        }),
        createNode({
          role: "listitem",
          children: [createNode({ role: "link", name: "About" })],
        }),
      ],
    });

    const result = extractStructuralTree([list], undefined, { labelInteractive: true });
    expect(result).toContain('link "Home"');
    expect(result).toContain('link "About"');
  });
});
