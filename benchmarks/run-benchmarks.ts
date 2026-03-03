#!/usr/bin/env node
/**
 * Benchmark orchestrator.
 * Runs all benchmark tests against configured MCP servers and generates results.
 *
 * Usage:
 *   npx tsx benchmarks/run-benchmarks.ts                         # Run comparison suite (default)
 *   npx tsx benchmarks/run-benchmarks.ts --suite comparison      # Charlotte vs Playwright vs Chrome DevTools
 *   npx tsx benchmarks/run-benchmarks.ts --suite profiles        # Charlotte profile comparison (full/browse/core)
 *   npx tsx benchmarks/run-benchmarks.ts --server charlotte      # Run against Charlotte only
 *   npx tsx benchmarks/run-benchmarks.ts --test 01               # Run test 01 only
 *   npx tsx benchmarks/run-benchmarks.ts --server charlotte --server playwright  # Multiple servers
 */

import { join } from "node:path";
import { loadServerConfig, runTestAgainstServer } from "./harness/test-runner.js";
import { TestRunResult } from "./harness/metrics.js";
import { saveSummary, generateDetailedMarkdown } from "./harness/reporter.js";
import { simplePageTest } from "./tests/01-simple-page.js";
import { contentHeavyTest } from "./tests/02-content-heavy.js";
import { interactiveFormTest } from "./tests/03-interactive-form.js";
import { multiPageTest } from "./tests/04-multi-page.js";
import { deepNavigationTest } from "./tests/08-deep-navigation.js";
import { toolDefinitionsTest } from "./tests/10-tool-definitions.js";
import { browseSessionTest } from "./tests/11-browse-session.js";
import { interactiveSessionTest } from "./tests/12-interactive-session.js";
import { runtimeToggleTest } from "./tests/13-runtime-toggle.js";
import type { BenchmarkTest } from "./harness/test-runner.js";
import type { ServerConfig } from "./harness/mcp-client.js";

const COMPARISON_TESTS: BenchmarkTest[] = [
  simplePageTest,
  contentHeavyTest,
  interactiveFormTest,
  multiPageTest,
  deepNavigationTest,
];

const PROFILE_TESTS: BenchmarkTest[] = [
  toolDefinitionsTest,
  browseSessionTest,
  interactiveSessionTest,
  runtimeToggleTest,
];

const ALL_TESTS: BenchmarkTest[] = [...COMPARISON_TESTS, ...PROFILE_TESTS];

const COMPARISON_SERVERS = ["charlotte", "playwright", "chrome-devtools"];
const PROFILE_SERVERS = ["charlotte-full", "charlotte-browse", "charlotte-core"];

type Suite = "comparison" | "profiles";

function parseArgs(): { servers: string[]; tests: string[]; suite: Suite | null } {
  const args = process.argv.slice(2);
  const servers: string[] = [];
  const tests: string[] = [];
  let suite: Suite | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--server" && args[i + 1]) {
      servers.push(args[++i]);
    } else if (args[i] === "--test" && args[i + 1]) {
      tests.push(args[++i]);
    } else if (args[i] === "--suite" && args[i + 1]) {
      const suiteArg = args[++i];
      if (suiteArg === "comparison" || suiteArg === "profiles") {
        suite = suiteArg;
      } else {
        console.error(`Unknown suite: ${suiteArg}. Valid suites: comparison, profiles`);
        process.exit(1);
      }
    }
  }

  // Apply suite defaults if no explicit servers/tests
  if (suite === "profiles") {
    return {
      servers: servers.length > 0 ? servers : PROFILE_SERVERS,
      tests: tests.length > 0 ? tests : [],
      suite,
    };
  }

  if (suite === "comparison") {
    return {
      servers: servers.length > 0 ? servers : COMPARISON_SERVERS,
      tests: tests.length > 0 ? tests : [],
      suite,
    };
  }

  // No suite specified — use original defaults (backward compatible)
  return {
    servers: servers.length > 0 ? servers : COMPARISON_SERVERS,
    tests: tests.length > 0 ? tests : [],
    suite: null,
  };
}

