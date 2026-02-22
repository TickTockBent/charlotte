#!/usr/bin/env node
/**
 * Benchmark orchestrator.
 * Runs all benchmark tests against configured MCP servers and generates results.
 *
 * Usage:
 *   npx tsx benchmarks/run-benchmarks.ts                    # Run all tests against all servers
 *   npx tsx benchmarks/run-benchmarks.ts --server charlotte # Run against Charlotte only
 *   npx tsx benchmarks/run-benchmarks.ts --test 01          # Run test 01 only
 *   npx tsx benchmarks/run-benchmarks.ts --server charlotte --server playwright  # Multiple servers
 */

import { loadServerConfig, runTestAgainstServer } from "./harness/test-runner.js";
import { TestRunResult } from "./harness/metrics.js";
import { saveSummary, generateDetailedMarkdown } from "./harness/reporter.js";
import { simplePageTest } from "./tests/01-simple-page.js";
import { contentHeavyTest } from "./tests/02-content-heavy.js";
import { interactiveFormTest } from "./tests/03-interactive-form.js";
import { multiPageTest } from "./tests/04-multi-page.js";
import { deepNavigationTest } from "./tests/08-deep-navigation.js";
import type { BenchmarkTest } from "./harness/test-runner.js";
import type { ServerConfig } from "./harness/mcp-client.js";

const ALL_TESTS: BenchmarkTest[] = [
  simplePageTest,
  contentHeavyTest,
  interactiveFormTest,
  multiPageTest,
  deepNavigationTest,
];

const ALL_SERVER_CONFIGS = ["charlotte", "playwright", "chrome-devtools"];

function parseArgs(): { servers: string[]; tests: string[] } {
  const args = process.argv.slice(2);
  const servers: string[] = [];
  const tests: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--server" && args[i + 1]) {
      servers.push(args[++i]);
    } else if (args[i] === "--test" && args[i + 1]) {
      tests.push(args[++i]);
    }
  }

  return {
    servers: servers.length > 0 ? servers : ALL_SERVER_CONFIGS,
    tests: tests.length > 0 ? tests : [],
  };
}

function filterTests(tests: BenchmarkTest[], testFilter: string[]): BenchmarkTest[] {
  if (testFilter.length === 0) return tests;

  // Map numeric IDs to test names for lookup
  const testIdToName: Record<string, string> = {
    "01": "Simple Page",
    "02": "Content-Heavy",
    "03": "Interactive Form",
    "04": "Multi-Page",
    "08": "Deep Navigation",
  };

  return tests.filter((test) => {
    return testFilter.some((filter) => {
      // Numeric filter: map to test name prefix
      if (/^\d+$/.test(filter) && testIdToName[filter]) {
        return test.name.startsWith(testIdToName[filter]);
      }
      // String filter: match by name substring
      return test.name.toLowerCase().includes(filter.toLowerCase());
    });
  });
}

async function main() {
  const { servers: serverNames, tests: testFilter } = parseArgs();
  const testsToRun = filterTests(ALL_TESTS, testFilter);

  console.log("=== Charlotte Benchmark Suite ===\n");
  console.log(`Servers: ${serverNames.join(", ")}`);
  console.log(`Tests: ${testsToRun.map((t) => t.name).join(", ")}`);
  console.log("");

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
      const result = await runTestAgainstServer(test, serverConfig);

      const statusIcon = result.success ? "PASS" : "FAIL";
      console.log(
        `  [${statusIcon}] ${test.name} — ${result.cumulative.totalChars.toLocaleString()} chars, ${result.cumulative.totalCalls} calls, ${result.cumulative.totalWallTimeMs.toFixed(0)}ms`
      );
      if (result.notes) {
        console.log(`         ${result.notes}`);
      }

      allResults.push(result);
    }
  }

  // Generate summary
  console.log("\n\n=== Generating Summary ===\n");
  const summaryPath = await saveSummary(allResults);
  console.log(`Summary written to: ${summaryPath}`);

  // Also print the markdown to stdout
  console.log("\n" + generateDetailedMarkdown(allResults));
}

main().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
