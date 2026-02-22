/**
 * Reporter: generates JSON results and markdown comparison tables from benchmark runs.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { TestRunResult } from "./metrics.js";

const RESULTS_DIR = join(import.meta.dirname, "..", "results");
const RAW_DIR = join(RESULTS_DIR, "raw");

export async function saveRawResult(result: TestRunResult): Promise<string> {
  await mkdir(RAW_DIR, { recursive: true });
  const filename = `${result.testName}--${result.serverName}--${Date.now()}.json`;
  const filepath = join(RAW_DIR, filename);
  await writeFile(filepath, JSON.stringify(result, null, 2));
  return filepath;
}

export interface ComparisonRow {
  testName: string;
  results: Record<
    string,
    {
      totalChars: number;
      totalEstimatedTokens: number;
      totalWallTimeMs: number;
      totalCalls: number;
      success: boolean;
    }
  >;
}

export function generateMarkdownTable(rows: ComparisonRow[]): string {
  if (rows.length === 0) return "No results to display.";

  // Collect all server names across all rows
  const serverNames = new Set<string>();
  for (const row of rows) {
    for (const serverName of Object.keys(row.results)) {
      serverNames.add(serverName);
    }
  }
  const servers = [...serverNames].sort();

  // Build header
  const headerCells = ["Test", ...servers.map((serverName) => `${serverName} (chars)`)];
  const header = `| ${headerCells.join(" | ")} |`;
  const separator = `| ${headerCells.map(() => "---:").join(" | ")} |`;
  // First column left-aligned
  const separatorFixed = separator.replace("---:", ":---");

  // Build rows
  const dataRows = rows.map((row) => {
    const cells = [
      row.testName,
      ...servers.map((serverName) => {
        const result = row.results[serverName];
        if (!result) return "N/A";
        const successMark = result.success ? "" : " (FAIL)";
        return `${result.totalChars.toLocaleString()}${successMark}`;
      }),
    ];
    return `| ${cells.join(" | ")} |`;
  });

  return [header, separatorFixed, ...dataRows].join("\n");
}

export function generateDetailedMarkdown(allResults: TestRunResult[]): string {
  const lines: string[] = [
    "# Charlotte Benchmark Results",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
  ];

  // Group by test name
  const byTest = new Map<string, TestRunResult[]>();
  for (const result of allResults) {
    const existing = byTest.get(result.testName) ?? [];
    existing.push(result);
    byTest.set(result.testName, existing);
  }

  // Summary table
  const comparisonRows: ComparisonRow[] = [];
  for (const [testName, results] of byTest) {
    const row: ComparisonRow = { testName, results: {} };
    for (const result of results) {
      row.results[result.serverName] = {
        ...result.cumulative,
        success: result.success,
      };
    }
    comparisonRows.push(row);
  }

  lines.push("## Summary", "", generateMarkdownTable(comparisonRows), "");

  // Detailed per-test sections
  for (const [testName, results] of byTest) {
    lines.push(`## ${testName}`, "");

    for (const result of results) {
      lines.push(`### ${result.serverName}`, "");
      lines.push(`- **Success:** ${result.success ? "Yes" : "No"}`);
      lines.push(`- **Total chars:** ${result.cumulative.totalChars.toLocaleString()}`);
      lines.push(
        `- **Estimated tokens:** ${result.cumulative.totalEstimatedTokens.toLocaleString()}`
      );
      lines.push(`- **Wall time:** ${result.cumulative.totalWallTimeMs.toFixed(0)}ms`);
      lines.push(`- **Tool calls:** ${result.cumulative.totalCalls}`);
      if (result.notes) {
        lines.push(`- **Notes:** ${result.notes}`);
      }
      lines.push("");

      lines.push("| # | Tool | Chars | Est. Tokens | Time (ms) |");
      lines.push("| ---: | :--- | ---: | ---: | ---: |");
      result.calls.forEach((call, index) => {
        lines.push(
          `| ${index + 1} | ${call.toolName} | ${call.responseChars.toLocaleString()} | ${call.estimatedTokens.toLocaleString()} | ${call.wallTimeMs.toFixed(0)} |`
        );
      });
      lines.push("");
    }
  }

  // Headline numbers
  lines.push("## Headline Numbers", "");
  for (const [testName, results] of byTest) {
    const charlotteResult = results.find((r) => r.serverName.includes("Charlotte"));
    const playwrightResult = results.find((r) => r.serverName.includes("Playwright"));

    if (charlotteResult && playwrightResult) {
      const ratio =
        playwrightResult.cumulative.totalChars / charlotteResult.cumulative.totalChars;
      lines.push(
        `- **${testName}:** Charlotte uses **${ratio.toFixed(1)}x fewer** characters than Playwright MCP (${charlotteResult.cumulative.totalChars.toLocaleString()} vs ${playwrightResult.cumulative.totalChars.toLocaleString()})`
      );
    }
  }
  lines.push("");

  return lines.join("\n");
}

export async function saveSummary(allResults: TestRunResult[]): Promise<string> {
  await mkdir(RESULTS_DIR, { recursive: true });
  const markdown = generateDetailedMarkdown(allResults);
  const filepath = join(RESULTS_DIR, "summary.md");
  await writeFile(filepath, markdown);
  return filepath;
}
