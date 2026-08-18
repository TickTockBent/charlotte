import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { setupMcpHarness, type McpHarness } from "../helpers/mcp-harness.js";

/**
 * `charlotte_screenshot`'s `max_height` clip (#246).
 *
 * When a full-page capture would exceed `max_height`, the tool clips from the
 * top instead of paying Chromium's super-linear fullPage compositor cost, and
 * announces the clip in the response so a caller with no independent
 * knowledge of the page height can tell a complete capture from the top slice
 * of a much taller page.
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

function clipTextBlock(result: CallToolResult): ContentBlock | undefined {
  return contentBlocks(result).find(
    (block) => block.type === "text" && block.text?.includes('"clipped"'),
  );
}

interface ClipPayload {
  clipped: true;
  captured_height: number;
  full_page_height: number;
  message: string;
}

describe("charlotte_screenshot max_height clip (#246)", () => {
  let harness: McpHarness;

  beforeAll(async () => {
    harness = await setupMcpHarness();
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  it("clips and announces it when the page exceeds the default 2000px", async () => {
    await harness.callTool("charlotte_navigate", { url: TALL_URL });
    const result = await harness.callTool("charlotte_screenshot", { full_page: true });

    expect(result.isError).toBeFalsy();
    expect(imageBlock(result)).toBeDefined();

    const clipBlock = clipTextBlock(result);
    expect(clipBlock).toBeDefined();
    const payload = JSON.parse(clipBlock!.text!) as ClipPayload;
    expect(payload.clipped).toBe(true);
    expect(payload.captured_height).toBe(2000);
    expect(payload.full_page_height).toBeGreaterThan(2000);
    expect(payload.message).toMatch(/max_height/);
  });

  it("does not clip or add a signal when the page is below max_height", async () => {
    await harness.callTool("charlotte_navigate", { url: SIMPLE_URL });
    const result = await harness.callTool("charlotte_screenshot", { full_page: true });

    expect(result.isError).toBeFalsy();
    expect(imageBlock(result)).toBeDefined();
    expect(clipTextBlock(result)).toBeUndefined();
    // Byte-identical to the pre-#246 response shape: image only, no extra block.
    expect(contentBlocks(result)).toHaveLength(1);
  });

  it("respects an explicit max_height below the page height", async () => {
    await harness.callTool("charlotte_navigate", { url: TALL_URL });
    const result = await harness.callTool("charlotte_screenshot", {
      full_page: true,
      max_height: 4000,
    });

    expect(result.isError).toBeFalsy();
    const clipBlock = clipTextBlock(result);
    expect(clipBlock).toBeDefined();
    const payload = JSON.parse(clipBlock!.text!) as ClipPayload;
    expect(payload.captured_height).toBe(4000);
  });

  it("max_height: 16384 disables clipping entirely", async () => {
    await harness.callTool("charlotte_navigate", { url: TALL_URL });
    const result = await harness.callTool("charlotte_screenshot", {
      full_page: true,
      max_height: 16384,
    });

    // The page is taller than png can comfortably clip, but with clipping off
    // we take the real fullPage path — no clip signal should be present.
    expect(clipTextBlock(result)).toBeUndefined();
  });
});
