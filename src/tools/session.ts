import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logger } from "../utils/logger.js";
import type { AutoSnapshotMode, DialogAutoDismiss } from "../types/config.js";
import type { ToolDependencies } from "./tool-helpers.js";
import {
  renderActivePage,
  formatPageResponse,
  handleToolError,
} from "./tool-helpers.js";

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
  // ─── charlotte:get_cookies ───
  server.registerTool(
    "charlotte:get_cookies",
    {
      description:
        "Get cookies for the active page. Optionally filter by URL(s). Returns cookie name, value, domain, path, and flags.",
      inputSchema: {
        urls: z
          .array(z.string())
          .optional()
          .describe(
            "URLs to filter cookies by. If omitted, returns cookies for the current page URL.",
          ),
      },
    },
    async ({ urls }) => {
      try {
        await deps.browserManager.ensureConnected();
        const page = deps.pageManager.getActivePage();

        logger.info("Getting cookies", { urls });

        const cookies = urls?.length
          ? await page.cookies(...urls)
          : await page.cookies();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                cookies: cookies.map((c) => ({
                  name: c.name,
                  value: c.value,
                  domain: c.domain,
                  path: c.path,
                  expires: c.expires,
                  httpOnly: c.httpOnly,
                  secure: c.secure,
                  sameSite: c.sameSite,
                })),
                count: cookies.length,
              }),
            },
          ],
        };
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte:clear_cookies ───
  server.registerTool(
    "charlotte:clear_cookies",
    {
      description:
        "Clear cookies from the browser. Optionally filter by name(s) to remove specific cookies. Without a filter, clears all cookies for the current page.",
      inputSchema: {
        names: z
          .array(z.string())
          .optional()
          .describe(
            "Cookie names to delete. If omitted, clears all cookies for the current page.",
          ),
      },
    },
    async ({ names }) => {
      try {
        await deps.browserManager.ensureConnected();
        const page = deps.pageManager.getActivePage();

        logger.info("Clearing cookies", { names });

        const currentCookies = await page.cookies();
        const cookiesToDelete = names
          ? currentCookies.filter((c) => names.includes(c.name))
          : currentCookies;

        await page.deleteCookie(...cookiesToDelete);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                cleared: cookiesToDelete.length,
                names: cookiesToDelete.map((c) => c.name),
              }),
            },
          ],
        };
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

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
        screenshot_dir: z
          .string()
          .optional()
          .describe(
            "Directory for persistent screenshot artifacts. Changes take effect immediately; existing artifacts remain in the previous directory.",
          ),
        dialog_auto_dismiss: z
          .enum(["none", "accept_alerts", "accept_all", "dismiss_all"])
          .optional()
          .describe(
            'Auto-dismiss behavior for JS dialogs. "none" (default) queues for charlotte:dialog.',
          ),
      },
    },
    async ({ snapshot_depth, auto_snapshot, screenshot_dir, dialog_auto_dismiss }) => {
      try {
        logger.info("Configuring Charlotte", { snapshot_depth, auto_snapshot, screenshot_dir });

        if (snapshot_depth !== undefined) {
          deps.snapshotStore.setDepth(snapshot_depth);
          deps.config.snapshotDepth = Math.max(5, Math.min(500, snapshot_depth));
        }

        if (auto_snapshot !== undefined) {
          deps.config.autoSnapshot = auto_snapshot as AutoSnapshotMode;
        }

        if (screenshot_dir !== undefined) {
          deps.config.screenshotDir = screenshot_dir;
          await deps.artifactStore.setScreenshotDir(screenshot_dir);
        }

        if (dialog_auto_dismiss !== undefined) {
          deps.config.dialogAutoDismiss = dialog_auto_dismiss as DialogAutoDismiss;
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
                  screenshot_dir: deps.artifactStore.screenshotDir,
                  dialog_auto_dismiss: deps.config.dialogAutoDismiss,
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

  // ─── charlotte:tabs ───
  server.registerTool(
    "charlotte:tabs",
    {
      description: "List all open browser tabs with their URLs, titles, and active status.",
      inputSchema: {},
    },
    async () => {
      try {
        await deps.browserManager.ensureConnected();

        const tabs = await deps.pageManager.listTabs();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ tabs }),
            },
          ],
        };
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte:tab_open ───
  server.registerTool(
    "charlotte:tab_open",
    {
      description:
        "Open a new browser tab. Optionally navigate to a URL. The new tab becomes the active tab.",
      inputSchema: {
        url: z
          .string()
          .optional()
          .describe("URL to navigate to (default: blank page)"),
      },
    },
    async ({ url }) => {
      try {
        await deps.browserManager.ensureConnected();

        const tabId = await deps.pageManager.openTab(deps.browserManager, url);
        logger.info("Opened new tab", { tabId, url });

        const representation = await renderActivePage(deps, {
          source: "action",
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                tab_id: tabId,
                ...representation,
              }, null, 2),
            },
          ],
        };
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte:tab_switch ───
  server.registerTool(
    "charlotte:tab_switch",
    {
      description:
        "Switch to a different browser tab by its tab ID. Returns the page representation of the activated tab.",
      inputSchema: {
        tab_id: z.string().describe("ID of the tab to switch to"),
      },
    },
    async ({ tab_id }) => {
      try {
        await deps.browserManager.ensureConnected();

        await deps.pageManager.switchTab(tab_id);
        logger.info("Switched to tab", { tab_id });

        const representation = await renderActivePage(deps, {
          source: "action",
        });

        return formatPageResponse(representation);
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte:tab_close ───
  server.registerTool(
    "charlotte:tab_close",
    {
      description:
        "Close a browser tab by its ID. If the closed tab was active, switches to the first remaining tab.",
      inputSchema: {
        tab_id: z.string().describe("ID of the tab to close"),
      },
    },
    async ({ tab_id }) => {
      try {
        await deps.browserManager.ensureConnected();

        await deps.pageManager.closeTab(tab_id);
        logger.info("Closed tab", { tab_id });

        const remainingTabs = await deps.pageManager.listTabs();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                closed: tab_id,
                remaining_tabs: remainingTabs,
              }),
            },
          ],
        };
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte:viewport ───

  const DEVICE_PRESETS: Record<string, { width: number; height: number }> = {
    mobile: { width: 375, height: 667 },
    tablet: { width: 768, height: 1024 },
    desktop: { width: 1280, height: 720 },
  };

  server.registerTool(
    "charlotte:viewport",
    {
      description:
        "Change the browser viewport dimensions. Use a device preset or specify custom width/height. Returns page representation at the new viewport size.",
      inputSchema: {
        width: z
          .number()
          .optional()
          .describe("Viewport width in pixels"),
        height: z
          .number()
          .optional()
          .describe("Viewport height in pixels"),
        device: z
          .enum(["mobile", "tablet", "desktop"])
          .optional()
          .describe(
            'Device preset (overrides width/height). "mobile" = 375×667, "tablet" = 768×1024, "desktop" = 1280×720',
          ),
      },
    },
    async ({ width, height, device }) => {
      try {
        await deps.browserManager.ensureConnected();
        const page = deps.pageManager.getActivePage();

        let viewportWidth: number;
        let viewportHeight: number;

        if (device) {
          const preset = DEVICE_PRESETS[device];
          viewportWidth = preset.width;
          viewportHeight = preset.height;
        } else if (width !== undefined && height !== undefined) {
          viewportWidth = width;
          viewportHeight = height;
        } else {
          viewportWidth = width ?? 1280;
          viewportHeight = height ?? 720;
        }

        logger.info("Setting viewport", {
          width: viewportWidth,
          height: viewportHeight,
          device,
        });

        await page.setViewport({
          width: viewportWidth,
          height: viewportHeight,
        });

        const representation = await renderActivePage(deps, {
          source: "action",
        });

        return formatPageResponse(representation);
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte:network ───

  const THROTTLE_PRESETS: Record<
    string,
    {
      offline: boolean;
      downloadThroughput: number;
      uploadThroughput: number;
      latency: number;
    }
  > = {
    "3g": {
      offline: false,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
      latency: 150,
    },
    "4g": {
      offline: false,
      downloadThroughput: (4 * 1024 * 1024) / 8,
      uploadThroughput: (3 * 1024 * 1024) / 8,
      latency: 20,
    },
    offline: {
      offline: true,
      downloadThroughput: 0,
      uploadThroughput: 0,
      latency: 0,
    },
    none: {
      offline: false,
      downloadThroughput: -1,
      uploadThroughput: -1,
      latency: 0,
    },
  };

  server.registerTool(
    "charlotte:network",
    {
      description:
        "Configure network conditions for the active page. Set throttling presets, block URL patterns, or enable request logging.",
      inputSchema: {
        throttle: z
          .enum(["3g", "4g", "offline", "none"])
          .optional()
          .describe(
            'Network throttling preset. "3g" = slow, "4g" = fast mobile, "offline" = no network, "none" = disable throttling',
          ),
        block: z
          .array(z.string())
          .optional()
          .describe(
            "URL patterns to block (e.g. [\"*.ads.com\", \"tracking.js\"]). Pass empty array to clear.",
          ),
      },
    },
    async ({ throttle, block }) => {
      try {
        await deps.browserManager.ensureConnected();
        const page = deps.pageManager.getActivePage();
        const session = await page.createCDPSession();

        const appliedSettings: {
          throttle?: string;
          blocked_patterns?: string[];
        } = {};

        if (throttle !== undefined) {
          const preset = THROTTLE_PRESETS[throttle];
          await session.send("Network.emulateNetworkConditions", preset);
          appliedSettings.throttle = throttle;
          logger.info("Applied network throttling", { throttle });
        }

        if (block !== undefined) {
          await session.send("Network.setBlockedURLs", { urls: block });
          appliedSettings.blocked_patterns = block;
          logger.info("Set blocked URL patterns", {
            patternCount: block.length,
          });
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                network: appliedSettings,
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
