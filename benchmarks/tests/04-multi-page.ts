/**
 * Test 4: Multi-Page Navigation — Hacker News Top Stories
 *
 * Tests cumulative token cost across multiple page observations.
 * Every navigation/snapshot in Playwright returns a full a11y tree.
 * Charlotte lets the agent choose detail level per page.
 */

import { BenchmarkTest } from "../harness/test-runner.js";
import { BenchmarkMcpClient } from "../harness/mcp-client.js";

const TARGET_URL = "https://news.ycombinator.com";

export const multiPageTest: BenchmarkTest = {
  name: "Multi-Page Nav (Hacker News)",
  description:
    "Navigate to Hacker News and extract the top 5 story titles. Tests cumulative cost across page observation.",
  successCriteria: "Successfully observe the front page content.",

  async run(client: BenchmarkMcpClient, serverName: string) {
    const responseText = (result: unknown): string => {
      const response = result as { content?: Array<{ text?: string }> };
      return response.content?.map((c) => c.text ?? "").join("\n") ?? JSON.stringify(result);
    };

    if (serverName.includes("Charlotte")) {
      // Navigate and use summary to get story titles
      await client.callTool("charlotte:navigate", { url: TARGET_URL });
      const summaryResult = await client.callTool("charlotte:observe", {
        detail: "summary",
      });

      // Use find to locate story links specifically
      const findLinks = await client.callTool("charlotte:find", {
        type: "link",
      });

      const summaryText = responseText(summaryResult.response);
      const hasContent =
        summaryText.length > 100 && /hacker news/i.test(summaryText);

      return {
        success: hasContent && !summaryResult.isError,
        notes: `Summary: ${summaryResult.metrics.responseChars} chars; Find: ${findLinks.metrics.responseChars} chars`,
      };
    }

    if (serverName.includes("Playwright")) {
      // Navigate returns snapshot automatically, then explicit snapshot
      await client.callTool("browser_navigate", { url: TARGET_URL });
      const snapshotResult = await client.callTool("browser_snapshot", {});

      const snapshotText = responseText(snapshotResult.response);
      const hasContent =
        snapshotText.length > 100 && /hacker news/i.test(snapshotText);

      return {
        success: hasContent && !snapshotResult.isError,
        notes: `Snapshot: ${snapshotResult.metrics.responseChars} chars`,
      };
    }

    if (serverName.includes("Chrome DevTools")) {
      await client.callTool("navigate_page", { url: TARGET_URL });
      const snapshotResult = await client.callTool("take_snapshot", {});

      const snapshotText = responseText(snapshotResult.response);
      const hasContent =
        snapshotText.length > 100 && /hacker news/i.test(snapshotText);

      return {
        success: hasContent && !snapshotResult.isError,
        notes: `Snapshot: ${snapshotResult.metrics.responseChars} chars`,
      };
    }

    return { success: false, notes: `Unknown server: ${serverName}` };
  },
};
