/**
 * Test 10: Tool Definition Overhead — Pure measurement
 *
 * Connects to the server, lists tools, and records definition payload size.
 * No browsing — fastest possible test to isolate definition overhead.
 */

import { BenchmarkTest } from "../harness/test-runner.js";
import { BenchmarkMcpClient } from "../harness/mcp-client.js";

const EXPECTED_TOOL_COUNTS: Record<string, number> = {
  "Charlotte (full)": 34,   // 33 tools + meta-tool
  "Charlotte (browse)": 16, // 15 tools + meta-tool
  "Charlotte (core)": 7,    // 6 tools + meta-tool
};

export const toolDefinitionsTest: BenchmarkTest = {
  name: "Tool Definitions (overhead)",
  description:
    "Connect and list tools to measure raw definition payload size. No browsing actions.",
  successCriteria:
    "Tool count matches expected profile size and definition payload is captured.",
  supportedServers: ["Charlotte"],

  async run(client: BenchmarkMcpClient, serverName: string) {
    const toolListMetrics = await client.listToolsWithMetrics();

    const expectedCount = EXPECTED_TOOL_COUNTS[serverName];
    const countMatches = expectedCount
      ? toolListMetrics.toolCount === expectedCount
      : true;

    // Make one lightweight tool call so the test has non-zero call count
    // (navigate to about:blank is near-instant)
    await client.callTool("charlotte_navigate", { url: "about:blank" });

    return {
      success: countMatches && toolListMetrics.toolCount > 0,
      notes: [
        `Tools: ${toolListMetrics.toolCount}${expectedCount ? ` (expected ${expectedCount}${countMatches ? ", match" : ", MISMATCH"})` : ""}`,
        `Definition chars: ${toolListMetrics.definitionChars.toLocaleString()}`,
        `Est. definition tokens: ${toolListMetrics.estimatedDefinitionTokens.toLocaleString()}`,
      ].join(". "),
    };
  },
};
