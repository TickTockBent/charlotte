/**
 * Test 1: Simple Page Read — example.com
 *
 * Baseline comparison. Navigate to example.com and read the page structure.
 * If there's a size difference here, it compounds on real sites.
 */

import { BenchmarkTest } from "../harness/test-runner.js";
import { BenchmarkMcpClient } from "../harness/mcp-client.js";

const TARGET_URL = "https://example.com";

export const simplePageTest: BenchmarkTest = {
  name: "Simple Page (example.com)",
  description:
    "Navigate to example.com and return the page structure. Baseline comparison.",
  successCriteria:
    "Server identifies the page title, the heading, and the single link.",

  async run(client: BenchmarkMcpClient, serverName: string) {
    const responseText = (result: unknown): string => {
      const response = result as { content?: Array<{ text?: string }> };
      return response.content?.map((c) => c.text ?? "").join("\n") ?? JSON.stringify(result);
    };

    if (serverName.includes("Charlotte")) {
      // Charlotte: navigate + observe(minimal)
      const navigateResult = await client.callTool("charlotte:navigate", {
        url: TARGET_URL,
      });
      const observeResult = await client.callTool("charlotte:observe", {
        detail: "minimal",
      });

      const observeText = responseText(observeResult.response);
      const hasTitle = /example/i.test(observeText);
      const hasHeading = /heading|h1/i.test(observeText) || /example domain/i.test(observeText);

      return {
        success: hasTitle && !navigateResult.isError && !observeResult.isError,
        notes: `Title found: ${hasTitle}, Heading found: ${hasHeading}`,
      };
    }

    if (serverName.includes("Playwright")) {
      // Playwright: browser_navigate (returns snapshot automatically) + browser_snapshot
      const navigateResult = await client.callTool("browser_navigate", {
        url: TARGET_URL,
      });
      const snapshotResult = await client.callTool("browser_snapshot", {});

      const snapshotText = responseText(snapshotResult.response);
      const hasTitle = /example/i.test(snapshotText);

      return {
        success: hasTitle && !navigateResult.isError && !snapshotResult.isError,
        notes: `Title found: ${hasTitle}`,
      };
    }

    if (serverName.includes("Chrome DevTools")) {
      // Chrome DevTools: navigate_page + take_snapshot
      const navigateResult = await client.callTool("navigate_page", {
        url: TARGET_URL,
      });
      const snapshotResult = await client.callTool("take_snapshot", {});

      const snapshotText = responseText(snapshotResult.response);
      const hasTitle = /example/i.test(snapshotText);

      return {
        success: hasTitle && !navigateResult.isError && !snapshotResult.isError,
        notes: `Title found: ${hasTitle}`,
      };
    }

    return { success: false, notes: `Unknown server: ${serverName}` };
  },
};
