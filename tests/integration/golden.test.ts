import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { setupMcpHarness, parseToolJson, type McpHarness } from "../helpers/mcp-harness.js";
import { captureGoldenScenarios } from "../helpers/golden.js";

/**
 * Golden fixture regression test (Slice 0, Step 1 — docs/remote/slice-0.md).
 *
 * This is the I1 instrument for the upcoming core-extraction refactor: it
 * captures the fixed scenario script through the real MCP handlers and
 * diffs the normalized result against the committed JSON in
 * `tests/fixtures/golden/`. A mismatch means tool-output behavior changed —
 * expected during Step 3's deliberate `session_id` envelope addition
 * (refreshed there with a reviewed diff), a rule-0.1 finding at any other
 * time.
 *
 * Also proves determinism (I1's other half): after the scenario run leaves
 * interaction.html active, a fresh `charlotte_observe` must report the exact
 * same element IDs as the `interaction.html.observe` scenario captured
 * moments earlier, in the same session.
 */
const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures/pages");
const GOLDEN_DIR = path.resolve(import.meta.dirname, "../fixtures/golden");

interface ObserveResultShape {
  interactive?: Array<{ id: string }>;
}

describe("golden fixtures: tool-output stability", () => {
  let harness: McpHarness;

  beforeAll(async () => {
    harness = await setupMcpHarness({ profile: "full", serveDirectory: FIXTURES_DIR });
  });

  afterAll(async () => {
    await harness.teardown();
  });

  it("matches every committed golden fixture and keeps element IDs stable within the session", async () => {
    const scenarios = await captureGoldenScenarios(harness);

    const goldenFiles = (await fs.readdir(GOLDEN_DIR)).filter((file) => file.endsWith(".json"));
    expect(goldenFiles.length).toBeGreaterThan(0);

    // Every committed golden must match the fresh capture exactly.
    for (const file of goldenFiles) {
      const scenarioName = file.replace(/\.json$/, "");
      const committedRaw = await fs.readFile(path.join(GOLDEN_DIR, file), "utf-8");
      const committed: unknown = JSON.parse(committedRaw);
      const fresh = scenarios[scenarioName];

      expect(
        fresh,
        `committed golden file "${file}" has no matching scenario in captureGoldenScenarios() output`,
      ).toBeDefined();
      expect(fresh, `golden mismatch for scenario "${scenarioName}"`).toEqual(committed);
    }

    // Every captured scenario must have a committed golden — catches a
    // scenario added to golden.ts but never persisted via goldens:refresh.
    for (const scenarioName of Object.keys(scenarios)) {
      expect(
        goldenFiles,
        `scenario "${scenarioName}" was captured but has no committed golden file — run npm run goldens:refresh`,
      ).toContain(`${scenarioName}.json`);
    }

    // Determinism proof (I1): captureGoldenScenarios() leaves interaction.html
    // active (the click scenario does not navigate). Re-render it and confirm
    // the element IDs match the interaction.html.observe scenario captured
    // during the run — same session, same IDs.
    const priorObserve = scenarios["interaction.html.observe"] as ObserveResultShape;
    expect(priorObserve.interactive?.length ?? 0).toBeGreaterThan(0);

    const freshObserve = parseToolJson<ObserveResultShape>(
      await harness.callTool("charlotte_observe", { detail: "summary" }),
    );

    expect(freshObserve.interactive?.map((el) => el.id)).toEqual(
      priorObserve.interactive?.map((el) => el.id),
    );
  });
});
