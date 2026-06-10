/**
 * Integration coverage for Wave 3 size-API work:
 *   - #188 render-pipeline output caps (interactive list, full_content) and the
 *     formatPageResponse byte ceiling, exercised through the real handlers.
 *   - #188 charlotte_evaluate result cap.
 *   - #72 charlotte_find output_file support.
 *   - #204 fill_form checkbox set-semantics (express desired state, not toggle).
 *
 * Each test drives tools through the shared in-memory MCP harness with a real
 * Chromium (sandbox disabled, per #184).
 */
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupMcpHarness, parseToolJson, type McpHarness } from "../helpers/mcp-harness.js";
import type {
  InteractiveElement,
  PageRepresentation,
} from "../../src/types/page-representation.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures/pages");
const SIZE_FIXTURE = `file://${path.join(FIXTURES_DIR, "size-caps.html")}`;

describe("Wave 3 size API (#188, #72, #204)", () => {
  describe("renderer output caps (#188)", () => {
    let harness: McpHarness;

    beforeAll(async () => {
      harness = await setupMcpHarness({
        profile: "full",
        configOverrides: (config) => {
          config.limits.maxInteractiveElements = 3;
          config.limits.maxFullContentChars = 60;
        },
      });
      await harness.callTool("charlotte_navigate", { url: SIZE_FIXTURE });
    });

    afterAll(async () => {
      await harness.teardown();
    });

    it("caps the interactive element list and reports truncation", async () => {
      const rep = parseToolJson<PageRepresentation>(
        await harness.callTool("charlotte_observe", { detail: "summary" }),
      );

      // The fixture has 6 buttons + 2 checkboxes; cap is 3.
      expect(rep.interactive!.length).toBe(3);
      expect(rep.truncation).toBeDefined();
      expect(rep.truncation!.interactive!.returned).toBe(3);
      expect(rep.truncation!.interactive!.total).toBeGreaterThan(3);
      expect(rep.truncation!.suggestion).toBeTruthy();
    });

    it("truncates full_content with an explicit marker", async () => {
      const rep = parseToolJson<PageRepresentation>(
        await harness.callTool("charlotte_observe", { detail: "full" }),
      );

      expect(rep.structure.full_content).toContain("[...full_content truncated at 60 characters.");
      expect(rep.truncation!.full_content).toBeDefined();
      expect(rep.truncation!.full_content!.total_chars).toBeGreaterThan(60);
    });
  });

  describe("formatPageResponse byte ceiling (#188)", () => {
    let harness: McpHarness;

    beforeAll(async () => {
      // A tiny byte ceiling forces even this small page to degrade.
      harness = await setupMcpHarness({
        profile: "full",
        configOverrides: (config) => {
          config.limits.maxResponseBytes = 200;
        },
      });
      await harness.callTool("charlotte_navigate", { url: SIZE_FIXTURE });
    });

    afterAll(async () => {
      await harness.teardown();
    });

    it("degrades an over-large response to a summary with an output_file suggestion", async () => {
      const payload = parseToolJson<Record<string, any>>(
        await harness.callTool("charlotte_observe", { detail: "summary" }),
      );

      expect(payload.response_truncated).toBeDefined();
      expect(payload.response_truncated.suggestion).toContain("output_file");
      expect(payload.interactive).toBeUndefined();
      expect(typeof payload.interactive_count).toBe("number");
    });
  });

  describe("charlotte_evaluate result cap (#188)", () => {
    let harness: McpHarness;

    beforeAll(async () => {
      harness = await setupMcpHarness({
        profile: "full",
        configOverrides: (config) => {
          config.limits.maxEvaluateBytes = 500;
        },
      });
      await harness.callTool("charlotte_navigate", { url: SIZE_FIXTURE });
    });

    afterAll(async () => {
      await harness.teardown();
    });

    it("truncates an oversized evaluate result and suggests an alternative", async () => {
      const payload = parseToolJson<Record<string, any>>(
        await harness.callTool("charlotte_evaluate", {
          expression: "'x'.repeat(5000)",
        }),
      );

      expect(payload.truncated).toBeDefined();
      expect(payload.truncated.total_bytes).toBeGreaterThan(500);
      expect(String(payload.value)).toContain("[truncated]");
    });

    it("returns small results untouched", async () => {
      const payload = parseToolJson<Record<string, any>>(
        await harness.callTool("charlotte_evaluate", { expression: "1 + 1" }),
      );
      expect(payload.value).toBe(2);
      expect(payload.truncated).toBeUndefined();
    });
  });

  describe("charlotte_find output_file (#72)", () => {
    let harness: McpHarness;
    let outputDir: string;

    beforeAll(async () => {
      outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "charlotte-find-out-"));
      harness = await setupMcpHarness({
        profile: "full",
        configOverrides: (config) => {
          config.outputDir = outputDir;
        },
      });
      await harness.callTool("charlotte_navigate", { url: SIZE_FIXTURE });
    });

    afterAll(async () => {
      await harness.teardown();
      await fs.rm(outputDir, { recursive: true, force: true });
    });

    it("writes selector results to a file and returns a confirmation", async () => {
      const confirmation = parseToolJson<{ output_file: string; size: number }>(
        await harness.callTool("charlotte_find", {
          selector: "button",
          output_file: "buttons.json",
        }),
      );

      expect(confirmation.output_file).toContain("buttons.json");
      expect(confirmation.size).toBeGreaterThan(0);

      const written = JSON.parse(await fs.readFile(confirmation.output_file, "utf-8"));
      expect(Array.isArray(written)).toBe(true);
      expect(written.length).toBe(6);
    });

    it("writes interactive matches to a file", async () => {
      const confirmation = parseToolJson<{ output_file: string }>(
        await harness.callTool("charlotte_find", {
          type: "button",
          output_file: "matches.json",
        }),
      );
      const written = JSON.parse(await fs.readFile(confirmation.output_file, "utf-8"));
      expect(Array.isArray(written)).toBe(true);
    });
  });

  describe("fill_form checkbox set-semantics (#204)", () => {
    let harness: McpHarness;

    beforeAll(async () => {
      harness = await setupMcpHarness({ profile: "full" });
      await harness.callTool("charlotte_navigate", { url: SIZE_FIXTURE });
    });

    afterAll(async () => {
      await harness.teardown();
    });

    // fill_form matches element_id against the accessibility-tree interactive
    // list, so resolve checkboxes by their AX label there (not by dom- selector
    // IDs, which fill_form does not accept).
    async function checkbox(label: string): Promise<InteractiveElement> {
      const rep = parseToolJson<PageRepresentation>(
        await harness.callTool("charlotte_observe", { detail: "summary" }),
      );
      const el = rep.interactive!.find(
        (e: InteractiveElement) => e.type === "checkbox" && e.label.includes(label),
      );
      if (!el) throw new Error(`checkbox '${label}' not found in interactive list`);
      return el;
    }

    // The AX tree omits `checked` for unchecked boxes, so normalize to a boolean.
    async function isChecked(label: string): Promise<boolean> {
      return (await checkbox(label)).state.checked === true;
    }

    it("value 'true' on an already-checked box is a no-op (stays checked)", async () => {
      const before = await checkbox("Pre-checked");
      expect(before.state.checked).toBe(true);

      await harness.callTool("charlotte_fill_form", {
        fields: [{ element_id: before.id, value: "true" }],
      });

      // Set-semantics: still checked, NOT toggled off.
      expect(await isChecked("Pre-checked")).toBe(true);
    });

    it("value 'false' unchecks a checked box", async () => {
      const before = await checkbox("Pre-checked");
      expect(before.state.checked).toBe(true);

      await harness.callTool("charlotte_fill_form", {
        fields: [{ element_id: before.id, value: "false" }],
      });
      expect(await isChecked("Pre-checked")).toBe(false);
    });

    it("value 'true' checks an unchecked box", async () => {
      expect(await isChecked("Unchecked")).toBe(false);
      const before = await checkbox("Unchecked");

      await harness.callTool("charlotte_fill_form", {
        fields: [{ element_id: before.id, value: "true" }],
      });
      expect(await isChecked("Unchecked")).toBe(true);
    });
  });
});
