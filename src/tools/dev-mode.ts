import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CharlotteError, CharlotteErrorCode } from "../types/errors.js";
import { logger } from "../utils/logger.js";
import { Auditor, type AuditCategory } from "../dev/auditor.js";
import type { ToolDependencies } from "./tool-helpers.js";
import {
  renderActivePage,
  renderAfterAction,
  formatPageResponse,
  handleToolError,
} from "./tool-helpers.js";

export function registerDevModeTools(
  server: McpServer,
  deps: ToolDependencies,
): void {
  // ─── charlotte:dev_serve ───
  server.registerTool(
    "charlotte:dev_serve",
    {
      description:
        "Serve a local directory as a static website and optionally watch for file changes. Navigates to the served URL and returns the page representation. File changes trigger automatic reloads and surface as reload_event on the next tool response.",
      inputSchema: {
        path: z.string().describe("Local directory to serve"),
        port: z
          .number()
          .optional()
          .describe("Port to serve on (default: auto-assign)"),
        watch: z
          .boolean()
          .optional()
          .describe(
            "Auto-reload on file changes (default: true)",
          ),
      },
    },
    async ({ path: directoryPath, port, watch }) => {
      try {
        await deps.browserManager.ensureConnected();

        if (!deps.devModeState) {
          throw new CharlotteError(
            CharlotteErrorCode.SESSION_ERROR,
            "Dev mode is not available.",
            "DevModeState was not initialized.",
          );
        }

        // Resolve and validate the directory path
        const absoluteDirectoryPath = path.resolve(directoryPath);
        let directoryStats: fs.Stats;
        try {
          directoryStats = fs.statSync(absoluteDirectoryPath);
        } catch {
          throw new CharlotteError(
            CharlotteErrorCode.SESSION_ERROR,
            `Path does not exist: ${absoluteDirectoryPath}`,
            "Provide a valid directory path.",
          );
        }

        if (!directoryStats.isDirectory()) {
          throw new CharlotteError(
            CharlotteErrorCode.SESSION_ERROR,
            `Path is not a directory: ${absoluteDirectoryPath}`,
            "Provide a path to a directory, not a file.",
          );
        }

        const shouldWatch = watch ?? true;

        logger.info("Starting dev serve", {
          directory: absoluteDirectoryPath,
          port,
          watch: shouldWatch,
        });

        const serverInfo = await deps.devModeState.startServing({
          directoryPath: absoluteDirectoryPath,
          port,
          watch: shouldWatch,
          pageManager: deps.pageManager,
        });

        // Navigate the active page to the served URL
        const page = deps.pageManager.getActivePage();
        await page.goto(serverInfo.url, { waitUntil: "load" });

        const representation = await renderActivePage(deps, {
          source: "action",
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  ...representation,
                  dev_server: {
                    url: serverInfo.url,
                    port: serverInfo.port,
                    directory: serverInfo.directoryPath,
                    watching: shouldWatch,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte:dev_inject ───
  server.registerTool(
    "charlotte:dev_inject",
    {
      description:
        "Inject CSS or JavaScript into the current page for testing modifications without editing files. Returns the page representation with a delta showing changes.",
      inputSchema: {
        css: z
          .string()
          .optional()
          .describe("CSS to inject into the page"),
        js: z
          .string()
          .optional()
          .describe("JavaScript to execute in the page context"),
      },
    },
    async ({ css, js }) => {
      try {
        await deps.browserManager.ensureConnected();

        if (!css && !js) {
          throw new CharlotteError(
            CharlotteErrorCode.SESSION_ERROR,
            "At least one of 'css' or 'js' must be provided.",
            "Provide CSS to inject, JS to execute, or both.",
          );
        }

        const page = deps.pageManager.getActivePage();

        if (css) {
          await page.addStyleTag({ content: css });
          logger.info("Injected CSS", {
            length: css.length,
          });
        }

        if (js) {
          await page.evaluate(js);
          logger.info("Executed injected JS", {
            length: js.length,
          });
        }

        // Brief pause to allow DOM updates to settle
        await new Promise((resolve) => setTimeout(resolve, 50));

        const representation = await renderAfterAction(deps);
        return formatPageResponse(representation);
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte:dev_audit ───
  server.registerTool(
    "charlotte:dev_audit",
    {
      description:
        "Run accessibility and quality audits on the current page. Returns findings with severity levels and actionable recommendations.",
      inputSchema: {
        checks: z
          .array(
            z.enum(["a11y", "performance", "seo", "contrast", "links"]),
          )
          .optional()
          .describe(
            "Audit categories to run. Options: a11y, performance, seo, contrast, links. Default: all categories.",
          ),
      },
    },
    async ({ checks }) => {
      try {
        await deps.browserManager.ensureConnected();

        const page = deps.pageManager.getActivePage();
        const session = await page.createCDPSession();

        const auditor = new Auditor();
        const categories = checks as AuditCategory[] | undefined;

        logger.info("Running dev audit", {
          categories: categories ?? "all",
        });

        try {
          const auditResult = await auditor.audit(page, session, categories);

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(auditResult, null, 2),
              },
            ],
          };
        } finally {
          await session.detach();
        }
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );
}
