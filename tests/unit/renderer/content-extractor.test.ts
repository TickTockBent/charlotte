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
});
