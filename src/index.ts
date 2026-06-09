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
import { loadStartupConfig } from "./config/index.js";

async function main(): Promise<void> {
  let resolved;
  try {
    resolved = loadStartupConfig();
  } catch (error) {
    // stdout is reserved for the MCP transport — config errors go to stderr.
    logger.error((error as Error).message);
    process.exit(1);
  }
  logger.info("Charlotte starting", {
    profile: resolved.profile ?? (resolved.toolGroups ? undefined : "browse"),
    toolGroups: resolved.toolGroups,
    noSandbox: resolved.noSandbox,
  });

  // Initialize config first (needed by PageManager for dialog handling).
  // Config-file tunables (snapshot depth, dialog handling, iframe rendering)
  // override the built-in defaults; CLI/env precedence is already resolved.
  const config = createDefaultConfig();
  if (resolved.snapshotDepth !== undefined) config.snapshotDepth = resolved.snapshotDepth;
  if (resolved.autoSnapshot !== undefined) config.autoSnapshot = resolved.autoSnapshot;
  if (resolved.dialogAutoDismiss !== undefined)
    config.dialogAutoDismiss = resolved.dialogAutoDismiss;
  if (resolved.includeIframes !== undefined) config.includeIframes = resolved.includeIframes;
  if (resolved.iframeDepth !== undefined) config.iframeDepth = resolved.iframeDepth;
  if (resolved.outputDir) {
    const resolvedOutputDir = path.resolve(resolved.outputDir);
    config.outputDir = resolvedOutputDir;
    await fs.mkdir(resolvedOutputDir, { recursive: true });
  }

  // Initialize browser and page management.
  // In CDP mode, connection + page adoption happen lazily on first tool call,
  // so the remote browser isn't contacted until actually needed.
  const cdpSessionManager = new CDPSessionManager();
  const pageManager = new PageManager(config, cdpSessionManager);
  const browserManager = new BrowserManager(
    config,
    { headless: resolved.headless, noSandbox: resolved.noSandbox },
    resolved.cdpEndpoint,
    resolved.cdpEndpoint
      ? async (browser) => {
          await pageManager.adoptExistingPages(browser);
        }
      : undefined,
  );

  // When the browser transport drops (crash/kill), clear PageManager's dead
  // Page objects and CDP session caches so the next tool call relaunches and
  // opens a fresh blank tab instead of operating on a wedged connection (#201).
  browserManager.setOnDisconnected(() => {
    pageManager.reset();
  });

  // Initialize renderer pipeline
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
    { profile: resolved.profile, toolGroups: resolved.toolGroups },
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
