/**
 * Test 20: Detail Level Comparison — Multi-Site
 *
 * Navigate to 6 real-world sites and observe with all 5 detail levels:
 *   tree, tree-labeled, minimal, summary, full
 *
 * Measures response size (chars/tokens) at each level to quantify the
 * token savings of tree views vs structured JSON representations.
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

const DETAIL_LEVELS = [
  { label: "tree", args: { view: "tree" } },
  { label: "tree-labeled", args: { view: "tree-labeled" } },
  { label: "minimal", args: { detail: "minimal" } },
  { label: "summary", args: { detail: "summary" } },
  { label: "full", args: { detail: "full" } },
];

export const detailLevelsTest: BenchmarkTest = {
  name: "Detail Levels (6 sites × 5 levels)",
  description:
    "Navigate to 6 real-world sites and observe each with tree, tree-labeled, minimal, summary, and full. 36 tool calls total (6 navigate + 30 observe).",
  successCriteria:
    "At least 4 sites load successfully and all 5 detail levels return content for each.",
  supportedServers: ["Charlotte"],

  async run(client: BenchmarkMcpClient, _serverName: string) {
    const siteResults: string[] = [];
    let successfulSites = 0;

    for (const site of SITES) {
      const navResult = await client.callTool("charlotte:navigate", {
        url: site.url,
      });

      if (navResult.isError) {
        siteResults.push(`${site.name}: NAVIGATE FAILED`);
        continue;
      }

      const levelChars: Record<string, number> = {};
      let allLevelsOk = true;

      for (const level of DETAIL_LEVELS) {
        const result = await client.callTool("charlotte:observe", level.args);
        if (result.isError) {
          allLevelsOk = false;
          levelChars[level.label] = 0;
        } else {
          levelChars[level.label] = result.metrics.responseChars;
        }
      }

      if (allLevelsOk) successfulSites++;

      const parts = DETAIL_LEVELS.map(
        (l) => `${l.label}=${levelChars[l.label]?.toLocaleString() ?? "ERR"}`,
      );
      siteResults.push(`${site.name}: ${parts.join(", ")}`);
    }

    return {
      success: successfulSites >= 4,
      notes: siteResults.join("\n"),
    };
  },
};
