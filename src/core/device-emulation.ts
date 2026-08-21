import { KnownDevices, type Device, type Page } from "puppeteer";
import type { DeviceType } from "../types/config.js";
import { CharlotteError, CharlotteErrorCode } from "../types/errors.js";

/**
 * Device resolution for `charlotte_viewport` (#24).
 *
 * A `device` argument is either one of the three generic presets (dimension-only,
 * sourced from config) or a Puppeteer `KnownDevices` name (full emulation: DPR,
 * touch, mobile mode, user agent). Resolution is pure so it can be unit-tested
 * without a browser; the Puppeteer side effects live in the tool handler.
 */

export const GENERIC_DEVICE_PRESETS: readonly DeviceType[] = ["mobile", "tablet", "desktop"];

const KNOWN_DEVICE_CATALOG: Readonly<Record<string, Device>> = KnownDevices;
const MAX_SUGGESTIONS = 5;
const FALLBACK_EXAMPLE_DEVICES = ["iPhone 15", "Pixel 5", "iPad Pro"] as const;

export type GenericViewportPresets = Record<DeviceType, { width: number; height: number }>;

export type DeviceEmulationResolution =
  | { kind: "generic"; preset: DeviceType; width: number; height: number }
  | { kind: "named"; name: string; descriptor: Device };

function isGenericPreset(value: string): value is DeviceType {
  return (GENERIC_DEVICE_PRESETS as readonly string[]).includes(value);
}

/**
 * Find the canonical KnownDevices key for `deviceInput`: exact match first,
 * then case-insensitive. Returns undefined when no key matches.
 */
export function findKnownDeviceName(deviceInput: string): string | undefined {
  if (Object.hasOwn(KNOWN_DEVICE_CATALOG, deviceInput)) return deviceInput;
  const lowered = deviceInput.toLowerCase();
  return Object.keys(KNOWN_DEVICE_CATALOG).find((knownName) => knownName.toLowerCase() === lowered);
}

/**
 * Up to {@link MAX_SUGGESTIONS} KnownDevices names similar to `deviceInput`.
 * Whole-string case-insensitive substring matches come first; if there are
 * none, names sharing any whitespace-separated word with the input are ranked
 * by how many words they share (so "Nokia 3310" still suggests the Nokias).
 */
export function suggestKnownDevices(deviceInput: string): string[] {
  const lowered = deviceInput.trim().toLowerCase();
  const knownNames = Object.keys(KNOWN_DEVICE_CATALOG);

  const wholeStringMatches = knownNames.filter((knownName) =>
    knownName.toLowerCase().includes(lowered),
  );
  if (wholeStringMatches.length > 0) return preferPortraitVariants(wholeStringMatches);

  const inputWords = lowered.split(/\s+/).filter((word) => word.length >= 2);
  if (inputWords.length === 0) return [];

  const wordMatches = knownNames
    .map((knownName, originalIndex) => {
      const loweredName = knownName.toLowerCase();
      const sharedWordCount = inputWords.filter((word) => loweredName.includes(word)).length;
      return { knownName, sharedWordCount, originalIndex };
    })
    .filter((candidate) => candidate.sharedWordCount > 0)
    .sort(
      (left, right) =>
        right.sharedWordCount - left.sharedWordCount || left.originalIndex - right.originalIndex,
    )
    .map((candidate) => candidate.knownName);
  return preferPortraitVariants(wordMatches);
}

/**
 * Order suggestions for usefulness: KnownDevices lists each family oldest-first,
 * so reversing puts current models first; landscape variants are derivable from
 * their portrait name and only fill slots left over after the portrait names.
 */
function preferPortraitVariants(candidateNames: string[]): string[] {
  const newestFirst = [...candidateNames].reverse();
  const portraitNames = newestFirst.filter((name) => !name.endsWith(" landscape"));
  const landscapeNames = newestFirst.filter((name) => name.endsWith(" landscape"));
  return [...portraitNames, ...landscapeNames].slice(0, MAX_SUGGESTIONS);
}

/**
 * Resolve a `device` argument into either a generic preset or a named device.
 * Throws `INVALID_ARGUMENT` with a steering suggestion for unknown names.
 */
export function resolveDeviceEmulation(
  deviceInput: string,
  genericPresets: GenericViewportPresets,
): DeviceEmulationResolution {
  const trimmedInput = deviceInput.trim();

  if (isGenericPreset(trimmedInput)) {
    const preset = genericPresets[trimmedInput];
    return { kind: "generic", preset: trimmedInput, width: preset.width, height: preset.height };
  }

  const knownDeviceName = findKnownDeviceName(trimmedInput);
  if (knownDeviceName !== undefined) {
    return {
      kind: "named",
      name: knownDeviceName,
      descriptor: KNOWN_DEVICE_CATALOG[knownDeviceName],
    };
  }

  const similarNames = suggestKnownDevices(trimmedInput);
  const suggestion =
    similarNames.length > 0
      ? `Did you mean: ${similarNames.join(", ")}? Generic presets are mobile, tablet, desktop.`
      : `Generic presets are mobile, tablet, desktop. Named devices follow Puppeteer KnownDevices, e.g. ${FALLBACK_EXAMPLE_DEVICES.join(", ")}.`;

  throw new CharlotteError(
    CharlotteErrorCode.INVALID_ARGUMENT,
    `Unknown device '${deviceInput}'.`,
    suggestion,
  );
}

// ─── Per-page emulation state ───

/** Pages that currently have a named device applied, keyed to the device name. */
const appliedNamedDeviceByPage = new WeakMap<Page, string>();

export function getAppliedNamedDevice(page: Page): string | undefined {
  return appliedNamedDeviceByPage.get(page);
}

/** Apply a KnownDevices descriptor (viewport + DPR + touch + mobile + UA). */
export async function applyNamedDevice(
  page: Page,
  name: string,
  descriptor: Device,
): Promise<void> {
  await page.emulate(descriptor);
  appliedNamedDeviceByPage.set(page, name);
}

/**
 * Set a plain viewport and, if a named device was previously applied to this
 * page, restore the browser's default user agent so emulation doesn't leak.
 */
export async function applyPlainViewport(page: Page, width: number, height: number): Promise<void> {
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
  if (appliedNamedDeviceByPage.has(page)) {
    await page.setUserAgent(await page.browser().userAgent());
    appliedNamedDeviceByPage.delete(page);
  }
}
