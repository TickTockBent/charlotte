import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { setupMcpHarness, type McpHarness } from "../helpers/mcp-harness.js";

/**
 * `charlotte_screenshot`'s retina downscale (#309).
 *
 * Browsers rendering above one image pixel per CSS pixel (a Retina Mac, an
 * emulated device with deviceScaleFactor > 1, a pinch-zoomed page) return
 * captures at physical resolution: a 1440px viewport yields a 2880px-wide
 * image. Inline captures are taken at one image pixel per CSS pixel via
 * clip.scale, so the payload stops doubling, vision models lose nothing they
 * could have seen (they downsample internally), and image pixels line up with
 * the page coordinates `charlotte_click_at` takes. The scale is measured with
 * a cheap probe capture rather than read from window.devicePixelRatio, which
 * the page can redefine and which is not the image-to-CSS ratio under mobile
 * emulation. The downscale never applies to `output_file` / `save` captures
 * (files on disk are not consumed by a vision model), `native_resolution:
 * true` opts out per call, and true 1:1 captures pass through untouched.
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

/** PNG IHDR dimensions, read straight from the header (no image library). */
function pngDimensions(buffer: Buffer): { width: number; height: number } {
  if (buffer.length < 24 || buffer.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("Not a PNG buffer");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
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

  it("captures a deviceScaleFactor 2 viewport at CSS pixels", async () => {
    await setViewport(2);
    const result = await harness.callTool("charlotte_screenshot", { full_page: false });

    expect(result.isError).toBeFalsy();
    const dims = pngDimensions(imageBuffer(result));
    expect(dims.width).toBe(800);
    expect(dims.height).toBe(600);
    // 1 image pixel per CSS pixel is the page's own coordinate system, so
    // no announcement is needed.
    expect(contentBlocks(result)).toHaveLength(1);

    // The raw capture at this DPR is twice as wide; the tool must actually
    // have shrunk it, not just claimed to.
    const rawCapture = Buffer.from((await page_screenshotBase64(harness)) as string, "base64");
    expect(pngDimensions(rawCapture).width).toBe(1600);
    expect(imageBuffer(result).length).toBeLessThan(rawCapture.length);
  });

  it("is byte-identical to a raw Puppeteer capture at DPR 1 (no processing at all)", async () => {
    await setViewport(1);
    const rawBase64 = (await page_screenshotBase64(harness)) as string;
    const result = await harness.callTool("charlotte_screenshot", { full_page: false });

    expect(result.isError).toBeFalsy();
    expect(imageBlock(result)?.data).toBe(rawBase64);
    expect(contentBlocks(result)).toHaveLength(1);
  });

  it("captures fractional DPR 1.25 at CSS pixels (no silent skip)", async () => {
    await setViewport(1.25);
    const result = await harness.callTool("charlotte_screenshot", { full_page: false });

    expect(result.isError).toBeFalsy();
    const dims = pngDimensions(imageBuffer(result));
    expect(dims.width).toBe(800);
    expect(dims.height).toBe(600);
  });

  it("ignores a page that redefines window.devicePixelRatio", async () => {
    await setViewport(2);
    const page = harness.pageManager.getActivePage();
    await page.evaluate(() => {
      Object.defineProperty(window, "devicePixelRatio", {
        get: () => 400,
        configurable: true,
      });
    });
    const result = await harness.callTool("charlotte_screenshot", { full_page: false });

    expect(result.isError).toBeFalsy();
    // The scale comes from a probe capture, not from the page's own value,
    // so the spoofed 400 cannot shrink the image to a few pixels.
    expect(pngDimensions(imageBuffer(result)).width).toBe(800);
  });

  it("respects the caller's quality on jpeg captures at DPR 2", async () => {
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
    // Both are captured at CSS pixels; the caller's quality reaches the
    // encoder, so a q15 capture is strictly smaller than a q90 one.
    expect(imageBuffer(low).length).toBeLessThan(imageBuffer(high).length);
  });

  it("captures a selector at CSS pixels via an explicit element clip", async () => {
    await setViewport(2);
    const result = await harness.callTool("charlotte_screenshot", {
      selector: "h1",
      full_page: false,
    });

    expect(result.isError).toBeFalsy();
    const dims = pngDimensions(imageBuffer(result));
    // The element's CSS box, captured 1 image px per CSS px.
    const page = harness.pageManager.getActivePage();
    const box = await (await page.$("h1"))!.boundingBox();
    expect(dims.width).toBe(Math.round(box!.width));
    expect(dims.height).toBe(Math.round(box!.height));
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
    const dims = pngDimensions(written);
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
    expect(pngDimensions(written).width).toBe(1600);
    // The inline copy in the same response keeps native resolution too, so
    // what the caller sees matches what was persisted.
    expect(pngDimensions(imageBuffer(result)).width).toBe(1600);
  });

  it("native_resolution: true opts out of the downscale", async () => {
    await setViewport(2);
    const result = await harness.callTool("charlotte_screenshot", {
      full_page: false,
      native_resolution: true,
    });

    expect(result.isError).toBeFalsy();
    const dims = pngDimensions(imageBuffer(result));
    expect(dims.width).toBe(1600);
    expect(dims.height).toBe(1200);
  });

  it("captures emulated devices at CSS layout width, not viewport width", async () => {
    // iPhone 15: 393x852 CSS at deviceScaleFactor 3. On a page without a
    // viewport meta tag the layout is 980px wide and the visual viewport
    // page scale (393/980) shrinks what the user sees, so a plain viewport
    // capture is 393 * 3 = 1179px covering 980 CSS px of layout. One image
    // pixel per CSS pixel means 980px, the page's own coordinate system.
    await harness.callTool("charlotte_viewport", { device: "iPhone 15" });
    await harness.callTool("charlotte_navigate", {
      url: `file://${path.join(FIXTURES_DIR, "mobile-no-viewport.html")}`,
    });

    const downscaled = await harness.callTool("charlotte_screenshot", { full_page: false });
    // The probed scale is rounded to ~0.1%, so allow one pixel of drift.
    const width = pngDimensions(imageBuffer(downscaled)).width;
    expect(Math.abs(width - 980)).toBeLessThanOrEqual(1);

    const native = await harness.callTool("charlotte_screenshot", {
      full_page: false,
      native_resolution: true,
    });
    expect(pngDimensions(imageBuffer(native)).width).toBe(1179);
  });

  it("captures emulated devices with a viewport meta at CSS width", async () => {
    // With a viewport meta the layout is 393 CSS px; the capture must come
    // back at 393px (one image pixel per CSS pixel), not 1179 or 980.
    await harness.callTool("charlotte_viewport", { device: "iPhone 15" });
    await harness.callTool("charlotte_navigate", { url: SIMPLE_URL });

    const result = await harness.callTool("charlotte_screenshot", { full_page: false });
    expect(pngDimensions(imageBuffer(result)).width).toBe(393);
  });

  it("max_height: 16384 disables clipping entirely, even with a downscale active", async () => {
    // At the MAX cap the clip must not truncate: the capture is the full
    // page at CSS pixels, with no clipped signal.
    await setViewport(2);
    await harness.callTool("charlotte_navigate", { url: TALL_URL });
    const result = await harness.callTool("charlotte_screenshot", {
      full_page: true,
      max_height: 16384,
    });

    expect(result.isError).toBeFalsy();
    expect(clipTextBlock(result)).toBeUndefined();
    const page = harness.pageManager.getActivePage();
    const { scrollWidth, scrollHeight } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    }));
    const dims = pngDimensions(imageBuffer(result));
    expect(dims.width).toBe(scrollWidth);
    expect(dims.height).toBe(scrollHeight);
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

    // Captured at one image pixel per CSS pixel, both dimensions are in the
    // page's own coordinate system: the width is the page's scroll width
    // and the height matches the clip signal's captured_height exactly. A
    // width cap or a lossy scale factor would break this alignment.
    const page = harness.pageManager.getActivePage();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const dims = pngDimensions(imageBuffer(result));
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
