/**
 * Core-direct test harness (Slice 0, Step 3 — docs/remote/slice-0.md).
 *
 * Executes Charlotte tool handlers directly against `charlotteTools`
 * (`src/core/index.ts`) with no `McpServer`, no transport, and no protocol
 * round-trip — just the same zod validation an MCP client's call would
 * trigger, followed by `ToolDefinition.handler(ctx, args)`. This is the
 * stdio-vs-core half of the future parity law (I3): comparing results from
 * this path against the real MCP harness (`tests/helpers/mcp-harness.ts`)
 * proves the registration/transport layer in `src/transports/stdio.ts` adds
 * nothing to a tool's result.
 *
 * Dependency wiring deliberately mirrors `tests/helpers/mcp-harness.ts`
 * (real BrowserManager + Chromium, PageManager, renderer pipeline, stores,
 * temp artifact dir) — only the `McpServer`/`Client`/`InMemoryTransport`
 * plumbing is omitted.
 */
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { charlotteTools } from "../../src/core/index.js";
import type { SessionContext, ToolResult } from "../../src/core/types.js";
import { BrowserManager } from "../../src/browser/browser-manager.js";
import { PageManager } from "../../src/browser/page-manager.js";
import { CDPSessionManager } from "../../src/browser/cdp-session.js";
import { RendererPipeline } from "../../src/renderer/renderer-pipeline.js";
import { ElementIdGenerator } from "../../src/renderer/element-id-generator.js";
import { SnapshotStore } from "../../src/state/snapshot-store.js";
import { ArtifactStore } from "../../src/state/artifact-store.js";
import { StaticServer } from "../../src/dev/static-server.js";
import { DevModeState } from "../../src/dev/dev-mode-state.js";
import { createDefaultConfig } from "../../src/types/config.js";
import type { CharlotteConfig } from "../../src/types/config.js";

export interface FixtureServerInfo {
  /** Base URL of the static fixture server (e.g. http://localhost:53124). */
  url: string;
  port: number;
}

export interface CoreDirectHarnessOptions {
  /**
   * If set, start a local static HTTP server rooting at this directory and
   * expose it as `harness.fixtureServer`. Mirrors
   * `HarnessOptions.serveDirectory` in `mcp-harness.ts`.
   */
  serveDirectory?: string;
  /** Allowed root for the static server's directory-traversal guard. */
  serveAllowedRoot?: string;
  /** Mutate the default config before the SessionContext is built. */
  configOverrides?: (config: CharlotteConfig) => void;
}

/** A live core-direct test harness. Always pair `setup` with `teardown`. */
export interface CoreDirectHarness {
  /** The shared SessionContext — pass to `callToolDirect` or drive directly. */
  ctx: SessionContext;
  browserManager: BrowserManager;
  pageManager: PageManager;
  config: CharlotteConfig;
  /** Present only when `serveDirectory` was provided. */
  fixtureServer?: FixtureServerInfo;
  /** Convenience wrapper: `callToolDirect` bound to this harness's `ctx`. */
  callTool: (name: string, args?: Record<string, unknown>) => Promise<CallToolResult>;
  /** Closes the browser, stops the fixture server, and removes the temp artifact dir. */
  teardown: () => Promise<void>;
}

/**
 * Build a real `SessionContext` — real Chromium, PageManager, renderer
 * pipeline, stores, temp artifact dir — with no MCP server or transport
 * wired on top of it.
 */
export async function setupCoreDirectHarness(
  options: CoreDirectHarnessOptions = {},
): Promise<CoreDirectHarness> {
  // Tests opt out of the Chromium sandbox: CI hosts and AppArmor-restricted
  // dev machines cannot launch the sandboxed browser (see #184).
  const browserManager = new BrowserManager(undefined, { noSandbox: true });
  await browserManager.launch();

  const config = createDefaultConfig();
  options.configOverrides?.(config);

  const cdpSessionManager = new CDPSessionManager();
  const pageManager = new PageManager(config, cdpSessionManager);
  await pageManager.openTab(browserManager);

  // Mirror src/index.ts / mcp-harness.ts: reset PageManager + CDP caches when
  // the browser transport drops so a crashed browser recovers (#201).
  browserManager.setOnDisconnected(() => {
    pageManager.reset();
  });

  const elementIdGenerator = new ElementIdGenerator();
  const rendererPipeline = new RendererPipeline(cdpSessionManager, elementIdGenerator, config);

  const artifactDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "charlotte-core-direct-"));
  const artifactStore = new ArtifactStore(artifactDirectory);
  await artifactStore.initialize();

  // Wire DevModeState so dev_mode tools (dev_serve, dev_inject, dev_audit) are
  // exercisable here too, rather than hitting the "Dev mode is not available"
  // guard (mirrors mcp-harness.ts).
  const devModeState = new DevModeState(config);

  const ctx: SessionContext = {
    browserManager,
    pageManager,
    cdpSessionManager,
    rendererPipeline,
    elementIdGenerator,
    snapshotStore: new SnapshotStore(config.snapshotDepth),
    artifactStore,
    config,
    devModeState,
  };

  let staticServer: StaticServer | undefined;
  let fixtureServer: FixtureServerInfo | undefined;
  if (options.serveDirectory) {
    staticServer = new StaticServer();
    const info = await staticServer.start({
      directoryPath: options.serveDirectory,
      allowedRoot: options.serveAllowedRoot ?? options.serveDirectory,
    });
    fixtureServer = { url: info.url, port: info.port };
  }

  const callTool = (name: string, args: Record<string, unknown> = {}) =>
    callToolDirect(ctx, name, args);

  const teardown = async () => {
    await devModeState.stopAll().catch(() => {});
    if (staticServer) await staticServer.stop().catch(() => {});
    await browserManager.close().catch(() => {});
    await fs.rm(artifactDirectory, { recursive: true, force: true }).catch(() => {});
  };

  return {
    ctx,
    browserManager,
    pageManager,
    config,
    fixtureServer,
    callTool,
    teardown,
  };
}

/**
 * Look up `name` in `charlotteTools`, validate `args` against its zod
 * `inputSchema` the way the SDK would (`z.object(shape).parse` — SDK v2 wraps a
 * raw shape in `z.object()` itself and validates through the resulting Standard
 * Schema), and invoke `handler(ctx, args)` directly. No `McpServer`, no
 * transport, no `RegisteredTool` in between.
 *
 * Returns the handler's `ToolResult` as-is — structurally identical to the
 * `CallToolResult` an MCP client receives (`{ content, isError? }`), so it
 * drops straight into `parseToolJson`/`parseToolText` from `mcp-harness.ts`
 * and into `captureGoldenScenarios`'s `CallToolFn` parameter.
 */
export async function callToolDirect(
  ctx: SessionContext,
  name: string,
  args: Record<string, unknown> = {},
): Promise<CallToolResult> {
  const definition = charlotteTools.find((tool) => tool.name === name);
  if (!definition) {
    throw new Error(`callToolDirect: no tool registered with name "${name}"`);
  }

  const schema = z.object(definition.inputSchema as z.ZodRawShape);
  const parsedArgs: unknown = schema.parse(args);

  const handler = definition.handler as (ctx: SessionContext, args: unknown) => Promise<ToolResult>;
  const result = await handler(ctx, parsedArgs);
  return result as CallToolResult;
}
