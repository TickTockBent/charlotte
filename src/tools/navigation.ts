import { z } from "zod";
import type { Page } from "puppeteer";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CharlotteError, CharlotteErrorCode } from "../types/errors.js";
import { logger } from "../utils/logger.js";
import type { DetailLevel } from "../renderer/renderer-pipeline.js";
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDependencies } from "./tool-helpers.js";
import {
  ensureReady,
  renderActivePage,
  formatPageResponse,
  handleToolError,
} from "./tool-helpers.js";

const detailSchema = z
  .enum(["minimal", "summary", "full"])
  .optional()
  .describe(
    '"minimal" (default), "summary" (includes content context), "full" (includes all text content)',
  );

/**
 * Read history position from CDP so we can decide whether a back/forward move
 * is possible BEFORE attempting it.
 *
 * Why not rely solely on `goBack()`/`goForward()` returning null? They return
 * null both when there is no entry to move to AND when the move is a
 * same-document navigation (SPA pushState) that produces no HTTP response. URL
 * comparison has the inverse problem: a same-URL history entry looks like "no
 * navigation happened". Checking `currentIndex` against the history length
 * distinguishes "no entry" from "real (possibly same-URL) navigation" without
 * either false negative (#202).
 */
async function getHistoryPosition(
  page: Page,
): Promise<{ currentIndex: number; entryCount: number }> {
  const client = await page.createCDPSession();
  try {
    const history = (await client.send("Page.getNavigationHistory")) as {
      currentIndex: number;
      entries: unknown[];
    };
    return { currentIndex: history.currentIndex, entryCount: history.entries.length };
  } finally {
    await client.detach().catch(() => {});
  }
}

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

        // dom- selector registrations are scoped to the document they were
        // created against; drop them on cross-document navigation (#191).
        deps.elementIdGenerator.clearDomQueryIds();

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

  tools["charlotte_back"] = server.registerTool(
    "charlotte_back",
    {
      description:
        "Navigate back in browser history. Returns page representation after navigation.",
      inputSchema: {
        detail: detailSchema,
      },
    },
    async ({ detail }) => {
      try {
        await ensureReady(deps);
        const page = deps.pageManager.getActivePage();

        logger.info("Navigating back");
        deps.pageManager.clearErrors();

        // Decide possibility from history position, not URL comparison: a
        // same-URL entry (SPA pushState) is a real navigation that URL
        // comparison would misreport as "no previous page" (#202).
        const { currentIndex } = await getHistoryPosition(page);
        if (currentIndex <= 0) {
          throw new CharlotteError(
            CharlotteErrorCode.NAVIGATION_FAILED,
            "No previous page in history.",
          );
        }

        // goBack() returns null for same-document (pushState) navigations even
        // though the move succeeded, so we do not treat null as failure here.
        await page.goBack({ waitUntil: "load" });

        // Only fire on actual navigation success (#191).
        deps.elementIdGenerator.clearDomQueryIds();

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

  tools["charlotte_forward"] = server.registerTool(
    "charlotte_forward",
    {
      description:
        "Navigate forward in browser history. Returns page representation after navigation.",
      inputSchema: {
        detail: detailSchema,
      },
    },
    async ({ detail }) => {
      try {
        await ensureReady(deps);
        const page = deps.pageManager.getActivePage();

        logger.info("Navigating forward");
        deps.pageManager.clearErrors();

        // Possibility decided from history position rather than URL comparison,
        // so same-URL SPA entries are not misreported as "no forward page" (#202).
        const { currentIndex, entryCount } = await getHistoryPosition(page);
        if (currentIndex >= entryCount - 1) {
          throw new CharlotteError(
            CharlotteErrorCode.NAVIGATION_FAILED,
            "No forward page in history.",
          );
        }

        // goForward() returns null for same-document (pushState) navigations
        // even though the move succeeded, so null is not treated as failure.
        await page.goForward({ waitUntil: "load" });

        // Only fire on actual navigation success (#191).
        deps.elementIdGenerator.clearDomQueryIds();

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

  tools["charlotte_reload"] = server.registerTool(
    "charlotte_reload",
    {
      description: "Reload the current page. Returns page representation after reload.",
      inputSchema: {
        hard: z.boolean().optional().describe("Bypass cache (default: false)"),
        detail: detailSchema,
      },
    },
    async ({ hard, detail }) => {
      try {
        await ensureReady(deps);
        const page = deps.pageManager.getActivePage();

        const bypassCache = hard ?? false;
        logger.info("Reloading page", { hard: bypassCache });
        deps.pageManager.clearErrors();

        if (bypassCache) {
          // Use CDP to reload with cache bypass.
          const client = await page.createCDPSession();
          try {
            // Register the navigation wait BEFORE sending Page.reload. Fast
            // localhost reloads can complete before waitForNavigation attaches,
            // producing a spurious 30s timeout if registered afterwards (#202).
            const navigationPromise = page.waitForNavigation({ waitUntil: "load" });
            await client.send("Page.reload", { ignoreCache: true });
            await navigationPromise;
          } finally {
            // Always detach so the ad-hoc session does not leak even if the
            // reload throws (#202).
            await client.detach().catch(() => {});
          }
        } else {
          await page.reload({ waitUntil: "load" });
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
