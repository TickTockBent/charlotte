import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { StaticServer } from "../../src/dev/static-server.js";
import { setupCoreDirectHarness, type CoreDirectHarness } from "../helpers/core-direct.js";
import { setupHttpHarness, type HttpHarness } from "../helpers/http-harness.js";
import { captureGoldenScenarios } from "../helpers/golden.js";

/**
 * I3 — the parity law, machine gate (docs/remote/slice-1.md step 3;
 * design-principles 0.7).
 *
 * The SAME scenario script (`captureGoldenScenarios`) is executed twice
 * against the SAME fixture server:
 *
 *   1. core-direct — `ToolDefinition.handler(ctx, args)` invoked with no
 *      `McpServer`, no protocol, no socket (`tests/helpers/core-direct.ts`).
 *   2. over live HTTP — a real MCP client speaking streamable HTTP over TCP to
 *      the real transport (`tests/helpers/http-harness.ts`).
 *
 * The two paths run on two SEPARATE browser instances and two separate
 * `SessionContext`s. That separation is the content of the law, not an
 * accident of the harness: parity must hold across independent sessions, so
 * element IDs, snapshot IDs, and every rendered field have to be functions of
 * the page and the call sequence alone — never of a shared process, a shared
 * browser, or the order the two paths happened to run in.
 *
 * The comparison is three-way. Both fresh captures are diffed against each
 * other AND against the committed goldens in `tests/fixtures/golden/`, so a
 * divergence can never hide by moving in both live paths at once.
 *
 * Normalization is exactly what `tests/helpers/golden.ts` already applies —
 * fixture origin, the named timestamp/duration/path keys — and nothing more.
 * Extending that allowlist to make this file pass would be defeating the
 * instrument: per principle 0.1, an HTTP-vs-core divergence is a finding that
 * halts the slice, never something to normalize away.
 */
const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures/pages");
const GOLDEN_DIR = path.resolve(import.meta.dirname, "../fixtures/golden");

/** Scenario names present in either capture, in a stable order for reporting. */
function unionScenarioNames(...captures: Array<Record<string, unknown>>): string[] {
  const names = new Set<string>();
  for (const capture of captures) {
    for (const name of Object.keys(capture)) names.add(name);
  }
  return [...names].sort();
}

/**
 * Compact, readable per-scenario divergence report. Vitest's own object diff
 * is good but gets unusable at the size of a full navigate payload, so this
 * points at the exact JSON paths that differ first.
 */
function describeDivergence(
  left: unknown,
  right: unknown,
  leftLabel: string,
  rightLabel: string,
): string {
  const differences: string[] = [];

  const walk = (a: unknown, b: unknown, jsonPath: string): void => {
    if (differences.length >= 12) return;
    if (Object.is(a, b)) return;

    const bothArrays = Array.isArray(a) && Array.isArray(b);
    const bothObjects =
      !bothArrays && a !== null && b !== null && typeof a === "object" && typeof b === "object";

    if (bothArrays) {
      const arrayA = a as unknown[];
      const arrayB = b as unknown[];
      if (arrayA.length !== arrayB.length) {
        differences.push(
          `${jsonPath}: length ${arrayA.length} (${leftLabel}) vs ${arrayB.length} (${rightLabel})`,
        );
      }
      for (let index = 0; index < Math.max(arrayA.length, arrayB.length); index += 1) {
        walk(arrayA[index], arrayB[index], `${jsonPath}[${index}]`);
      }
      return;
    }

    if (bothObjects) {
      const keys = new Set([
        ...Object.keys(a as Record<string, unknown>),
        ...Object.keys(b as Record<string, unknown>),
      ]);
      for (const key of [...keys].sort()) {
        walk(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
          `${jsonPath}.${key}`,
        );
      }
      return;
    }

    differences.push(
      `${jsonPath}: ${JSON.stringify(a)} (${leftLabel}) vs ${JSON.stringify(b)} (${rightLabel})`,
    );
  };

  walk(left, right, "$");
  if (differences.length === 0) return "(no scalar differences found — structural mismatch)";
  return differences.join("\n  ");
}

