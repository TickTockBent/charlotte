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
