import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { setupMcpHarness, parseToolJson, type McpHarness } from "../helpers/mcp-harness.js";
import { pollUntil } from "../helpers/poll.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures/pages");
const SANDBOX_DIR = path.resolve(import.meta.dirname, "../sandbox");

/**
 * Real-handler smoke coverage for the tool groups that lacked any handler-level
 * test (#195): screenshot (observation), monitoring (console/requests), and
 * dev_mode (dev_serve/dev_inject/dev_audit). Each is exercised through the MCP
 * transport via `callTool`. Obscure tools (screenshot_get/_delete) get a single
 * smoke assertion as the issue allows.
 */
describe("tool-group handler smoke coverage", () => {
  let harness: McpHarness;
  let baseUrl: string;

  beforeAll(async () => {
    harness = await setupMcpHarness({ profile: "full", serveDirectory: FIXTURES_DIR });
    baseUrl = harness.fixtureServer!.url;
  });

  afterAll(async () => {
    await harness.teardown();
  });

  /** Extract the JSON text block from a multi-content (e.g. image+text) result. */
  function jsonTextBlock<T>(result: CallToolResult): T {
    const blocks = result.content as Array<{ type: string; text?: string }>;
    const textBlock = blocks.find((b) => b.type === "text" && b.text);
    expect(textBlock).toBeDefined();
    return JSON.parse(textBlock!.text!) as T;
  }

  describe("observation: screenshot group", () => {
    beforeAll(async () => {
      await harness.callTool("charlotte_navigate", { url: `${baseUrl}/simple.html` });
    });

    it("screenshot captures an image and screenshot/_get/_delete round-trip an artifact", async () => {
      // charlotte_screenshot returns an image content block; with save:true it
      // also appends an artifact metadata block.
      const shotResult = await harness.callTool("charlotte_screenshot", {
        save: true,
        full_page: false,
      });
      expect(shotResult.isError).toBeFalsy();
      const imageBlock = (shotResult.content as Array<{ type: string }>).find(
        (b) => b.type === "image",
      );
      expect(imageBlock).toBeDefined();
      const { artifact } = jsonTextBlock<{ artifact: { id: string } }>(shotResult);
      expect(artifact.id).toBeTruthy();

      // charlotte_screenshots lists it.
      const listed = parseToolJson<{ screenshots: Array<{ id: string }>; count: number }>(
        await harness.callTool("charlotte_screenshots", {}),
      );
      expect(listed.screenshots.some((s) => s.id === artifact.id)).toBe(true);

      // charlotte_screenshot_get retrieves it (image + metadata).
      const got = await harness.callTool("charlotte_screenshot_get", { id: artifact.id });
      expect(got.isError).toBeFalsy();
      expect(jsonTextBlock<{ artifact: { id: string } }>(got).artifact.id).toBe(artifact.id);

      // charlotte_screenshot_delete removes it.
      const deleted = parseToolJson<{ success: boolean; deleted: string }>(
        await harness.callTool("charlotte_screenshot_delete", { id: artifact.id }),
      );
      expect(deleted.success).toBe(true);
      expect(deleted.deleted).toBe(artifact.id);

      // It no longer appears in the listing.
      const afterDelete = parseToolJson<{ screenshots: Array<{ id: string }> }>(
        await harness.callTool("charlotte_screenshots", {}),
      );
      expect(afterDelete.screenshots.some((s) => s.id === artifact.id)).toBe(false);
    });

    it("screenshot_delete returns ELEMENT_NOT_FOUND for an unknown id", async () => {
      const result = await harness.callTool("charlotte_screenshot_delete", { id: "ss-nope" });
      expect(result.isError).toBe(true);
      const parsed = parseToolJson<{ error: { code: string } }>(result);
      expect(parsed.error.code).toBe("ELEMENT_NOT_FOUND");
    });
  });

  describe("monitoring: console + requests", () => {
    beforeAll(async () => {
      await harness.callTool("charlotte_navigate", { url: `${baseUrl}/monitoring.html` });
    });

    it("charlotte_console captures page console messages and can clear them", async () => {
      // Trigger console output from the page via the evaluate handler.
      await harness.callTool("charlotte_evaluate", {
        expression: "console.error('smoke error message'); console.log('smoke log message'); 1",
      });

      const messages = await pollUntil(
        async () => {
          const parsed = parseToolJson<{ messages: Array<{ text: string; level: string }> }>(
            await harness.callTool("charlotte_console", { level: "all" }),
          );
          return parsed.messages.some((m) => m.text.includes("smoke error message"))
            ? parsed.messages
            : null;
        },
        { message: "console message never captured" },
      );
      expect(messages.some((m) => m.text.includes("smoke log message"))).toBe(true);

      // level filter narrows results to errors only.
      const errorsOnly = parseToolJson<{ messages: Array<{ level: string }> }>(
        await harness.callTool("charlotte_console", { level: "error" }),
      );
      expect(errorsOnly.messages.every((m) => m.level === "error")).toBe(true);

      // clear:true empties the buffer.
      const cleared = parseToolJson<{ cleared: boolean }>(
        await harness.callTool("charlotte_console", { clear: true }),
      );
      expect(cleared.cleared).toBe(true);
      const afterClear = parseToolJson<{ count: number }>(
        await harness.callTool("charlotte_console", {}),
      );
      expect(afterClear.count).toBe(0);
    });

    it("charlotte_requests reports network request history", async () => {
      // The navigation to monitoring.html itself produced at least one request.
      const requests = parseToolJson<{
        requests: Array<{ url: string; method: string }>;
        count: number;
      }>(await harness.callTool("charlotte_requests", {}));
      expect(requests.count).toBeGreaterThan(0);
      expect(requests.requests.some((r) => r.url.includes("monitoring.html"))).toBe(true);

      // url_pattern filters the history.
      const filtered = parseToolJson<{ requests: Array<{ url: string }> }>(
        await harness.callTool("charlotte_requests", { url_pattern: "monitoring" }),
      );
      expect(filtered.requests.every((r) => r.url.toLowerCase().includes("monitoring"))).toBe(true);
    });
  });

  describe("dev_mode: dev_serve, dev_inject, dev_audit", () => {
    it("dev_serve serves a directory and navigates to it", async () => {
      const result = await harness.callTool("charlotte_dev_serve", {
        path: SANDBOX_DIR,
        watch: false,
      });
      expect(result.isError).toBeFalsy();
      const page = parseToolJson<{ url: string; title: string }>(result);
      // dev_serve navigates the active page to the served index.
      expect(page.url).toMatch(/^http:\/\//);
      expect(page.title).toBe("Charlotte Test Sandbox");
    });

    it("dev_inject injects CSS/JS and reflects the change", async () => {
      const result = await harness.callTool("charlotte_dev_inject", {
        js: "document.body.setAttribute('data-charlotte-injected', 'yes')",
        css: "body { outline: 1px solid red; }",
      });
      expect(result.isError).toBeFalsy();
      const injected = parseToolJson<{ value: string }>(
        await harness.callTool("charlotte_evaluate", {
          expression: "document.body.getAttribute('data-charlotte-injected')",
        }),
      );
      expect(injected.value).toBe("yes");
    });

    it("dev_inject rejects a call with neither css nor js", async () => {
      const result = await harness.callTool("charlotte_dev_inject", {});
      expect(result.isError).toBe(true);
      const parsed = parseToolJson<{ error: { code: string } }>(result);
      expect(parsed.error.code).toBe("INVALID_ARGUMENT");
    });

    it("dev_audit returns findings for the current page", async () => {
      const result = await harness.callTool("charlotte_dev_audit", { checks: ["a11y", "seo"] });
      expect(result.isError).toBeFalsy();
      // The audit returns a structured report; assert it parses and is an object.
      const report = parseToolJson<Record<string, unknown>>(result);
      expect(typeof report).toBe("object");
      expect(report).not.toBeNull();
    });
  });
});
