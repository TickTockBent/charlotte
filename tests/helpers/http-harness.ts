/**
 * HTTP transport test harness (Slice 1, Step 3 — docs/remote/slice-1.md).
 *
 * Stands up a real {@link SessionContext} — real Chromium, PageManager,
 * renderer pipeline, stores, temp artifact dir — and serves it over the live
 * streamable-HTTP transport (`src/transports/http.ts`) on an ephemeral
 * loopback port behind a test bearer token. The dependency wiring deliberately
 * mirrors `tests/helpers/core-direct.ts` line for line so that the ONLY
 * difference between the two harnesses is the door the tool call comes
 * through; anything else would contaminate the I3 parity comparison.
 *
 * Two call surfaces are exposed, for two different jobs:
 *
 *  - {@link HttpHarness.callTool} — a real MCP client (`Client` +
 *    `StreamableHTTPClientTransport` from `@modelcontextprotocol/client`)
 *    doing a genuine protocol round-trip over TCP. This is the honest path and
 *    the one the parity scenario uses: same client library a remote consumer
 *    would use, negotiating protocol era with the stateless server exactly as
 *    claude.ai's connector does.
 *  - {@link HttpHarness.postMcp} / {@link HttpHarness.callToolRaw} — raw
 *    `fetch` against `POST /mcp`, so the I4/I5 tests can send requests the MCP
 *    client would refuse to construct: no `Authorization` header at all, a
 *    wrong token, a malformed body. The SSE unwrapper promoted from step 2's
 *    smoke tests lives here ({@link readJsonRpc}) so both eras' response
 *    framings read the same way.
 *
 * Teardown order matters and matches the transport's ownership contract
 * (principle 0.3): the transport stops listening first, then the harness — as
 * the ctx owner — closes the browser, the fixture server, and the temp dir.
 */
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import type { SessionContext } from "../../src/core/types.js";
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
import { startHttpTransport, type HttpTransportHandle } from "../../src/transports/http.js";
import type { ToolProfile } from "../../src/tools/tool-groups.js";

/** Default bearer token for harness-built transports. */
export const HTTP_HARNESS_TOKEN = "test-token-6b1d90ae";

export interface FixtureServerInfo {
  /** Base URL of the static fixture server (e.g. http://localhost:53124). */
  url: string;
  port: number;
}

export interface HttpHarnessOptions {
  /**
   * If set, start a local static HTTP server rooting at this directory and
   * expose it as `harness.fixtureServer`. Mirrors `serveDirectory` on the
   * other two harnesses. Omit it when the caller already has a fixture server
   * running (the parity scenario shares ONE server between both paths).
   */
  serveDirectory?: string;
  /** Allowed root for the static server's directory-traversal guard. */
  serveAllowedRoot?: string;
  /** Mutate the default config before the SessionContext is built. */
  configOverrides?: (config: CharlotteConfig) => void;
  /** Tool profile the transport exposes. Defaults to "full" (mirrors mcp-harness). */
  profile?: ToolProfile;
  /** Bearer token the transport requires. Defaults to {@link HTTP_HARNESS_TOKEN}. */
  authToken?: string;
  /**
   * Public https origin to advertise. Setting it turns the OAuth facade on
   * (⟨D2⟩); leaving it unset keeps the transport in bearer-only mode, which is
   * what every pre-facade test expects. The value is metadata only — nothing
   * ever dials it — so an unroutable `https://…` origin is correct here even
   * though the harness itself listens on http loopback.
   */
  publicOrigin?: string;
  /** Turn request observation on (method, path, redacted headers to stderr). */
  debugRequests?: boolean;
  /**
   * Enable the outbound SSRF guard (D14) with the given CIDR allowlist BEFORE
   * the initial tab is opened, so the pre-opened tab carries the guard. SSRF
   * tests set this; every other HTTP test leaves it undefined (guard off on the
   * pre-opened tab, matching production's guard-off-until-HTTP-startup posture).
   */
  navigationGuardAllowlist?: string[];
}

/** A JSON-RPC response envelope as it comes back off the wire. */
export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

/** Knobs for a raw `POST /mcp` — everything the MCP client would never do wrong. */
export interface RawPostOptions {
  /**
   * Bearer token to present. `undefined` uses the harness token; `null` sends
   * no `Authorization` header at all.
   */
  token?: string | null;
  /** Send this exact string as the body instead of JSON-encoding `body`. */
  rawBody?: string;
  /** Extra/overriding request headers (lowercase keys win over the defaults). */
  headers?: Record<string, string>;
}

