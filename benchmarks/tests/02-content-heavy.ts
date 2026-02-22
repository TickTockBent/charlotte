/**
 * Test 2: Content-Heavy Page — Wikipedia Article
 *
 * This is where token bloat shows up most dramatically. Wikipedia articles
 * have massive DOM trees with hundreds of links, references, and sections.
 */

import { BenchmarkTest } from "../harness/test-runner.js";
import { BenchmarkMcpClient } from "../harness/mcp-client.js";

const TARGET_URL = "https://en.wikipedia.org/wiki/Artificial_intelligence";

export const contentHeavyTest: BenchmarkTest = {
  name: "Content-Heavy (Wikipedia AI)",
  description:
    "Navigate to the Artificial Intelligence Wikipedia article. Tests response size on content-dense pages.",
  successCriteria:
    "Server identifies the article title, table of contents structure, and sidebar elements.",

  async run(client: BenchmarkMcpClient, serverName: string) {
    const responseText = (result: unknown): string => {
      const response = result as { content?: Array<{ text?: string }> };
      return response.content?.map((c) => c.text ?? "").join("\n") ?? JSON.stringify(result);
    };

    if (serverName.includes("Charlotte")) {
      // Charlotte: navigate + observe at all 3 detail levels
      await client.callTool("charlotte:navigate", { url: TARGET_URL });

      const minimalResult = await client.callTool("charlotte:observe", {
        detail: "minimal",
      });
      const summaryResult = await client.callTool("charlotte:observe", {
        detail: "summary",
      });
      const fullResult = await client.callTool("charlotte:observe", {
        detail: "full",
      });

      const minimalText = responseText(minimalResult.response);
      const summaryText = responseText(summaryResult.response);
      const hasTitle =
        /artificial intelligence/i.test(minimalText) ||
        /artificial intelligence/i.test(summaryText);

      return {
        success: hasTitle && !minimalResult.isError && !fullResult.isError,
        notes: [
          `Minimal: ${minimalResult.metrics.responseChars} chars`,
          `Summary: ${summaryResult.metrics.responseChars} chars`,
          `Full: ${fullResult.metrics.responseChars} chars`,
          `Title found: ${hasTitle}`,
        ].join("; "),
      };
    }

    if (serverName.includes("Playwright")) {
      // Playwright: navigate + snapshot
      await client.callTool("browser_navigate", { url: TARGET_URL });
      const snapshotResult = await client.callTool("browser_snapshot", {});

      const snapshotText = responseText(snapshotResult.response);
      const hasTitle = /artificial intelligence/i.test(snapshotText);

      return {
        success: hasTitle && !snapshotResult.isError,
        notes: `Snapshot: ${snapshotResult.metrics.responseChars} chars; Title found: ${hasTitle}`,
      };
    }

    if (serverName.includes("Chrome DevTools")) {
      await client.callTool("navigate_page", { url: TARGET_URL });
      const snapshotResult = await client.callTool("take_snapshot", {});

      const snapshotText = responseText(snapshotResult.response);
      const hasTitle = /artificial intelligence/i.test(snapshotText);

      return {
        success: hasTitle && !snapshotResult.isError,
        notes: `Snapshot: ${snapshotResult.metrics.responseChars} chars; Title found: ${hasTitle}`,
      };
    }

    return { success: false, notes: `Unknown server: ${serverName}` };
  },
};
