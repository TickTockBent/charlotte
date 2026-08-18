/**
 * One-off benchmark for #246: measure real screenshot() timing at various
 * clip heights on a controlled, reproducibly-tall fixture page, on this
 * exact environment. Not part of the vitest suite or the benchmarks/
 * harness (those measure token/character cost, not wall-clock timing) —
 * run manually with `npx tsx scripts/bench-screenshot-clip.mts` when the
 * clip-height default needs re-justifying.
 */
import puppeteer from "puppeteer";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const HEIGHTS = [900, 2000, 4000, 8000, 16384, 28000];

async function main() {
  const spacerHeight = 28000;
  const html = `<!DOCTYPE html><html><body style="margin:0"><div style="height:${spacerHeight}px;background:repeating-linear-gradient(0deg,#eee,#eee 20px,#ddd 20px,#ddd 40px)"></div></body></html>`;
  const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "charlotte-bench-"));
  const fixturePath = path.join(fixtureDir, "tall.html");
  await fs.writeFile(fixturePath, html);

  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1440, height: 900 },
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage();
    await page.goto(`file://${fixturePath}`, { waitUntil: "load" });
    const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    console.log(`Fixture page height: ${scrollHeight}px\n`);
    console.log("height(px) | time(ms) | mode");
    console.log("-----------|----------|-----");

    for (const height of HEIGHTS) {
      const clip = height < 16384 && scrollHeight > height;
      const start = performance.now();
      if (clip) {
        await page.screenshot({
          type: "png",
          clip: { x: 0, y: 0, width: 1440, height },
        });
      } else {
        await page.screenshot({ type: "png", fullPage: true });
      }
      const elapsed = performance.now() - start;
      console.log(
        `${String(height).padEnd(10)} | ${elapsed.toFixed(0).padEnd(8)} | ${clip ? "clip" : "fullPage"}`,
      );
    }
  } finally {
    await browser.close();
    await fs.rm(fixtureDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
