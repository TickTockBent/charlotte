import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logger } from "../utils/logger.js";
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
}
