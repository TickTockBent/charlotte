/**
 * Test 13: Runtime Tool Toggle
 *
 * Start with browse profile, measure initial tool list,
 * enable monitoring group, measure expanded list, use charlotte:console,
 * disable monitoring, measure contracted list.
 * Validates that tool count grows, shrinks, and restores correctly.
 */

import { BenchmarkTest } from "../harness/test-runner.js";
import { BenchmarkMcpClient } from "../harness/mcp-client.js";

export const runtimeToggleTest: BenchmarkTest = {
  name: "Runtime Toggle (meta-tool)",
  description:
    "Start with browse profile, enable/disable monitoring group via charlotte:tools, measure tool list changes.",
  successCriteria:
    "Tool count increases after enable, monitoring tool works, tool count decreases after disable.",
  supportedServers: ["Charlotte (browse)"],

  async run(client: BenchmarkMcpClient, serverName: string) {
    const responseText = (result: unknown): string => {
      const response = result as { content?: Array<{ text?: string }> };
      return response.content?.map((c) => c.text ?? "").join("\n") ?? JSON.stringify(result);
    };

    // 1. Measure initial tool list
    const initialMetrics = await client.listToolsWithMetrics();
    const initialToolCount = initialMetrics.toolCount;

    // 2. List groups to see current state
    const listResult = await client.callTool("charlotte:tools", {
      action: "list",
    });
    const listText = responseText(listResult.response);

    // 3. Enable monitoring group
    const enableResult = await client.callTool("charlotte:tools", {
      action: "enable",
      group: "monitoring",
    });
    const enableText = responseText(enableResult.response);

    // 4. Measure expanded tool list
    const expandedMetrics = await client.listToolsWithMetrics();
    const expandedToolCount = expandedMetrics.toolCount;
    const toolCountGrew = expandedToolCount > initialToolCount;

    // 5. Navigate to a page so console tool has something to work with
    await client.callTool("charlotte:navigate", { url: "about:blank" });

    // 6. Use the newly-enabled monitoring tool
    const consoleResult = await client.callTool("charlotte:console", {});
    const consoleWorked = !consoleResult.isError;

    // 7. Disable monitoring group
    const disableResult = await client.callTool("charlotte:tools", {
      action: "disable",
      group: "monitoring",
    });

    // 8. Measure contracted tool list
    const contractedMetrics = await client.listToolsWithMetrics();
    const contractedToolCount = contractedMetrics.toolCount;
    const toolCountRestored = contractedToolCount === initialToolCount;

    return {
      success: toolCountGrew && consoleWorked && toolCountRestored,
      notes: [
        `Initial: ${initialToolCount} tools`,
        `After enable: ${expandedToolCount} tools (grew: ${toolCountGrew})`,
        `Console tool worked: ${consoleWorked}`,
        `After disable: ${contractedToolCount} tools (restored: ${toolCountRestored})`,
        `Initial def chars: ${initialMetrics.definitionChars.toLocaleString()}`,
        `Expanded def chars: ${expandedMetrics.definitionChars.toLocaleString()}`,
        `Contracted def chars: ${contractedMetrics.definitionChars.toLocaleString()}`,
      ].join(". "),
    };
  },
};
