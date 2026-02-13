import { describe, it, expect, vi } from "vitest";
import { pollUntilCondition } from "../../../src/utils/wait.js";

// Create a mock page object for testing
function createMockPage(behavior: {
  selectorExists?: boolean;
  textExists?: boolean;
  jsResult?: boolean;
}) {
  return {
    $: vi.fn().mockResolvedValue(behavior.selectorExists ? {} : null),
    evaluate: vi.fn().mockImplementation((fn: Function, ...args: any[]) => {
      // The function is called with arguments — detect which condition type
      if (args.length > 0 && typeof args[0] === "string") {
        // Could be text search or JS eval
        const arg = args[0];
        // Check if it looks like a search text (from text condition)
        // vs a JS expression (from js condition)
        // We determine by checking the function source for "innerText"
        const fnStr = fn.toString();
        if (fnStr.includes("innerText")) {
          return Promise.resolve(behavior.textExists ?? false);
        }
        if (fnStr.includes("eval")) {
          return Promise.resolve(behavior.jsResult ?? false);
        }
      }
      return Promise.resolve(false);
    }),
  } as any;
}

describe("pollUntilCondition", () => {
  it("returns true immediately when condition is already satisfied", async () => {
    const mockPage = createMockPage({ selectorExists: true });

    const result = await pollUntilCondition(
      mockPage,
      { selector: "#test" },
      { timeout: 1000 },
    );

    expect(result).toBe(true);
  });

  it("returns false when condition is never satisfied within timeout", async () => {
    const mockPage = createMockPage({ selectorExists: false });

    const result = await pollUntilCondition(
      mockPage,
      { selector: "#nonexistent" },
      { timeout: 200, pollInterval: 50 },
    );

    expect(result).toBe(false);
  });

  it("polls multiple times before condition is met", async () => {
    let callCount = 0;
    const mockPage = {
      $: vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve(callCount >= 3 ? {} : null);
      }),
    } as any;

    const result = await pollUntilCondition(
      mockPage,
      { selector: "#delayed" },
      { timeout: 5000, pollInterval: 50 },
    );

    expect(result).toBe(true);
    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it("checks text condition", async () => {
    const mockPage = createMockPage({ textExists: true });

    const result = await pollUntilCondition(
      mockPage,
      { text: "Expected text" },
      { timeout: 1000 },
    );

    expect(result).toBe(true);
  });

  it("checks JS condition", async () => {
    const mockPage = createMockPage({ jsResult: true });

    const result = await pollUntilCondition(
      mockPage,
      { js: "document.ready === true" },
      { timeout: 1000 },
    );

    expect(result).toBe(true);
  });

  it("requires all conditions to be true (AND logic)", async () => {
    // selector exists but text doesn't
    const mockPage = createMockPage({
      selectorExists: true,
      textExists: false,
    });

    const result = await pollUntilCondition(
      mockPage,
      { selector: "#exists", text: "missing text" },
      { timeout: 200, pollInterval: 50 },
    );

    expect(result).toBe(false);
  });

  it("returns true when no conditions are specified", async () => {
    const mockPage = createMockPage({});

    const result = await pollUntilCondition(mockPage, {}, { timeout: 100 });

    expect(result).toBe(true);
  });
});
