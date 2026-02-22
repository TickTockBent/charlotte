/**
 * Metrics collection for benchmark harness.
 * Captures response sizes, timing, and token estimates.
 */

export interface ToolCallMetrics {
  /** Total character count of the serialized response */
  responseChars: number;
  /** Estimated token count (chars / 4) */
  estimatedTokens: number;
  /** Wall-clock time in milliseconds */
  wallTimeMs: number;
  /** Timestamp of the call */
  timestamp: number;
}

/**
 * Wraps an async tool call, capturing timing and response size metrics.
 */
export async function captureToolCall<T>(
  callFunction: () => Promise<T>
): Promise<{ result: T; metrics: ToolCallMetrics }> {
  const startTime = performance.now();
  const timestamp = Date.now();

  const result = await callFunction();

  const wallTimeMs = performance.now() - startTime;
  const serialized = JSON.stringify(result);
  const responseChars = serialized.length;
  const estimatedTokens = Math.ceil(responseChars / 4);

  return {
    result,
    metrics: {
      responseChars,
      estimatedTokens,
      wallTimeMs,
      timestamp,
    },
  };
}

export interface TestRunResult {
  testName: string;
  serverName: string;
  calls: Array<{
    toolName: string;
    arguments: Record<string, unknown>;
    responseChars: number;
    estimatedTokens: number;
    wallTimeMs: number;
    isError: boolean;
  }>;
  cumulative: {
    totalChars: number;
    totalEstimatedTokens: number;
    totalWallTimeMs: number;
    totalCalls: number;
  };
  success: boolean;
  successCriteria: string;
  notes: string;
  timestamp: number;
}
