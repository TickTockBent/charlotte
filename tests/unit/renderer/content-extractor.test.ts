import { describe, it, expect } from "vitest";
import { ContentExtractor } from "../../../src/renderer/content-extractor.js";
import type { ParsedAXNode } from "../../../src/renderer/accessibility-extractor.js";

function node(role: string, name: string, children: ParsedAXNode[] = []): ParsedAXNode {
  const n: ParsedAXNode = {
    nodeId: `${role}-${name}`,
    role,
    name,
    description: "",
    value: null,
    properties: {},
    backendDOMNodeId: null,
    children,
    parent: null,
    frameId: null,
  };
  for (const child of children) child.parent = n;
  return n;
}

describe("ContentExtractor.extractSummary", () => {
  const extractor = new ContentExtractor();

  it("does not count a form landmark as containing itself", () => {
    // A form landmark containing two inputs. The form must NOT report
    // "1 forms" about itself — that count was self-referential.
    const form = node("form", "Login", [node("textbox", "Email"), node("textbox", "Password")]);
    const summary = extractor.extractSummary([form]);

    expect(summary).toContain("2 inputs");
    expect(summary).not.toContain("forms");
  });

  it("a main landmark does not count a nested form landmark (it gets its own summary)", () => {
    const form = node("form", "Signup", [node("textbox", "Name")]);
    const main = node("main", "Content", [node("heading", "Welcome"), form]);
    const summary = extractor.extractSummary([main]);

    // main reports its heading; the nested form is summarized separately and
    // counts its own input, but neither reports a "forms" count.
    expect(summary).toContain("1 headings");
    expect(summary).toContain("1 inputs");
    expect(summary).not.toContain("forms");
  });

  it("uses landmark label as the summary prefix when available", () => {
    const nav = node("navigation", "Primary Nav", [node("link", "Home"), node("link", "About")]);
    const summary = extractor.extractSummary([nav]);
    expect(summary).toContain("Primary Nav");
    expect(summary).toContain("2 links");
  });

  it("falls back to role name when landmark has no label", () => {
    const nav = node("navigation", "", [node("link", "Home")]);
    const summary = extractor.extractSummary([nav]);
    expect(summary).toContain("navigation");
    expect(summary).toContain("1 links");
  });

  it("counts multiple landmark types when present", () => {
    const banner = node("banner", "Site Header", [node("button", "Menu")]);
    const main = node("main", "Main Content", [
      node("heading", "Welcome"),
      node("paragraph", "Body text"),
    ]);
    const contentinfo = node("contentinfo", "Footer", [node("link", "Privacy")]);
    const summary = extractor.extractSummary([banner, main, contentinfo]);

    expect(summary).toContain("1 buttons");
    expect(summary).toContain("1 headings");
    expect(summary).toContain("1 paragraphs");
    expect(summary).toContain("1 links");
  });

  it("reports 'empty' for a landmark with no countable children", () => {
    const nav = node("navigation", "Sidebar", []);
    const summary = extractor.extractSummary([nav]);
    expect(summary).toContain("empty");
  });

  it("falls back to full-page summary when no landmarks present", () => {
    const root = node("group", "", [node("heading", "Title"), node("paragraph", "text")]);
    const summary = extractor.extractSummary([root]);
    // No landmark found, so top-level count is used
    expect(summary).toContain("1 headings");
    expect(summary).toContain("1 paragraphs");
  });

  // Pinned invariant: Chromium AX tree uses role "image" (not "img") for <img>
  it("counts image-role nodes correctly (Chromium uses 'image', not 'img')", () => {
    const main = node("main", "Content", [node("image", "Photo of cat"), node("image", "Logo")]);
    const summary = extractor.extractSummary([main]);
    expect(summary).toContain("2 images");
  });

  it("also counts img-role nodes (both roles are handled defensively)", () => {
    const main = node("main", "Content", [node("img", "Avatar")]);
    const summary = extractor.extractSummary([main]);
    expect(summary).toContain("1 images");
  });

  it("counts all interactive input role types", () => {
    const form = node("form", "Complex Form", [
      node("textbox", "Name"),
      node("searchbox", "Query"),
      node("combobox", "Country"),
      node("listbox", "Items"),
      node("checkbox", "Agree"),
      node("radio", "Option A"),
      node("slider", "Volume"),
      node("spinbutton", "Count"),
      node("switch", "Dark mode"),
    ]);
    const summary = extractor.extractSummary([form]);
    expect(summary).toContain("9 inputs");
  });

  it("counts lists and tables", () => {
    const main = node("main", "Data", [
      node("list", "Items", [node("listitem", "A"), node("listitem", "B")]),
      node("table", "Stats"),
    ]);
    const summary = extractor.extractSummary([main]);
    expect(summary).toContain("1 lists");
    expect(summary).toContain("1 tables");
  });

  it("does not recurse into nested landmarks for counting (each gets its own summary)", () => {
    const innerMain = node("main", "Inner", [node("heading", "Deep heading")]);
    const outer = node("region", "Outer", [node("paragraph", "Outer text"), innerMain]);
    const summary = extractor.extractSummary([outer]);

    // The "outer" region summary should contain the paragraph but not count the heading
    // (it belongs to the nested "main" landmark's summary)
    const outerSummaryPart = summary.split(";")[0];
    expect(outerSummaryPart).toContain("1 paragraphs");
    expect(outerSummaryPart).not.toContain("headings");
  });

  it("handles multiple root nodes each contributing to the summary", () => {
    const nav = node("navigation", "Nav", [node("link", "Home")]);
    const main = node("main", "Content", [node("heading", "Title")]);
    const summary = extractor.extractSummary([nav, main]);
    expect(summary).toContain("1 links");
    expect(summary).toContain("1 headings");
  });
});

