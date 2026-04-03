import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Page } from "puppeteer";
import { CharlotteError, CharlotteErrorCode } from "../types/errors.js";
import { logger } from "../utils/logger.js";
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDependencies } from "./tool-helpers.js";
import {
  renderActivePage,
  renderAfterAction,
  formatPageResponse,
  handleToolError,
} from "./tool-helpers.js";

export function registerWaitForTools(
  server: McpServer,
  deps: ToolDependencies,
): Record<string, RegisteredTool> {
  const tools: Record<string, RegisteredTool> = {};

  // ─── charlotte_wait_for ───
  tools["charlotte_wait_for"] = server.registerTool(
    "charlotte_wait_for",
    {
      description:
        "Wait for a condition to be met on the page. Returns page representation when the condition is satisfied, or a TIMEOUT error.",
      inputSchema: {
        element_id: z.string().optional().describe("Wait for specific element to appear/change"),
        state: z
          .enum(["visible", "hidden", "enabled", "disabled", "exists", "removed"])
          .optional()
          .describe("Target element state to wait for"),
        text: z.string().optional().describe("Wait for text to appear on the page"),
        selector: z.string().optional().describe("Wait for CSS selector to match"),
        js: z.string().optional().describe("Wait for JS expression to return truthy"),
        timeout: z.number().optional().describe("Max wait in ms (default: 10000)"),
      },
    },
    async ({ element_id, state, text, selector, js, timeout }) => {
      try {
        await deps.browserManager.ensureConnected();
        const page = deps.pageManager.getActivePage();
        const waitTimeout = timeout ?? 10000;

        // Validate that at least one condition is provided
        if (!element_id && !text && !selector && !js) {
          throw new CharlotteError(
            CharlotteErrorCode.SESSION_ERROR,
            "At least one wait condition is required (element_id, text, selector, or js).",
          );
        }

        logger.info("Waiting for condition", {
          element_id,
          state,
          text,
          selector,
          js,
          timeout: waitTimeout,
        });

        // Build a composite wait condition
        const satisfied = await pollWaitForCondition(
          deps,
          page,
          { element_id, state, text, selector, js },
          waitTimeout,
        );

        if (!satisfied) {
          const representation = await renderAfterAction(deps);
          const timeoutError = new CharlotteError(
            CharlotteErrorCode.TIMEOUT,
            `Wait condition not met within ${waitTimeout}ms.`,
            "The current page state is included in the response. Consider increasing timeout or adjusting your condition.",
          );
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  ...timeoutError.toResponse(),
                  page: representation,
                }),
              },
            ],
            isError: true,
          };
        }

        const representation = await renderAfterAction(deps);
        return formatPageResponse(representation);
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  return tools;
}

/**
 * Poll for complex wait_for conditions that may involve element state checks.
 */
async function pollWaitForCondition(
  deps: ToolDependencies,
  page: Page,
  condition: {
    element_id?: string;
    state?: string;
    text?: string;
    selector?: string;
    js?: string;
  },
  timeoutMs: number,
): Promise<boolean> {
  const pollInterval = 100;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    let allSatisfied = true;

    // Check element_id + state condition
    if (condition.element_id) {
      const targetState = condition.state ?? "exists";
      const elementSatisfied = await checkElementCondition(deps, condition.element_id, targetState);
      if (!elementSatisfied) allSatisfied = false;
    }

    // Check text condition
    if (allSatisfied && condition.text) {
      const textFound = await page.evaluate((searchText) => {
        return document.body?.innerText?.includes(searchText) ?? false;
      }, condition.text);
      if (!textFound) allSatisfied = false;
    }

    // Check selector condition
    if (allSatisfied && condition.selector) {
      const selectorMatched = await page.$(condition.selector);
      if (!selectorMatched) allSatisfied = false;
    }

    // Check JS condition via CDP Runtime.evaluate (matches evaluate.ts pattern)
    if (allSatisfied && condition.js) {
      const cdpSession = await page.createCDPSession();
      try {
        const evalResult = await cdpSession.send("Runtime.evaluate", {
          expression: condition.js,
          returnByValue: true,
          awaitPromise: true,
          timeout: Math.max(0, deadline - Date.now()),
        });
        const isTruthy =
          !evalResult.exceptionDetails && !!evalResult.result.value;
        if (!isTruthy) allSatisfied = false;
      } catch {
        allSatisfied = false;
      } finally {
        await cdpSession.detach().catch(() => {});
      }
    }

    if (allSatisfied) return true;

    const remainingTime = deadline - Date.now();
    if (remainingTime <= 0) break;

    await new Promise((resolve) => setTimeout(resolve, Math.min(pollInterval, remainingTime)));
  }

  return false;
}

/**
 * Check if an element meets a specific state condition.
 */
async function checkElementCondition(
  deps: ToolDependencies,
  elementId: string,
  targetState: string,
): Promise<boolean> {
  switch (targetState) {
    case "exists": {
      const backendNodeId = deps.elementIdGenerator.resolveId(elementId);
      return backendNodeId !== null;
    }
    case "removed": {
      const backendNodeId = deps.elementIdGenerator.resolveId(elementId);
      if (backendNodeId !== null) {
        // Re-render to check if it's truly still there
        await renderActivePage(deps, { detail: "minimal" });
        return deps.elementIdGenerator.resolveId(elementId) === null;
      }
      return true;
    }
    case "visible":
    case "hidden":
    case "enabled":
    case "disabled": {
      // Re-render to get fresh state
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const element = representation.interactive.find((el) => el.id === elementId);
      if (!element) {
        // Element doesn't exist — "hidden" and "disabled" are satisfied, others not
        return targetState === "hidden" || targetState === "disabled";
      }

      switch (targetState) {
        case "visible":
          return element.state.visible === true;
        case "hidden":
          return element.state.visible === false;
        case "enabled":
          return element.state.enabled === true;
        case "disabled":
          return element.state.enabled === false;
      }
      return false;
    }
    default:
      return false;
  }
}
