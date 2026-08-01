import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SessionContext } from "./core/types.js";
import { registerMetaTool, type ToolRegistry } from "./tools/meta-tool.js";
import { registerCoreTools } from "./transports/stdio.js";
import {
  type ToolProfile,
  type ToolGroupName,
  TOOL_GROUPS,
  resolveProfile,
  resolveGroups,
  ALL_GROUP_NAMES,
  GROUP_DESCRIPTIONS,
} from "./tools/tool-groups.js";

export type { SessionContext } from "./core/types.js";

/**
 * @deprecated Historical name for {@link SessionContext}. Retained so existing
 * callers and tests (`import type { ServerDeps } from "./server.js"`) compile
 * unchanged.
 */
export type ServerDeps = SessionContext;

export interface ServerOptions {
  profile?: ToolProfile;
  toolGroups?: ToolGroupName[];
}

export interface CreateServerResult {
  server: McpServer;
  registry: ToolRegistry;
}

/**
 * Build the server instructions string from the set of enabled tool names.
 *
 * Lists both fully-disabled groups (nothing usable until enabled) and
 * partially-enabled groups (some tools hidden) so an agent has a discoverability
 * path to tools like fill_form without having to spontaneously call
 * charlotte_tools (#204).
 *
 * Exported (and pure) so it can be unit-tested without standing up a server.
 */
export function buildServerInstructions(enabledTools: Set<string>, activeLabel: string): string {
  const fullyDisabledGroups: ToolGroupName[] = [];
  const partiallyEnabledGroups: Array<{ group: ToolGroupName; enabled: number; total: number }> =
    [];
  for (const group of ALL_GROUP_NAMES) {
    const groupTools = TOOL_GROUPS[group];
    const enabledCount = groupTools.filter((t) => enabledTools.has(t)).length;
    if (enabledCount === 0) {
      fullyDisabledGroups.push(group);
    } else if (enabledCount < groupTools.length) {
      partiallyEnabledGroups.push({ group, enabled: enabledCount, total: groupTools.length });
    }
  }

  const instructionLines = [`Charlotte browser automation server. ${activeLabel}`];
  if (fullyDisabledGroups.length > 0) {
    instructionLines.push("Additional tool groups available via charlotte_tools:");
    for (const group of fullyDisabledGroups) {
      instructionLines.push(`  - ${group}: ${GROUP_DESCRIPTIONS[group]}`);
    }
  }
  if (partiallyEnabledGroups.length > 0) {
    instructionLines.push("Partially-enabled groups (enable via charlotte_tools for more tools):");
    for (const { group, enabled, total } of partiallyEnabledGroups) {
      const disabledTools = TOOL_GROUPS[group]
        .filter((t) => !enabledTools.has(t))
        .map((t) => t.replace(/^charlotte_/, ""));
      instructionLines.push(
        `  - ${group} (${enabled}/${total} enabled — enable for ${disabledTools.join(", ")})`,
      );
    }
  }
  if (fullyDisabledGroups.length > 0 || partiallyEnabledGroups.length > 0) {
    instructionLines.push("Call charlotte_tools to list groups or enable/disable them.");
  }

  return instructionLines.join("\n");
}

export function createServer(deps: ServerDeps, options: ServerOptions = {}): CreateServerResult {
  // Resolve which tools should be enabled
  const profileName = options.toolGroups ? undefined : (options.profile ?? "browse");
  const enabledTools = options.toolGroups
    ? resolveGroups(options.toolGroups)
    : resolveProfile(profileName!);

  const activeLabel = profileName
    ? `Active profile: ${profileName}.`
    : `Active groups: ${options.toolGroups!.join(", ")}.`;
  const instructions = buildServerInstructions(enabledTools, activeLabel);

  const server = new McpServer(
    {
      name: "charlotte",
      version,
    },
    {
      capabilities: {
        // listChanged: prep for runtime tool toggling (e.g. profile switching)
        tools: { listChanged: true },
        logging: {},
      },
      instructions,
    },
  );

  // ─── Register all tools and collect references ───
  // Every tool handler lives in src/core/ as a transport-agnostic
  // ToolDefinition; the stdio adapter binds them to this server, in the
  // canonical charlotteTools order.

  const registry: ToolRegistry = registerCoreTools(server, deps);

  // ─── Apply profile: disable tools not in the enabled set ───
  // Set .enabled directly to batch state changes before a single
  // sendToolListChanged(). Do not call tool.disable() here — each
  // call fires an independent notification via the SDK's update().

  let disabledCount = 0;
  for (const [toolName, tool] of Object.entries(registry)) {
    if (!enabledTools.has(toolName)) {
      tool.enabled = false;
      disabledCount++;
    }
  }
  if (disabledCount > 0) {
    server.sendToolListChanged();
  }

  // ─── Register meta-tool (always enabled) ───

  registerMetaTool(server, registry);

  return { server, registry };
}
