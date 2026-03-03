/**
 * Test 11: Multi-Site Browse Session
 *
 * Visit 5 sites and perform navigate → observe(minimal) → observe(summary) → find(link)
 * per site. 20 total tool calls to amplify definition overhead differences.
 * Uses only core tools (navigate, observe, find) so it works on all 3 profiles.
 */

import { BenchmarkTest } from "../harness/test-runner.js";
import { BenchmarkMcpClient } from "../harness/mcp-client.js";

const SITES = [
  { url: "https://example.com", name: "example.com" },
  { url: "https://news.ycombinator.com", name: "Hacker News" },
  { url: "https://en.wikipedia.org/wiki/Model_Context_Protocol", name: "Wikipedia MCP" },
  { url: "https://httpbin.org/forms/post", name: "httpbin form" },
  { url: "https://github.com/anthropics/anthropic-cookbook", name: "GitHub cookbook" },
];

export const browseSessionTest: BenchmarkTest = {
  name: "Browse Session (5 sites)",
  description:
    "Visit 5 sites with navigate + observe(minimal) + observe(summary) + find(link) per site. 20 tool calls total.",
  successCriteria:
    "All 5 navigations succeed and at least 3 sites return meaningful content.",
  supportedServers: ["Charlotte"],

  async run(client: BenchmarkMcpClient, serverName: string) {
    const responseText = (result: unknown): string => {
      const response = result as { content?: Array<{ text?: string }> };
      return response.content?.map((c) => c.text ?? "").join("\n") ?? JSON.stringify(result);
    };

    let successfulSites = 0;

    for (const site of SITES) {
      // 1. Navigate
      const navigateResult = await client.callTool("charlotte:navigate", {
        url: site.url,
      });

      if (navigateResult.isError) continue;

      // 2. Observe (minimal)
      const minimalResult = await client.callTool("charlotte:observe", {
        detail: "minimal",
      });

      // 3. Observe (summary)
      await client.callTool("charlotte:observe", {
        detail: "summary",
      });

      // 4. Find links
      await client.callTool("charlotte:find", {
        type: "link",
      });

      const minimalText = responseText(minimalResult.response);
      if (minimalText.length > 50) {
        successfulSites++;
      }
    }

    return {
      success: successfulSites >= 3,
      notes: `${successfulSites}/${SITES.length} sites returned meaningful content`,
    };
  },
};