/** Assert deep equality, reporting the offending JSON paths on failure. */
function expectScenarioIdentical(
  scenarioName: string,
  left: unknown,
  right: unknown,
  leftLabel: string,
  rightLabel: string,
): void {
  expect(
    left,
    `PARITY VIOLATION (rule-0.1 finding) in scenario "${scenarioName}": ` +
      `${leftLabel} diverges from ${rightLabel}.\n  ` +
      describeDivergence(left, right, leftLabel, rightLabel),
  ).toEqual(right);
}

describe("I3 parity: core-direct and live HTTP produce byte-identical tool results", () => {
  let fixtureServer: StaticServer;
  let fixtureBaseUrl: string;
  let coreHarness: CoreDirectHarness;
  let httpHarness: HttpHarness;
  let coreScenarios: Record<string, unknown>;
  let httpScenarios: Record<string, unknown>;

  beforeAll(async () => {
    // ONE fixture server, shared by both paths: the served bytes and the
    // origin string are then provably identical, so any divergence that shows
    // up is attributable to the transport and nothing else.
    fixtureServer = new StaticServer();
    const info = await fixtureServer.start({
      directoryPath: FIXTURES_DIR,
      allowedRoot: FIXTURES_DIR,
    });
    fixtureBaseUrl = info.url;

    // Run the two paths one after the other, each on its own browser and its
    // own SessionContext — never sharing, never overlapping.
    coreHarness = await setupCoreDirectHarness();
    coreScenarios = await captureGoldenScenarios(coreHarness.callTool, fixtureBaseUrl);

    httpHarness = await setupHttpHarness();
    httpScenarios = await captureGoldenScenarios(httpHarness.callTool, fixtureBaseUrl);
  });

  afterAll(async () => {
    await httpHarness?.teardown();
    await coreHarness?.teardown();
    await fixtureServer?.stop().catch(() => {});
  });

  it("captures the same scenario set on both paths", () => {
    expect(Object.keys(httpScenarios).sort()).toEqual(Object.keys(coreScenarios).sort());
    expect(Object.keys(httpScenarios).length).toBeGreaterThan(0);
  });

  it("returns identical results over HTTP as core-direct, scenario by scenario", () => {
    for (const scenarioName of unionScenarioNames(coreScenarios, httpScenarios)) {
      expectScenarioIdentical(
        scenarioName,
        httpScenarios[scenarioName],
        coreScenarios[scenarioName],
        "HTTP",
        "core-direct",
      );
    }
  });

  it("matches the committed goldens on both paths (three-way)", async () => {
    const goldenFiles = (await fs.readdir(GOLDEN_DIR)).filter((file) => file.endsWith(".json"));
    expect(goldenFiles.length).toBeGreaterThan(0);

    for (const file of goldenFiles) {
      const scenarioName = file.replace(/\.json$/, "");
      const committed: unknown = JSON.parse(
        await fs.readFile(path.join(GOLDEN_DIR, file), "utf-8"),
      );

      expect(
        coreScenarios[scenarioName],
        `committed golden "${file}" has no matching scenario in captureGoldenScenarios() output`,
      ).toBeDefined();

      expectScenarioIdentical(
        scenarioName,
        coreScenarios[scenarioName],
        committed,
        "core-direct",
        "committed golden",
      );
      expectScenarioIdentical(
        scenarioName,
        httpScenarios[scenarioName],
        committed,
        "HTTP",
        "committed golden",
      );
    }

    for (const scenarioName of Object.keys(coreScenarios)) {
      expect(
        goldenFiles,
        `scenario "${scenarioName}" was captured but has no committed golden file`,
      ).toContain(`${scenarioName}.json`);
    }
  });
});
