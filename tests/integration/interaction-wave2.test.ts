/**
 * Wave 2 interaction-tool correctness regressions.
 *
 * Covers, through the real MCP tool handlers via the shared harness:
 *  - #186: charlotte_select must error (not silently succeed) on a missing option.
 *  - #189: charlotte_submit must natively submit a plain HTML form (requestSubmit),
 *          not just dispatch a no-op submit event.
 *  - #182: dialog-race guard on select / toggle / type+press_enter / key(Enter) /
 *          fill_form / drag — these must surface pending_dialog instead of hanging.
 *  - #185: charlotte_drag must use fresh source coordinates after scrolling the
 *          target into view.
 *
 * Each test that exercises a dialog races the tool call against a timeout: on the
 * old (unguarded) code the tool would block until the client timeout, so a 5s
 * timeout race that resolves "timeout" is itself the failing assertion.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as path from "node:path";
import { setupMcpHarness, parseToolJson, type McpHarness } from "../helpers/mcp-harness.js";
import { pollUntil } from "../helpers/poll.js";
import type { PageRepresentation } from "../../src/types/page-representation.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures/pages");
const INTERACTION_FIXTURE = `file://${path.join(FIXTURES_DIR, "interaction.html")}`;
const DIALOG_FIXTURE = `file://${path.join(FIXTURES_DIR, "interaction-dialog.html")}`;
const DRAG_SCROLL_FIXTURE = `file://${path.join(FIXTURES_DIR, "drag-scroll.html")}`;

/** Run a tool call but never hang the suite: a still-blocking call resolves to "timeout". */
async function callOrTimeout(
  promise: Promise<unknown>,
  ms = 5000,
): Promise<"completed" | "timeout"> {
  const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms));
  return Promise.race([promise.then(() => "completed" as const), timeout]);
}

function findId(
  rep: PageRepresentation,
  predicate: (label: string, type: string) => boolean,
): string {
  const element = rep.interactive.find((el) => predicate(el.label, el.type));
  if (!element) {
    throw new Error(
      `No interactive element matched. Available: ${rep.interactive
        .map((el) => `${el.type}:${el.label}`)
        .join(", ")}`,
    );
  }
  return element.id;
}

