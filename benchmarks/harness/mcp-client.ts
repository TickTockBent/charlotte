/**
 * Lightweight MCP client for benchmark harness.
 * Spawns an MCP server over stdio, sends tool calls, captures responses with timing.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ToolCallMetrics, captureToolCall } from "./metrics.js";

export interface ServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface ToolCallResult {
  toolName: string;
  arguments: Record<string, unknown>;
  response: unknown;
  metrics: ToolCallMetrics;
  isError: boolean;
}

export class BenchmarkMcpClient {
  private client: Client;
  private transport: StdioClientTransport;
  private serverConfig: ServerConfig;
  private connected = false;
  public callHistory: ToolCallResult[] = [];

  constructor(serverConfig: ServerConfig) {
    this.serverConfig = serverConfig;
    this.client = new Client(
      { name: "charlotte-benchmark", version: "1.0.0" },
      { capabilities: {} }
    );
    this.transport = new StdioClientTransport({
      command: serverConfig.command,
      args: serverConfig.args,
      env: serverConfig.env,
      cwd: serverConfig.cwd,
      stderr: "pipe",
    });
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
    this.connected = true;
  }

  async listTools(): Promise<string[]> {
    const response = await this.client.listTools();
    return response.tools.map((tool) => tool.name);
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown> = {}
  ): Promise<ToolCallResult> {
    if (!this.connected) {
      throw new Error("Client not connected. Call connect() first.");
    }

    const { result: response, metrics } = await captureToolCall(async () => {
      return this.client.callTool({ name: toolName, arguments: args });
    });

    const toolCallResult: ToolCallResult = {
      toolName,
      arguments: args,
      response,
      metrics,
      isError: response.isError === true,
    };

    this.callHistory.push(toolCallResult);
    return toolCallResult;
  }

  getCumulativeMetrics(): {
    totalChars: number;
    totalEstimatedTokens: number;
    totalWallTimeMs: number;
    totalCalls: number;
  } {
    let totalChars = 0;
    let totalEstimatedTokens = 0;
    let totalWallTimeMs = 0;

    for (const call of this.callHistory) {
      totalChars += call.metrics.responseChars;
      totalEstimatedTokens += call.metrics.estimatedTokens;
      totalWallTimeMs += call.metrics.wallTimeMs;
    }

    return {
      totalChars,
      totalEstimatedTokens,
      totalWallTimeMs,
      totalCalls: this.callHistory.length,
    };
  }

  resetHistory(): void {
    this.callHistory = [];
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.client.close();
      this.connected = false;
    }
  }
}
