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
 *
 * ## Request observation (D2 — observe-then-build)
 *
 * `CHARLOTTE_DEBUG_HTTP=1` or `http.debugRequests: true` turns on a diagnostic
 * mode that logs every inbound request (method, path+query, redacted headers)
 * and its response status to stderr. It exists because claude.ai's connector
 * probes discovery endpoints — `/.well-known/*`, `/register`, … — that
 * Charlotte does not serve; without this they hit Express's default 404 and
 * vanish unrecorded. The catch-all below turns those probes into an explicit
 * `{"error":"not_found"}` and, in observation mode, a log line, so the OAuth
 * facade can be designed against what claude.ai actually asks for.
 */
import type { Server as NodeHttpServer } from "node:http";
import express, { type Request, type Response, type NextFunction } from "express";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { charlotteTools } from "../core/index.js";
import type { SessionContext, ToolDefinition } from "../core/types.js";
import { registerToolDefinitions } from "./stdio.js";
import { buildServerInstructions, SERVER_NAME, SERVER_VERSION } from "../server.js";
import { resolveProfile, type ToolProfile } from "../tools/tool-groups.js";
import { makeSecretMatcher, mountOauthFacade, normalizePublicOrigin } from "./oauth-facade.js";
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
  /**
   * Log every inbound request and its response status to stderr.
   *
   * Diagnostics only (see the module header). `CHARLOTTE_DEBUG_HTTP` turns it
   * on independently of this flag, so an operator can observe a running
   * deployment without editing its config file.
   */
  debugRequests?: boolean;
  /**
   * Public https origin clients reach this server at, e.g.
   * `https://charlotte.example.com`. Setting it turns the OAuth facade on
   * (⟨D2⟩, `src/transports/oauth-facade.ts`): discovery, registration, consent
   * and token endpoints are mounted, and the `/mcp` 401 gains a
   * `WWW-Authenticate` challenge pointing at the metadata document.
   *
   * Unset (the default) is bearer-only mode — exactly the behavior before the
   * facade existed: no facade routes, no `WWW-Authenticate`, and the operator
   * token is the only credential `/mcp` accepts. Invalid values throw at
   * startup, before anything is listening.
   */
  publicOrigin?: string;
  /**
   * CIDR carve-outs for the outbound SSRF / navigation guard (D14). The guard
   * itself is always ON in HTTP mode (deny-private-by-default); this list names
   * the private ranges an operator opts back in to (e.g. an intranet
   * `10.0.5.0/24`). Empty (the default) denies every private range.
   */
  allowPrivateNetworks?: string[];
  /**
   * The configured CDP endpoint, if any (`--cdpEndpoint` / config). Present here
   * only so HTTP-mode startup can REFUSE to run against an external browser: the
   * SSRF guard (D15) is enforced by a launch-time proxy and cannot front a
   * browser Charlotte did not launch. Unset in the normal launch path.
   */
  cdpEndpoint?: string;
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

/** JSON body returned for every path this server does not serve. */
const NOT_FOUND_BODY = { error: "not_found" } as const;

/** Env values that switch request observation on. */
const TRUTHY_DEBUG_VALUES = new Set(["1", "true", "yes", "on"]);

/**
 * Whether `CHARLOTTE_DEBUG_HTTP` asks for request observation.
 *
 * Read here rather than plumbed through the config layer so the flag also
 * works for a transport constructed directly (tests, harnesses) and for an
 * operator who wants one observation run without touching the config file.
 * Anything unrecognized counts as "off" — a debug switch must never be the
 * reason a server refuses to start.
 */
function debugRequestsFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.CHARLOTTE_DEBUG_HTTP?.trim().toLowerCase();
  return raw !== undefined && TRUTHY_DEBUG_VALUES.has(raw);
}

/**
 * Header names whose values are credentials and are never logged verbatim.
 *
 * Observation mode exists to learn WHICH requests arrive, not what they carry:
 * a log file from a live tunnel run would otherwise hand over the bearer token
 * (and any session cookie) to anyone the operator shares it with.
 */