/** A live HTTP test harness. Always pair `setup` with `teardown`. */
export interface HttpHarness {
  /** The shared SessionContext the transport serves — inspect it directly in I4/I5 tests. */
  ctx: SessionContext;
  browserManager: BrowserManager;
  pageManager: PageManager;
  snapshotStore: SnapshotStore;
  config: CharlotteConfig;
  /** The running transport handle (port, host, close). */
  transport: HttpTransportHandle;
  /** Origin of the MCP server, e.g. `http://127.0.0.1:53124`. */
  baseUrl: string;
  /** The bearer token this transport accepts. */
  authToken: string;
  /** Present only when `serveDirectory` was provided. */
  fixtureServer?: FixtureServerInfo;
  /** The connected MCP client, for tests that want `listTools` etc. */
  client: Client;
  /**
   * Real MCP tool call over HTTP. Signature-compatible with
   * `CoreDirectHarness.callTool` and `McpHarness.callTool`, so
   * `captureGoldenScenarios` consumes it unmodified.
   */
  callTool: (name: string, args?: Record<string, unknown>) => Promise<CallToolResult>;
  /** Raw `POST /mcp`, bypassing the MCP client entirely. */
  postMcp: (body: unknown, options?: RawPostOptions) => Promise<Response>;
  /**
   * Raw `tools/call` over `fetch` — same wire result as {@link callTool} but
   * with full control over the token and body, and no client-side validation.
   */
  callToolRaw: (
    name: string,
    args?: Record<string, unknown>,
    options?: RawPostOptions,
  ) => Promise<Response>;
  /** Stop the transport, then close the browser, fixture server, and temp dir. */
  teardown: () => Promise<void>;
}

/**
 * Read a JSON-RPC response body.
 *
 * Promoted from `tests/integration/http-transport.test.ts` (step 2). The
 * 2025-era ("legacy") stateless leg answers over SSE whenever the request
 * accepts `text/event-stream` — which is what claude.ai's connector client
 * sends per the R2 spike — so the single `data:` frame is unwrapped here and
 * plain JSON bodies pass straight through.
 */
export async function readJsonRpc(response: Response): Promise<JsonRpcResponse> {
  const body = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    return JSON.parse(body) as JsonRpcResponse;
  }
  const dataLine = body.split("\n").find((line) => line.startsWith("data:"));
  if (dataLine === undefined) {
    throw new Error(`No SSE data frame in response body: ${body}`);
  }
  return JSON.parse(dataLine.slice("data:".length).trim()) as JsonRpcResponse;
}

/**
 * Boot a SessionContext and serve it over the real HTTP transport.
 *
 * Chromium launches here (as in the other harnesses) so that `isConnected()`
 * reflects the harness's own setup rather than transport behavior; the I4
 * tests that must prove "no browser activity" build their ctx WITHOUT calling
 * `launch()` — see {@link setupHttpHarness}'s `launchBrowser` sibling below.
 */
export async function setupHttpHarness(options: HttpHarnessOptions = {}): Promise<HttpHarness> {
  return buildHttpHarness(options, true);
}

/**
 * Same as {@link setupHttpHarness}, but leaves Chromium un-launched and opens
 * no tab. Used by the I4 assertions, where the whole point is that a rejected
 * request must not cause ANY browser activity — with a pre-launched browser
 * `isConnected()` would be true regardless and the assertion would be vacuous.
 */
export async function setupUnlaunchedHttpHarness(
  options: HttpHarnessOptions = {},
): Promise<HttpHarness> {
  return buildHttpHarness(options, false);
}