// Map numeric IDs to test names for lookup
const TEST_ID_TO_NAME: Record<string, string> = {
  "01": "Simple Page",
  "02": "Content-Heavy",
  "03": "Interactive Form",
  "04": "Multi-Page",
  "08": "Deep Navigation",
  "10": "Tool Definitions",
  "11": "Browse Session",
  "12": "Interactive Session",
  "13": "Runtime Toggle",
};

function filterTests(tests: BenchmarkTest[], testFilter: string[]): BenchmarkTest[] {
  if (testFilter.length === 0) return tests;

  return tests.filter((test) => {
    return testFilter.some((filter) => {
      // Numeric filter: map to test name prefix
      if (/^\d+$/.test(filter) && TEST_ID_TO_NAME[filter]) {
        return test.name.startsWith(TEST_ID_TO_NAME[filter]);
      }
      // String filter: match by name substring
      return test.name.toLowerCase().includes(filter.toLowerCase());
    });
  });
}

async function main() {
  const { servers: serverNames, tests: testFilter, suite } = parseArgs();

  // Select test pool based on suite
  let testPool: BenchmarkTest[];
  if (suite === "profiles") {
    testPool = PROFILE_TESTS;
  } else if (suite === "comparison") {
    testPool = COMPARISON_TESTS;
  } else {
    testPool = ALL_TESTS;
  }

  const testsToRun = filterTests(testPool, testFilter);

  const suiteName = suite === "profiles"
    ? "Profile Comparison"
    : suite === "comparison"
      ? "Server Comparison"
      : "Charlotte Benchmark";

  console.log(`=== ${suiteName} Suite ===\n`);
  console.log(`Servers: ${serverNames.join(", ")}`);
  console.log(`Tests: ${testsToRun.map((t) => t.name).join(", ")}`);
  console.log("");

  // Compute output directory early so raw results go to the right place
  let outputDir: string | undefined;
  if (suite === "profiles") {
    outputDir = join(import.meta.dirname, "results", "raw", "tiered-profiles-v1");
  }

  const allResults: TestRunResult[] = [];

  for (const serverName of serverNames) {
    let serverConfig: ServerConfig;
    try {
      serverConfig = await loadServerConfig(serverName);
    } catch (error) {
      console.error(`Failed to load config for ${serverName}:`, (error as Error).message);
      continue;
    }

    console.log(`\n--- ${serverConfig.name} ---\n`);

    for (const test of testsToRun) {
      // Check if this test supports this server
      if (
        test.supportedServers &&
        !test.supportedServers.some((s) => serverConfig.name.includes(s))
      ) {
        console.log(`  [SKIP] ${test.name} (not supported by ${serverConfig.name})`);
        continue;
      }

      console.log(`  [RUN]  ${test.name}...`);
      const result = await runTestAgainstServer(test, serverConfig, 1, outputDir);

      const statusIcon = result.success ? "PASS" : "FAIL";
      const defInfo = result.toolDefinitions
        ? `, ${result.toolDefinitions.toolCount} tools, ${result.toolDefinitions.definitionChars.toLocaleString()} def chars`
        : "";
      console.log(
        `  [${statusIcon}] ${test.name} — ${result.cumulative.totalChars.toLocaleString()} chars, ${result.cumulative.totalCalls} calls, ${result.cumulative.totalWallTimeMs.toFixed(0)}ms${defInfo}`
      );
      if (result.notes) {
        console.log(`         ${result.notes}`);
      }

      allResults.push(result);
    }
  }

  // Generate summary
  console.log("\n\n=== Generating Summary ===\n");

  const summaryPath = await saveSummary(allResults, outputDir);
  console.log(`Summary written to: ${summaryPath}`);

  // Also print the markdown to stdout
  console.log("\n" + generateDetailedMarkdown(allResults));
}

main().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
