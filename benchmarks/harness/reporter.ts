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

/**
 * Generates a table comparing tool definition overhead across profiles.
 * One row per server/profile showing tool count, definition chars, and estimated tokens.
 */
export function generateDefinitionComparisonTable(allResults: TestRunResult[]): string | null {
  // Deduplicate by serverName — pick any result that has toolDefinitions
  const byServer = new Map<string, TestRunResult>();
  for (const result of allResults) {
    if (result.toolDefinitions && !byServer.has(result.serverName)) {
      byServer.set(result.serverName, result);
    }
  }

  if (byServer.size === 0) return null;

  const lines: string[] = [
    "| Profile | Tools | Definition Chars | Est. Def. Tokens |",
    "| :--- | ---: | ---: | ---: |",
  ];

  for (const [serverName, result] of byServer) {
    const defs = result.toolDefinitions!;
    lines.push(
      `| ${serverName} | ${defs.toolCount} | ${defs.definitionChars.toLocaleString()} | ${defs.estimatedDefinitionTokens.toLocaleString()} |`
    );
  }

  return lines.join("\n");
}

/**
 * Generates a table showing cumulative token cost per profile across a test.
 * Columns: profile, calls, response tokens, definition tokens (cumulative), total, savings vs baseline.
 */
export function generateCumulativeCostTable(
  allResults: TestRunResult[],
  baselineServerName: string
): string | null {
  // Group by test
  const byTest = new Map<string, TestRunResult[]>();
  for (const result of allResults) {
    if (!result.toolDefinitions) continue;
    const existing = byTest.get(result.testName) ?? [];
    existing.push(result);
    byTest.set(result.testName, existing);
  }

  if (byTest.size === 0) return null;

  const lines: string[] = [];

  for (const [testName, results] of byTest) {
    const baselineResult = results.find((r) => r.serverName === baselineServerName);
    if (!baselineResult?.toolDefinitions) continue;

    const baselineTotalTokens =
      baselineResult.cumulative.totalEstimatedTokens +
      baselineResult.toolDefinitions.cumulativeDefinitionTokens;

    lines.push(`### ${testName}`, "");
    lines.push(
      "| Profile | Calls | Response Tokens | Def. Tokens (cum.) | Total Tokens | Savings vs Full |"
    );
    lines.push("| :--- | ---: | ---: | ---: | ---: | ---: |");

    for (const result of results) {
      const defs = result.toolDefinitions!;
      const totalTokens = result.cumulative.totalEstimatedTokens + defs.cumulativeDefinitionTokens;
      const savingsPercent =
        baselineTotalTokens > 0
          ? (((baselineTotalTokens - totalTokens) / baselineTotalTokens) * 100).toFixed(1)
          : "0.0";
      const savingsLabel =
        result.serverName === baselineServerName ? "—" : `${savingsPercent}%`;

      lines.push(
        `| ${result.serverName} | ${result.cumulative.totalCalls} | ${result.cumulative.totalEstimatedTokens.toLocaleString()} | ${defs.cumulativeDefinitionTokens.toLocaleString()} | ${totalTokens.toLocaleString()} | ${savingsLabel} |`
      );
    }
    lines.push("");
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

/**
 * Generates headline savings numbers comparing profiles against a baseline.
 */
export function generateHeadlineSavings(
  allResults: TestRunResult[],
  baselineServerName: string
): string | null {
  // Deduplicate definition metrics by server
  const byServer = new Map<string, TestRunResult>();
  for (const result of allResults) {
    if (result.toolDefinitions && !byServer.has(result.serverName)) {
      byServer.set(result.serverName, result);
    }
  }

  const baselineResult = byServer.get(baselineServerName);
  if (!baselineResult?.toolDefinitions) return null;

  const baselineTokens = baselineResult.toolDefinitions.estimatedDefinitionTokens;
  const lines: string[] = [];

  for (const [serverName, result] of byServer) {
    if (serverName === baselineServerName) continue;
    const defs = result.toolDefinitions!;
    const savingsPercent =
      baselineTokens > 0
        ? (((baselineTokens - defs.estimatedDefinitionTokens) / baselineTokens) * 100).toFixed(0)
        : "0";
    lines.push(
      `- **${serverName}** saves **${savingsPercent}%** tool definition overhead vs ${baselineServerName} (${defs.estimatedDefinitionTokens.toLocaleString()} vs ${baselineTokens.toLocaleString()} tokens per call)`
    );
  }

  return lines.length > 0 ? lines.join("\n") : null;
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

  // Tool definition comparison (only when toolDefinitions data is present)
  const hasToolDefinitions = allResults.some((r) => r.toolDefinitions);
  if (hasToolDefinitions) {
    const defTable = generateDefinitionComparisonTable(allResults);
    if (defTable) {
      lines.push("## Tool Definition Overhead", "", defTable, "");
    }

    // Find baseline — prefer "Charlotte (full)", fall back to first with definitions
    const baselineName =
      allResults.find((r) => r.serverName === "Charlotte (full)" && r.toolDefinitions)
        ?.serverName ??
      allResults.find((r) => r.toolDefinitions)?.serverName;

    if (baselineName) {
      const headlineSavings = generateHeadlineSavings(allResults, baselineName);
      if (headlineSavings) {
        lines.push("### Headline Savings", "", headlineSavings, "");
      }

      const cumulativeCostTable = generateCumulativeCostTable(allResults, baselineName);
      if (cumulativeCostTable) {
        lines.push("## Cumulative Token Cost by Test", "", cumulativeCostTable);
      }
    }
  }

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

  // Headline numbers (Charlotte vs Playwright comparison — only when both are present)
  const headlineLines: string[] = [];
  for (const [testName, results] of byTest) {
    const charlotteResult = results.find((r) => r.serverName.includes("Charlotte"));
    const playwrightResult = results.find((r) => r.serverName.includes("Playwright"));

    if (charlotteResult && playwrightResult) {
      const ratio =
        playwrightResult.cumulative.totalChars / charlotteResult.cumulative.totalChars;
      headlineLines.push(
        `- **${testName}:** Charlotte uses **${ratio.toFixed(1)}x fewer** characters than Playwright MCP (${charlotteResult.cumulative.totalChars.toLocaleString()} vs ${playwrightResult.cumulative.totalChars.toLocaleString()})`
      );
    }
  }
  if (headlineLines.length > 0) {
    lines.push("## Headline Numbers", "", ...headlineLines, "");
  }

  return lines.join("\n");
}

export async function saveSummary(
  allResults: TestRunResult[],
  outputDir?: string
): Promise<string> {
  const targetDir = outputDir ?? RESULTS_DIR;
  await mkdir(targetDir, { recursive: true });
  const markdown = generateDetailedMarkdown(allResults);
  const filepath = join(targetDir, "summary.md");
  await writeFile(filepath, markdown);
  return filepath;
}