describe("Wave 2 interaction correctness", () => {
  let harness: McpHarness;

  beforeAll(async () => {
    harness = await setupMcpHarness({ profile: "full" });
  });

  afterAll(async () => {
    await harness.teardown();
  });

  /** Drain a pending dialog so it does not leak into the next test. */
  async function drainPendingDialog(): Promise<void> {
    for (let guard = 0; guard < 10; guard++) {
      const raw = harness.pageManager.getPendingDialog();
      if (!raw) break;
      await raw.accept().catch(() => {});
      harness.pageManager.clearPendingDialog();
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  // ─── #186: select errors on a missing option ───
  describe("charlotte_select missing option (#186)", () => {
    beforeEach(async () => {
      await harness.callTool("charlotte_navigate", { url: INTERACTION_FIXTURE });
    });

    it("returns an error (not silent success) when the option does not exist", async () => {
      const rep = parseToolJson<PageRepresentation>(
        await harness.callTool("charlotte_observe", { detail: "summary" }),
      );
      const selectId = findId(rep, (label, type) => type === "select" && label.includes("Color"));

      const result = await harness.callTool("charlotte_select", {
        element_id: selectId,
        value: "chartreuse", // not an option
      });

      expect(result.isError).toBe(true);
      const payload = parseToolJson<{
        error: { code: string; message: string; suggestion?: string };
      }>(result);
      expect(payload.error.code).toBe("ELEMENT_NOT_FOUND");
      expect(payload.error.message).toContain("chartreuse");
      // Available options are surfaced as a suggestion.
      expect(payload.error.suggestion).toContain("green");
    });

    it("succeeds and reflects the selected value when the option exists", async () => {
      const rep = parseToolJson<PageRepresentation>(
        await harness.callTool("charlotte_observe", { detail: "summary" }),
      );
      const selectId = findId(rep, (label, type) => type === "select" && label.includes("Color"));

      const result = await harness.callTool("charlotte_select", {
        element_id: selectId,
        value: "green",
      });
      expect(result.isError).toBeFalsy();

      const selectedValue = await harness.pageManager
        .getActivePage()
        .evaluate(
          () => (document.getElementById("color-select") as HTMLSelectElement)?.value ?? "",
        );
      expect(selectedValue).toBe("green");
    });
  });

  // ─── #189: plain form submit performs native submission ───
  describe("charlotte_submit plain form (#189)", () => {
    let formHarness: McpHarness;

    beforeAll(async () => {
      formHarness = await setupMcpHarness({ profile: "full", serveDirectory: FIXTURES_DIR });
    });

    afterAll(async () => {
      await formHarness.teardown();
    });

    it("navigates the page (native submission) for a JS-handler-less form", async () => {
      const baseUrl = formHarness.fixtureServer!.url;
      await formHarness.callTool("charlotte_navigate", { url: `${baseUrl}/plain-form.html` });

      const rep = parseToolJson<PageRepresentation>(
        await formHarness.callTool("charlotte_observe", { detail: "summary" }),
      );
      const form = rep.forms.find((f) => f.id === "plain-form" || f.fields.length > 0);
      expect(form).toBeDefined();
      // The fixture deliberately has no submit button in the AX tree → fallback path.
      expect(form!.submit).toBeNull();

      await formHarness.callTool("charlotte_submit", { form_id: form!.id });

      // The form action is result.html; native submission must navigate there.
      // Dispatching a bare submit Event (old behavior) would leave us on plain-form.html.
      const finalUrl = await pollUntil(
        () => {
          const url = formHarness.pageManager.getActivePage().url();
          return url.includes("result.html") ? url : null;
        },
        { message: "form did not navigate to result.html — native submission did not fire" },
      );
      expect(finalUrl).toContain("result.html");
    });
  });

  // ─── #182: dialog-race guard on the previously-bare action tools ───
  describe("dialog-race guard (#182)", () => {
    beforeEach(async () => {
      await harness.callTool("charlotte_navigate", { url: DIALOG_FIXTURE });
    });

    async function assertDialogGuarded(
      toolCall: () => Promise<unknown>,
      expectedMessageFragment: string,
    ): Promise<void> {
      const outcome = await callOrTimeout(toolCall());
      expect(outcome).toBe("completed");

      const dialog = harness.pageManager.getPendingDialogInfo();
      expect(dialog).not.toBeNull();
      expect(dialog!.message).toContain(expectedMessageFragment);

      await drainPendingDialog();
    }

    it("charlotte_select does not hang when the change handler opens a dialog", async () => {
      const rep = parseToolJson<PageRepresentation>(
        await harness.callTool("charlotte_observe", { detail: "summary" }),
      );
      const selectId = findId(rep, (_label, type) => type === "select");

      await assertDialogGuarded(
        () => harness.callTool("charlotte_select", { element_id: selectId, value: "red" }),
        "select changed: red",
      );
    });

    it("charlotte_toggle does not hang when the change handler opens a dialog", async () => {
      const rep = parseToolJson<PageRepresentation>(
        await harness.callTool("charlotte_observe", { detail: "summary" }),
      );
      const checkboxId = findId(rep, (_label, type) => type === "checkbox");

      await assertDialogGuarded(
        () => harness.callTool("charlotte_toggle", { element_id: checkboxId }),
        "toggled:",
      );
    });

    it("charlotte_type with press_enter does not hang when Enter opens a dialog", async () => {
      const rep = parseToolJson<PageRepresentation>(
        await harness.callTool("charlotte_observe", { detail: "summary" }),
      );
      const inputId = findId(
        rep,
        (label, type) => type === "text_input" && label.includes("Press Enter"),
      );

      await assertDialogGuarded(
        () =>
          harness.callTool("charlotte_type", {
            element_id: inputId,
            text: "hi",
            press_enter: true,
          }),
        "enter pressed",
      );
    });

    it("charlotte_key Enter does not hang when a keydown handler opens a dialog", async () => {
      const rep = parseToolJson<PageRepresentation>(
        await harness.callTool("charlotte_observe", { detail: "summary" }),
      );
      const inputId = findId(
        rep,
        (label, type) => type === "text_input" && label.includes("Press Enter"),
      );

      await assertDialogGuarded(
        () => harness.callTool("charlotte_key", { key: "Enter", element_id: inputId }),
        "enter pressed",
      );
    });

    it("charlotte_fill_form does not hang when an input handler opens a dialog", async () => {
      const rep = parseToolJson<PageRepresentation>(
        await harness.callTool("charlotte_observe", { detail: "summary" }),
      );
      const bioId = findId(rep, (label, type) => type === "text_input" && label.includes("Bio"));

      await assertDialogGuarded(
        () =>
          harness.callTool("charlotte_fill_form", {
            fields: [{ element_id: bioId, value: "x" }],
          }),
        "input:",
      );
    });

    it("charlotte_drag does not hang when the drop handler opens a dialog", async () => {
      // The drag source/target are non-AX-tree divs; charlotte_drag needs element
      // IDs. charlotte_find selector mode returns durable dom- IDs.
      const sourceMatches = parseToolJson<Array<{ id: string }>>(
        await harness.callTool("charlotte_find", { selector: "#drag-source" }),
      );
      const targetMatches = parseToolJson<Array<{ id: string }>>(
        await harness.callTool("charlotte_find", { selector: "#drag-target" }),
      );
      const sourceId = sourceMatches[0].id;
      const targetId = targetMatches[0].id;

      await assertDialogGuarded(
        () => harness.callTool("charlotte_drag", { source_id: sourceId, target_id: targetId }),
        "dropped",
      );
    });
  });

  // ─── #185: drag re-reads source coordinates after scrolling the target ───
  describe("charlotte_drag with scroll (#185)", () => {
    it("drops the source into a target that is far below the fold", async () => {
      await harness.callTool("charlotte_navigate", { url: DRAG_SCROLL_FIXTURE });

      const sourceMatches = parseToolJson<Array<{ id: string }>>(
        await harness.callTool("charlotte_find", { selector: "#item-1" }),
      );
      const targetMatches = parseToolJson<Array<{ id: string }>>(
        await harness.callTool("charlotte_find", { selector: "#zone-b" }),
      );

      await harness.callTool("charlotte_drag", {
        source_id: sourceMatches[0].id,
        target_id: targetMatches[0].id,
      });

      // On the old code, scrolling the far-below target into view moved the page
      // and the press-down landed on stale source coordinates, so the drop never
      // fired. The result text confirms the item was dropped into zone-b.
      const resultText = await pollUntil(
        async () => {
          const text = await harness.pageManager
            .getActivePage()
            .evaluate(() => document.getElementById("result")?.textContent ?? "");
          return text.includes("dropped:") ? text : null;
        },
        { message: "drag did not drop the item into the scrolled-to target" },
      );
      expect(resultText).toContain("dropped: item-1 into zone-b");
    });
  });
});
