#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BrowserManager } from "./browser/browser-manager.js";
import { PageManager } from "./browser/page-manager.js";
import { CDPSessionManager } from "./browser/cdp-session.js";
import { RendererPipeline } from "./renderer/renderer-pipeline.js";
import { ElementIdGenerator } from "./renderer/element-id-generator.js";
import { SnapshotStore } from "./state/snapshot-store.js";
import { ArtifactStore } from "./state/artifact-store.js";
import { createDefaultConfig } from "./types/config.js";
import { createServer } from "./server.js";
import { DevModeState } from "./dev/dev-mode-state.js";
import { logger } from "./utils/logger.js";
import type { ToolProfile, ToolGroupName } from "./tools/tool-groups.js";

const VALID_PROFILES: ToolProfile[] = [
  "core", "browse", "interact", "develop", "audit", "full",
];

const VALID_GROUPS: ToolGroupName[] = [
  "navigation", "observation", "interaction", "session",
  "dev_mode", "dialog", "evaluate", "monitoring",
];

function parseCliArgs(): { profile?: ToolProfile; toolGroups?: ToolGroupName[] } {
  const args = process.argv.slice(2);

  const profileArg = args.find((a) => a.startsWith("--profile="));
  const toolsArg = args.find((a) => a.startsWith("--tools="));

  if (profileArg && toolsArg) {
    logger.warn("Both --profile and --tools provided; --profile takes precedence");
  }

  if (profileArg) {
    const profile = profileArg.split("=")[1] as ToolProfile;
    if (!VALID_PROFILES.includes(profile)) {
      logger.error(`Invalid profile: ${profile}. Valid profiles: ${VALID_PROFILES.join(", ")}`);
      process.exit(1);
    }
    return { profile };
  }

  if (toolsArg) {
    const groups = toolsArg.split("=")[1].split(",") as ToolGroupName[];
    for (const group of groups) {
      if (!VALID_GROUPS.includes(group)) {
        logger.error(`Invalid tool group: ${group}. Valid groups: ${VALID_GROUPS.join(", ")}`);
        process.exit(1);
      }
    }
    return { toolGroups: groups };
  }

  // Default: browse profile
  return {};
}

async function main(): Promise<void> {
  const cliOptions = parseCliArgs();
  logger.info("Charlotte starting", {
    profile: cliOptions.profile ?? "browse",
    toolGroups: cliOptions.toolGroups,
  });

  // Initialize config first (needed by PageManager for dialog handling)
  const config = createDefaultConfig();

  // Initialize browser
  const browserManager = new BrowserManager();
  await browserManager.launch();

  // Initialize page management
  const pageManager = new PageManager(config);

  // Open a default tab
  await pageManager.openTab(browserManager);

  // Initialize renderer pipeline
  const cdpSessionManager = new CDPSessionManager();
  const elementIdGenerator = new ElementIdGenerator();
  const rendererPipeline = new RendererPipeline(
    cdpSessionManager,
    elementIdGenerator,
  );
  const snapshotStore = new SnapshotStore(config.snapshotDepth);

  // Initialize screenshot artifact store
  const artifactStore = new ArtifactStore(config.screenshotDir);
  await artifactStore.initialize();

  // Initialize dev mode state
  const devModeState = new DevModeState(config);

  // Create and configure MCP server
  const mcpServer = createServer(
    {
      browserManager,
      pageManager,
      rendererPipeline,
      elementIdGenerator,
      snapshotStore,
      artifactStore,
      config,
      devModeState,
    },
    cliOptions,
  );

  // Connect stdio transport
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  logger.info("Charlotte MCP server running on stdio");

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down");
    await devModeState.stopAll();
    await mcpServer.close();
    await browserManager.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  logger.error("Fatal error", error);
  process.exit(1);
});
