/**
 * The charlotte_tools meta-tool for runtime tool group management.
 *
 * Always registered regardless of profile. Allows agents to discover
 * available groups and enable/disable them at runtime.
 */

import { z } from "zod";
import type { McpServer, RegisteredTool } from "@modelcontextprotocol/server";
import { DEFAULT_SESSION_ID } from "../core/types.js";
import {
  TOOL_GROUPS,
  ALL_GROUP_NAMES,
  GROUP_DESCRIPTIONS,
  type ToolGroupName,
} from "./tool-groups.js";

export type ToolRegistry = Record<string, RegisteredTool>;

/**
 * Get the enabled/disabled status of each group based on the tool registry.
 */
interface GroupStatus {
  enabled: boolean;
  enabled_count: number;
  total_count: number;
  tools: string[];
  description: string;
}

function getGroupStatus(registry: ToolRegistry): Record<string, GroupStatus> {
  const status: Record<string, GroupStatus> = {};

  for (const groupName of ALL_GROUP_NAMES) {
    const toolNames = TOOL_GROUPS[groupName];
    const enabledCount = toolNames.filter((name) => registry[name]?.enabled === true).length;
    status[groupName] = {
      enabled: enabledCount === toolNames.length,
      enabled_count: enabledCount,
      total_count: toolNames.length,
      tools: [...toolNames],
      description: GROUP_DESCRIPTIONS[groupName],
    };
  }

  return status;
}

/**
 * Register the charlotte_tools meta-tool.
 */
export function registerMetaTool(server: McpServer, registry: ToolRegistry): RegisteredTool {
  return server.registerTool(
    "charlotte_tools",
    {
      description:
        "Manage Charlotte tool visibility. Lists available tool groups and their " +
        "status. Use 'enable' or 'disable' to control which tools are loaded. " +
        "Disabled tools don't appear in the tool list — enable a group to access its tools. " +
        "Groups: 'interaction' for form filling, clicking, and drag-and-drop. " +
        "'session' for cookie/auth management, tab switching, viewport, and network. " +
        "'dev_mode' for local development serving and audits. " +
        "'evaluate' for JavaScript execution. " +
        "'monitoring' for console and network request logs. " +
        "'dialog' for JavaScript dialog handling.",
      inputSchema: {
        action: z
          .enum(["list", "enable", "disable"])
          .optional()
          .describe(
            '"list" (default) — show all groups and status. "enable"/"disable" — toggle a group.',
          ),
        group: z
          .enum(ALL_GROUP_NAMES as [ToolGroupName, ...ToolGroupName[]])
          .optional()
          .describe("Tool group to enable or disable"),
      },
    },
    async ({ action, group }) => {
      const effectiveAction = action ?? "list";

      if ((effectiveAction === "enable" || effectiveAction === "disable") && !group) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                session_id: DEFAULT_SESSION_ID,
                error: "group is required for enable/disable actions",
              }),
            },
          ],
          isError: true,
        };
      }

      if (effectiveAction === "enable" && group) {
        const toolNames = TOOL_GROUPS[group as ToolGroupName];
        let enabled = 0;
        // Set .enabled directly to batch state changes before a single
        // sendToolListChanged(). Do not call tool.enable() here — each
        // call fires an independent notification via the SDK's update().
        for (const name of toolNames) {
          const tool = registry[name];
          if (tool && !tool.enabled) {
            tool.enabled = true;
            enabled++;
          }
        }
        if (enabled > 0) {
          server.sendToolListChanged();
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                session_id: DEFAULT_SESSION_ID,
                action: "enable",
                group,
                tools_enabled: enabled,
                tools: [...toolNames],
              }),
            },
          ],
        };
      }

      if (effectiveAction === "disable" && group) {
        const toolNames = TOOL_GROUPS[group as ToolGroupName];
        let disabled = 0;
        // Set .enabled directly — see comment in enable block above.
        for (const name of toolNames) {
          const tool = registry[name];
          if (tool?.enabled) {
            tool.enabled = false;
            disabled++;
          }
        }
        if (disabled > 0) {
          server.sendToolListChanged();
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                session_id: DEFAULT_SESSION_ID,
                action: "disable",
                group,
                tools_disabled: disabled,
                tools: [...toolNames],
              }),
            },
          ],
        };
      }

      // Default: list
      const status = getGroupStatus(registry);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ session_id: DEFAULT_SESSION_ID, groups: status }),
          },
        ],
      };
    },
  );
}

/**
 * Register a READ-ONLY charlotte_tools reporter for transports whose tool set
 * is fixed at startup (HTTP mode — stateless, no per-connection registry to
 * mutate). Reports the exposed group/tool inventory (the #204 discoverability
 * rationale) with no mutation path. enable/disable are accepted for schema
 * parity with the stdio meta-tool but refuse+steer to the http.profile knob.
 */
export function registerMetaToolReporter(
  server: McpServer,
  registry: ToolRegistry,
): RegisteredTool {
  return server.registerTool(
    "charlotte_tools",
    {
      description:
        "Report Charlotte's exposed tool groups (read-only). This server's tool " +
        "set is fixed at startup and cannot be changed at runtime — use 'list' " +
        "to see which groups are exposed and which tools each contains. To expose " +
        "more tools, change http.profile in the server config.",
      inputSchema: {
        action: z
          .enum(["list", "enable", "disable"])
          .optional()
          .describe(
            '"list" (default) — show all groups and which are exposed. ' +
              '"enable"/"disable" are not available on this server (fixed tool set).',
          ),
        group: z
          .enum(ALL_GROUP_NAMES as [ToolGroupName, ...ToolGroupName[]])
          .optional()
          .describe(
            "Tool group (only meaningful for enable/disable, which this server rejects)",
          ),
      },
    },
    async ({ action, group }) => {
      const effectiveAction = action ?? "list";

      if (effectiveAction === "enable" || effectiveAction === "disable") {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                session_id: DEFAULT_SESSION_ID,
                read_only: true,
                error:
                  "This server's tool set is fixed at startup and cannot be " +
                  "changed at runtime. To expose more tools, set http.profile " +
                  "(e.g. 'develop' or 'full') in the server config.",
                requested_action: effectiveAction,
                ...(group ? { group } : {}),
              }),
            },
          ],
          isError: true,
        };
      }

      const status = getGroupStatus(registry);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              session_id: DEFAULT_SESSION_ID,
              read_only: true,
              groups: status,
            }),
          },
        ],
      };
    },
  );
}
