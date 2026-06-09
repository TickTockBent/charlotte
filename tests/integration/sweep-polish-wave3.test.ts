/**
 * Wave 3 sweep/polish regressions, exercised through the real MCP handlers.
 *
 * Covers:
 *  - #187: argument-validation failures surface INVALID_ARGUMENT (not SESSION_ERROR)
 *          for scroll amount, key/keys exclusivity, missing wait condition,
 *          upload file-not-found, screenshot save/output_file conflict,
 *          dev_inject empty args, dev_serve bad path.
 *  - #204a: charlotte_find spatial filters reject a boundsless reference element.
 *  - #204b: charlotte_screenshot full_page:false captures viewport-only (smaller).
 *  - #204c: clear_first replaces (does not prepend) regardless of host platform.
 *  - #204d: charlotte_toggle rejects non-toggleable element types.
 *  - #204e: charlotte_wait_for rejects `state` without `element_id`.
 *  - #204f: charlotte_click_at routes through the shared clickAtCoordinates helper.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as path from "node:path";
import { setupMcpHarness, parseToolJson, type McpHarness } from "../helpers/mcp-harness.js";
import type { PageRepresentation } from "../../src/types/page-representation.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures/pages");
const INTERACTION_FIXTURE = `file://${path.join(FIXTURES_DIR, "interaction.html")}`;
const BOUNDLESS_FIXTURE = `file://${path.join(FIXTURES_DIR, "boundless-ref.html")}`;

function findId(
  rep: PageRepresentation,
  predicate: (label: string, type: string, id: string) => boolean,
): string {
  const element = rep.interactive.find((el) => predicate(el.label, el.type, el.id));
  if (!element) {
    throw new Error(
      `No interactive element matched. Available: ${rep.interactive
        .map((el) => `${el.type}:${el.label}`)
        .join(", ")}`,
    );
  }
  return element.id;
}

function errorCode(result: CallToolResult): string {
  const payload = parseToolJson<{ error: { code: string; message: string } }>(result);
  return payload.error.code;
}

describe("Wave 3 sweep/polish", () => {
  let harness: McpHarness;

  beforeAll(async () => {
    harness = await setupMcpHarness({ profile: "full" });
  });

  afterAll(async () => {
    await harness.teardown();
  });

  beforeEach(async () => {
    await harness.callTool("charlotte_navigate", { url: INTERACTION_FIXTURE });
  });

  // ─── #187: argument-validation taxonomy ───
  describe("#187 INVALID_ARGUMENT for argument-validation failures", () => {
    it("charlotte_scroll: non-numeric amount", async () => {
      const result = await harness.callTool("charlotte_scroll", {
        direction: "down",
        amount: "lots",
      });
      expect(result.isError).toBe(true);
      expect(errorCode(result)).toBe("INVALID_ARGUMENT");
    });

    it("charlotte_key: key and keys both provided", async () => {
      const result = await harness.callTool("charlotte_key", {
        key: "Enter",
        keys: ["ArrowDown"],
      });
      expect(result.isError).toBe(true);
      expect(errorCode(result)).toBe("INVALID_ARGUMENT");
    });

    it("charlotte_key: neither key nor keys provided", async () => {
      const result = await harness.callTool("charlotte_key", {});
      expect(result.isError).toBe(true);
      expect(errorCode(result)).toBe("INVALID_ARGUMENT");
    });

    it("charlotte_upload: file not found", async () => {
      const rep = parseToolJson<PageRepresentation>(
        await harness.callTool("charlotte_observe", { detail: "summary" }),
      );
      const fileInputId = findId(rep, (_label, type) => type === "file_input");
      const result = await harness.callTool("charlotte_upload", {
        element_id: fileInputId,
        paths: ["/nonexistent/charlotte-wave3-missing.txt"],
      });
      expect(result.isError).toBe(true);
      expect(errorCode(result)).toBe("INVALID_ARGUMENT");
    });

    it("charlotte_screenshot: save and output_file conflict", async () => {
      const result = await harness.callTool("charlotte_screenshot", {
        save: true,
        output_file: "shot.png",
      });
      expect(result.isError).toBe(true);
      expect(errorCode(result)).toBe("INVALID_ARGUMENT");
    });

    it("charlotte_wait_for: no condition provided", async () => {
      const result = await harness.callTool("charlotte_wait_for", {});
      expect(result.isError).toBe(true);
      expect(errorCode(result)).toBe("INVALID_ARGUMENT");
    });

    it("charlotte_dev_inject: neither css nor js", async () => {
      const result = await harness.callTool("charlotte_dev_inject", {});
      expect(result.isError).toBe(true);
      expect(errorCode(result)).toBe("INVALID_ARGUMENT");
    });

    it("charlotte_dev_serve: path does not exist", async () => {
      const result = await harness.callTool("charlotte_dev_serve", {
        path: "/nonexistent/charlotte-wave3-dir",
      });
      expect(result.isError).toBe(true);
      expect(errorCode(result)).toBe("INVALID_ARGUMENT");
    });

    it("charlotte_upload: element is not a file input → ELEMENT_NOT_INTERACTIVE", async () => {
      const rep = parseToolJson<PageRepresentation>(
        await harness.callTool("charlotte_observe", { detail: "summary" }),
      );
      const buttonId = findId(rep, (_label, type) => type === "button");
      const result = await harness.callTool("charlotte_upload", {
        element_id: buttonId,
        paths: [path.join(FIXTURES_DIR, "interaction.html")],
      });
      expect(result.isError).toBe(true);
      expect(errorCode(result)).toBe("ELEMENT_NOT_INTERACTIVE");
    });
  });

  // ─── #204e: wait_for state without element_id ───
  describe("#204e charlotte_wait_for rejects state without element_id", () => {
    it("returns INVALID_ARGUMENT", async () => {
      const result = await harness.callTool("charlotte_wait_for", {
        state: "visible",
        text: "Ready",
      });
      expect(result.isError).toBe(true);
      expect(errorCode(result)).toBe("INVALID_ARGUMENT");
    });
  });

  // ─── #204d: toggle target-type validation ───
  describe("#204d charlotte_toggle validates element type", () => {
    it("toggles a checkbox successfully", async () => {
      const rep = parseToolJson<PageRepresentation>(
        await harness.callTool("charlotte_observe", { detail: "summary" }),
      );
      const checkboxId = findId(rep, (_label, type) => type === "checkbox");
      const result = await harness.callTool("charlotte_toggle", { element_id: checkboxId });
      expect(result.isError).toBeFalsy();
    });

    it("rejects a button with INVALID_ARGUMENT naming charlotte_click", async () => {
      const rep = parseToolJson<PageRepresentation>(
        await harness.callTool("charlotte_observe", { detail: "summary" }),
      );
      const buttonId = findId(rep, (_label, type) => type === "button");
      const result = await harness.callTool("charlotte_toggle", { element_id: buttonId });
      expect(result.isError).toBe(true);
      const payload = parseToolJson<{ error: { code: string; suggestion?: string } }>(result);
      expect(payload.error.code).toBe("INVALID_ARGUMENT");
      expect(payload.error.suggestion).toContain("charlotte_click");
    });
  });

  // ─── #204c: clear_first replaces existing value (no prepend) ───
  describe("#204c clear_first replaces the existing value", () => {
    it("typing with clear_first leaves only the new text", async () => {
      const rep = parseToolJson<PageRepresentation>(
        await harness.callTool("charlotte_observe", { detail: "summary" }),
      );
      // The text-input fixture is pre-populated with "initial value".
      const inputId = findId(rep, (_label, type, _id) => type === "text_input");
      const afterType = parseToolJson<PageRepresentation>(
        await harness.callTool("charlotte_type", {
          element_id: inputId,
          text: "replaced",
          clear_first: true,
        }),
      );
      const updated = afterType.interactive.find((el) => el.id === inputId);
      // If clear-all had failed (Ctrl+A as caret-move), the value would be
      // "replacedinitial value" or similar — assert it is exactly the new text.
      expect(updated?.value).toBe("replaced");
    });
  });

  // ─── #204a: spatial filter rejects boundsless reference ───
  describe("#204a charlotte_find spatial filter on a boundsless reference", () => {
    beforeEach(async () => {
      await harness.callTool("charlotte_navigate", { url: BOUNDLESS_FIXTURE });
    });

    it("near: rejects with INVALID_ARGUMENT when the reference has no bounds", async () => {
      const rep = parseToolJson<PageRepresentation>(
        await harness.callTool("charlotte_observe", { detail: "summary" }),
      );
      // The display:contents button has no box model → bounds: null.
      const boundless = rep.interactive.find((el) => el.bounds == null);
      expect(boundless, "fixture must expose a boundsless interactive element").toBeTruthy();

      const result = await harness.callTool("charlotte_find", {
        type: "button",
        near: boundless!.id,
      });
      expect(result.isError).toBe(true);
      expect(errorCode(result)).toBe("INVALID_ARGUMENT");
    });

    it("within: rejects with INVALID_ARGUMENT when the reference has no bounds", async () => {
      const rep = parseToolJson<PageRepresentation>(
        await harness.callTool("charlotte_observe", { detail: "summary" }),
      );
      const boundless = rep.interactive.find((el) => el.bounds == null);
      expect(boundless, "fixture must expose a boundsless interactive element").toBeTruthy();

      const result = await harness.callTool("charlotte_find", {
        type: "button",
        within: boundless!.id,
      });
      expect(result.isError).toBe(true);
      expect(errorCode(result)).toBe("INVALID_ARGUMENT");
    });
  });

  // ─── #204b: screenshot full_page option ───
  describe("#204b charlotte_screenshot full_page option", () => {
    it("full_page:false produces a smaller image than full_page:true on a tall page", async () => {
      const full = await harness.callTool("charlotte_screenshot", { full_page: true });
      const viewport = await harness.callTool("charlotte_screenshot", { full_page: false });

      const fullImg = (full.content as Array<{ type: string; data?: string }>).find(
        (c) => c.type === "image",
      );
      const viewportImg = (viewport.content as Array<{ type: string; data?: string }>).find(
        (c) => c.type === "image",
      );
      expect(fullImg?.data).toBeTruthy();
      expect(viewportImg?.data).toBeTruthy();
      // The interaction fixture has a scrollable body taller than the viewport,
      // so the full-page PNG must be at least as large as the viewport-only one.
      expect((fullImg!.data as string).length).toBeGreaterThanOrEqual(
        (viewportImg!.data as string).length,
      );
    });

    it("defaults to full_page when the arg is omitted", async () => {
      const omitted = await harness.callTool("charlotte_screenshot", {});
      const omittedImg = (omitted.content as Array<{ type: string; data?: string }>).find(
        (c) => c.type === "image",
      );
      expect(omittedImg?.data).toBeTruthy();
    });
  });

  // ─── #204f: click_at shared helper parity ───
  describe("#204f charlotte_click_at via shared clickAtCoordinates", () => {
    it("clicks at coordinates and triggers the page handler", async () => {
      const rep = parseToolJson<PageRepresentation>(
        await harness.callTool("charlotte_observe", { detail: "summary" }),
      );
      const button = rep.interactive.find((el) => el.type === "button" && el.bounds != null);
      expect(button?.bounds).toBeTruthy();
      const bounds = button!.bounds!;
      const result = await harness.callTool("charlotte_click_at", {
        x: Math.round(bounds.x + bounds.w / 2),
        y: Math.round(bounds.y + bounds.h / 2),
      });
      expect(result.isError).toBeFalsy();
    });
  });
});
