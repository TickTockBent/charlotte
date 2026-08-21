#!/usr/bin/env node
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { BrowserManager } from "./browser/browser-manager.js";
import { PageManager } from "./browser/page-manager.js";
import { CDPSessionManager } from "./browser/cdp-session.js";
import { RendererPipeline } from "./renderer/renderer-pipeline.js";
import { ElementIdGenerator } from "./renderer/element-id-generator.js";
import { SnapshotStore } from "./state/snapshot-store.js";
import { ArtifactStore } from "./state/artifact-store.js";
import { createDefaultConfig } from "./types/config.js";
import { createServer } from "./server.js";
import type { SessionContext } from "./core/types.js";
import { startHttpTransport } from "./transports/http.js";
import { DevModeState } from "./dev/dev-mode-state.js";
import { logger } from "./utils/logger.js";
import { loadStartupConfig } from "./config/index.js";
import type { ResolvedOptions } from "./config/resolve.js";
import { isDoctorInvocation } from "./cli.js";
import { runDoctorCli } from "./doctor.js";

/**
 * Build the process's single {@link SessionContext} — the browser, page, and
 * render services every tool handler operates on.
 *
 * Both transports get the same graph: stdio binds it to an `McpServer`, HTTP
 * binds it to the streamable endpoint. Nothing here launches Chromium; the
 * browser stays lazy until the first tool call.
 */
async function buildSessionContext(resolved: ResolvedOptions): Promise<SessionContext> {
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
  // Output-size caps (issue #188): each falls back to its built-in default.
  if (resolved.maxInteractiveElements !== undefined)
    config.limits.maxInteractiveElements = resolved.maxInteractiveElements;
  if (resolved.maxFullContentChars !== undefined)
    config.limits.maxFullContentChars = resolved.maxFullContentChars;
  if (resolved.maxResponseBytes !== undefined)
    config.limits.maxResponseBytes = resolved.maxResponseBytes;
  if (resolved.maxEvaluateBytes !== undefined)
    config.limits.maxEvaluateBytes = resolved.maxEvaluateBytes;
  // Init scripts (issue #18) were already read from disk during resolution.
  config.initScripts = resolved.initScripts;
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

  // Feed the SSRF filtering proxy's refusals (D15) to PageManager so the
  // navigate tool can raise NAVIGATION_BLOCKED. No-op unless HTTP startup has
  // set `config.navigationGuard.enabled` (stdio never starts the proxy).
  browserManager.setNavigationGuardOnDeny((info) => pageManager.recordNavigationBlock(info));

  // Initialize renderer pipeline
  const elementIdGenerator = new ElementIdGenerator();
  const rendererPipeline = new RendererPipeline(cdpSessionManager, elementIdGenerator, config);
  const snapshotStore = new SnapshotStore(config.snapshotDepth);

  // Initialize screenshot artifact store
  const artifactStore = new ArtifactStore(config.screenshotDir);
  await artifactStore.initialize();

  // Initialize dev mode state
  const devModeState = new DevModeState(config);

  return {
    browserManager,
    pageManager,
    cdpSessionManager,
    rendererPipeline,
    elementIdGenerator,
    snapshotStore,
    artifactStore,
    config,
    devModeState,
  };
}

/**
 * Register SIGINT/SIGTERM handlers that stop the transport, then the session.
 *
 * The session (browser, dev servers) is owned by this process, not by the
 * transport — the transport handle only stops accepting requests.
 */
function installShutdownHandlers(ctx: SessionContext, closeTransport: () => Promise<void>): void {
  const shutdown = async () => {
    logger.info("Shutting down");
    await ctx.devModeState?.stopAll();
    await closeTransport();
    await ctx.browserManager.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // `charlotte doctor [...]` is a preflight smoke-check subcommand: it never
  // starts the MCP server (stdio or HTTP), so it is dispatched before any of
  // the normal startup below runs. `runDoctorCli` prints its own report to
  // stdout and returns the exit code; nothing else in main() executes.
  if (isDoctorInvocation(argv)) {
    const exitCode = await runDoctorCli(argv.slice(1));
    process.exit(exitCode);
  }

  let resolved;
  try {
    resolved = loadStartupConfig();
  } catch (error) {
    // stdout is reserved for the MCP transport — config errors go to stderr.
    logger.error((error as Error).message);
    process.exit(1);
  }
  logger.info("Charlotte starting", {
    mode: resolved.http ? "http" : "stdio",
    profile: resolved.http
      ? resolved.httpConfig.profile
      : (resolved.profile ?? (resolved.toolGroups ? undefined : "browse")),
    toolGroups: resolved.http ? undefined : resolved.toolGroups,
    noSandbox: resolved.noSandbox,
  });

  const ctx = await buildSessionContext(resolved);

  // ─── HTTP mode (--http) ───
  // Mutually exclusive with stdio: the process serves one transport or the
  // other, never both (remote design spec §3.3).
  if (resolved.http) {
    let httpTransport;
    try {
      // Pass the CDP endpoint so HTTP startup can fail closed when the SSRF
      // guard cannot be enforced against an external browser (S2-F2).
      httpTransport = await startHttpTransport(ctx, {
        ...resolved.httpConfig,
        cdpEndpoint: resolved.cdpEndpoint,
      });
    } catch (error) {
      logger.error((error as Error).message);
      await ctx.browserManager.close();
      process.exit(1);
    }
    installShutdownHandlers(ctx, () => httpTransport.close());
    return;
  }

  // ─── stdio mode (default) ───
  const { server: mcpServer } = createServer(ctx, {
    profile: resolved.profile,
    toolGroups: resolved.toolGroups,
  });

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  logger.info("Charlotte MCP server running on stdio");

  installShutdownHandlers(ctx, () => mcpServer.close());
}

main().catch((error) => {
  logger.error("Fatal error", error);
  process.exit(1);
});
