#!/usr/bin/env node
import * as fs from "node:fs/promises";
import * as path from "node:path";
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
import { parseCliArgs } from "./cli.js";

async function main(): Promise<void> {
  let cliOptions;
  try {
    cliOptions = parseCliArgs();
  } catch (error) {
    logger.error((error as Error).message);
    process.exit(1);
  }
  logger.info("Charlotte starting", {
    profile: cliOptions.profile ?? "browse",
    toolGroups: cliOptions.toolGroups,
  });

  // Initialize config first (needed by PageManager for dialog handling)
  const config = createDefaultConfig();
  if (cliOptions.outputDir) {
    const resolvedOutputDir = path.resolve(cliOptions.outputDir);
    config.outputDir = resolvedOutputDir;
    await fs.mkdir(resolvedOutputDir, { recursive: true });
  }

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
  const rendererPipeline = new RendererPipeline(cdpSessionManager, elementIdGenerator, config);
  const snapshotStore = new SnapshotStore(config.snapshotDepth);

  // Initialize screenshot artifact store
  const artifactStore = new ArtifactStore(config.screenshotDir);
  await artifactStore.initialize();

  // Initialize dev mode state
  const devModeState = new DevModeState(config);

  // Create and configure MCP server
  const { server: mcpServer } = createServer(
    {
      browserManager,
      pageManager,
      cdpSessionManager,
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
