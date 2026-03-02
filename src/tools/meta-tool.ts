/**
 * The charlotte:tools meta-tool for runtime tool group management.
 *
 * Always registered regardless of profile. Allows agents to discover
 * available groups and enable/disable them at runtime.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
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
function getGroupStatus(registry: ToolRegistry): Record<string, {
  enabled: boolean;
  tools: string[];
  description: string;
}> {
  const status: Record<string, {
    enabled: boolean;
    tools: string[];
    description: string;
  }> = {};

  for (const groupName of ALL_GROUP_NAMES) {
    const toolNames = TOOL_GROUPS[groupName];
    // A group is "enabled" if at least one of its tools is enabled
    // and "disabled" if all are disabled
    const enabledTools = toolNames.filter(
      (name) => registry[name]?.enabled === true,
    );
    status[groupName] = {
      enabled: enabledTools.length > 0,
      tools: [...toolNames],
      description: GROUP_DESCRIPTIONS[groupName],
    };
  }

  return status;
}

/**
 * Register the charlotte:tools meta-tool.
 */
export function registerMetaTool(
  server: McpServer,
  registry: ToolRegistry,
): RegisteredTool {
  return server.registerTool(
    "charlotte:tools",
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
          .describe('"list" (default) — show all groups and status. "enable"/"disable" — toggle a group.'),
        group: z
          .enum([
            "navigation",
            "observation",
            "interaction",
            "session",
            "dev_mode",
            "dialog",
            "evaluate",
            "monitoring",
          ])
          .optional()
          .describe("Tool group to enable or disable"),
      },
    },
    async ({ action, group }) => {
      const effectiveAction = action ?? "list";

      if (effectiveAction === "enable" && group) {
        const toolNames = TOOL_GROUPS[group as ToolGroupName];
        let enabled = 0;
        for (const name of toolNames) {
          const tool = registry[name];
          if (tool && !tool.enabled) {
            tool.enable();
            enabled++;
          }
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
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
        for (const name of toolNames) {
          const tool = registry[name];
          if (tool?.enabled) {
            tool.disable();
            disabled++;
          }
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
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
            text: JSON.stringify({ groups: status }),
          },
        ],
      };
    },
  );
}