const REDACTED_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
]);

/** Auth-style headers whose scheme (`Bearer`, `Basic`, …) is safe to keep. */
const SCHEME_BEARING_HEADERS = new Set(["authorization", "proxy-authorization"]);

/**
 * Copy request headers for logging, replacing credential values with a marker
 * that records presence — and, for auth headers, the scheme — but never the
 * secret itself.
 */
function summarizeHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const summary: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    const value = Array.isArray(rawValue) ? rawValue.join(", ") : (rawValue ?? "");
    if (!REDACTED_HEADERS.has(name)) {
      summary[name] = value;
      continue;
    }
    if (SCHEME_BEARING_HEADERS.has(name)) {
      const scheme = /^(\S+)\s/.exec(value)?.[1];
      summary[name] = `<redacted: present, scheme=${scheme ?? "none"}>`;
      continue;
    }
    summary[name] = "<redacted: present>";
  }
  return summary;
}

/**
 * Constant-time `Authorization: Bearer` comparison against every credential
 * this server accepts.
 *
 * With the OAuth facade mounted there are two: the operator token and the
 * facade's derived access token. The comparison itself lives in
 * {@link makeSecretMatcher} — SHA-256 digests through `timingSafeEqual`, every
 * candidate compared on every call with no short-circuit — so adding the
 * second credential costs one more fixed-size comparison and leaks nothing
 * about which one (if either) matched.
 */
