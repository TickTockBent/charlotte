import { describe, it, expect } from "vitest";
import { computeDOMPathSignature } from "../../../src/renderer/dom-path.js";
import type { ParsedAXNode } from "../../../src/renderer/accessibility-extractor.js";

function createNode(overrides: Partial<ParsedAXNode> = {}): ParsedAXNode {
  return {
    nodeId: "1",
    role: "button",
    name: "Test",
    description: "",
    value: null,
    properties: {},
    backendDOMNodeId: null,
    children: [],
    parent: null,
    ...overrides,
  };
}

describe("computeDOMPathSignature", () => {
  it("returns empty signature for root node", () => {
    const node = createNode({ role: "button", name: "Submit" });

    const signature = computeDOMPathSignature(node);

    expect(signature.nearestLandmarkRole).toBeNull();
    expect(signature.nearestLandmarkLabel).toBeNull();
    expect(signature.nearestLabelledContainer).toBeNull();
    expect(signature.siblingIndex).toBe(0);
  });

  it("finds nearest landmark ancestor", () => {
    const main = createNode({ role: "main", name: "Content" });
    const div = createNode({ role: "generic", name: "Container" });
    const button = createNode({ role: "button", name: "Submit" });

    main.children = [div];
    div.parent = main;
    div.children = [button];
    button.parent = div;

    const signature = computeDOMPathSignature(button);

    expect(signature.nearestLandmarkRole).toBe("main");
    expect(signature.nearestLandmarkLabel).toBe("Content");
  });

  it("finds nearest labelled container", () => {
    const div = createNode({ role: "generic", name: "Form Section" });
    const button = createNode({ role: "button", name: "Submit" });

    div.children = [button];
    button.parent = div;

    const signature = computeDOMPathSignature(button);

    expect(signature.nearestLabelledContainer).toBe("Form Section");
  });

  it("computes sibling index among same-role peers", () => {
    const parent = createNode({ role: "generic", name: "" });
    const firstButton = createNode({ nodeId: "1", role: "button", name: "First" });
    const secondButton = createNode({ nodeId: "2", role: "button", name: "Second" });
    const link = createNode({ nodeId: "3", role: "link", name: "Some Link" });

    parent.children = [firstButton, link, secondButton];
    firstButton.parent = parent;
    secondButton.parent = parent;
    link.parent = parent;

    const firstSig = computeDOMPathSignature(firstButton);
    const secondSig = computeDOMPathSignature(secondButton);
    const linkSig = computeDOMPathSignature(link);

    expect(firstSig.siblingIndex).toBe(0);
    expect(secondSig.siblingIndex).toBe(1);
    expect(linkSig.siblingIndex).toBe(0); // Only link among siblings
  });

  it("stops at nearest landmark even if labelled containers are above", () => {
    const nav = createNode({ role: "navigation", name: "Main Nav" });
    const main = createNode({ role: "main", name: "Content" });
    const section = createNode({ role: "generic", name: "Section" });
    const button = createNode({ role: "button", name: "Click" });

    // nav > main > section > button
    nav.children = [main];
    main.parent = nav;
    main.children = [section];
    section.parent = main;
    section.children = [button];
    button.parent = section;

    const signature = computeDOMPathSignature(button);

    // Should find 'main' as the nearest landmark (not 'navigation')
    expect(signature.nearestLandmarkRole).toBe("main");
    expect(signature.nearestLandmarkLabel).toBe("Content");
    // nearestLabelledContainer is found before reaching the landmark
    expect(signature.nearestLabelledContainer).toBe("Section");
  });
});
