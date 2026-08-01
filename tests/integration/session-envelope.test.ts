import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { setupMcpHarness, type McpHarness } from "../helpers/mcp-harness.js";
import { pollUntil } from "../helpers/poll.js";
import { ALL_TOOL_NAMES } from "../../src/tools/tool-groups.js";

/**
 * Session envelope regression test (Slice 0, Step 3 — docs/remote/slice-0.md,
 * invariant I2): every tool result's JSON payload must carry a top-level
 * `session_id: "default"` field (the spec §5 schema reservation —
 * `DEFAULT_SESSION_ID` in `src/core/types.ts`).
 *
 * Extends the handler-smoke sweep pattern (`tests/integration/handler-smoke.test.ts`)
 * to cover every tool the "full" profile exposes, in one sequential script so
 * state dependencies (element IDs, form IDs, tab IDs, a pending dialog) are
 * satisfied naturally. `calledTools` is checked against `ALL_TOOL_NAMES` (plus
 * the always-on `charlotte_tools` meta-tool) at the end so a future tool added
 * without updating this script fails loudly instead of silently going
 * unchecked.
 */
const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures/pages");
const SANDBOX_DIR = path.resolve(import.meta.dirname, "../sandbox");

describe("session envelope: every tool result carries session_id", () => {
  let harness: McpHarness;
  let baseUrl: string;
  const calledTools = new Set<string>();
  let uploadDir: string;
  let uploadFile: string;

  beforeAll(async () => {
    harness = await setupMcpHarness({ profile: "full", serveDirectory: FIXTURES_DIR });
    baseUrl = harness.fixtureServer!.url;

    uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), "charlotte-session-envelope-"));
    uploadFile = path.join(uploadDir, "upload-me.txt");
    await fs.writeFile(uploadFile, "session envelope test upload");
  });

  afterAll(async () => {
    await harness.teardown();
    await fs.rm(uploadDir, { recursive: true, force: true }).catch(() => {});
  });

  /** Call a tool and record it as covered, for the completeness check at the end. */
  async function call(name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
    calledTools.add(name);
    return harness.callTool(name, args);
  }

  /** Extract the first text content block from a (possibly multi-content) result. */
  function textBlock(result: CallToolResult): string {
    const blocks = result.content as Array<{ type: string; text?: string }>;
    const block = blocks.find((b) => b.type === "text" && b.text);
    expect(block, "expected a text content block carrying the JSON payload").toBeDefined();
    return block!.text!;
  }

  /**
   * Call a tool, parse its JSON payload, and assert the session_id envelope.
   * Returns the parsed payload for tests that need to chain off it (element
   * IDs, tab IDs, etc).
   */
  async function callAndAssertEnvelope<T = Record<string, unknown>>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    const result = await call(name, args);
    const parsed = JSON.parse(textBlock(result)) as T & { session_id?: string };
    expect(parsed.session_id, `${name} result missing session_id`).toBe("default");
    return parsed as T;
  }

  interface FindElements {
    elements: Array<{ id: string; label?: string; type?: string }>;
  }

  it("every registered tool's JSON payload carries session_id: \"default\"", async () => {
    // ─── navigation (4): navigate, back, forward, reload ───
    await callAndAssertEnvelope("charlotte_navigate", {
      url: `${baseUrl}/form.html`,
      detail: "minimal",
    });
    await callAndAssertEnvelope("charlotte_navigate", {
      url: `${baseUrl}/interaction.html`,
      detail: "minimal",
    });
    await callAndAssertEnvelope("charlotte_back"); // -> form.html
    await callAndAssertEnvelope("charlotte_forward"); // -> interaction.html
    await callAndAssertEnvelope("charlotte_reload");

    // ─── observation + interaction on interaction.html ───
    await callAndAssertEnvelope("charlotte_observe", { detail: "summary" });

    const buttons = await callAndAssertEnvelope<FindElements>("charlotte_find", {
      type: "button",
    });
    const clickBtn = buttons.elements.find((el) => el.label === "Click Me");
    expect(clickBtn, "expected the interaction.html 'Click Me' button").toBeDefined();
    await callAndAssertEnvelope("charlotte_click", { element_id: clickBtn!.id });

    await callAndAssertEnvelope("charlotte_click_at", { x: 5, y: 5 });

    const textInputs = await callAndAssertEnvelope<FindElements>("charlotte_find", {
      type: "text_input",
      text: "Text Input",
    });
    expect(textInputs.elements.length).toBeGreaterThan(0);
    await callAndAssertEnvelope("charlotte_type", {
      element_id: textInputs.elements[0].id,
      text: "hello",
    });

    const selects = await callAndAssertEnvelope<FindElements>("charlotte_find", {
      type: "select",
    });
    expect(selects.elements.length).toBeGreaterThan(0);
    await callAndAssertEnvelope("charlotte_select", {
      element_id: selects.elements[0].id,
      value: "green",
    });

    const checkboxes = await callAndAssertEnvelope<FindElements>("charlotte_find", {
      type: "checkbox",
      text: "agree",
    });
    expect(checkboxes.elements.length).toBeGreaterThan(0);
    await callAndAssertEnvelope("charlotte_toggle", { element_id: checkboxes.elements[0].id });

    const hoverTargets = await callAndAssertEnvelope<FindElements>("charlotte_find", {
      text: "Hover Over Me",
    });
    expect(hoverTargets.elements.length).toBeGreaterThan(0);
    await callAndAssertEnvelope("charlotte_hover", { element_id: hoverTargets.elements[0].id });

    await callAndAssertEnvelope("charlotte_key", { key: "Escape" });
    await callAndAssertEnvelope("charlotte_scroll", { direction: "down" });
    await callAndAssertEnvelope("charlotte_wait_for", { selector: "#result", timeout: 2000 });

    const fileInputs = await callAndAssertEnvelope<FindElements>("charlotte_find", {
      type: "file_input",
      text: "Single File",
    });
    expect(fileInputs.elements.length).toBeGreaterThan(0);
    await callAndAssertEnvelope("charlotte_upload", {
      element_id: fileInputs.elements[0].id,
      paths: [uploadFile],
    });

    await callAndAssertEnvelope("charlotte_fill_form", {
      fields: [{ element_id: textInputs.elements[0].id, value: "filled via fill_form" }],
    });

    // submit-form's onsubmit handler returns false (no real navigation) — safe
    // to submit through the real handler.
    const page = await callAndAssertEnvelope<{
      forms: Array<{ id: string; submit: string | null }>;
      interactive: Array<{ id: string; label: string }>;
    }>("charlotte_observe", { detail: "summary" });
    const submitForm = page.forms.find((f) =>
      page.interactive.some((el) => el.id === f.submit && el.label.includes("Submit")),
    );
    expect(submitForm, "expected interaction.html's submit-form").toBeDefined();
    await callAndAssertEnvelope("charlotte_submit", { form_id: submitForm!.id });

    // ─── observation: screenshot family + diff ───
    const shot = await callAndAssertEnvelope<{ artifact: { id: string } }>(
      "charlotte_screenshot",
      { save: true, full_page: false },
    );
    // charlotte_screenshot without save/output_file returns a bare image
    // content block with no JSON text payload — there is nothing to carry
    // session_id, so it is exercised (for coverage) but not asserted on.
    await call("charlotte_screenshot", { full_page: false });

    await callAndAssertEnvelope("charlotte_screenshots");
    await callAndAssertEnvelope("charlotte_screenshot_get", { id: shot.artifact.id });
    await callAndAssertEnvelope("charlotte_screenshot_delete", { id: shot.artifact.id });
    await callAndAssertEnvelope("charlotte_diff");

    // ─── drag ───
    await callAndAssertEnvelope("charlotte_navigate", { url: `${baseUrl}/drag.html` });
    const dragSource = await callAndAssertEnvelope<FindElements>("charlotte_find", {
      selector: "#item-1",
    });
    const dragTarget = await callAndAssertEnvelope<FindElements>("charlotte_find", {
      selector: "#zone-b",
    });
    await callAndAssertEnvelope("charlotte_drag", {
      source_id: dragSource.elements[0].id,
      target_id: dragTarget.elements[0].id,
    });

    // ─── dialog ───
    await callAndAssertEnvelope("charlotte_navigate", { url: `${baseUrl}/dialog.html` });
    const dialogPage = harness.pageManager.getActivePage();
    const triggerPromise = dialogPage.click("#alert-btn").catch(() => {});
    await pollUntil(() => harness.pageManager.getPendingDialogInfo(), {
      message: "alert dialog never appeared",
    });
    await callAndAssertEnvelope("charlotte_dialog", { accept: true });
    await triggerPromise;

    // ─── session ───
    const initialTabs = await callAndAssertEnvelope<{ tabs: Array<{ id: string }> }>(
      "charlotte_tabs",
    );
    const originalTabId = initialTabs.tabs[0].id;

    await callAndAssertEnvelope("charlotte_get_cookies");
    const hostname = new URL(baseUrl).hostname;
    await callAndAssertEnvelope("charlotte_set_cookies", {
      cookies: [{ name: "charlotte_envelope_test", value: "1", domain: hostname }],
    });
    await callAndAssertEnvelope("charlotte_clear_cookies", { names: ["charlotte_envelope_test"] });
    await callAndAssertEnvelope("charlotte_set_headers", { headers: { "X-Envelope-Test": "1" } });
    await callAndAssertEnvelope("charlotte_configure", { auto_snapshot: "every_action" });

    const opened = await callAndAssertEnvelope<{ tab_id: string }>("charlotte_tab_open", {
      url: `${baseUrl}/simple.html`,
    });
    await callAndAssertEnvelope("charlotte_tab_switch", { tab_id: originalTabId });
    await callAndAssertEnvelope("charlotte_tab_close", { tab_id: opened.tab_id });
    await callAndAssertEnvelope("charlotte_viewport", { width: 1024, height: 768 });
    await callAndAssertEnvelope("charlotte_network", { throttle: "none" });

    // ─── evaluate + monitoring ───
    await callAndAssertEnvelope("charlotte_evaluate", { expression: "1 + 1" });
    await callAndAssertEnvelope("charlotte_console");
    await callAndAssertEnvelope("charlotte_requests");

    // ─── dev mode ───
    await callAndAssertEnvelope("charlotte_dev_serve", { path: SANDBOX_DIR, watch: false });
    await callAndAssertEnvelope("charlotte_dev_inject", { js: "1" });
    await callAndAssertEnvelope("charlotte_dev_audit", { checks: ["seo"] });

    // ─── meta-tool ───
    await callAndAssertEnvelope("charlotte_tools");

    // ─── completeness: every tool the "full" profile exposes was exercised ───
    const expectedTools = new Set([...ALL_TOOL_NAMES, "charlotte_tools"]);
    expect(calledTools).toEqual(expectedTools);
  });

  it("carries session_id on an isError result (clicking a nonexistent element)", async () => {
    const result = await call("charlotte_click", { element_id: "btn-does-not-exist" });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(textBlock(result)) as { session_id?: string; error?: unknown };
    expect(parsed.session_id).toBe("default");
    expect(parsed.error).toBeDefined();
  });
});