describe("ContentExtractor.extractFullContent caps (#188)", () => {
  const extractor = new ContentExtractor();

  it("returns full text and totalChars with no truncation when under the cap", () => {
    const root = node("main", "", [node("paragraph", "Hello world")]);
    const result = extractor.extractFullContent([root], 1000);
    expect(result.text).toBe("Hello world");
    expect(result.truncated).toBe(false);
    expect(result.totalChars).toBe("Hello world".length);
  });

  it("treats an undefined cap as unbounded", () => {
    const big = "x".repeat(5000);
    const root = node("main", "", [node("paragraph", big)]);
    const result = extractor.extractFullContent([root]);
    expect(result.truncated).toBe(false);
    expect(result.text).toBe(big);
  });

  it("truncates with an explicit marker once the cap is exceeded", () => {
    // Many paragraphs, each contributing text, far past a tiny cap.
    const paragraphs = Array.from({ length: 200 }, (_, i) =>
      node("paragraph", `line ${i} content`),
    );
    const root = node("main", "", paragraphs);

    const cap = 100;
    const result = extractor.extractFullContent([root], cap);

    expect(result.truncated).toBe(true);
    expect(result.totalChars).toBeGreaterThan(cap);
    expect(result.text).toContain("[...full_content truncated at 100 characters.");
    // The non-marker prefix never exceeds the cap.
    const markerStart = result.text.indexOf("\n\n[...full_content truncated");
    expect(markerStart).toBeLessThanOrEqual(cap);
  });

  it("emits content-role node name without recursing into children (avoids duplication)", () => {
    // A heading with StaticText children — should only emit the heading name
    const staticChild = node("StaticText", "Welcome");
    const heading = node("heading", "Welcome", [staticChild]);
    staticChild.parent = heading;
    const root = node("main", "", [heading]);

    const result = extractor.extractFullContent([root]);
    // "Welcome" should appear exactly once, not twice
    const occurrences = result.text.split("Welcome").length - 1;
    expect(occurrences).toBe(1);
  });

  it("collects StaticText name when not under a content-role parent", () => {
    const staticText = node("StaticText", "Standalone text");
    const root = node("group", "", [staticText]);

    const result = extractor.extractFullContent([root]);
    expect(result.text).toContain("Standalone text");
  });

  it("collects text-role node name when not under a content-role parent", () => {
    const textNode = node("text", "Text node text");
    const root = node("group", "", [textNode]);

    const result = extractor.extractFullContent([root]);
    expect(result.text).toContain("Text node text");
  });

  it("collects multiple content roles: heading, paragraph, listitem, cell, label, legend, caption, blockquote", () => {
    const contentRoles = [
      "heading",
      "paragraph",
      "listitem",
      "cell",
      "label",
      "legend",
      "caption",
      "blockquote",
    ];
    const children = contentRoles.map((role, i) => node(role, `Text ${i}`));
    const root = node("main", "", children);

    const result = extractor.extractFullContent([root]);
    for (let i = 0; i < contentRoles.length; i++) {
      expect(result.text).toContain(`Text ${i}`);
    }
  });

  it("handles multiple root nodes", () => {
    const firstRoot = node("main", "", [node("paragraph", "First section")]);
    const secondRoot = node("region", "", [node("heading", "Second section")]);

    const result = extractor.extractFullContent([firstRoot, secondRoot]);
    expect(result.text).toContain("First section");
    expect(result.text).toContain("Second section");
  });

  it("returns empty text and zero totalChars for empty root nodes", () => {
    const result = extractor.extractFullContent([]);
    expect(result.text).toBe("");
    expect(result.totalChars).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it("skips nodes with empty names", () => {
    const root = node("main", "", [
      node("paragraph", ""),
      node("paragraph", "Non-empty"),
      node("StaticText", ""),
    ]);

    const result = extractor.extractFullContent([root]);
    // Only non-empty text nodes contribute
    expect(result.text).toBe("Non-empty");
  });

  it("stops traversal once cap is reached (does not continue accumulating)", () => {
    // Use long paragraph names so that even a small number exceeds the cap.
    // Each paragraph name is 20 chars, cap is 30 chars — after 2 paragraphs
    // (each adding name.length+1 = 21 to totalChars) the cap is hit.
    const longName = "a".repeat(20);
    const paragraphs = Array.from({ length: 1000 }, () => node("paragraph", longName));
    const root = node("main", "", paragraphs);

    const cap = 30;
    const result = extractor.extractFullContent([root], cap);

    expect(result.truncated).toBe(true);
    // The result should only have a small number of lines, not 1000
    const lineCount = result.text.split("\n").filter((l) => l === longName).length;
    expect(lineCount).toBeLessThan(1000);
  });

  it("respects MAX_TRAVERSAL_DEPTH and does not stack overflow on deep nesting", () => {
    // Build a deeply nested chain (depth > 5000 would overflow without the guard)
    let current = node("StaticText", "deep text");
    for (let depth = 0; depth < 5100; depth++) {
      const parent = node("group", "", [current]);
      current.parent = parent;
      current = parent;
    }

    // Should not throw
    const result = extractor.extractFullContent([current]);
    // Deep text may or may not appear depending on traversal depth limit,
    // but we verify no crash and a valid result shape.
    expect(typeof result.text).toBe("string");
    expect(typeof result.totalChars).toBe("number");
    expect(typeof result.truncated).toBe("boolean");
  });
});
