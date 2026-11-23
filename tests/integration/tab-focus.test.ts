import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { setupMcpHarness, type McpHarness } from "../helpers/mcp-harness.js";

/**
 * `charlotte_navigate` and the tab lifecycle keep `document.hasFocus()` on
 * the tab Charlotte believes it is working on (#310). The unit suites pin
 * the call order against mocks; this suite checks the actual contract
 * through a real two-tab browser: the active tab has focus, a background
 * tab does not, and closing the active tab moves focus to the fallback.
 */
const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures/pages");
const SIMPLE_URL = `file://${path.join(FIXTURES_DIR, "simple.html")}`;

function textPayload(result: CallToolResult): Record<string, unknown> {
  const block = (result.content ?? []).find((b) => b.type === "text");
  return JSON.parse((block as { text: string }).text) as Record<string, unknown>;
}

describe("tab focus across the tab lifecycle (#310)", () => {
  let harness: McpHarness;
  let outputDir: string;

  beforeAll(async () => {
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "charlotte-tab-focus-"));
    harness = await setupMcpHarness({
      configOverrides: (config) => {
        config.outputDir = outputDir;
      },
    });
  });

  afterAll(async () => {
    await harness?.teardown();
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });

  it("keeps document.hasFocus() on the navigated tab, not a background one", async () => {
    // Tab 1: initial harness tab, active.
    await harness.callTool("charlotte_navigate", { url: SIMPLE_URL });
    const tab1 = harness.pageManager.getActivePage();
    expect(await tab1.evaluate(() => document.hasFocus())).toBe(true);

    // Tab 2: opened via the tool, becomes active and takes focus.
    const opened = await harness.callTool("charlotte_tab_open", { url: SIMPLE_URL });
    const tab2Id = textPayload(opened).tab_id as string;
    const tab2 = harness.pageManager.getActivePage();
    expect(tab2).not.toBe(tab1);
    expect(await tab2.evaluate(() => document.hasFocus())).toBe(true);
    expect(await tab1.evaluate(() => document.hasFocus())).toBe(false);

    // Switch back to tab 1: switchTab focuses it.
    const tabsAfterOpen = textPayload(await harness.callTool("charlotte_tabs", {}));
    const tab1Id = (
      (tabsAfterOpen.tabs ?? []) as Array<{ id: string; active: boolean; url: string }>
    ).find((t) => t.id !== tab2Id)!.id;
    await harness.callTool("charlotte_tab_switch", { tab_id: tab1Id });
    expect(harness.pageManager.getActivePage()).toBe(tab1);
    expect(await tab1.evaluate(() => document.hasFocus())).toBe(true);
    expect(await tab2.evaluate(() => document.hasFocus())).toBe(false);

    // Navigating the active tab keeps focus on it while it loads.
    await harness.callTool("charlotte_navigate", { url: SIMPLE_URL });
    expect(await tab1.evaluate(() => document.hasFocus())).toBe(true);
    expect(await tab2.evaluate(() => document.hasFocus())).toBe(false);

    // Closing the active tab moves both the active pointer and focus to
    // the fallback tab, so activeTabId cannot drift from the focused tab.
    await harness.callTool("charlotte_tab_close", { tab_id: tab1Id });
    expect(harness.pageManager.getActivePage()).toBe(tab2);
    expect(await tab2.evaluate(() => document.hasFocus())).toBe(true);
  });
});
