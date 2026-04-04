import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CharlotteError, CharlotteErrorCode } from "../types/errors.js";
import { logger } from "../utils/logger.js";
import type { DetailLevel } from "../renderer/renderer-pipeline.js";
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDependencies } from "./tool-helpers.js";
import { ensureReady, renderActivePage, formatPageResponse, handleToolError } from "./tool-helpers.js";

const detailSchema = z
  .enum(["minimal", "summary", "full"])
  .optional()
  .describe(
    '"minimal" (default), "summary" (includes content context), "full" (includes all text content)',
  );

export function registerNavigationTools(
  server: McpServer,
  deps: ToolDependencies,
): Record<string, RegisteredTool> {
  const tools: Record<string, RegisteredTool> = {};

  tools["charlotte_navigate"] = server.registerTool(
    "charlotte_navigate",
    {
      description:
        "Load a URL in the active page. Returns page representation after navigation. Default minimal detail includes landmarks, headings, and interactive element counts — use charlotte_find to locate specific elements, or pass detail: 'summary' to get the full element list.",
      inputSchema: {
        url: z.string().describe("URL to navigate to"),
        wait_for: z
          .enum(["load", "domcontentloaded", "networkidle"])
          .optional()
          .describe(
            'Wait condition: "load" (default), "domcontentloaded", "networkidle". Note: "networkidle" is unreliable on SPAs with persistent WebSocket connections.',
          ),
        timeout: z.number().optional().describe("Max wait in ms (default: 30000)"),
        detail: detailSchema,
      },
    },
    async ({ url, wait_for, timeout, detail }) => {
      try {
        await ensureReady(deps);
        const page = deps.pageManager.getActivePage();

        const waitUntilValue = wait_for ?? "load";
        const navigationTimeout = timeout ?? 30000;

        // Map our wait_for values to Puppeteer's PuppeteerLifeCycleEvent
        const waitUntilMap = {
          load: "load" as const,
          domcontentloaded: "domcontentloaded" as const,
          networkidle: "networkidle0" as const,
        };

        logger.info("Navigating", { url, waitUntil: waitUntilValue });

        // Clear errors before navigation
        deps.pageManager.clearErrors();

        try {
          await page.goto(url, {
            waitUntil: waitUntilMap[waitUntilValue],
            timeout: navigationTimeout,
          });
        } catch (navigationError: unknown) {
          const errorMessage =
            navigationError instanceof Error ? navigationError.message : String(navigationError);

          // Check for timeout specifically
          if (errorMessage.includes("timeout") || errorMessage.includes("Timeout")) {
            throw new CharlotteError(
              CharlotteErrorCode.TIMEOUT,
              `Navigation to '${url}' timed out after ${navigationTimeout}ms.`,
              'Try using wait_for: "load" instead of "networkidle", or increase the timeout.',
            );
          }

          throw new CharlotteError(
            CharlotteErrorCode.NAVIGATION_FAILED,
            `Navigation to '${url}' failed: ${errorMessage}`,
          );
        }

        const detailLevel: DetailLevel = detail ?? "minimal";
        const representation = await renderActivePage(deps, {
          detail: detailLevel,
          source: "action",
        });
        return formatPageResponse(representation);
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte_history ───
  tools["charlotte_history"] = server.registerTool(
    "charlotte_history",
    {
      description:
        "Navigate browser history or reload. Returns page representation after the action.",
      inputSchema: {
        action: z
          .enum(["back", "forward", "reload"])
          .describe("History action to perform"),
        hard: z.boolean().optional().describe("Bypass cache on reload (default: false)"),
        detail: detailSchema,
      },
    },
    async ({ action, hard, detail }) => {
      try {
        await ensureReady(deps);
        const page = deps.pageManager.getActivePage();
        deps.pageManager.clearErrors();

        if (action === "reload") {
          const bypassCache = hard ?? false;
          logger.info("Reloading page", { hard: bypassCache });

          if (bypassCache) {
            const client = await page.createCDPSession();
            await client.send("Page.reload", { ignoreCache: true });
            await page.waitForNavigation({ waitUntil: "load" });
            await client.detach();
          } else {
            await page.reload({ waitUntil: "load" });
          }
        } else {
          logger.info(`Navigating ${action}`);
          const urlBefore = page.url();

          if (action === "back") {
            await page.goBack({ waitUntil: "load" });
          } else {
            await page.goForward({ waitUntil: "load" });
          }

          if (page.url() === urlBefore) {
            throw new CharlotteError(
              CharlotteErrorCode.NAVIGATION_FAILED,
              action === "back" ? "No previous page in history." : "No forward page in history.",
            );
          }
        }

        const detailLevel: DetailLevel = detail ?? "minimal";
        const representation = await renderActivePage(deps, {
          detail: detailLevel,
          source: "action",
        });
        return formatPageResponse(representation);
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  return tools;
}
