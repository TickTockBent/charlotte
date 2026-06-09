import { describe, it, expect, afterEach } from "vitest";
import * as path from "node:path";
import {
  setupMcpHarness,
  parseToolJson,
  parseToolText,
  type McpHarness,
} from "../helpers/mcp-harness.js";
import { pollUntil } from "../helpers/poll.js";

const FIXTURES = path.resolve(import.meta.dirname, "../fixtures/pages");
const SIMPLE = `file://${path.join(FIXTURES, "simple.html")}`;
const SPA = `file://${path.join(FIXTURES, "spa.html")}`;
const SAME_URL_HISTORY = `file://${path.join(FIXTURES, "same-url-history.html")}`;

describe("lifecycle resilience (issues #201, #202)", () => {
  let harness: McpHarness;

  afterEach(async () => {
    await harness?.teardown();
  });

  describe("browser crash recovery (#201)", () => {
    it("recovers on the next tool call after the browser process is killed", async () => {
      harness = await setupMcpHarness({ profile: "full" });

      // Establish a working session.
      const first = await harness.callTool("charlotte_navigate", { url: SIMPLE });
      expect(parseToolJson<{ title: string }>(first).title).toBe("Simple Test Page");

      // Hard-kill the underlying Chromium process — simulates a crash. The dead
      // Page objects remain in PageManager until the disconnect hook fires.
      const browser = await harness.browserManager.getBrowser();
      const proc = browser.process();
      expect(proc).not.toBeNull();
      proc!.kill("SIGKILL");

      // Wait for the transport to actually drop and the reset hook to clear tabs.
      await pollUntil(() => !harness.browserManager.isConnected(), {
        message: "browser never reported disconnected after kill",
      });
      await pollUntil(() => !harness.pageManager.hasPages(), {
        message: "PageManager.reset() never cleared the dead tabs",
      });

      // The very next tool call must relaunch + open a fresh blank tab and
      // succeed, with NO server restart. Pre-fix this stayed wedged forever.
      const recovered = await harness.callTool("charlotte_navigate", { url: SPA });
      const payload = parseToolJson<{ url: string; title: string }>(recovered);
      expect(payload.url).toContain("spa.html");
      expect(payload.title).toContain("SPA");
      expect(harness.browserManager.isConnected()).toBe(true);
    });
  });

  describe("reload --hard (#202)", () => {
    it("hard-reloads a fast localhost page without a spurious timeout", async () => {
      harness = await setupMcpHarness({ profile: "full", serveDirectory: FIXTURES });
      const url = `${harness.fixtureServer!.url}/simple.html`;

      await harness.callTool("charlotte_navigate", { url });

      // Fast http reload: waitForNavigation must be registered BEFORE
      // Page.reload or this can hang to the 30s navigation timeout. Bound the
      // assertion well under that so a regression fails as a timeout here.
      const start = Date.now();
      const result = await harness.callTool("charlotte_reload", { hard: true });
      const elapsed = Date.now() - start;

      const payload = parseToolJson<{ url: string }>(result);
      expect(payload.url).toContain("simple.html");
      expect(elapsed).toBeLessThan(10000);
    });
  });

  describe("back/forward with same-URL history entries (#202)", () => {
    it("treats a same-URL pushState entry as a real back navigation", async () => {
      harness = await setupMcpHarness({ profile: "full" });

      await harness.callTool("charlotte_navigate", { url: SAME_URL_HISTORY });

      // Push two same-URL history entries via the page's button.
      const summary = await harness.callTool("charlotte_navigate", {
        url: SAME_URL_HISTORY,
        detail: "summary",
      });
      const buttonId = parseToolJson<{
        interactive: Array<{ id: string; type: string; label?: string }>;
      }>(summary).interactive.find((el) => el.type === "button")?.id;
      expect(buttonId).toBeTruthy();

      await harness.callTool("charlotte_click", { element_id: buttonId });
      await harness.callTool("charlotte_click", { element_id: buttonId });

      // Going back lands on a same-URL entry. Pre-fix (URL comparison) this
      // reported "No previous page in history"; now it succeeds.
      const backResult = await harness.callTool("charlotte_back", {});
      const backText = parseToolText(backResult);
      expect(backText).not.toContain("No previous page");
      const backPayload = parseToolJson<{ url: string }>(backResult);
      expect(backPayload.url).toContain("same-url-history.html");

      // Forward should also succeed and not report "No forward page".
      const forwardResult = await harness.callTool("charlotte_forward", {});
      expect(parseToolText(forwardResult)).not.toContain("No forward page");
    });

    it("still reports no previous page when history is genuinely empty", async () => {
      harness = await setupMcpHarness({ profile: "full" });

      // A fresh tab starts at about:blank, then navigates once. Going back to
      // about:blank is allowed; a SECOND back must fail cleanly.
      await harness.callTool("charlotte_navigate", { url: SIMPLE });
      await harness.callTool("charlotte_back", {}); // -> about:blank (ok)

      const result = await harness.callTool("charlotte_back", {});
      expect(parseToolText(result)).toContain("No previous page");
    });
  });
});
