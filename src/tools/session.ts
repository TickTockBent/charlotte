import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logger } from "../utils/logger.js";
import type { AutoSnapshotMode } from "../types/config.js";
import type { ToolDependencies } from "./tool-helpers.js";
import { handleToolError } from "./tool-helpers.js";

const CookieSchema = z.object({
  name: z.string().describe("Cookie name"),
  value: z.string().describe("Cookie value"),
  domain: z.string().describe("Cookie domain"),
  path: z.string().optional().describe("Cookie path (default: '/')"),
  secure: z.boolean().optional().describe("Secure flag"),
  httpOnly: z.boolean().optional().describe("HttpOnly flag"),
  sameSite: z
    .enum(["Strict", "Lax", "None"])
    .optional()
    .describe("SameSite attribute"),
});

export function registerSessionTools(
  server: McpServer,
  deps: ToolDependencies,
): void {
  // ─── charlotte:set_cookies ───
  server.registerTool(
    "charlotte:set_cookies",
    {
      description:
        "Set cookies on the active page. Cookies persist for subsequent navigations within matching domains.",
      inputSchema: {
        cookies: z
          .array(CookieSchema)
          .describe("Array of cookie objects to set"),
      },
    },
    async ({ cookies }) => {
      try {
        await deps.browserManager.ensureConnected();
        const page = deps.pageManager.getActivePage();

        logger.info("Setting cookies", { count: cookies.length });

        const puppeteerCookies = cookies.map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path ?? "/",
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite as "Strict" | "Lax" | "None" | undefined,
        }));

        await page.setCookie(...puppeteerCookies);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                cookies_set: cookies.length,
                details: cookies.map((c) => ({
                  name: c.name,
                  domain: c.domain,
                  path: c.path ?? "/",
                })),
              }),
            },
          ],
        };
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte:set_headers ───
  server.registerTool(
    "charlotte:set_headers",
    {
      description:
        "Set extra HTTP headers for subsequent requests. Headers persist for all navigations on the active page.",
      inputSchema: {
        headers: z
          .record(z.string(), z.string())
          .describe("Key-value header pairs (e.g. { 'Authorization': 'Bearer token' })"),
      },
    },
    async ({ headers }) => {
      try {
        await deps.browserManager.ensureConnected();
        const page = deps.pageManager.getActivePage();

        logger.info("Setting extra HTTP headers", {
          headerNames: Object.keys(headers),
        });

        await page.setExtraHTTPHeaders(headers);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                headers_set: Object.keys(headers),
              }),
            },
          ],
        };
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte:configure ───
  server.registerTool(
    "charlotte:configure",
    {
      description:
        "Configure Charlotte runtime settings. Changes take effect immediately.",
      inputSchema: {
        snapshot_depth: z
          .number()
          .optional()
          .describe("Ring buffer size for snapshots (default: 50, min: 5, max: 500)"),
        auto_snapshot: z
          .enum(["every_action", "observe_only", "manual"])
          .optional()
          .describe(
            '"every_action" (default) — snapshot after every tool, "observe_only" — only on observe, "manual" — only with explicit snapshot: true',
          ),
      },
    },
    async ({ snapshot_depth, auto_snapshot }) => {
      try {
        logger.info("Configuring Charlotte", { snapshot_depth, auto_snapshot });

        if (snapshot_depth !== undefined) {
          deps.snapshotStore.setDepth(snapshot_depth);
          deps.config.snapshotDepth = Math.max(5, Math.min(500, snapshot_depth));
        }

        if (auto_snapshot !== undefined) {
          deps.config.autoSnapshot = auto_snapshot as AutoSnapshotMode;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                config: {
                  snapshot_depth: deps.config.snapshotDepth,
                  auto_snapshot: deps.config.autoSnapshot,
                },
              }),
            },
          ],
        };
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );
}
