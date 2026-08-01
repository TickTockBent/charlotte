/**
 * Streamable HTTP transport adapter (remote design spec §3.3, slice 1 step 2).
 *
 * A second door onto the same tool core the stdio adapter consumes. The
 * transport owns nothing but the HTTP plumbing: the browser, tabs, snapshot
 * ring buffer and element-ID generator all live in the single
 * {@link SessionContext} handed in by the caller, which also owns its shutdown
 * (design principle 0.3 — transports consume the core, never own browser
 * state).
 *
 * Shape, verified against the v2 packages by the R1 spike (§Q3):
 *
 * ```
 * createMcpHandler(serverFactory, { legacy: 'stateless' })  // @modelcontextprotocol/server
 * toNodeHandler(handler)                                    // @modelcontextprotocol/node
 * ```
 *
 * `createMcpHandler` is stateless by construction: it calls the factory once
 * per HTTP request and keeps nothing between exchanges. Charlotte's per-server
 * state is therefore only the MCP shell (registered tool metadata); everything
 * an agent can observe threads through the shared `ctx`, which is what makes
 * the single implicit session (pillar 2) survive across requests.
 *
 * Two consequences of statelessness, both deliberate:
 *
 * - The tool set is FIXED at startup from `http.profile`. There is no
 *   per-connection registry for `charlotte_tools` to mutate, so the meta-tool
 *   is not registered here at all (⟨D3⟩ resolves the read-only variant in
 *   slice 2); the server instructions say so in words.
 * - `GET`/`DELETE /mcp` (2025-era session operations) answer 405, and no
 *   `Mcp-Session-Id` is ever issued. Both protocol eras are served from the
 *   one handler: modern (2026-07-28) natively, 2025-era via the stateless
 *   legacy fallback.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { Server as NodeHttpServer } from "node:http";
import express, { type Request, type Response, type NextFunction } from "express";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { charlotteTools } from "../core/index.js";
import type { SessionContext, ToolDefinition } from "../core/types.js";
import { registerToolDefinitions } from "./stdio.js";
import { buildServerInstructions, SERVER_NAME, SERVER_VERSION } from "../server.js";
import { resolveProfile, type ToolProfile } from "../tools/tool-groups.js";
import { logger } from "../utils/logger.js";

/** Startup settings for {@link startHttpTransport}. */
export interface HttpTransportOptions {
  /** Port to listen on. `0` binds an ephemeral port (used by tests). */
  port: number;
  /** Address to bind. Defaults to loopback at the config layer. */
  host: string;
  /**
   * Static bearer token. Mandatory: `undefined`/blank makes startup throw
   * before anything is listening.
   */
  authToken?: string;
  /** Tool profile, fixed for the lifetime of the process. */
  profile: ToolProfile;
}

/** A running HTTP transport. */
export interface HttpTransportHandle {
  /** The port actually bound (resolved, so `0` reports the ephemeral port). */
  port: number;
  /** The address actually bound. */
  host: string;
  /**
   * Stop listening and drop in-flight MCP exchanges.
   *
   * Deliberately does NOT touch the browser or the session: the caller that
   * built the {@link SessionContext} closes it (principle 0.3).
   */
  close(): Promise<void>;
}

/** JSON body returned for every rejected /mcp request. */
const UNAUTHORIZED_BODY = { error: "unauthorized" } as const;

/**
 * Constant-time bearer comparison.
 *
 * Both sides are SHA-256 digests, so `timingSafeEqual` always gets two 32-byte
 * buffers — it throws on length mismatch, and comparing raw tokens would leak
 * the expected length through that throw.
 */
function makeTokenMatcher(authToken: string): (header: string | undefined) => boolean {
  const expectedDigest = createHash("sha256").update(authToken, "utf8").digest();

  return (header: string | undefined): boolean => {
    if (typeof header !== "string") return false;
    const match = /^Bearer\s+(\S.*)$/i.exec(header.trim());
    if (!match) return false;
    const presentedDigest = createHash("sha256").update(match[1], "utf8").digest();
    return timingSafeEqual(expectedDigest, presentedDigest);
  };
}

/**
 * The tool definitions a given profile exposes, in canonical `charlotteTools`
 * order (which is the order `tools/list` reports).
 */
