import { describe, it, expect } from "vitest";
import {
  assertTypingDurationWithinLimit,
  resolveCharacterDelay,
  MAX_TYPING_DURATION_MS,
  DEFAULT_SLOW_TYPING_DELAY_MS,
} from "../../../src/tools/interaction-helpers.js";
import { CharlotteError, CharlotteErrorCode } from "../../../src/types/errors.js";

describe("resolveCharacterDelay", () => {
  it("returns undefined for full-speed typing (no slowly, no delay)", () => {
    expect(resolveCharacterDelay(undefined, undefined)).toBeUndefined();
    expect(resolveCharacterDelay(false, undefined)).toBeUndefined();
  });

  it("defaults to 50ms when slowly is true without an explicit delay", () => {
    expect(resolveCharacterDelay(true, undefined)).toBe(DEFAULT_SLOW_TYPING_DELAY_MS);
  });

  it("prefers an explicit character_delay over the slowly default", () => {
    expect(resolveCharacterDelay(true, 120)).toBe(120);
    expect(resolveCharacterDelay(undefined, 120)).toBe(120);
  });
});

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

  it("rejects a large slowly:true request via the resolved default delay", () => {
    // Mirrors the tool handler path: slowly true with no explicit delay resolves
    // to 50ms, and a large text then exceeds the cap.
    const delayMs = resolveCharacterDelay(true, undefined);
    expect(() => assertTypingDurationWithinLimit(2000, delayMs)).toThrow(CharlotteError);
  });

  it("bounds full-speed typing via the handler's 2ms floor (#204)", () => {
    // charlotte_type passes Math.max(delayMs ?? 0, 2) so even full-speed typing
    // of a huge payload is bounded. Mirror that with delayMs undefined.
    const fullSpeedDelay: number | undefined = undefined;
    const flooredDelay = Math.max(fullSpeedDelay ?? 0, 2);

    // 100k chars * 2ms = 200s, far over the cap.
    expect(() => assertTypingDurationWithinLimit(100_000, flooredDelay)).toThrow(CharlotteError);
    // A small full-speed payload still passes under the floor.
    expect(() => assertTypingDurationWithinLimit(100, flooredDelay)).not.toThrow();
  });

  it("bounds a long charlotte_key sequence (#204)", () => {
    // keys:[500] with delay:200 → 100s of presses, far over the cap. The handler
    // applies Math.max(delay ?? 0, 2) before the same guard.
    const sequenceDelay: number | undefined = 200;
    expect(() => assertTypingDurationWithinLimit(500, Math.max(sequenceDelay ?? 0, 2))).toThrow(
      CharlotteError,
    );

    // A modest sequence at full speed is allowed.
    const fastDelay: number | undefined = undefined;
    expect(() => assertTypingDurationWithinLimit(10, Math.max(fastDelay ?? 0, 2))).not.toThrow();
  });
});
