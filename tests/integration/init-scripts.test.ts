import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import { setupMcpHarness, parseToolJson, type McpHarness } from "../helpers/mcp-harness.js";
import { pollUntil } from "../helpers/poll.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures/pages");

interface EvaluateResult {
  value: unknown;
  type: string;
}

/**
 * Persistent init scripts (issue #18): scripts registered via config or
 * `charlotte_dev_inject { persist: true }` run on every new document, in every
 * tab, before any page JS — Charlotte's `--init-script` equivalent.
 *
 * The fixtures are served over http because popup.html opens root-relative
 * URLs (`/simple.html`), which do not resolve from `file://`.
 */
describe("Init scripts (issue #18)", () => {
  let harness: McpHarness;
  let simpleUrl: string;
  let formUrl: string;
  let popupUrl: string;

  async function evaluate(expression: string): Promise<unknown> {
    const result = await harness.callTool("charlotte_evaluate", { expression });
    expect(result.isError).toBeFalsy();
    return parseToolJson<EvaluateResult>(result).value;
  }

  beforeAll(async () => {
    harness = await setupMcpHarness({
      profile: "full",
      serveDirectory: FIXTURES_DIR,
      configOverrides: (config) => {
        config.initScripts = [
          {
            source: "test",
            content: "window.__charlotteInit = (window.__charlotteInit ?? 0) + 1",
          },
        ];
      },
    });
    const baseUrl = harness.fixtureServer!.url;
    simpleUrl = `${baseUrl}/simple.html`;
    formUrl = `${baseUrl}/form.html`;
    popupUrl = `${baseUrl}/popup.html`;
  });

  afterAll(async () => {
    await harness.teardown();
  });

  it("runs a configured init script once per document in the initial tab", async () => {
    await harness.callTool("charlotte_navigate", { url: simpleUrl });
    expect(await evaluate("window.__charlotteInit")).toBe(1);

    // A fresh document gets a fresh run — the counter does not accumulate.
    await harness.callTool("charlotte_navigate", { url: formUrl });
    expect(await evaluate("window.__charlotteInit")).toBe(1);
  });

  it("applies configured init scripts to tabs opened via charlotte_tab_open", async () => {
    const openResult = await harness.callTool("charlotte_tab_open", { url: simpleUrl });
    expect(openResult.isError).toBeFalsy();
    expect(await evaluate("window.__charlotteInit")).toBe(1);
  });

  it("dev_inject js with persist:true survives navigation; without persist it does not", async () => {
    await harness.callTool("charlotte_navigate", { url: simpleUrl });

    const persistResult = await harness.callTool("charlotte_dev_inject", {
      js: "window.__persistedMarker = 'yes'",
      persist: true,
    });
    expect(persistResult.isError).toBeFalsy();
    // Immediate injection still happens on the current document.
    expect(await evaluate("window.__persistedMarker")).toBe("yes");

    await harness.callTool("charlotte_navigate", { url: formUrl });
    expect(await evaluate("window.__persistedMarker")).toBe("yes");
    // The configured script still runs alongside the persisted one.
    expect(await evaluate("window.__charlotteInit")).toBe(1);

    const ephemeralResult = await harness.callTool("charlotte_dev_inject", {
      js: "window.__ephemeralMarker = 'yes'",
    });
    expect(ephemeralResult.isError).toBeFalsy();
    expect(await evaluate("window.__ephemeralMarker")).toBe("yes");

    await harness.callTool("charlotte_navigate", { url: simpleUrl });
    expect(await evaluate("typeof window.__ephemeralMarker")).toBe("undefined");
    expect(await evaluate("window.__persistedMarker")).toBe("yes");
  });

  it("dev_inject css with persist:true is re-applied on the next document", async () => {
    await harness.callTool("charlotte_navigate", { url: simpleUrl });

    const result = await harness.callTool("charlotte_dev_inject", {
      css: "body { background-color: rgb(1, 2, 3) !important; }",
      persist: true,
    });
    expect(result.isError).toBeFalsy();
    expect(await evaluate("getComputedStyle(document.body).backgroundColor")).toBe("rgb(1, 2, 3)");

    await harness.callTool("charlotte_navigate", { url: formUrl });
    expect(await evaluate("getComputedStyle(document.body).backgroundColor")).toBe("rgb(1, 2, 3)");
  });

  it("applies init scripts to popup tabs from their next document onward", async () => {
    await harness.callTool("charlotte_navigate", { url: popupUrl });
    const pageManager = harness.deps.pageManager;
    pageManager.consumeNewTabs();
    const baselineTabCount = (await pageManager.listTabs()).length;

    // Clicking through page.evaluate: Puppeteer's page.click on a
    // target="_blank" link waits for a navigation that never happens here.
    await pageManager.getActivePage().evaluate(() => {
      document.getElementById("blank-link")!.click();
    });
    await pollUntil(async () => (await pageManager.listTabs()).length > baselineTabCount, {
      message: "popup tab was never registered",
    });
    const [popupTabId] = pageManager.consumeNewTabs();
    expect(popupTabId).toBeDefined();

    const switchResult = await harness.callTool("charlotte_tab_switch", { tab_id: popupTabId });
    expect(switchResult.isError).toBeFalsy();
    await pollUntil(async () => (await evaluate("document.readyState")) === "complete", {
      message: "popup never finished loading",
    });
    expect(await evaluate("location.pathname")).toBe("/simple.html");

    // Observed limitation: Puppeteer resumes a new popup target
    // (Runtime.runIfWaitingForDebugger) before it emits the `popup` event, so
    // the popup's *initial* document has already started by the time
    // PageManager can register scripts on it. Not asserted either way here —
    // it is a race Charlotte does not control. Every document after that one
    // is covered, which is what this pins.
    const reloadResult = await harness.callTool("charlotte_reload", {});
    expect(reloadResult.isError).toBeFalsy();
    expect(await evaluate("window.__charlotteInit")).toBe(1);
    expect(await evaluate("window.__persistedMarker")).toBe("yes");
  });
});
