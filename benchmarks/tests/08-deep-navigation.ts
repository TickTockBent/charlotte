/**
 * Test 8: Deep Navigation — GitHub Repo Exploration
 *
 * Real-world multi-step navigation with complex modern UI.
 * GitHub is React-based with dynamic content loading and complex a11y trees.
 */

import { BenchmarkTest } from "../harness/test-runner.js";
import { BenchmarkMcpClient } from "../harness/mcp-client.js";

const TARGET_URL = "https://github.com/anthropics/anthropic-cookbook";

export const deepNavigationTest: BenchmarkTest = {
  name: "Deep Navigation (GitHub Repo)",
  description:
    "Navigate to a GitHub repo page. Tests response size on complex modern web apps.",
  successCriteria: "Server can observe the repo page structure.",

  async run(client: BenchmarkMcpClient, serverName: string) {
    const responseText = (result: unknown): string => {
      const response = result as { content?: Array<{ text?: string }> };
      return response.content?.map((c) => c.text ?? "").join("\n") ?? JSON.stringify(result);
    };

    if (serverName.includes("Charlotte")) {
      await client.callTool("charlotte:navigate", { url: TARGET_URL });
      const summaryResult = await client.callTool("charlotte:observe", {
        detail: "summary",
      });
      const minimalResult = await client.callTool("charlotte:observe", {
        detail: "minimal",
      });

      const summaryText = responseText(summaryResult.response);
      const hasContent = summaryText.length > 100;

      return {
        success: hasContent && !summaryResult.isError,
        notes: `Summary: ${summaryResult.metrics.responseChars} chars; Minimal: ${minimalResult.metrics.responseChars} chars`,
      };
    }

    if (serverName.includes("Playwright")) {
      await client.callTool("browser_navigate", { url: TARGET_URL });
      const snapshotResult = await client.callTool("browser_snapshot", {});

      const snapshotText = responseText(snapshotResult.response);
      const hasContent = snapshotText.length > 100;

      return {
        success: hasContent && !snapshotResult.isError,
        notes: `Snapshot: ${snapshotResult.metrics.responseChars} chars`,
      };
    }

    if (serverName.includes("Chrome DevTools")) {
      await client.callTool("navigate_page", { url: TARGET_URL });
      const snapshotResult = await client.callTool("take_snapshot", {});

      const snapshotText = responseText(snapshotResult.response);
      const hasContent = snapshotText.length > 100;

      return {
        success: hasContent && !snapshotResult.isError,
        notes: `Snapshot: ${snapshotResult.metrics.responseChars} chars`,
      };
    }

    return { success: false, notes: `Unknown server: ${serverName}` };
  },
};
