import { describe, it, expect } from "vitest";
import {
  assertTypingDurationWithinLimit,
  MAX_TYPING_DURATION_MS,
} from "../../../src/tools/interaction-helpers.js";
import { CharlotteError, CharlotteErrorCode } from "../../../src/types/errors.js";

describe("assertTypingDurationWithinLimit", () => {
  it("is a no-op when character delay is undefined (full-speed typing)", () => {
    expect(() => assertTypingDurationWithinLimit(100000, undefined)).not.toThrow();
  });

  it("allows typing that stays comfortably under the cap", () => {
    // 100 chars * 50ms = 5s (well under 30s even with overhead margin)
    expect(() => assertTypingDurationWithinLimit(100, 50)).not.toThrow();
  });

  it("throws CharlotteError with INVALID_ARGUMENT when estimate exceeds the cap", () => {
    // 1000 chars * 50ms = 50s, far over the 30s ceiling
    let thrown: unknown;
    try {
      assertTypingDurationWithinLimit(1000, 50);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CharlotteError);
    expect((thrown as CharlotteError).code).toBe(CharlotteErrorCode.INVALID_ARGUMENT);
    expect((thrown as CharlotteError).message).toContain("too long");
  });

  it("accounts for keystroke overhead so a naive sub-cap estimate can still be rejected", () => {
    // 595 chars * 50ms = 29.75s naively (under 30s), but with the overhead
    // margin it tips over the ceiling and must be rejected.
    const naiveEstimateMs = 595 * 50;
    expect(naiveEstimateMs).toBeLessThan(MAX_TYPING_DURATION_MS);
    expect(() => assertTypingDurationWithinLimit(595, 50)).toThrow(CharlotteError);
  });
});
