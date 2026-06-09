import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as path from "node:path";
import { setupMcpHarness, parseToolJson, type McpHarness } from "../helpers/mcp-harness.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures/pages");

/**
 * Exercises the real session-group handlers (src/tools/session.ts) through the
 * MCP transport: cookies, headers, configure, tabs, viewport, network.
 *
 * Previously this file built a `_deps` bundle, never used it, and drove
 * Puppeteer's `page.setCookie`/`page.cookies` directly — i.e. it tested
 * Puppeteer, not the handlers (#195). It is reimplemented here so the handlers'
 * own serialization, validation, and effect are what is asserted. Cookies are
 * exercised over a real http origin (the harness fixture server) because CDP
 * cookie operations require http/https.
 */
describe("session-group handlers", () => {
  let harness: McpHarness;
  let baseUrl: string;
  let cookieDomain: string;

  beforeAll(async () => {
    harness = await setupMcpHarness({ profile: "full", serveDirectory: FIXTURES_DIR });
    baseUrl = harness.fixtureServer!.url;
    // The fixture server binds to 127.0.0.1, so cookies must use that host as
    // their domain or page.cookies() (matched by current-URL host) won't see them.
    cookieDomain = new URL(baseUrl).hostname;
  });

  afterAll(async () => {
    await harness.teardown();
  });

  describe("cookies", () => {
    beforeEach(async () => {
      await harness.callTool("charlotte_navigate", { url: `${baseUrl}/simple.html` });
      // Start each test from a clean slate via the handler under test.
      await harness.callTool("charlotte_clear_cookies", {});
    });

    it("set_cookies then get_cookies round-trips a single cookie", async () => {
      const setResult = await harness.callTool("charlotte_set_cookies", {
        cookies: [{ name: "test_session", value: "abc123", domain: cookieDomain }],
      });
      expect(setResult.isError).toBeFalsy();
      const setParsed = parseToolJson<{ success: boolean; cookies_set: number }>(setResult);
      expect(setParsed.success).toBe(true);
      expect(setParsed.cookies_set).toBe(1);

      const getResult = await harness.callTool("charlotte_get_cookies", {});
      expect(getResult.isError).toBeFalsy();
      const getParsed = parseToolJson<{
        cookies: Array<{ name: string; value: string }>;
        count: number;
      }>(getResult);
      const cookie = getParsed.cookies.find((c) => c.name === "test_session");
      expect(cookie).toBeDefined();
      expect(cookie!.value).toBe("abc123");
    });

    it("set_cookies sets multiple cookies at once", async () => {
      await harness.callTool("charlotte_set_cookies", {
        cookies: [
          { name: "cookie_a", value: "value_a", domain: cookieDomain },
          { name: "cookie_b", value: "value_b", domain: cookieDomain },
        ],
      });

      const getParsed = parseToolJson<{ cookies: Array<{ name: string; value: string }> }>(
        await harness.callTool("charlotte_get_cookies", {}),
      );
      expect(getParsed.cookies.find((c) => c.name === "cookie_a")?.value).toBe("value_a");
      expect(getParsed.cookies.find((c) => c.name === "cookie_b")?.value).toBe("value_b");
    });

    it("set_cookies honors the httpOnly flag", async () => {
      await harness.callTool("charlotte_set_cookies", {
        cookies: [
          { name: "http_only_cookie", value: "secret", domain: cookieDomain, httpOnly: true },
        ],
      });

      const getParsed = parseToolJson<{
        cookies: Array<{ name: string; httpOnly: boolean }>;
      }>(await harness.callTool("charlotte_get_cookies", {}));
      const cookie = getParsed.cookies.find((c) => c.name === "http_only_cookie");
      expect(cookie).toBeDefined();
      expect(cookie!.httpOnly).toBe(true);
    });

    it("clear_cookies with no filter removes all cookies", async () => {
      await harness.callTool("charlotte_set_cookies", {
        cookies: [
          { name: "to_clear_a", value: "val_a", domain: cookieDomain },
          { name: "to_clear_b", value: "val_b", domain: cookieDomain },
        ],
      });

      const clearResult = await harness.callTool("charlotte_clear_cookies", {});
      expect(clearResult.isError).toBeFalsy();
      const clearParsed = parseToolJson<{ success: boolean; cleared: number }>(clearResult);
      expect(clearParsed.success).toBe(true);
      expect(clearParsed.cleared).toBeGreaterThanOrEqual(2);

      const getParsed = parseToolJson<{ count: number }>(
        await harness.callTool("charlotte_get_cookies", {}),
      );
      expect(getParsed.count).toBe(0);
    });

    it("clear_cookies with a names filter removes only the named cookies", async () => {
      await harness.callTool("charlotte_set_cookies", {
        cookies: [
          { name: "keep_me", value: "keep", domain: cookieDomain },
          { name: "delete_me", value: "delete", domain: cookieDomain },
        ],
      });

      const clearParsed = parseToolJson<{ cleared: number; names: string[] }>(
        await harness.callTool("charlotte_clear_cookies", { names: ["delete_me"] }),
      );
      expect(clearParsed.names).toEqual(["delete_me"]);

      const getParsed = parseToolJson<{ cookies: Array<{ name: string }> }>(
        await harness.callTool("charlotte_get_cookies", {}),
      );
      const names = getParsed.cookies.map((c) => c.name);
      expect(names).toContain("keep_me");
      expect(names).not.toContain("delete_me");
    });
  });

  describe("set_headers", () => {
    it("sets extra HTTP headers and reports the header names", async () => {
      const result = await harness.callTool("charlotte_set_headers", {
        headers: { "X-Custom-Header": "test-value", Authorization: "Bearer token123" },
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseToolJson<{ success: boolean; headers_set: string[] }>(result);
      expect(parsed.success).toBe(true);
      expect(parsed.headers_set).toContain("X-Custom-Header");
      expect(parsed.headers_set).toContain("Authorization");

      // Subsequent navigation must still succeed with the headers applied.
      const navResult = await harness.callTool("charlotte_navigate", {
        url: `${baseUrl}/simple.html`,
      });
      expect(navResult.isError).toBeFalsy();
      expect(parseToolJson<{ title: string }>(navResult).title).toBe("Simple Test Page");
    });

    it("a later set_headers call replaces the prior header set", async () => {
      await harness.callTool("charlotte_set_headers", { headers: { "X-First": "first-value" } });
      const parsed = parseToolJson<{ headers_set: string[] }>(
        await harness.callTool("charlotte_set_headers", {
          headers: { "X-Second": "second-value" },
        }),
      );
      // setExtraHTTPHeaders replaces the whole set, so only the latest names appear.
      expect(parsed.headers_set).toEqual(["X-Second"]);
      const navResult = await harness.callTool("charlotte_navigate", {
        url: `${baseUrl}/simple.html`,
      });
      expect(navResult.isError).toBeFalsy();
    });
  });

  describe("configure", () => {
    it("updates snapshot depth, auto-snapshot mode, and iframe settings", async () => {
      const result = await harness.callTool("charlotte_configure", {
        snapshot_depth: 25,
        auto_snapshot: "observe_only",
        include_iframes: true,
        iframe_depth: 5,
      });
      expect(result.isError).toBeFalsy();
      const parsed = parseToolJson<{
        success: boolean;
        config: {
          snapshot_depth: number;
          auto_snapshot: string;
          include_iframes: boolean;
          iframe_depth: number;
        };
      }>(result);
      expect(parsed.config.snapshot_depth).toBe(25);
      expect(parsed.config.auto_snapshot).toBe("observe_only");
      expect(parsed.config.include_iframes).toBe(true);
      expect(parsed.config.iframe_depth).toBe(5);
      // Effect is observable on the shared deps the handler mutated.
      expect(harness.deps.config.autoSnapshot).toBe("observe_only");
      expect(harness.deps.config.includeIframes).toBe(true);

      // Restore defaults so later tests aren't affected.
      await harness.callTool("charlotte_configure", {
        snapshot_depth: 50,
        auto_snapshot: "every_action",
        include_iframes: false,
        iframe_depth: 3,
      });
    });

    it("clamps snapshot depth into the allowed range", async () => {
      const parsed = parseToolJson<{ config: { snapshot_depth: number } }>(
        await harness.callTool("charlotte_configure", { snapshot_depth: 9999 }),
      );
      expect(parsed.config.snapshot_depth).toBe(500);
      await harness.callTool("charlotte_configure", { snapshot_depth: 50 });
    });
  });

  describe("viewport", () => {
    beforeEach(async () => {
      await harness.callTool("charlotte_navigate", { url: `${baseUrl}/simple.html` });
    });

    it("applies a device preset and re-renders the page", async () => {
      const result = await harness.callTool("charlotte_viewport", { device: "mobile" });
      expect(result.isError).toBeFalsy();
      const parsed = parseToolJson<{ viewport: { width: number; height: number } }>(result);
      expect(parsed.viewport.width).toBe(393);
      expect(parsed.viewport.height).toBe(852);
    });

    it("applies explicit width/height", async () => {
      const parsed = parseToolJson<{ viewport: { width: number; height: number } }>(
        await harness.callTool("charlotte_viewport", { width: 1024, height: 768 }),
      );
      expect(parsed.viewport.width).toBe(1024);
      expect(parsed.viewport.height).toBe(768);
    });
  });

  describe("tabs", () => {
    it("tab_open, tabs, tab_switch, tab_close manage tab lifecycle", async () => {
      const openParsed = parseToolJson<{ tab_id: string; url: string }>(
        await harness.callTool("charlotte_tab_open", { url: `${baseUrl}/simple.html` }),
      );
      expect(openParsed.tab_id).toBeTruthy();

      const listParsed = parseToolJson<{
        tabs: Array<{ id: string; active: boolean }>;
      }>(await harness.callTool("charlotte_tabs", {}));
      expect(listParsed.tabs.length).toBeGreaterThanOrEqual(2);
      const newTab = listParsed.tabs.find((t) => t.id === openParsed.tab_id);
      expect(newTab).toBeDefined();
      expect(newTab!.active).toBe(true);

      // Switch back to the first tab, then close the one we opened.
      const firstTabId = listParsed.tabs.find((t) => t.id !== openParsed.tab_id)!.id;
      const switchResult = await harness.callTool("charlotte_tab_switch", { tab_id: firstTabId });
      expect(switchResult.isError).toBeFalsy();

      const closeParsed = parseToolJson<{
        success: boolean;
        closed: string;
        remaining_tabs: Array<{ id: string }>;
      }>(await harness.callTool("charlotte_tab_close", { tab_id: openParsed.tab_id }));
      expect(closeParsed.success).toBe(true);
      expect(closeParsed.closed).toBe(openParsed.tab_id);
      expect(closeParsed.remaining_tabs.some((t) => t.id === openParsed.tab_id)).toBe(false);
    });
  });

  describe("network", () => {
    it("applies a throttle preset and reports it", async () => {
      await harness.callTool("charlotte_navigate", { url: `${baseUrl}/simple.html` });
      const parsed = parseToolJson<{ success: boolean; network: { throttle?: string } }>(
        await harness.callTool("charlotte_network", { throttle: "3g" }),
      );
      expect(parsed.success).toBe(true);
      expect(parsed.network.throttle).toBe("3g");
      // Clear throttling so it doesn't slow later tests on the shared page.
      await harness.callTool("charlotte_network", { throttle: "none" });
    });

    it("block actually blocks a request through the handler, not a silent no-op (#192)", async () => {
      // The #192 fix enables the Network domain on the cached session before
      // setBlockedURLs; without it the block silently does nothing. The
      // network-block fixture exposes window.testFetch(url) so we can probe a
      // blocked request from page context via charlotte_evaluate.
      await harness.callTool("charlotte_navigate", { url: `${baseUrl}/network-block.html` });
      const blockedUrl = `${baseUrl}/simple.html`;

      await harness.callTool("charlotte_network", { block: [blockedUrl] });
      const blockedProbe = parseToolJson<{ value: { ok: boolean } }>(
        await harness.callTool("charlotte_evaluate", {
          expression: `window.testFetch(${JSON.stringify(blockedUrl)})`,
        }),
      );
      expect(blockedProbe.value.ok).toBe(false);

      // Clear the block — the same URL must become reachable again.
      await harness.callTool("charlotte_network", { block: [] });
      const unblockedProbe = parseToolJson<{ value: { ok: boolean; status: number } }>(
        await harness.callTool("charlotte_evaluate", {
          expression: `window.testFetch(${JSON.stringify(blockedUrl)})`,
        }),
      );
      expect(unblockedProbe.value.ok).toBe(true);
      expect(unblockedProbe.value.status).toBe(200);
    });
  });
});