function selectTools(enabledToolNames: Set<string>): ToolDefinition[] {
  return charlotteTools.filter((definition) => enabledToolNames.has(definition.name));
}

/**
 * Start the streamable HTTP transport against an existing session.
 *
 * Throws before binding if no bearer token is configured. Chromium is NOT
 * launched here — the browser stays lazy, exactly as over stdio, and the first
 * tool call brings it up.
 */
export async function startHttpTransport(
  ctx: SessionContext,
  options: HttpTransportOptions,
): Promise<HttpTransportHandle> {
  const authToken = options.authToken?.trim();
  if (!authToken) {
    throw new Error(
      "HTTP mode requires a bearer token. Set CHARLOTTE_AUTH_TOKEN in the environment " +
        'or "http": { "authToken": "..." } in the config file. Charlotte will not serve ' +
        "HTTP without authentication.",
    );
  }

  const enabledToolNames = resolveProfile(options.profile);
  const exposedTools = selectTools(enabledToolNames);
  // No charlotte_tools here, so the instructions must not tell the agent to
  // call it; the group inventory itself is still worth serving.
  const instructions = buildServerInstructions(
    enabledToolNames,
    `Active profile: ${options.profile}.`,
    { metaToolAvailable: false },
  );

  const isAuthorized = makeTokenMatcher(authToken);
  const startedAtMs = Date.now();

  // One fresh MCP shell per request; all state stays in the shared ctx.
  const handler = createMcpHandler(
    () => {
      const server = new McpServer(
        { name: SERVER_NAME, version: SERVER_VERSION },
        {
          capabilities: {
            // Declared empty because the tool set is fixed at startup here.
            // Observed: the SDK still advertises `tools: {listChanged: true}`
            // in `initialize` — `registerTool` merges that capability in
            // unconditionally, and it cannot be declared away. Harmless (no
            // list-changed notification is ever sent over HTTP), but noted so
            // nobody reads this block as the advertised truth.
            tools: {},
          },
          instructions,
        },
      );
      registerToolDefinitions(server, ctx, exposedTools);
      return server;
    },
    {
      // Serve 2025-era clients through the stateless fallback as well as
      // 2026-07-28 clients — R2 found claude.ai's connector rollout in flight
      // across both eras, and this costs nothing to keep.
      legacy: "stateless",
      onerror: (error: Error) => {
        logger.error("HTTP transport error", error);
      },
    },
  );

  const app = express();
  app.disable("x-powered-by");

  // ─── Unauthenticated liveness ───
  // Liveness only: version, uptime, and whether Chromium is up. No page data,
  // no config echo — this endpoint is reachable by anyone who can reach the port.
  app.get("/healthz", (_req: Request, res: Response) => {
    res.json({
      version: SERVER_VERSION,
      uptime_s: Math.floor((Date.now() - startedAtMs) / 1000),
      browser_connected: ctx.browserManager.isConnected(),
    });
  });

  // ─── Auth, ahead of everything MCP (I4) ───
  // Plain Express middleware mounted before the handler, so a request with a
  // missing or wrong token is answered 401 without the server factory ever
  // running: no MCP instance, no session touch, no browser activity.
  app.use("/mcp", (req: Request, res: Response, next: NextFunction) => {
    if (!isAuthorized(req.headers.authorization)) {
      res.status(401).json(UNAUTHORIZED_BODY);
      return;
    }
    next();
  });

  const nodeHandler = toNodeHandler(handler, {
    onerror: (error: Error) => {
      logger.error("HTTP transport adapter error", error);
    },
  });
  // No body parser is mounted: toNodeHandler reads the request stream itself,
  // and a parser in front would drain it first.
  app.all("/mcp", (req: Request, res: Response) => {
    void nodeHandler(req, res);
  });

  const httpServer: NodeHttpServer = await new Promise((resolve, reject) => {
    const server = app.listen(options.port, options.host);
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });

  const address = httpServer.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : options.port;

  logger.info(
    `Charlotte MCP server running on http://${options.host}:${boundPort}/mcp ` +
      `(profile: ${options.profile}, auth: bearer required)`,
  );

  let closed = false;
  return {
    port: boundPort,
    host: options.host,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await handler.close();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
        // Keep-alive sockets would otherwise hold `close` open until they idle out.
        httpServer.closeAllConnections();
      });
    },
  };
}
