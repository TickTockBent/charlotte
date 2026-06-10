import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleToolError, ensureReady } from "../../../src/tools/tool-helpers.js";
import type { ToolDependencies } from "../../../src/tools/tool-helpers.js";
import { CharlotteError, CharlotteErrorCode } from "../../../src/types/errors.js";
import type { BrowserManager } from "../../../src/browser/browser-manager.js";
import type { PageManager } from "../../../src/browser/page-manager.js";

/** Parse the JSON payload from a handleToolError result. */
function parseError(result: ReturnType<typeof handleToolError>): {
  error: { code: string; message: string; suggestion?: string };
} {
  return JSON.parse(result.content[0].text);
}

describe("handleToolError", () => {
  it("passes a CharlotteError through with its code, message, and suggestion intact", () => {
    const original = new CharlotteError(
      CharlotteErrorCode.ELEMENT_NOT_FOUND,
      "Element 'btn-x' not found.",
      "Call charlotte_observe.",
    );

    const result = handleToolError(original);

    expect(result.isError).toBe(true);
    const parsed = parseError(result);
    expect(parsed.error.code).toBe("ELEMENT_NOT_FOUND");
    expect(parsed.error.message).toBe("Element 'btn-x' not found.");
    expect(parsed.error.suggestion).toBe("Call charlotte_observe.");
  });

  it("preserves INVALID_ARGUMENT (does not remap caller-fixable errors to SESSION_ERROR)", () => {
    const result = handleToolError(
      new CharlotteError(CharlotteErrorCode.INVALID_ARGUMENT, "bad arg"),
    );
    expect(parseError(result).error.code).toBe("INVALID_ARGUMENT");
  });

  it("omits suggestion when the CharlotteError has none", () => {
    const result = handleToolError(new CharlotteError(CharlotteErrorCode.TIMEOUT, "timed out"));
    const parsed = parseError(result);
    expect(parsed.error.code).toBe("TIMEOUT");
    expect(parsed.error.suggestion).toBeUndefined();
  });

  it("maps a generic Error to SESSION_ERROR and embeds its message", () => {
    const result = handleToolError(new Error("boom from CDP"));
    const parsed = parseError(result);
    expect(parsed.error.code).toBe("SESSION_ERROR");
    expect(parsed.error.message).toContain("boom from CDP");
    expect(parsed.error.message).toContain("Unexpected error");
  });

  it("maps a non-Error thrown value to SESSION_ERROR via String()", () => {
    const result = handleToolError("string failure");
    const parsed = parseError(result);
    expect(parsed.error.code).toBe("SESSION_ERROR");
    expect(parsed.error.message).toContain("string failure");
  });

  it("always returns isError:true with a single text content block", () => {
    const result = handleToolError(new Error("x"));
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
  });
});

describe("ensureReady", () => {
  let ensureConnected: ReturnType<typeof vi.fn>;
  let hasPages: ReturnType<typeof vi.fn>;
  let openTab: ReturnType<typeof vi.fn>;
  let deps: Pick<ToolDependencies, "browserManager" | "pageManager">;

  beforeEach(() => {
    ensureConnected = vi.fn().mockResolvedValue(undefined);
    hasPages = vi.fn().mockReturnValue(true);
    openTab = vi.fn().mockResolvedValue(undefined);
    deps = {
      browserManager: { ensureConnected } as unknown as BrowserManager,
      pageManager: { hasPages, openTab } as unknown as PageManager,
    };
  });

  it("connects the browser and returns early when a page already exists", async () => {
    await ensureReady(deps);
    expect(ensureConnected).toHaveBeenCalledTimes(1);
    expect(openTab).not.toHaveBeenCalled();
  });

  it("opens an initial tab when no pages exist", async () => {
    hasPages.mockReturnValue(false);
    await ensureReady(deps);
    expect(openTab).toHaveBeenCalledTimes(1);
    expect(openTab).toHaveBeenCalledWith(deps.browserManager);
  });

  it("propagates a browser-connection failure", async () => {
    ensureConnected.mockRejectedValue(new Error("browser launch failed"));
    await expect(ensureReady(deps)).rejects.toThrow("browser launch failed");
    expect(openTab).not.toHaveBeenCalled();
  });

  it("propagates an openTab failure and clears the init mutex so a retry can succeed", async () => {
    hasPages.mockReturnValue(false);
    openTab.mockRejectedValueOnce(new Error("tab open failed"));
    await expect(ensureReady(deps)).rejects.toThrow("tab open failed");

    // The init mutex must have been released in the finally block — a second
    // call should attempt openTab again rather than awaiting a settled mutex.
    openTab.mockResolvedValueOnce(undefined);
    await ensureReady(deps);
    expect(openTab).toHaveBeenCalledTimes(2);
  });

  it("serializes concurrent first-init calls onto a single openTab", async () => {
    hasPages.mockReturnValue(false);
    let resolveOpen!: () => void;
    openTab.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveOpen = resolve;
        }),
    );

    // Fire two concurrent calls before the first openTab resolves.
    const first = ensureReady(deps);
    const second = ensureReady(deps);
    // Let the awaited ensureConnected() microtasks settle so openTab() is
    // actually invoked (and resolveOpen assigned) before we resolve it.
    await vi.waitFor(() => expect(openTab).toHaveBeenCalled());
    resolveOpen();
    await Promise.all([first, second]);

    // The mutex should have collapsed the two calls onto one openTab.
    expect(openTab).toHaveBeenCalledTimes(1);
  });
});
