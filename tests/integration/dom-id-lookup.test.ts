/**
 * #220: selector-mode (`dom-`) IDs from charlotte_find never appear in
 * `representation.interactive`, so tools that looked elements up there only
 * mis-handled them. These tests drive the real handlers through the MCP
 * harness to pin the fixed behavior for charlotte_toggle and the `near`
 * spatial filter.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as path from "node:path";
import {
  setupMcpHarness,
  parseToolJson,
  parseToolText,
  type McpHarness,
} from "../helpers/mcp-harness.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures/pages");
const INTERACTION_FIXTURE = `file://${path.join(FIXTURES_DIR, "interaction.html")}`;
const SIMPLE_FIXTURE = `file://${path.join(FIXTURES_DIR, "simple.html")}`;

interface FindElementsPayload {
  elements: Array<{ id: string; tag?: string; type?: string; bounds?: unknown }>;
}

interface ErrorPayload {
  error: { code: string; message: string; suggestion?: string };
}

describe("#220 dom- ID lookup paths", () => {
  let harness: McpHarness;

  beforeAll(async () => {
    harness = await setupMcpHarness({ profile: "full" });
  });

  afterAll(async () => {
    await harness.teardown();
  });

  /** Run charlotte_find in selector mode and return the first dom- ID. */
  async function findDomId(selector: string): Promise<string> {
    const { elements } = parseToolJson<FindElementsPayload>(
      await harness.callTool("charlotte_find", { selector }),
    );
    expect(elements.length, `selector '${selector}' must match`).toBeGreaterThan(0);
    const domId = elements[0].id;
    expect(domId.startsWith("dom-")).toBe(true);
    return domId;
  }

  async function currentUrl(): Promise<string> {
    return harness.pageManager.getActivePage().url();
  }

  describe("charlotte_toggle", () => {
    it("rejects a dom- ID pointing at a link with INVALID_ARGUMENT and does not follow it", async () => {
      await harness.callTool("charlotte_navigate", { url: SIMPLE_FIXTURE });
      const urlBeforeToggle = await currentUrl();
      const linkDomId = await findDomId('a[href="/dashboard"]');

      const result = await harness.callTool("charlotte_toggle", { element_id: linkDomId });

      expect(result.isError).toBe(true);
      const payload = parseToolJson<ErrorPayload>(result);
      expect(payload.error.code).toBe("INVALID_ARGUMENT");
      expect(payload.error.message).toContain("not a checkbox/radio/switch");
      expect(payload.error.suggestion).toContain("charlotte_click");
      expect(await currentUrl()).toBe(urlBeforeToggle);
    });

    it("rejects a dom- ID pointing at a button with INVALID_ARGUMENT", async () => {
      await harness.callTool("charlotte_navigate", { url: INTERACTION_FIXTURE });
      const buttonDomId = await findDomId("#click-btn");

      const result = await harness.callTool("charlotte_toggle", { element_id: buttonDomId });

      expect(result.isError).toBe(true);
      expect(parseToolJson<ErrorPayload>(result).error.code).toBe("INVALID_ARGUMENT");
      // The button's onclick writes "Button clicked" into #result — it must not have fired.
      const resultText = await harness.pageManager
        .getActivePage()
        .evaluate(() => document.getElementById("result")?.textContent ?? "");
      expect(resultText).not.toContain("Button clicked");
    });

    it("toggles a checkbox via its dom- ID and flips the checked state", async () => {
      await harness.callTool("charlotte_navigate", { url: INTERACTION_FIXTURE });
      const page = harness.pageManager.getActivePage();
      const readChecked = () =>
        page.evaluate(
          () => (document.getElementById("agree-checkbox") as HTMLInputElement).checked,
        );
      expect(await readChecked()).toBe(false);

      const checkboxDomId = await findDomId("#agree-checkbox");
      const result = await harness.callTool("charlotte_toggle", { element_id: checkboxDomId });

      expect(result.isError).toBeFalsy();
      expect(await readChecked()).toBe(true);
    });
  });

  describe("charlotte_find spatial filters", () => {
    beforeEach(async () => {
      await harness.callTool("charlotte_navigate", { url: INTERACTION_FIXTURE });
    });

    it("near: accepts a dom- ID of a laid-out element as the reference", async () => {
      const anchorDomId = await findDomId("#click-btn");

      const result = await harness.callTool("charlotte_find", {
        type: "button",
        near: anchorDomId,
      });

      expect(result.isError, parseToolText(result)).toBeFalsy();
      const { elements } = parseToolJson<FindElementsPayload>(result);
      // The fixture's click buttons sit side by side, so at least the
      // neighbouring "Double Click Me" button must be within range.
      expect(elements.length).toBeGreaterThan(0);
      expect(elements.every((element) => element.bounds != null)).toBe(true);
    });

    it("within: accepts a dom- ID of a container as the reference", async () => {
      const containerDomId = await findDomId("body");

      const result = await harness.callTool("charlotte_find", {
        type: "button",
        within: containerDomId,
      });

      expect(result.isError, parseToolText(result)).toBeFalsy();
      const { elements } = parseToolJson<FindElementsPayload>(result);
      expect(elements.length).toBeGreaterThan(0);
    });

    it("near: reports an unknown reference ID as ELEMENT_NOT_FOUND", async () => {
      const result = await harness.callTool("charlotte_find", {
        type: "button",
        near: "btn-deadbeef",
      });

      expect(result.isError).toBe(true);
      const payload = parseToolJson<ErrorPayload>(result);
      expect(payload.error.code).toBe("ELEMENT_NOT_FOUND");
      expect(payload.error.message).toContain("not found");
      expect(payload.error.message).not.toContain("has no bounds");
    });
  });
});
