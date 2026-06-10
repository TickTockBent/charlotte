import { describe, it, expect } from "vitest";
import { formatPageResponse, stripEmptyFields } from "../../../src/tools/tool-helpers.js";
import type {
  PageRepresentation,
  InteractiveElement,
} from "../../../src/types/page-representation.js";

function baseRepresentation(overrides: Partial<PageRepresentation> = {}): PageRepresentation {
  return {
    url: "https://example.test/",
    title: "Example",
    viewport: { width: 1440, height: 900 },
    snapshot_id: 1,
    timestamp: "2026-06-09T00:00:00.000Z",
    structure: { landmarks: [], headings: [] },
    interactive: [],
    forms: [],
    errors: { console: [], network: [] },
    ...overrides,
  };
}

function fakeElement(index: number): InteractiveElement {
  return {
    id: `btn-${index}`,
    type: "button",
    label: `Button number ${index} with some padding text to add bytes`,
    bounds: { x: index, y: index, w: 100, h: 30 },
    state: { enabled: true, visible: true },
  };
}

describe("formatPageResponse (#188, #204)", () => {
  it("merges extra keys at the top level alongside the stripped page payload", () => {
    const rep = baseRepresentation();
    const result = formatPageResponse(rep, { extra: { tab_id: "tab-42" } });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.tab_id).toBe("tab-42");
    expect(payload.url).toBe("https://example.test/");
  });

  it("degrades an oversized response to a compact summary with a suggestion", () => {
    const interactive = Array.from({ length: 5000 }, (_, i) => fakeElement(i));
    const rep = baseRepresentation({ interactive });

    const result = formatPageResponse(rep, { maxResponseBytes: 2000 });
    const payload = JSON.parse(result.content[0].text);

    // Heavy interactive array is dropped in favor of a count.
    expect(payload.interactive).toBeUndefined();
    expect(payload.interactive_count).toBe(5000);
    expect(payload.response_truncated).toBeDefined();
    expect(payload.response_truncated.suggestion).toContain("output_file");
    // The degraded payload itself stays within budget.
    expect(Buffer.byteLength(result.content[0].text, "utf-8")).toBeLessThanOrEqual(2000 + 200);
  });

  it("preserves extra keys even when the response is degraded", () => {
    const interactive = Array.from({ length: 5000 }, (_, i) => fakeElement(i));
    const rep = baseRepresentation({ interactive });

    const result = formatPageResponse(rep, {
      extra: { dialog_handled: { type: "confirm", action: "accepted" } },
      maxResponseBytes: 2000,
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.dialog_handled.action).toBe("accepted");
    expect(payload.response_truncated).toBeDefined();
  });

  it("does not degrade a small response", () => {
    const rep = baseRepresentation({ interactive: [fakeElement(0)] });
    const result = formatPageResponse(rep);
    const payload = JSON.parse(result.content[0].text);

    expect(payload.response_truncated).toBeUndefined();
    expect(payload.interactive).toHaveLength(1);
  });
});

describe("stripEmptyFields truncation handling (#188)", () => {
  it("strips an absent truncation marker", () => {
    const cleaned = stripEmptyFields(baseRepresentation());
    expect(cleaned.truncation).toBeUndefined();
  });

  it("retains a present truncation marker", () => {
    const rep = baseRepresentation({
      truncation: {
        interactive: { total: 5000, returned: 2000 },
        suggestion: "use charlotte_find",
      },
    });
    const cleaned = stripEmptyFields(rep);
    expect(cleaned.truncation).toBeDefined();
  });
});
