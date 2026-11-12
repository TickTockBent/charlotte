import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import sharp from "sharp";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { setupMcpHarness, type McpHarness } from "../helpers/mcp-harness.js";

/**
 * `charlotte_screenshot`'s retina downscale (#309).
 *
 * Browsers rendering at devicePixelRatio > 1 return captures at physical
 * resolution (a 1440px viewport yields a 2880px-wide image). Inline captures
 * are downscaled to CSS pixels (1/dpr) so the payload stops doubling, vision
 * models lose nothing they could have seen, and image pixels line up with the
 * page coordinates `charlotte_click_at` takes. The downscale never applies to
 * `output_file` / `save` captures (files on disk are not consumed by a vision
 * model), `native_resolution: true` opts out per call, the re-encode keeps the
 * caller's choices (lossless PNG, explicit quality for jpeg/webp), and DPR 1
 * captures pass through untouched.
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

function imageBuffer(result: CallToolResult): Buffer {
  const block = imageBlock(result);
  if (!block?.data) throw new Error("Tool result has no image content block");
  return Buffer.from(block.data, "base64");
}

function clipTextBlock(result: CallToolResult): ContentBlock | undefined {
  return contentBlocks(result).find(
    (block) => block.type === "text" && block.text?.includes('"clipped"'),
  );
}

async function dimensions(buffer: Buffer): Promise<{ width: number; height: number }> {
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Could not read image dimensions");
  return { width: metadata.width, height: metadata.height };
}

describe("charlotte_screenshot retina downscale (#309)", () => {
  let harness: McpHarness;
  let outputDir: string;

  beforeAll(async () => {
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "charlotte-downscale-"));
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

  /** Viewport at 800x600 with the given deviceScaleFactor, on a static page. */
  async function setViewport(dsf: number): Promise<void> {
    const page = harness.pageManager.getActivePage();
    await page.setViewport({ width: 800, height: 600, deviceScaleFactor: dsf });
    await harness.callTool("charlotte_navigate", { url: SIMPLE_URL });
  }

  it("downscales a deviceScaleFactor 2 capture to CSS pixels, losslessly", async () => {
    await setViewport(2);
    const result = await harness.callTool("charlotte_screenshot", { full_page: false });

    expect(result.isError).toBeFalsy();
    const dims = await dimensions(imageBuffer(result));
    expect(dims.width).toBe(800);
    expect(dims.height).toBe(600);
    // 1/dpr is the page's own coordinate system, so no announcement is needed.
    expect(contentBlocks(result)).toHaveLength(1);

    // Lossless: the returned PNG must carry exactly the pixels of a local
    // lanczos3 downscale of the raw physical-resolution capture (a palette
    // or otherwise lossy re-encode would differ).
    const rawCapture = Buffer.from((await page_screenshotBase64(harness)) as string, "base64");
    const rawDims = await dimensions(rawCapture);
    expect(rawDims.width).toBe(1600);
    const reference = await sharp(rawCapture)
      .resize({ width: 800, kernel: "lanczos3" })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const [returnedPixels, referencePixels] = await Promise.all([
      sharp(imageBuffer(result)).raw().toBuffer(),
      sharp(reference).raw().toBuffer(),
    ]);
    expect(returnedPixels.equals(referencePixels)).toBe(true);
  });

  it("is byte-identical to a raw Puppeteer capture at DPR 1 (no processing at all)", async () => {
    await setViewport(1);
    const rawBase64 = (await page_screenshotBase64(harness)) as string;
    const result = await harness.callTool("charlotte_screenshot", { full_page: false });

    expect(result.isError).toBeFalsy();
    expect(imageBlock(result)?.data).toBe(rawBase64);
    expect(contentBlocks(result)).toHaveLength(1);
  });

  it("respects an explicit quality when re-encoding jpeg at DPR 2", async () => {
    await setViewport(2);
    const high = await harness.callTool("charlotte_screenshot", {
      full_page: false,
      format: "jpeg",
      quality: 90,
    });
    const low = await harness.callTool("charlotte_screenshot", {
      full_page: false,
      format: "jpeg",
      quality: 15,
    });

    expect(high.isError).toBeFalsy();
    expect(low.isError).toBeFalsy();
    expect((await dimensions(imageBuffer(high))).width).toBe(800);
    expect((await dimensions(imageBuffer(low))).width).toBe(800);
    // The caller's quality must survive the re-encode: a q15 capture is
    // strictly smaller than a q90 one at the same dimensions.
    expect(imageBuffer(low).length).toBeLessThan(imageBuffer(high).length);
  });

  it("never downscales output_file captures (files on disk are not for a vision model)", async () => {
    await setViewport(2);
    const result = await harness.callTool("charlotte_screenshot", {
      full_page: false,
      output_file: "native.png",
    });

    expect(result.isError).toBeFalsy();
    // output_file returns a write confirmation, no inline image.
    expect(imageBlock(result)).toBeUndefined();
    const written = await fs.readFile(path.join(outputDir, "native.png"));
    const dims = await dimensions(written);
    expect(dims.width).toBe(1600);
    expect(dims.height).toBe(1200);
  });

  it("never downscales save: true artifacts", async () => {
    await setViewport(2);
    const result = await harness.callTool("charlotte_screenshot", {
      full_page: false,
      save: true,
    });

    expect(result.isError).toBeFalsy();
    const artifactBlock = contentBlocks(result).find(
      (block) => block.type === "text" && block.text?.includes('"artifact"'),
    );
    expect(artifactBlock).toBeDefined();
    const payload = JSON.parse(artifactBlock!.text!) as { artifact: { path: string } };
    const written = await fs.readFile(payload.artifact.path);
    expect((await dimensions(written)).width).toBe(1600);
    // The inline copy in the same response keeps native resolution too, so
    // what the caller sees matches what was persisted.
    expect((await dimensions(imageBuffer(result))).width).toBe(1600);
  });

  it("native_resolution: true opts out of the downscale", async () => {
    await setViewport(2);
    const result = await harness.callTool("charlotte_screenshot", {
      full_page: false,
      native_resolution: true,
    });

    expect(result.isError).toBeFalsy();
    const dims = await dimensions(imageBuffer(result));
    expect(dims.width).toBe(1600);
    expect(dims.height).toBe(1200);
  });

  it("downscales emulated devices to CSS width; native_resolution restores physical width", async () => {
    // iPhone 15: 393x852 CSS at deviceScaleFactor 3 -> 1179x2556 physical.
    await harness.callTool("charlotte_viewport", { device: "iPhone 15" });
    await harness.callTool("charlotte_navigate", { url: SIMPLE_URL });

    const downscaled = await harness.callTool("charlotte_screenshot", { full_page: false });
    expect((await dimensions(imageBuffer(downscaled))).width).toBe(393);

    const native = await harness.callTool("charlotte_screenshot", {
      full_page: false,
      native_resolution: true,
    });
    expect((await dimensions(imageBuffer(native))).width).toBe(1179);
  });

  it("clip signal height matches the downscaled image height at DPR 2", async () => {
    await setViewport(2);
    await harness.callTool("charlotte_navigate", { url: TALL_URL });
    const result = await harness.callTool("charlotte_screenshot", { full_page: true });

    expect(result.isError).toBeFalsy();
    const clipBlock = clipTextBlock(result);
    expect(clipBlock).toBeDefined();
    const payload = JSON.parse(clipBlock!.text!) as {
      clipped: boolean;
      captured_height: number;
      full_page_height: number;
    };
    expect(payload.captured_height).toBe(2000);

    // After the 1/dpr downscale the image is back in CSS pixels, so both
    // dimensions must match the page's own coordinate system: the width is
    // the page's scroll width and the height matches the clip signal's
    // captured_height exactly. A width cap or a lossy scale factor would
    // break this alignment.
    const page = harness.pageManager.getActivePage();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const dims = await dimensions(imageBuffer(result));
    expect(dims.width).toBe(scrollWidth);
    expect(dims.height).toBe(payload.captured_height);
  });
});

/** Raw viewport screenshot through Puppeteer, matching the tool's own params. */
async function page_screenshotBase64(harness: McpHarness): Promise<string> {
  const page = harness.pageManager.getActivePage();
  return (await page.screenshot({
    type: "png",
    encoding: "base64",
    fullPage: false,
  })) as string;
}
