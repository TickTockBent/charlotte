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

async function main(): Promise<void> {
  logger.info("Charlotte starting");

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
  const devModeState = new DevModeState();

  // Create and configure MCP server
  const mcpServer = createServer({
    browserManager,
    pageManager,
    rendererPipeline,
    elementIdGenerator,
    snapshotStore,
    artifactStore,
    config,
    devModeState,
  });

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
