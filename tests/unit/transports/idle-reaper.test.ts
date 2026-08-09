/**
 * Deterministic unit tests for the idle-TTL reaper (D17, I7).
 *
 * Fake timers only — no browser, no HTTP. Covers arm/fire, reset-on-activity,
 * the never-touched case, stop() semantics, the inert (disabled) paths, and
 * async-onIdle-rejection swallowing. Reset-on-activity precision lives here
 * rather than the real-timer integration test, to avoid timing flake.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createIdleReaper } from "../../../src/transports/idle-reaper.js";
import { logger } from "../../../src/utils/logger.js";

describe("createIdleReaper", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("arms on touch and fires onIdle once after idleMs", async () => {
    const onIdle = vi.fn();
    const reaper = createIdleReaper({ idleMs: 1000, onIdle });

    reaper.touch();
    vi.advanceTimersByTime(999);
    expect(onIdle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    // The fire wraps onIdle in a microtask; flush it before asserting.
    await Promise.resolve();
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("resets the deadline on each touch (fires idleMs after the LAST touch)", async () => {
    const onIdle = vi.fn();
    const reaper = createIdleReaper({ idleMs: 1000, onIdle });

    reaper.touch();
    vi.advanceTimersByTime(500);
    reaper.touch();

    vi.advanceTimersByTime(999);
    expect(onIdle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await Promise.resolve();
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("does not fire without any touch", () => {
    const onIdle = vi.fn();
    createIdleReaper({ idleMs: 1000, onIdle });

    vi.advanceTimersByTime(5000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("stop() cancels a pending fire", () => {
    const onIdle = vi.fn();
    const reaper = createIdleReaper({ idleMs: 1000, onIdle });

    reaper.touch();
    vi.advanceTimersByTime(500);
    reaper.stop();

    vi.advanceTimersByTime(5000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("stop() is permanent — a later touch does not re-arm", () => {
    const onIdle = vi.fn();
    const reaper = createIdleReaper({ idleMs: 1000, onIdle });

    reaper.touch();
    reaper.stop();
    reaper.touch();

    vi.advanceTimersByTime(5000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("is inert when idleMs <= 0", () => {
    const onIdle = vi.fn();
    const reaper = createIdleReaper({ idleMs: 0, onIdle });

    reaper.touch();
    vi.advanceTimersByTime(5000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("is inert when idleMs is non-finite (Infinity)", () => {
    const onIdle = vi.fn();
    const reaper = createIdleReaper({ idleMs: Infinity, onIdle });

    reaper.touch();
    vi.advanceTimersByTime(1_000_000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("is inert when idleMs is non-finite (NaN)", () => {
    const onIdle = vi.fn();
    const reaper = createIdleReaper({ idleMs: NaN, onIdle });

    reaper.touch();
    vi.advanceTimersByTime(1_000_000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("swallows an async onIdle rejection and logs it", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const onIdle = vi.fn(async () => {
      throw new Error("boom");
    });
    const reaper = createIdleReaper({ idleMs: 1000, onIdle });

    reaper.touch();
    // Advance and flush both the timer callback and the rejected microtask;
    // runAllTimersAsync drains scheduled timers and pending microtasks without
    // letting the rejection surface as an unhandled rejection.
    await vi.runAllTimersAsync();

    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith("idle-reaper: onIdle failed", {
      error: expect.any(Error),
    });
  });
});
