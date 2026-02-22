/**
 * Test runner: defines the BenchmarkTest interface and runs tests against server configs.
 */

import { readFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { BenchmarkMcpClient, ServerConfig, ToolCallResult } from "./mcp-client.js";
import { TestRunResult } from "./metrics.js";
import { saveRawResult } from "./reporter.js";

export interface BenchmarkTest {
  name: string;
  description: string;
  successCriteria: string;

  /**
   * Runs the test against a specific MCP server.
   * Returns the calls made and whether the test passed.
   */
  run(
    client: BenchmarkMcpClient,
    serverName: string
  ): Promise<{
    success: boolean;
    notes: string;
  }>;

  /**
   * Which servers this test supports. If not provided, runs against all.
   * Use this to skip servers that lack certain features (e.g., diff, audit).
   */
  supportedServers?: string[];
}

export async function loadServerConfig(configName: string): Promise<ServerConfig> {
  const configPath = join(import.meta.dirname, "..", "configs", `${configName}.json`);
  const configDir = dirname(configPath);
  const raw = await readFile(configPath, "utf-8");
  const config = JSON.parse(raw) as ServerConfig;

  // Resolve cwd relative to the config file directory
  if (config.cwd) {
    config.cwd = resolve(configDir, config.cwd);
  }

  return config;
}

export async function runTestAgainstServer(
  test: BenchmarkTest,
  serverConfig: ServerConfig,
  retries = 1
): Promise<TestRunResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    const client = new BenchmarkMcpClient(serverConfig);

    try {
      await client.connect();
      client.resetHistory();

      const { success, notes } = await test.run(client, serverConfig.name);

      const cumulative = client.getCumulativeMetrics();
      const calls = client.callHistory.map((call) => ({
        toolName: call.toolName,
        arguments: call.arguments,
        responseChars: call.metrics.responseChars,
        estimatedTokens: call.metrics.estimatedTokens,
        wallTimeMs: call.metrics.wallTimeMs,
        isError: call.isError,
      }));

      const result: TestRunResult = {
        testName: test.name,
        serverName: serverConfig.name,
        calls,
        cumulative,
        success,
        successCriteria: test.successCriteria,
        notes,
        timestamp: Date.now(),
      };

      await saveRawResult(result);
      return result;
    } catch (error) {
      lastError = error as Error;
      console.error(
        `[${serverConfig.name}] ${test.name} attempt ${attempt + 1} failed:`,
        (error as Error).message
      );
    } finally {
      await client.disconnect().catch(() => {});
    }
  }

  // All retries exhausted — return a failure result
  return {
    testName: test.name,
    serverName: serverConfig.name,
    calls: [],
    cumulative: {
      totalChars: 0,
      totalEstimatedTokens: 0,
      totalWallTimeMs: 0,
      totalCalls: 0,
    },
    success: false,
    successCriteria: test.successCriteria,
    notes: `Failed after ${retries} attempts: ${lastError?.message}`,
    timestamp: Date.now(),
  };
}