function makeTokenMatcher(
  acceptedTokens: readonly string[],
): (header: string | undefined) => boolean {
  const matchesAcceptedToken = makeSecretMatcher(acceptedTokens);

  return (header: string | undefined): boolean => {
    if (typeof header !== "string") return false;
    const match = /^Bearer\s+(\S.*)$/i.exec(header.trim());
    if (!match) return false;
    return matchesAcceptedToken(match[1]);
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

  // Turn the outbound SSRF / navigation guard ON for HTTP mode (D14). It is off
  // by default in the session config so stdio is unaffected; flipping it here is
  // what makes "HTTP denies private ranges by default" true. PageManager reads
  // this flag when it wires each page, so the guard is armed before the first
  // navigation. The allowlist carves post-resolution exceptions (empty = deny
  // all private ranges).
  ctx.config.navigationGuard.enabled = true;
  ctx.config.navigationGuard.allowPrivateNetworks = options.allowPrivateNetworks ?? [];

  // Fail closed (S2-F2): the guard is enforced by a launch-time filtering proxy
  // (D15), which can only front a browser Charlotte launches itself. Attaching
  // to an external browser via a CDP endpoint would serve a remote HTTP endpoint
  // driving an UNGUARDED browser — a silent absence of the security boundary
  // (pillar 5). Refuse to start rather than warn-and-continue.
  if (ctx.config.navigationGuard.enabled && options.cdpEndpoint) {
    throw new Error(
      "HTTP mode enables the SSRF navigation guard, which requires Charlotte to launch " +
        "its own browser; it cannot be enforced when attaching to an external browser via " +
        `CDP endpoint (${options.cdpEndpoint}). Remove the CDP endpoint so Charlotte ` +
        "launches a guarded browser.",
    );
  }

  logger.info(
    `Outbound SSRF guard enabled (allowPrivateNetworks: ${
      ctx.config.navigationGuard.allowPrivateNetworks.length > 0
        ? ctx.config.navigationGuard.allowPrivateNetworks.join(", ")
        : "none — all private ranges denied"
    })`,
  );

  // Validated before the listener exists: a mistyped origin must fail loudly at
  // startup, not by serving metadata that points somewhere else.
  const publicOrigin =
    options.publicOrigin === undefined || options.publicOrigin.trim() === ""
      ? undefined
      : normalizePublicOrigin(options.publicOrigin);

  const enabledToolNames = resolveProfile(options.profile);
  const exposedTools = selectTools(enabledToolNames);
  // No charlotte_tools here, so the instructions must not tell the agent to
  // call it; the group inventory itself is still worth serving.
  const instructions = buildServerInstructions(
    enabledToolNames,
    `Active profile: ${options.profile}.`,
    { metaToolAvailable: false },
  );

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

  // ─── Request observation (first in the chain, before auth and routing) ───
  // Mounted ahead of everything so discovery probes and rejected requests are
  // both attributed: the request line is logged on arrival, the status on
  // finish, so a 401 or a 404 is visible with the path that produced it.
  //
  // Headers and the request line ONLY — never bodies. The OAuth facade's
  // consent form POSTs the operator token in its body, so a body-logging
  // middleware here would write the root credential to stderr on every
  // approval. Nothing downstream may add one.
  const observationEnabled = options.debugRequests === true || debugRequestsFromEnv();
  if (observationEnabled) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      const requestStartedMs = Date.now();
      logger.info("http request", {
        method: req.method,
        // originalUrl keeps the query string, which is where a probe's
        // parameters (client_id, redirect_uri, …) would show up.
        path: req.originalUrl,
        headers: summarizeHeaders(req.headers),
      });
      res.on("finish", () => {
        logger.info("http response", {
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          duration_ms: Date.now() - requestStartedMs,
        });
      });
      next();
    });
  }

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

  // ─── OAuth facade (⟨D2⟩), only when a public origin is configured ───
  // Mounted after /healthz and before /mcp's auth middleware. Its routes are
  // unauthenticated by design — discovery and registration are what a client
  // does BEFORE it has a credential — and they sit outside /mcp, so the I4
  // boundary is untouched: none of them can reach the session or the browser.
  const oauthFacade =
    publicOrigin === undefined
      ? undefined
      : mountOauthFacade(app, { publicOrigin, operatorToken: authToken });

  // With the facade on, /mcp accepts the derived access token as well as the
  // operator token; with it off, the operator token is the only credential.
  const isAuthorized = makeTokenMatcher(
    oauthFacade === undefined ? [authToken] : [authToken, oauthFacade.accessToken],
  );

  // ─── Auth, ahead of everything MCP (I4) ───
  // Plain Express middleware mounted before the handler, so a request with a
  // missing or wrong token is answered 401 without the server factory ever
  // running: no MCP instance, no session touch, no browser activity.
  app.use("/mcp", (req: Request, res: Response, next: NextFunction) => {
    if (!isAuthorized(req.headers.authorization)) {
      if (oauthFacade !== undefined) {
        // RFC 9728 §5.1: point the client at the metadata document so it can
        // discover the authorization server without guessing well-known paths.
        // Emitted only with the facade on — advertising a resource_metadata URL
        // that 404s would be worse than staying silent.
        res.set(
          "www-authenticate",
          `Bearer resource_metadata="${oauthFacade.protectedResourceMetadataUrl}"`,
        );
      }
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

  // ─── Catch-all, after every defined route ───
  // Registered last, so it can never shadow /healthz or /mcp. It answers with
  // a JSON 404 always (Express's default is an HTML stack-ish body), and logs
  // only in observation mode. These paths sit outside /mcp's auth middleware
  // by construction — an unauthenticated discovery probe is exactly what the
  // D2 observation run needs to see.
  app.use((req: Request, res: Response) => {
    if (observationEnabled) {
      logger.info("unmatched route", { method: req.method, path: req.originalUrl });
    }
    res.status(404).json(NOT_FOUND_BODY);
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
  if (publicOrigin !== undefined) {
    logger.info(
      `OAuth facade enabled at ${publicOrigin} — clients may authorize with the ` +
        "operator token through the consent page (/oauth/authorize).",
    );
  }
  if (observationEnabled) {
    logger.warn(
      "Request observation is ON: every request's method, path, and redacted headers " +
        "are logged to stderr. Diagnostics only — turn it off for normal operation.",
    );
  }

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