async function buildHttpHarness(
  options: HttpHarnessOptions,
  launchBrowser: boolean,
): Promise<HttpHarness> {
  const config = createDefaultConfig();
  // Enable the SSRF guard (D15) before launch when a test asks for it, so the
  // filtering proxy fronts the browser. Left off otherwise, matching production
  // (guard off until HTTP startup flips it) — so existing HTTP tests are
  // unaffected.
  if (options.navigationGuardAllowlist !== undefined) {
    config.navigationGuard.enabled = true;
    config.navigationGuard.allowPrivateNetworks = options.navigationGuardAllowlist;
  }
  options.configOverrides?.(config);

  // Tests opt out of the Chromium sandbox: CI hosts and AppArmor-restricted
  // dev machines cannot launch the sandboxed browser (see #184). Pass the shared
  // config so BrowserManager sees `navigationGuard.enabled` at launch (D15).
  const browserManager = new BrowserManager(config, { noSandbox: true });

  const cdpSessionManager = new CDPSessionManager();
  const pageManager = new PageManager(config, cdpSessionManager);

  // Mirror src/index.ts: reset per-session state on disconnect (#201) and feed
  // the filtering proxy's refusals to PageManager (D15). Both wired BEFORE
  // launch so the proxy starts (and its denials are captured) from the first
  // navigation.
  browserManager.setOnDisconnected(() => {
    pageManager.reset();
  });
  browserManager.setNavigationGuardOnDeny((info) => pageManager.recordNavigationBlock(info));

  if (launchBrowser) {
    await browserManager.launch();
    await pageManager.openTab(browserManager);
  }

  const elementIdGenerator = new ElementIdGenerator();
  const rendererPipeline = new RendererPipeline(cdpSessionManager, elementIdGenerator, config);

  const artifactDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "charlotte-http-harness-"));
  const artifactStore = new ArtifactStore(artifactDirectory);
  await artifactStore.initialize();

  const devModeState = new DevModeState(config);
  const snapshotStore = new SnapshotStore(config.snapshotDepth);

  const ctx: SessionContext = {
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

  const authToken = options.authToken ?? HTTP_HARNESS_TOKEN;
  let transport: HttpTransportHandle;
  try {
    transport = await startHttpTransport(ctx, {
      port: 0,
      host: "127.0.0.1",
      authToken,
      profile: options.profile ?? "full",
      ...(options.publicOrigin !== undefined ? { publicOrigin: options.publicOrigin } : {}),
      ...(options.debugRequests !== undefined ? { debugRequests: options.debugRequests } : {}),
    });
  } catch (error) {
    // Tests that assert on startup rejections (bad token, bad publicOrigin)
    // never get a handle to tear down, so the resources built above — browser,
    // fixture server, temp artifact dir — would leak once per case.
    await staticServer?.stop().catch(() => {});
    await browserManager.close().catch(() => {});
    await fs.rm(artifactDirectory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  const baseUrl = `http://${transport.host}:${transport.port}`;
  const mcpUrl = new URL(`${baseUrl}/mcp`);

  // A real MCP client over real TCP. `authProvider.token()` is consulted before
  // every request, which is all a static bearer needs — no OAuth machinery.
  const clientTransport = new StreamableHTTPClientTransport(mcpUrl, {
    authProvider: { token: () => Promise.resolve(authToken) },
  });
  const client = new Client({ name: "charlotte-http-harness", version: "1.0.0" });
  await client.connect(clientTransport);

  const callTool = (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: args }) as Promise<CallToolResult>;

  let rawRequestId = 1000;
  const postMcp = (body: unknown, rawOptions: RawPostOptions = {}): Promise<Response> => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (rawOptions.token !== null) {
      headers.authorization = `Bearer ${rawOptions.token ?? authToken}`;
    }
    Object.assign(headers, rawOptions.headers ?? {});
    return fetch(mcpUrl, {
      method: "POST",
      headers,
      body: rawOptions.rawBody ?? JSON.stringify(body),
    });
  };

  const callToolRaw = (
    name: string,
    args: Record<string, unknown> = {},
    rawOptions: RawPostOptions = {},
  ): Promise<Response> => {
    rawRequestId += 1;
    return postMcp(
      {
        jsonrpc: "2.0",
        id: rawRequestId,
        method: "tools/call",
        params: { name, arguments: args },
      },
      rawOptions,
    );
  };

  const teardown = async () => {
    // Client and transport first: an open SSE stream would keep the HTTP
    // server's sockets alive past `close()`.
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
    await devModeState.stopAll().catch(() => {});
    if (staticServer) await staticServer.stop().catch(() => {});
    await browserManager.close().catch(() => {});
    await fs.rm(artifactDirectory, { recursive: true, force: true }).catch(() => {});
  };

  return {
    ctx,
    browserManager,
    pageManager,
    snapshotStore,
    config,
    transport,
    baseUrl,
    authToken,
    fixtureServer,
    client,
    callTool,
    postMcp,
    callToolRaw,
    teardown,
  };
}
