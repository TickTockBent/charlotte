import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BrowserManager } from "./browser/browser-manager.js";
import type { PageManager } from "./browser/page-manager.js";
import type { CDPSessionManager } from "./browser/cdp-session.js";
import type { RendererPipeline } from "./renderer/renderer-pipeline.js";
import type { ElementIdGenerator } from "./renderer/element-id-generator.js";
import type { SnapshotStore } from "./state/snapshot-store.js";
import type { ArtifactStore } from "./state/artifact-store.js";
import type { CharlotteConfig } from "./types/config.js";
import { registerEvaluateTools } from "./tools/evaluate.js";
import { registerNavigationTools } from "./tools/navigation.js";
import { registerObservationTools } from "./tools/observation.js";
import { registerInteractionTools } from "./tools/interaction.js";
import { registerDialogTools } from "./tools/dialog.js";
import { registerSessionTools } from "./tools/session.js";
import { registerMonitoringTools } from "./tools/monitoring.js";
import { registerDevModeTools } from "./tools/dev-mode.js";
import { registerMetaTool, type ToolRegistry } from "./tools/meta-tool.js";
import {
  type ToolProfile,
  type ToolGroupName,
  TOOL_GROUPS,
  resolveProfile,
  resolveGroups,
  ALL_GROUP_NAMES,
  GROUP_DESCRIPTIONS,
} from "./tools/tool-groups.js";
import type { DevModeState } from "./dev/dev-mode-state.js";

export interface ServerDeps {
  browserManager: BrowserManager;
  pageManager: PageManager;
  cdpSessionManager: CDPSessionManager;
  rendererPipeline: RendererPipeline;
  elementIdGenerator: ElementIdGenerator;
  snapshotStore: SnapshotStore;
  artifactStore: ArtifactStore;
  config: CharlotteConfig;
  devModeState?: DevModeState;
}

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

  const registry: ToolRegistry = {};

  // Evaluate tool (different deps signature)
  Object.assign(
    registry,
    registerEvaluateTools(server, {
      browserManager: deps.browserManager,
      pageManager: deps.pageManager,
      getActivePage: () => deps.pageManager.getActivePage(),
      maxEvaluateBytes: deps.config.limits.maxEvaluateBytes,
    }),
  );

  // All other tool modules share the same dependency bundle
  const toolDeps = {
    browserManager: deps.browserManager,
    pageManager: deps.pageManager,
    cdpSessionManager: deps.cdpSessionManager,
    rendererPipeline: deps.rendererPipeline,
    elementIdGenerator: deps.elementIdGenerator,
    snapshotStore: deps.snapshotStore,
    artifactStore: deps.artifactStore,
    config: deps.config,
    devModeState: deps.devModeState,
  };

  Object.assign(registry, registerNavigationTools(server, toolDeps));
  Object.assign(registry, registerObservationTools(server, toolDeps));
  Object.assign(registry, registerInteractionTools(server, toolDeps));
  Object.assign(registry, registerDialogTools(server, toolDeps));
  Object.assign(registry, registerSessionTools(server, toolDeps));
  Object.assign(registry, registerMonitoringTools(server, toolDeps));
  Object.assign(registry, registerDevModeTools(server, toolDeps));

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
