import { describe, it, expect, vi } from "vitest";
import { pollUntilCondition } from "../../../src/utils/wait.js";
import { CharlotteError, CharlotteErrorCode } from "../../../src/types/errors.js";

// Create a mock page object for testing
function createMockPage(behavior: {
  selectorExists?: boolean;
  textExists?: boolean;
  jsResult?: boolean;
}) {
  const mockCdpSession = {
    send: vi.fn().mockImplementation((method: string) => {
      if (method === "Runtime.evaluate") {
        return Promise.resolve({
          result: { value: behavior.jsResult ?? false },
        });
      }
      return Promise.resolve({});
    }),
    detach: vi.fn().mockResolvedValue(undefined),
  };

  return {
    $: vi.fn().mockResolvedValue(behavior.selectorExists ? {} : null),
    createCDPSession: vi.fn().mockResolvedValue(mockCdpSession),
    evaluate: vi.fn().mockImplementation((fn: (...fnArgs: any[]) => any, ...args: any[]) => {
      // Text condition passes searchText as an argument
      if (args.length > 0 && typeof args[0] === "string") {
        const fnStr = fn.toString();
        if (fnStr.includes("innerText")) {
          return Promise.resolve(behavior.textExists ?? false);
        }
      }
      return Promise.resolve(false);
    }),
  } as any;
}

describe("pollUntilCondition", () => {
  it("returns true immediately when condition is already satisfied", async () => {
    const mockPage = createMockPage({ selectorExists: true });

    const result = await pollUntilCondition(mockPage, { selector: "#test" }, { timeout: 1000 });

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

    const result = await pollUntilCondition(mockPage, { text: "Expected text" }, { timeout: 1000 });

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

  it("treats JS evaluation exceptions as falsy (condition not met, polls until timeout)", async () => {
    const mockCdpSession = {
      send: vi.fn().mockResolvedValue({
        result: { type: "undefined" },
        exceptionDetails: { text: "ReferenceError: foo is not defined" },
      }),
      detach: vi.fn().mockResolvedValue(undefined),
    };
    const mockPage = {
      $: vi.fn(),
      createCDPSession: vi.fn().mockResolvedValue(mockCdpSession),
      evaluate: vi.fn(),
    } as any;

    const result = await pollUntilCondition(
      mockPage,
      { js: "foo.bar.baz" },
      { timeout: 200, pollInterval: 50 },
    );

    // Exceptions fold into "not met" — no immediate INVALID_ARGUMENT, just a false timeout
    expect(result).toBe(false);
  });

  it("throws INVALID_ARGUMENT immediately when JS expression evaluates to a function", async () => {
    const mockCdpSession = {
      send: vi.fn().mockResolvedValue({
        result: { type: "function" },
      }),
      detach: vi.fn().mockResolvedValue(undefined),
    };
    const mockPage = {
      $: vi.fn(),
      createCDPSession: vi.fn().mockResolvedValue(mockCdpSession),
      evaluate: vi.fn(),
    } as any;

    // Must reject immediately, not timeout
    await expect(
      pollUntilCondition(mockPage, { js: "() => document.title === 'x'" }, { timeout: 5000 }),
    ).rejects.toThrow(CharlotteError);

    await expect(
      pollUntilCondition(mockPage, { js: "() => document.title === 'x'" }, { timeout: 5000 }),
    ).rejects.toMatchObject({ code: CharlotteErrorCode.INVALID_ARGUMENT });

    // Should have only called send once (immediate failure, not polling)
    expect(mockCdpSession.send).toHaveBeenCalledTimes(2);
  });

  it("treats truthy non-boolean JS result as satisfied (non-serializable object → {})", async () => {
    // returnByValue: true on a DOM node returns type: "object", no value (or empty object)
    // The condition should still be considered truthy (object exists, subtype not "null")
    const mockCdpSession = {
      send: vi.fn().mockResolvedValue({
        result: { type: "object", subtype: undefined, value: undefined },
      }),
      detach: vi.fn().mockResolvedValue(undefined),
    };
    const mockPage = {
      $: vi.fn(),
      createCDPSession: vi.fn().mockResolvedValue(mockCdpSession),
      evaluate: vi.fn(),
    } as any;

    const result = await pollUntilCondition(
      mockPage,
      { js: "document.querySelector('h1')" },
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
