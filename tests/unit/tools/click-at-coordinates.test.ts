/**
 * #204f: charlotte_click_at and charlotte_click (via clickElementByBackendNodeId)
 * previously duplicated the modifier-down → click-variant → modifier-up sequence
 * byte-for-byte. Both now route through the single clickAtCoordinates() helper.
 *
 * These tests pin the exact event ordering produced by the shared helper so the
 * two call sites can never drift apart again.
 */
import { describe, it, expect, vi } from "vitest";
import type { Page } from "puppeteer";
import { clickAtCoordinates } from "../../../src/tools/interaction-helpers.js";

interface RecordedCall {
  kind: string;
  args: unknown[];
}

/**
 * Build a minimal Page stub whose keyboard/mouse calls are appended to a shared
 * ordered log, so we can assert the precise modifier/click sequence.
 */
function makeRecordingPage(): { page: Page; log: RecordedCall[] } {
  const log: RecordedCall[] = [];
  const record =
    (kind: string) =>
    async (...args: unknown[]) => {
      log.push({ kind, args });
    };
  const page = {
    keyboard: {
      down: record("keyboard.down"),
      up: record("keyboard.up"),
    },
    mouse: {
      click: record("mouse.click"),
    },
  } as unknown as Page;
  return { page, log };
}

describe("clickAtCoordinates (#204f shared helper)", () => {
  it("issues a plain left click at the given coordinates", async () => {
    const { page, log } = makeRecordingPage();
    await clickAtCoordinates(page, 12, 34);
    expect(log).toEqual([{ kind: "mouse.click", args: [12, 34] }]);
  });

  it("uses button:right for a right click", async () => {
    const { page, log } = makeRecordingPage();
    await clickAtCoordinates(page, 5, 6, "right");
    expect(log).toEqual([{ kind: "mouse.click", args: [5, 6, { button: "right" }] }]);
  });

  it("uses clickCount:2 for a double click", async () => {
    const { page, log } = makeRecordingPage();
    await clickAtCoordinates(page, 7, 8, "double");
    expect(log).toEqual([{ kind: "mouse.click", args: [7, 8, { clickCount: 2 }] }]);
  });

  it("holds modifiers before the click and releases them in reverse order after", async () => {
    const { page, log } = makeRecordingPage();
    await clickAtCoordinates(page, 1, 2, "left", ["ctrl", "shift"]);
    expect(log).toEqual([
      { kind: "keyboard.down", args: ["Control"] },
      { kind: "keyboard.down", args: ["Shift"] },
      { kind: "mouse.click", args: [1, 2] },
      { kind: "keyboard.up", args: ["Shift"] },
      { kind: "keyboard.up", args: ["Control"] },
    ]);
  });

  it("releases modifiers even when the click throws", async () => {
    const log: RecordedCall[] = [];
    const record =
      (kind: string) =>
      async (...args: unknown[]) => {
        log.push({ kind, args });
      };
    const page = {
      keyboard: { down: record("keyboard.down"), up: record("keyboard.up") },
      mouse: {
        click: vi.fn(async () => {
          log.push({ kind: "mouse.click", args: [] });
          throw new Error("click failed");
        }),
      },
    } as unknown as Page;

    await expect(clickAtCoordinates(page, 0, 0, "left", ["meta"])).rejects.toThrow("click failed");
    // Modifier must still be released despite the thrown click.
    expect(log).toEqual([
      { kind: "keyboard.down", args: ["Meta"] },
      { kind: "mouse.click", args: [] },
      { kind: "keyboard.up", args: ["Meta"] },
    ]);
  });
});
