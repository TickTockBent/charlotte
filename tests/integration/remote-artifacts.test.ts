import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { setupHttpHarness, type HttpHarness } from "../helpers/http-harness.js";
import { setupMcpHarness, type McpHarness } from "../helpers/mcp-harness.js";

/**
 * Artifact delivery over HTTP — D6/D19, invariant I8.
 *
 * In HTTP/remote mode the screenshot tools must (a) cap inline images at 256 KB
 * and refuse+steer above it, (b) never leak server filesystem paths, (c) default
 * `full_page` to viewport, and universally (d) treat an empty encode as an error.
 * The mechanism is the `remoteArtifacts` core-config flag, OFF over stdio and
 * flipped ON by HTTP startup — so the two harnesses below differ ONLY in whether
 * the flag is set, which is exactly what these tests pin.
 *
 * Navigation is over `file://` so no fixture HTTP server (or SSRF proxy) is in
 * the loop — the behavior under test is entirely in the screenshot handlers.
 */
const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures/pages");
const SIMPLE_URL = `file://${path.join(FIXTURES_DIR, "simple.html")}`;
const TALL_URL = `file://${path.join(FIXTURES_DIR, "tall.html")}`;

interface ContentBlock {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

function contentBlocks(result: CallToolResult): ContentBlock[] {
  return (result.content ?? []) as ContentBlock[];
}

function imageBlock(result: CallToolResult): ContentBlock | undefined {
  return contentBlocks(result).find((block) => block.type === "image");
}

function textBlock(result: CallToolResult): ContentBlock | undefined {
  return contentBlocks(result).find((block) => block.type === "text");
}

/** Parse the (first) text content block as JSON. */
function textJson<T = Record<string, unknown>>(result: CallToolResult): T {
  const block = textBlock(result);
  if (!block?.text) {
    throw new Error("Tool result has no text content block");
  }
  return JSON.parse(block.text) as T;
}

interface ArtifactPayload {
  session_id: string;
  artifact: { id: string; size: number; path?: string; filename: string; format: string };
}

interface ListPayload {
  session_id: string;
  count: number;
  directory?: string;
  screenshots: Array<{ id: string }>;
}

interface ErrorPayload {
  session_id: string;
  error: { code: string; message: string; suggestion?: string };
}

describe("Remote artifact delivery (D6/D19, I8)", () => {
  describe("I8 — remote mode omits server filesystem paths", () => {
    let harness: HttpHarness;

    beforeAll(async () => {
      harness = await setupHttpHarness();
      await harness.callTool("charlotte_navigate", { url: SIMPLE_URL });
    });

    afterAll(async () => {
      await harness?.teardown();
    });

    it("charlotte_screenshot(save) returns artifact metadata with NO path", async () => {
      const result = await harness.callTool("charlotte_screenshot", { save: true });
      expect(result.isError).toBeFalsy();

      const payload = textJson<ArtifactPayload>(result);
      expect(payload.artifact.id).toBeTruthy();
      expect(payload.artifact.size).toBeGreaterThan(0);
      // The load-bearing assertion: no server path leaks over HTTP.
      expect(payload.artifact).not.toHaveProperty("path");
    });

    it("charlotte_screenshot_get returns the image with NO path", async () => {
      const saved = await harness.callTool("charlotte_screenshot", { save: true });
      const savedId = textJson<ArtifactPayload>(saved).artifact.id;

      const result = await harness.callTool("charlotte_screenshot_get", { id: savedId });
      expect(result.isError).toBeFalsy();
      expect(imageBlock(result)).toBeDefined();

      const payload = textJson<ArtifactPayload>(result);
      expect(payload.artifact.id).toBe(savedId);
      expect(payload.artifact).not.toHaveProperty("path");
    });

    it("charlotte_screenshots list returns NO directory", async () => {
      const result = await harness.callTool("charlotte_screenshots", {});
      const payload = textJson<ListPayload>(result);
      expect(payload.count).toBeGreaterThan(0);
      expect(payload).not.toHaveProperty("directory");
    });
  });

  describe("stdio parity — local mode keeps paths (no regression)", () => {
    let harness: McpHarness;

    beforeAll(async () => {
      harness = await setupMcpHarness();
      await harness.callTool("charlotte_navigate", { url: SIMPLE_URL });
    });

    afterAll(async () => {
      await harness?.teardown();
    });

    it("charlotte_screenshot(save) still returns a server path", async () => {
      const result = await harness.callTool("charlotte_screenshot", { save: true });
      const payload = textJson<ArtifactPayload>(result);
      expect(payload.artifact.path).toBeTruthy();
    });

    it("charlotte_screenshot_get still returns a server path", async () => {
      const saved = await harness.callTool("charlotte_screenshot", { save: true });
      const savedId = textJson<ArtifactPayload>(saved).artifact.id;

      const result = await harness.callTool("charlotte_screenshot_get", { id: savedId });
      const payload = textJson<ArtifactPayload>(result);
      expect(payload.artifact.path).toBeTruthy();
    });

    it("charlotte_screenshots list still returns a directory", async () => {
      const result = await harness.callTool("charlotte_screenshots", {});
      const payload = textJson<ListPayload>(result);
      expect(payload.directory).toBeTruthy();
    });
  });

  describe("full_page default flips to viewport in remote mode (D6 §3)", () => {
    let harness: HttpHarness;

    beforeAll(async () => {
      harness = await setupHttpHarness();
      await harness.callTool("charlotte_navigate", { url: TALL_URL });
    });

    afterAll(async () => {
      await harness?.teardown();
    });

    it("full_page UNSET returns an inline image (viewport capture, inline-safe)", async () => {
      const result = await harness.callTool("charlotte_screenshot", {});
      expect(result.isError).toBeFalsy();
      const image = imageBlock(result);
      expect(image).toBeDefined();
      expect(image?.data?.length ?? 0).toBeGreaterThan(0);
    });

    it("full_page:true over-caps (proves the default was viewport, not full page)", async () => {
      // max_height: 16384 disables the default 2000px clip (screenshot-clip.test.ts)
      // so this exercises the true full-page size, not a clipped one.
      const result = await harness.callTool("charlotte_screenshot", {
        full_page: true,
        max_height: 16384,
      });
      expect(result.isError).toBe(true);
      expect(imageBlock(result)).toBeUndefined();
    });
  });

  describe("over-cap refuse+steer in remote mode (D6 §1/§2)", () => {
    let harness: HttpHarness;

    beforeAll(async () => {
      harness = await setupHttpHarness();
      await harness.callTool("charlotte_navigate", { url: TALL_URL });
    });

    afterAll(async () => {
      await harness?.teardown();
    });

    it("full_page:true refuses with a sized, actionable error and no image/path", async () => {
      // max_height: 16384 disables the default 2000px clip (screenshot-clip.test.ts)
      // so the capture is genuinely over-cap rather than shrunk by clipping.
      const result = await harness.callTool("charlotte_screenshot", {
        full_page: true,
        max_height: 16384,
      });
      expect(result.isError).toBe(true);

      // No bytes blown, no path leaked.
      expect(imageBlock(result)).toBeUndefined();

      const payload = textJson<ErrorPayload>(result);
      expect(payload.error.message).toMatch(/KB/);
      expect(payload.error.message).toMatch(/inline limit/);
      // Steers toward the concrete recovery paths.
      expect(payload.error.suggestion).toMatch(/full_page: false|selector|region/);
      expect(JSON.stringify(payload)).not.toMatch(/tall\.html|\/tmp|screenshotDir/);
      expect(payload.error).not.toHaveProperty("path");
    });
  });

  describe("over-cap does NOT fire over stdio (cap is remote-only)", () => {
    let harness: McpHarness;

    beforeAll(async () => {
      harness = await setupMcpHarness();
      await harness.callTool("charlotte_navigate", { url: TALL_URL });
    });

    afterAll(async () => {
      await harness?.teardown();
    });

    it("full_page:true returns the (large) inline image, no refusal", async () => {
      // max_height: 16384 disables the default 2000px clip (screenshot-clip.test.ts)
      // so the capture is genuinely the full page, not shrunk by clipping.
      const result = await harness.callTool("charlotte_screenshot", {
        full_page: true,
        max_height: 16384,
      });
      expect(result.isError).toBeFalsy();
      const image = imageBlock(result);
      expect(image).toBeDefined();
      // Genuinely over the 256 KB inline cap — proving the cap simply is not applied.
      const rawBytes = Buffer.from(image?.data ?? "", "base64").length;
      expect(rawBytes).toBeGreaterThan(256_000);
    });
  });

  describe("empty encode is an error in BOTH modes (D6 §5, universal)", () => {
    let harness: McpHarness;

    beforeAll(async () => {
      harness = await setupMcpHarness();
      await harness.callTool("charlotte_navigate", { url: TALL_URL });
    });

    afterAll(async () => {
      await harness?.teardown();
    });

    it("webp full_page on a >16,383px page errors, not a success with empty image data", async () => {
      // max_height: 16384 disables the default 2000px clip (screenshot-clip.test.ts)
      // so this exercises the underlying webp encode cap rather than the clip path.
      const result = await harness.callTool("charlotte_screenshot", {
        format: "webp",
        full_page: true,
        max_height: 16384,
      });

      expect(result.isError).toBe(true);
      // Specifically NOT a success carrying an empty image block.
      const image = imageBlock(result);
      expect(image).toBeUndefined();

      const payload = textJson<ErrorPayload>(result);
      expect(payload.error.message).toMatch(/no data|produced no/i);
    });
  });
});
