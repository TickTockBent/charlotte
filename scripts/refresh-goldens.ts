/**
 * Regenerate the committed golden fixtures in `tests/fixtures/golden/`.
 *
 * Run deliberately at refresh points (e.g. after a reviewed, intentional
 * output-shape change) — never in CI. `tests/integration/golden.test.ts`
 * compares a fresh capture against these committed files on every run; this
 * script is how the committed files get updated.
 *
 * Usage: npm run goldens:refresh
 */
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { setupMcpHarness } from "../tests/helpers/mcp-harness.js";
import { captureGoldenScenarios } from "../tests/helpers/golden.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "../tests/fixtures/pages");
const GOLDEN_DIR = path.resolve(import.meta.dirname, "../tests/fixtures/golden");

async function main(): Promise<void> {
  const harness = await setupMcpHarness({ profile: "full", serveDirectory: FIXTURES_DIR });

  try {
    const scenarios = await captureGoldenScenarios(harness.callTool, harness.fixtureServer!.url);

    await fs.mkdir(GOLDEN_DIR, { recursive: true });

    // Remove stale golden files so a scenario renamed/removed from the script
    // doesn't leave an orphaned committed fixture behind.
    const existingFiles = await fs.readdir(GOLDEN_DIR).catch(() => [] as string[]);
    for (const file of existingFiles) {
      if (file.endsWith(".json")) {
        await fs.rm(path.join(GOLDEN_DIR, file));
      }
    }

    for (const [scenarioName, result] of Object.entries(scenarios)) {
      const filePath = path.join(GOLDEN_DIR, `${scenarioName}.json`);
      await fs.writeFile(filePath, `${JSON.stringify(result, null, 2)}\n`, "utf-8");
      console.log(`wrote ${path.relative(process.cwd(), filePath)}`);
    }

    console.log(`\nRefreshed ${Object.keys(scenarios).length} golden fixture(s).`);
  } finally {
    await harness.teardown();
  }
}

main().catch((error) => {
  console.error("goldens:refresh failed:", error);
  process.exitCode = 1;
});
