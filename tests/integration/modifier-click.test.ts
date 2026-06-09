import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as path from "node:path";
import { setupMcpHarness, parseToolJson, type McpHarness } from "../helpers/mcp-harness.js";

const MODIFIER_CLICK_FIXTURE = `file://${path.resolve(import.meta.dirname, "../fixtures/pages/modifier-click.html")}`;

/**
 * Exercises the real `charlotte_click` handler's modifier + click-type support
 * (src/tools/interaction.ts → clickElementByBackendNodeId).
 *
 * Previously this file declared a `clickWithModifiers` helper documented as
 * "Mirrors the production clickElementByBackendNodeId function" and asserted
 * the *mirror* worked — the handler itself was never invoked (#195). Here the
 * same behaviors (single modifiers, combined modifiers, modifiers with
 * right/double click) are pinned by calling charlotte_click and reading the
 * fixture's #result via charlotte_evaluate.
 */
describe("charlotte_click modifier + click-type handling", () => {
  let harness: McpHarness;

  beforeAll(async () => {
    harness = await setupMcpHarness({ profile: "full" });
  });

  afterAll(async () => {
    await harness.teardown();
  });

  beforeEach(async () => {
    await harness.callTool("charlotte_navigate", { url: MODIFIER_CLICK_FIXTURE });
  });

  /** Resolve the modifier test button's Charlotte element ID via charlotte_find. */
  async function modifierButtonId(): Promise<string> {
    const matches = parseToolJson<Array<{ id: string; label: string }>>(
      await harness.callTool("charlotte_find", { text: "modifier test button" }),
    );
    expect(matches.length).toBeGreaterThan(0);
    return matches[0].id;
  }

  /** Read the fixture's #result text via the evaluate handler. */
  async function resultText(): Promise<string> {
    const parsed = parseToolJson<{ value: string }>(
      await harness.callTool("charlotte_evaluate", {
        expression: "document.getElementById('result')?.textContent ?? ''",
      }),
    );
    return parsed.value;
  }

  async function clickButton(args: Record<string, unknown>): Promise<void> {
    const elementId = await modifierButtonId();
    const result = await harness.callTool("charlotte_click", { element_id: elementId, ...args });
    expect(result.isError).toBeFalsy();
  }

  describe("single modifier clicks", () => {
    it("clicks without modifiers and reports none", async () => {
      await clickButton({});
      expect(await resultText()).toBe("clicked:none");
    });

    it("ctrl+click sets ctrlKey on the event", async () => {
      await clickButton({ modifiers: ["ctrl"] });
      expect(await resultText()).toBe("clicked:ctrl");
    });

    it("shift+click sets shiftKey on the event", async () => {
      await clickButton({ modifiers: ["shift"] });
      expect(await resultText()).toBe("clicked:shift");
    });

    it("alt+click sets altKey on the event", async () => {
      await clickButton({ modifiers: ["alt"] });
      expect(await resultText()).toBe("clicked:alt");
    });

    it("meta+click sets metaKey on the event", async () => {
      await clickButton({ modifiers: ["meta"] });
      expect(await resultText()).toBe("clicked:meta");
    });
  });

  describe("combined modifier clicks", () => {
    it("ctrl+shift+click sets both modifier keys", async () => {
      await clickButton({ modifiers: ["ctrl", "shift"] });
      expect(await resultText()).toBe("clicked:ctrl+shift");
    });

    it("alt+shift+click sets both modifier keys", async () => {
      await clickButton({ modifiers: ["alt", "shift"] });
      expect(await resultText()).toBe("clicked:alt+shift");
    });
  });

  describe("modifiers with different click types", () => {
    it("ctrl+right-click sets ctrlKey on contextmenu event", async () => {
      await clickButton({ click_type: "right", modifiers: ["ctrl"] });
      expect(await resultText()).toBe("rightclicked:ctrl");
    });

    it("shift+double-click sets shiftKey on dblclick event", async () => {
      await clickButton({ click_type: "double", modifiers: ["shift"] });
      expect(await resultText()).toBe("dblclicked:shift");
    });
  });
});
