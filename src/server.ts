import { readFileSync } from "node:fs";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
);
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

export function createServer(deps: ServerDeps, options: ServerOptions = {}): CreateServerResult {
  // Resolve which tools should be enabled
  const profileName = options.toolGroups ? undefined : (options.profile ?? "browse");
  const enabledTools = options.toolGroups
    ? resolveGroups(options.toolGroups)
    : resolveProfile(profileName!);

  // Build server instructions — only list groups where every tool is disabled
  const fullyDisabledGroups = ALL_GROUP_NAMES.filter((group) => {
    const groupTools = TOOL_GROUPS[group];
    return groupTools.every((t) => !enabledTools.has(t));
  });

  const activeLabel = profileName
    ? `Active profile: ${profileName}.`
    : `Active groups: ${options.toolGroups!.join(", ")}.`;
  const instructionLines = [`Charlotte browser automation server. ${activeLabel}`];
  if (fullyDisabledGroups.length > 0) {
    instructionLines.push("Additional tool groups available via charlotte_tools:");
    for (const group of fullyDisabledGroups) {
      instructionLines.push(`  - ${group}: ${GROUP_DESCRIPTIONS[group]}`);
    }
    instructionLines.push("Call charlotte_tools to list groups or enable/disable them.");
  }

  const server = new McpServer(
    {
      name: "charlotte",
      version,
    },
    {
      capabilities: {
        tools: { listChanged: true },
        logging: {},
      },
      instructions: instructionLines.join("\n"),
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

  for (const [toolName, tool] of Object.entries(registry)) {
    if (!enabledTools.has(toolName)) {
      tool.disable();
    }
  }

  // ─── Register meta-tool (always enabled) ───

  registerMetaTool(server, registry);

  return { server, registry };
}
