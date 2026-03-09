import { z } from "zod";
import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
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
): Record<string, RegisteredTool> {
  const tools: Record<string, RegisteredTool> = {};

  tools["charlotte:evaluate"] = server.registerTool(
    "charlotte:evaluate",
    {
      description:
        "Execute JavaScript in page context. Supports single expressions and multi-statement code. Returns the completion value of the last expression-statement.",
      inputSchema: {
        expression: z.string().describe("JS expression or multi-statement code to evaluate"),
        timeout: z.number().optional().describe("Max execution time in ms (default: 5000)"),
        await_promise: z
          .boolean()
          .optional()
          .describe(
            "If the expression returns a Promise, await it before returning (default: true)",
          ),
      },
    },
    async ({ expression, timeout, await_promise }) => {
      await deps.browserManager.ensureConnected();
      const page = deps.getActivePage();

      const evaluationTimeout = timeout ?? 5000;
      const shouldAwaitPromise = await_promise ?? true;

      const cdpSession = await page.createCDPSession();
      try {
        const evalResult = await Promise.race([
          cdpSession.send("Runtime.evaluate", {
            expression,
            returnByValue: true,
            awaitPromise: shouldAwaitPromise,
            timeout: evaluationTimeout,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("TIMEOUT")),
              evaluationTimeout + 500, // slightly longer than CDP timeout as fallback
            ),
          ),
        ]);

        // Check for exceptions
        if (evalResult.exceptionDetails) {
          const exceptionMessage =
            evalResult.exceptionDetails.exception?.description ??
            evalResult.exceptionDetails.text ??
            "Unknown evaluation error";
          throw new CharlotteError(
            CharlotteErrorCode.EVALUATION_ERROR,
            `Evaluation error: ${exceptionMessage}`,
          );
        }

        // Serialize the RemoteObject result
        const remoteObject = evalResult.result;
        const result = serializeRemoteObject(remoteObject);

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
      } finally {
        await cdpSession.detach();
      }
    },
  );

  return tools;
}

/**
 * Convert a CDP RemoteObject to a { value, type } result.
 */
function serializeRemoteObject(remoteObject: {
  type: string;
  subtype?: string;
  value?: unknown;
  description?: string;
  className?: string;
}): { value: unknown; type: string } {
  const { type, subtype, value, description, className } = remoteObject;

  if (type === "undefined") {
    return { value: null, type: "undefined" };
  }

  if (subtype === "null") {
    return { value: null, type: "null" };
  }

  if (type === "function") {
    return { value: description ?? "[function]", type: "function" };
  }

  if (type === "object" && subtype === "node") {
    return { value: description ?? "[Node]", type: className ?? "Node" };
  }

  if (type === "object" && subtype === "error") {
    return { value: description ?? "[Error]", type: "Error" };
  }

  // For primitives and serializable objects, returnByValue gives us the value directly
  if (value !== undefined) {
    return { value, type };
  }

  // Fallback for non-serializable objects
  return { value: description ?? `[${className ?? type}]`, type: className ?? type };
}
