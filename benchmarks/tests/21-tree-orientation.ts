/**
 * Test 21: Tree Orientation Workflow
 *
 * Simulates a realistic agent workflow where tree-labeled view replaces
 * summary-level observation for initial page orientation.
 *
 * Both provide actionable context (element labels, page structure), but
 * tree-labeled omits content text and JSON overhead.
 *
 * Workflow per site (two passes on same page):
 *   Pass A (tree-labeled): observe(view: "tree-labeled") → find(link)
 *   Pass B (summary):      observe(detail: "summary") → find(link)
 *
 * 6 sites × (1 navigate + 2 observe + 2 find) = 30 tool calls total.
 */

import { BenchmarkTest } from "../harness/test-runner.js";
import { BenchmarkMcpClient } from "../harness/mcp-client.js";

const SITES = [
  { url: "https://en.wikipedia.org/wiki/Main_Page", name: "Wikipedia" },
  { url: "https://github.com/anthropics", name: "GitHub" },
  { url: "https://news.ycombinator.com/", name: "Hacker News" },
  { url: "https://www.linkedin.com/", name: "LinkedIn" },
  { url: "https://stackoverflow.com/questions", name: "Stack Overflow" },
  { url: "https://www.amazon.com/", name: "Amazon" },
];

export const treeOrientationTest: BenchmarkTest = {
  name: "Tree Orientation Workflow (6 sites)",
  description:
    "Compare tree-labeled orientation vs summary JSON orientation across 6 sites. " +
    "Each workflow: observe → find(link). 30 total calls (6 navigate + 12 observe + 12 find).",
  successCriteria:
    "At least 4 sites complete both workflows and tree-labeled orientation is cheaper than summary.",
  supportedServers: ["Charlotte"],

  async run(client: BenchmarkMcpClient, _serverName: string) {
    const siteNotes: string[] = [];
    let successfulSites = 0;
    let totalTreeLabeledChars = 0;
    let totalSummaryChars = 0;

    for (const site of SITES) {
      const navResult = await client.callTool("charlotte_navigate", {
        url: site.url,
      });
      if (navResult.isError) {
        siteNotes.push(`${site.name}: NAVIGATE FAILED`);
        continue;
      }

      // ── Pass A: tree-labeled workflow ──
      const treeResult = await client.callTool("charlotte_observe", {
        view: "tree-labeled",
      });
      await client.callTool("charlotte_find", { type: "link" });

      // ── Pass B: summary workflow (same page) ──
      const summaryResult = await client.callTool("charlotte_observe", {
        detail: "summary",
      });
      await client.callTool("charlotte_find", { type: "link" });

      if (!treeResult.isError && !summaryResult.isError) {
        successfulSites++;
        totalTreeLabeledChars += treeResult.metrics.responseChars;
        totalSummaryChars += summaryResult.metrics.responseChars;

        const savings = Math.round(
          (1 - treeResult.metrics.responseChars / summaryResult.metrics.responseChars) * 100,
        );
        siteNotes.push(
          `${site.name}: tree-labeled=${treeResult.metrics.responseChars.toLocaleString()}, ` +
            `summary=${summaryResult.metrics.responseChars.toLocaleString()} (${savings}% savings)`,
        );
      } else {
        siteNotes.push(`${site.name}: observe failed`);
      }
    }

    const overallSavings =
      totalSummaryChars > 0
        ? Math.round((1 - totalTreeLabeledChars / totalSummaryChars) * 100)
        : 0;

    siteNotes.push(
      `\nOverall observe savings: tree-labeled=${totalTreeLabeledChars.toLocaleString()} vs ` +
        `summary=${totalSummaryChars.toLocaleString()} chars (${overallSavings}% savings)`,
    );

    return {
      success: successfulSites >= 4 && totalTreeLabeledChars < totalSummaryChars,
      notes: siteNotes.join("\n"),
    };
  },
};
