import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BrowserManager } from "../browser/browser-manager.js";
import type { PageManager } from "../browser/page-manager.js";
import { CharlotteError, CharlotteErrorCode } from "../types/errors.js";
import { logger } from "../utils/logger.js";

export interface EvaluateDeps {
  browserManager: BrowserManager;
  pageManager?: PageManager;
  getActivePage: () => import("puppeteer").Page;
}

export function registerEvaluateTools(
  server: McpServer,
  deps: EvaluateDeps,
): void {
  server.registerTool("charlotte:evaluate", {
    description:
      "Execute JavaScript in page context. Useful for reading computed values, triggering custom events, or accessing page-level APIs.",
    inputSchema: {
      expression: z.string().describe("JS expression to evaluate"),
      timeout: z
        .number()
        .optional()
        .describe("Max execution time in ms (default: 5000)"),
      await_promise: z
        .boolean()
        .optional()
        .describe(
          "If the expression returns a Promise, await it before returning (default: true)",
        ),
    },
  }, async ({ expression, timeout, await_promise }) => {
    await deps.browserManager.ensureConnected();
    const page = deps.getActivePage();

    const evaluationTimeout = timeout ?? 5000;
    const shouldAwaitPromise = await_promise ?? true;

    try {
      const result = await Promise.race([
        page.evaluate(async (expr: string, awaitPromise: boolean) => {
          try {
            let result = eval(expr);
            if (awaitPromise && result && typeof result === "object" && typeof result.then === "function") {
              result = await result;
            }

            // Serialize the result
            if (result === undefined) return { value: null, type: "undefined" };
            if (result === null) return { value: null, type: "null" };
            if (typeof result === "function") return { value: result.toString(), type: "function" };
            if (result instanceof HTMLElement) return { value: result.outerHTML.substring(0, 200), type: "HTMLElement" };
            if (result instanceof Node) return { value: result.nodeName, type: "Node" };

            try {
              return { value: JSON.parse(JSON.stringify(result)), type: typeof result };
            } catch {
              return { value: String(result), type: typeof result };
            }
          } catch (error: any) {
            return {
              error: true,
              message: error.message,
              stack: error.stack,
            };
          }
        }, expression, shouldAwaitPromise),

        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("TIMEOUT")),
            evaluationTimeout,
          ),
        ),
      ]);

      if (result && typeof result === "object" && "error" in result && result.error) {
        throw new CharlotteError(
          CharlotteErrorCode.EVALUATION_ERROR,
          `Evaluation error: ${(result as any).message}`,
        );
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      if (error instanceof CharlotteError) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(error.toResponse()),
            },
          ],
          isError: true,
        };
      }

      if (error instanceof Error && error.message === "TIMEOUT") {
        const timeoutError = new CharlotteError(
          CharlotteErrorCode.TIMEOUT,
          `Expression evaluation exceeded ${evaluationTimeout}ms. The expression may have had side effects before termination.`,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(timeoutError.toResponse()),
            },
          ],
          isError: true,
        };
      }

      logger.error("Unexpected error in evaluate", error);
      const sessionError = new CharlotteError(
        CharlotteErrorCode.SESSION_ERROR,
        `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(sessionError.toResponse()),
          },
        ],
        isError: true,
      };
    }
  });
}
