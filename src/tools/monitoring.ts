import { z } from "zod";
import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logger } from "../utils/logger.js";
import type { ToolDependencies } from "./tool-helpers.js";
import { handleToolError, coercedBoolean, resolveOutputPath, writeOutputFile } from "./tool-helpers.js";

export function registerMonitoringTools(
  server: McpServer,
  deps: ToolDependencies,
): Record<string, RegisteredTool> {
  const tools: Record<string, RegisteredTool> = {};

  // ─── charlotte:console ───
  tools["charlotte:console"] = server.registerTool(
    "charlotte:console",
    {
      description:
        "Retrieve console messages from the active page. Returns messages at all severity levels (log, info, warning, error, debug, etc.) with timestamps. Useful for debugging JavaScript behavior.",
      inputSchema: {
        level: z
          .enum(["all", "log", "info", "warn", "error", "debug"])
          .optional()
          .describe(
            'Filter by log level. "all" (default) returns every message.',
          ),
        clear: coercedBoolean
          .optional()
          .describe(
            "Clear the message buffer after retrieval (default: false).",
          ),
        output_file: z
          .string()
          .optional()
          .describe(
            "Write console messages to this file path instead of returning inline. Relative paths resolve against output_dir (see charlotte:configure). Returns only a confirmation with the file path and size.",
          ),
      },
    },
    async ({ level, clear, output_file }) => {
      try {
        await deps.browserManager.ensureConnected();

        const filterLevel = level ?? "all";
        const messages = deps.pageManager.getConsoleMessages(filterLevel);

        logger.info("Retrieving console messages", {
          level: filterLevel,
          count: messages.length,
          clear,
        });

        if (clear) {
          deps.pageManager.clearConsoleMessages();
        }

        const result = {
          messages,
          count: messages.length,
          level: filterLevel,
          cleared: clear ?? false,
        };

        if (output_file) {
          const resolvedPath = await resolveOutputPath(output_file, deps.config);
          return await writeOutputFile(resolvedPath, JSON.stringify(result, null, 2));
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result),
            },
          ],
        };
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte:requests ───
  tools["charlotte:requests"] = server.registerTool(
    "charlotte:requests",
    {
      description:
        "Retrieve network request history from the active page. Returns all HTTP requests with method, status, resource type, and timestamps. Useful for debugging API calls and resource loading.",
      inputSchema: {
        url_pattern: z
          .string()
          .optional()
          .describe(
            "Filter requests by URL substring match (case-insensitive).",
          ),
        resource_type: z
          .enum([
            "document",
            "stylesheet",
            "image",
            "media",
            "font",
            "script",
            "texttrack",
            "xhr",
            "fetch",
            "eventsource",
            "websocket",
            "manifest",
            "other",
          ])
          .optional()
          .describe(
            "Filter by resource type (e.g. \"fetch\", \"xhr\", \"document\").",
          ),
        status_min: z
          .number()
          .optional()
          .describe(
            "Minimum HTTP status code to include (e.g. 400 for errors only).",
          ),
        clear: coercedBoolean
          .optional()
          .describe(
            "Clear the request buffer after retrieval (default: false).",
          ),
        output_file: z
          .string()
          .optional()
          .describe(
            "Write network requests to this file path instead of returning inline. Relative paths resolve against output_dir (see charlotte:configure). Returns only a confirmation with the file path and size.",
          ),
      },
    },
    async ({ url_pattern, resource_type, status_min, clear, output_file }) => {
      try {
        await deps.browserManager.ensureConnected();

        let requests = deps.pageManager.getNetworkRequests();

        if (url_pattern) {
          const lowerPattern = url_pattern.toLowerCase();
          requests = requests.filter((r) =>
            r.url.toLowerCase().includes(lowerPattern),
          );
        }

        if (resource_type) {
          requests = requests.filter((r) => r.resourceType === resource_type);
        }

        if (status_min !== undefined) {
          requests = requests.filter((r) => r.status >= status_min);
        }

        logger.info("Retrieving network requests", {
          total: deps.pageManager.getNetworkRequests().length,
          filtered: requests.length,
          url_pattern,
          resource_type,
          status_min,
          clear,
        });

        if (clear) {
          deps.pageManager.clearNetworkRequests();
        }

        const result = {
          requests,
          count: requests.length,
          cleared: clear ?? false,
        };

        if (output_file) {
          const resolvedPath = await resolveOutputPath(output_file, deps.config);
          return await writeOutputFile(resolvedPath, JSON.stringify(result, null, 2));
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result),
            },
          ],
        };
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  return tools;
}
