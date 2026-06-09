/**
 * Shared MCP test harness.
 *
 * Stands up the Charlotte MCP server over an in-memory transport backed by real
 * {@link ServerDeps} (real BrowserManager + Chromium, PageManager, renderer
 * pipeline, stores) and exposes a typed `callTool()` so tests exercise tools
 * through their actual registered handlers instead of reimplementing logic.
 *
 * Extracted from the duplicated setup in `tests/integration/protocol.test.ts`,
 * the `fill_form` suite in `tests/integration/interaction.test.ts`, and the MCP
 * blocks of `tests/integration/dialog.test.ts`. Later waves use this to test
 * every tool through its real handler.
 *
 * Note: this deliberately retires the previous "no shared test helpers"
 * convention (see CLAUDE.md). Each harness owns a unique temp artifact dir
 * (created via `mkdtemp`, removed on teardown) so parallel runs do not collide.
 */
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "../../src/server.js";
import type { ServerDeps, ServerOptions } from "../../src/server.js";
import { BrowserManager } from "../../src/browser/browser-manager.js";
import { PageManager } from "../../src/browser/page-manager.js";
import { CDPSessionManager } from "../../src/browser/cdp-session.js";
import { RendererPipeline } from "../../src/renderer/renderer-pipeline.js";
import { ElementIdGenerator } from "../../src/renderer/element-id-generator.js";
import { SnapshotStore } from "../../src/state/snapshot-store.js";
import { ArtifactStore } from "../../src/state/artifact-store.js";
import { StaticServer } from "../../src/dev/static-server.js";
import { createDefaultConfig } from "../../src/types/config.js";
import type { CharlotteConfig } from "../../src/types/config.js";

export interface FixtureServerInfo {
  /** Base URL of the static fixture server (e.g. http://localhost:53124). */
  url: string;
  port: number;
}

export interface HarnessOptions {
  /** Tool profile to expose. Defaults to "full" so every tool is callable. */
  profile?: ServerOptions["profile"];
  /** Explicit tool groups (mutually exclusive with `profile`, mirrors createServer). */
  toolGroups?: ServerOptions["toolGroups"];
  /**
   * If set, start a local static HTTP server rooting at this directory and
   * expose it as `harness.fixtureServer`. Useful for tests that need real
   * http(s) URLs rather than `file://`.
   */
  serveDirectory?: string;
  /**
   * Allowed root for the static server's directory-traversal guard. Defaults to
   * the served directory itself.
   */
  serveAllowedRoot?: string;
  /** Mutate the default config before the server is created. */
  configOverrides?: (config: CharlotteConfig) => void;
}

/** A live MCP test harness. Always pair `setup()` with `teardown()`. */
export interface McpHarness {
  /** The connected MCP client — call tools, list tools, inspect capabilities. */
  client: Client;
  /** The shared dependency bundle, so tests can drive lower-level state too. */
  deps: ServerDeps;
  browserManager: BrowserManager;
  pageManager: PageManager;
  config: CharlotteConfig;
  /** Present only when `serveDirectory` was provided. */
  fixtureServer?: FixtureServerInfo;
  /**
   * Typed convenience wrapper over `client.callTool`. Returns the raw
   * {@link CallToolResult} (use {@link parseToolText}/{@link parseToolJson} to
   * read the payload).
   */
  callTool: (name: string, args?: Record<string, unknown>) => Promise<CallToolResult>;
  /** Close the client/server, the browser, the fixture server, and remove the temp artifact dir. */
  teardown: () => Promise<void>;
}

/**
 * Create and connect a fully-wired MCP harness with a real browser.
 *
 * The dependency graph mirrors `src/index.ts`: a single CDPSessionManager and
 * ElementIdGenerator are shared between the harness and the RendererPipeline so
 * `resolveElement` and rendering see consistent state.
 */
export async function setupMcpHarness(options: HarnessOptions = {}): Promise<McpHarness> {
  // Tests opt out of the Chromium sandbox: CI hosts and AppArmor-restricted
  // dev machines cannot launch the sandboxed browser (see #184).
  const browserManager = new BrowserManager(undefined, { noSandbox: true });
  await browserManager.launch();

  const config = createDefaultConfig();
  options.configOverrides?.(config);

  const cdpSessionManager = new CDPSessionManager();
  const pageManager = new PageManager(config, cdpSessionManager);
  await pageManager.openTab(browserManager);

  // Mirror src/index.ts: reset PageManager + CDP caches when the browser
  // transport drops so a crashed browser recovers on the next tool call (#201).
  browserManager.setOnDisconnected(() => {
    pageManager.reset();
  });

  const elementIdGenerator = new ElementIdGenerator();
  const rendererPipeline = new RendererPipeline(cdpSessionManager, elementIdGenerator);

  const artifactDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "charlotte-harness-"));
  const artifactStore = new ArtifactStore(artifactDirectory);
  await artifactStore.initialize();

  const deps: ServerDeps = {
    browserManager,
    pageManager,
    cdpSessionManager,
    rendererPipeline,
    elementIdGenerator,
    snapshotStore: new SnapshotStore(config.snapshotDepth),
    artifactStore,
    config,
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

  const serverOptions: ServerOptions = options.toolGroups
    ? { toolGroups: options.toolGroups }
    : { profile: options.profile ?? "full" };

  const { server } = createServer(deps, serverOptions);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: "charlotte-test-harness", version: "1.0.0" });
  await client.connect(clientTransport);

  const callTool = (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: args }) as Promise<CallToolResult>;

  const teardown = async () => {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
    if (staticServer) await staticServer.stop().catch(() => {});
    await browserManager.close().catch(() => {});
    await fs.rm(artifactDirectory, { recursive: true, force: true }).catch(() => {});
  };

  return {
    client,
    deps,
    browserManager,
    pageManager,
    config,
    fixtureServer,
    callTool,
    teardown,
  };
}

/** Extract the first text content block from a tool result. */
export function parseToolText(result: CallToolResult): string {
  const content = result.content as Array<{ type: string; text: string }>;
  if (!content?.length || content[0].type !== "text") {
    throw new Error("Tool result has no text content block");
  }
  return content[0].text;
}

/** Parse the first text content block of a tool result as JSON. */
export function parseToolJson<T = unknown>(result: CallToolResult): T {
  return JSON.parse(parseToolText(result)) as T;
}
