import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { setupCoreDirectHarness, type CoreDirectHarness } from "../helpers/core-direct.js";
import { captureGoldenScenarios } from "../helpers/golden.js";

/**
 * Parity-harness scaffold (Slice 0, Step 3 — docs/remote/slice-0.md).
 *
 * Runs the exact same golden scenario script from `tests/helpers/golden.ts`
 * through the core-direct execution mode (`tests/helpers/core-direct.ts`:
 * `ToolDefinition.handler` invoked directly, no `McpServer`, no transport) and
 * compares the normalized result against the SAME committed golden fixtures
 * in `tests/fixtures/golden/` that `tests/integration/golden.test.ts` compares
 * the real MCP-transport path against.
 *
 * Since both paths are diffed against one shared, committed golden set, a
 * pass here transitively proves core-direct output is byte-identical to the
 * MCP-registration-layer output — the stdio-vs-core half of the future I3
 * parity law (the HTTP half arrives in slice 1). Any divergence beyond the
 * (refreshed) `session_id` field is a rule-0.1 finding: the "thin adapter"
 * premise (stdio.ts adds nothing to a result) would be false.
 */
const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures/pages");
const GOLDEN_DIR = path.resolve(import.meta.dirname, "../fixtures/golden");

describe("parity: core-direct execution matches the committed goldens", () => {
  let harness: CoreDirectHarness;

  beforeAll(async () => {
    harness = await setupCoreDirectHarness({ serveDirectory: FIXTURES_DIR });
  });

  afterAll(async () => {
    await harness.teardown();
  });

  it("matches every committed golden fixture via direct handler invocation (no MCP transport)", async () => {
    const scenarios = await captureGoldenScenarios(harness.callTool, harness.fixtureServer!.url);

    const goldenFiles = (await fs.readdir(GOLDEN_DIR)).filter((file) => file.endsWith(".json"));
    expect(goldenFiles.length).toBeGreaterThan(0);

    for (const file of goldenFiles) {
      const scenarioName = file.replace(/\.json$/, "");
      const committedRaw = await fs.readFile(path.join(GOLDEN_DIR, file), "utf-8");
      const committed: unknown = JSON.parse(committedRaw);
      const fresh = scenarios[scenarioName];

      expect(
        fresh,
        `committed golden file "${file}" has no matching scenario in captureGoldenScenarios() output`,
      ).toBeDefined();
      expect(
        fresh,
        `core-direct output for scenario "${scenarioName}" diverges from the MCP-path golden — ` +
          "the registration/transport layer is not \"thin\" (rule-0.1 finding).",
      ).toEqual(committed);
    }

    for (const scenarioName of Object.keys(scenarios)) {
      expect(
        goldenFiles,
        `scenario "${scenarioName}" was captured but has no committed golden file — run npm run goldens:refresh`,
      ).toContain(`${scenarioName}.json`);
    }
  });
});
