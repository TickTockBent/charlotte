import { describe, it, expect } from "vitest";
import { KnownDevices } from "puppeteer";
import {
  resolveDeviceEmulation,
  suggestKnownDevices,
  findKnownDeviceName,
} from "../../../src/core/device-emulation.js";
import { DEVICE_VIEWPORT_PRESETS } from "../../../src/types/config.js";
import { CharlotteError, CharlotteErrorCode } from "../../../src/types/errors.js";

describe("resolveDeviceEmulation (#24)", () => {
  it("resolves a generic preset to dimensions only", () => {
    const resolution = resolveDeviceEmulation("tablet", DEVICE_VIEWPORT_PRESETS);
    expect(resolution).toEqual({ kind: "generic", preset: "tablet", width: 768, height: 1024 });
  });

  it("resolves an exact KnownDevices name with its descriptor", () => {
    const resolution = resolveDeviceEmulation("iPhone 15", DEVICE_VIEWPORT_PRESETS);
    expect(resolution.kind).toBe("named");
    if (resolution.kind !== "named") return;
    expect(resolution.name).toBe("iPhone 15");
    expect(resolution.descriptor).toBe(KnownDevices["iPhone 15"]);
    expect(resolution.descriptor.viewport.deviceScaleFactor).toBe(3);
    expect(resolution.descriptor.viewport.hasTouch).toBe(true);
  });

  it("matches KnownDevices names case-insensitively and returns the canonical name", () => {
    const resolution = resolveDeviceEmulation("iphone 15 LANDSCAPE", DEVICE_VIEWPORT_PRESETS);
    expect(resolution.kind).toBe("named");
    if (resolution.kind !== "named") return;
    expect(resolution.name).toBe("iPhone 15 landscape");
    expect(resolution.descriptor.viewport.isLandscape).toBe(true);
  });

  it("prefers an exact match over a case-insensitive one", () => {
    expect(findKnownDeviceName("Pixel 5")).toBe("Pixel 5");
    expect(findKnownDeviceName("pixel 5")).toBe("Pixel 5");
    expect(findKnownDeviceName("Pixel 5000")).toBeUndefined();
  });

  it("throws INVALID_ARGUMENT with substring suggestions for an unknown name", () => {
    let thrown: unknown;
    try {
      resolveDeviceEmulation("iphone", DEVICE_VIEWPORT_PRESETS);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CharlotteError);
    const charlotteError = thrown as CharlotteError;
    expect(charlotteError.code).toBe(CharlotteErrorCode.INVALID_ARGUMENT);
    expect(charlotteError.message).toBe("Unknown device 'iphone'.");
    expect(charlotteError.suggestion).toContain("iPhone 15");
    expect(charlotteError.suggestion).toContain("Did you mean");
    expect(charlotteError.suggestion).not.toContain("landscape");
  });

  it("caps substring suggestions at five", () => {
    const suggestions = suggestKnownDevices("iphone");
    expect(suggestions).toHaveLength(5);
    for (const suggestion of suggestions) {
      expect(suggestion.toLowerCase()).toContain("iphone");
    }
  });

  it("falls back to the generic-preset message when nothing matches", () => {
    let thrown: unknown;
    try {
      resolveDeviceEmulation("Commodore 64", DEVICE_VIEWPORT_PRESETS);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CharlotteError);
    const charlotteError = thrown as CharlotteError;
    expect(charlotteError.code).toBe(CharlotteErrorCode.INVALID_ARGUMENT);
    expect(charlotteError.suggestion).not.toContain("Did you mean");
    expect(charlotteError.suggestion).toContain("mobile, tablet, desktop");
    expect(charlotteError.suggestion).toContain("KnownDevices");
    expect(charlotteError.suggestion).toContain("iPhone 15");
  });
});

describe("suggestKnownDevices word fallback", () => {
  it("suggests names sharing a word when no whole-string substring matches", () => {
    const suggestions = suggestKnownDevices("Nokia 3310");
    expect(suggestions.length).toBeGreaterThan(0);
    for (const suggestion of suggestions) {
      expect(suggestion).toContain("Nokia");
    }
  });
});
