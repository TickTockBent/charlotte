/**
 * In-process filtering proxy — the SSRF enforcement layer (decision D15,
 * mechanism; policy is D14; verified by spike s2-proxy-spike.md).
 *
 * A tiny forward proxy bound to loopback, started only in HTTP mode when the
 * navigation guard is enabled. Chromium is launched with
 * `--proxy-server=http://127.0.0.1:<port>` and `--proxy-bypass-list=<-loopback>`
 * so **all** egress — initial navigations, redirect hops, subresources, workers,
 * and crucially a **popup's initial request** — routes through here. Because
 * enforcement is at the network layer (below Puppeteer's target manager), it
 * catches the popup case that the CDP-`Fetch` mechanism could not, and it never
 * disturbs Puppeteer's page/popup lifecycle.
 *
 * Every request's host is resolved and classified by
 * {@link ./navigation-guard.ts} against the deny-set + allowlist:
 * - **HTTP** (absolute-URL requests): deny → `403`; allow → forward to the
 *   **vetted IP** (IP-pin), preserving the original `Host` header.
 * - **HTTPS** (`CONNECT host:port`): deny → `403` + destroy; allow → open a raw
 *   TCP tunnel **to the vetted IP** and pipe. No TLS interception — the client
 *   does TLS end-to-end; dialing the resolved IP with the client's own SNI is
 *   correct and closes the D14 https-pin residual with zero cert work.
 * - **ws://** (`upgrade`): classified like HTTP, forwarded raw to the vetted IP.
 *   (`wss://` rides the CONNECT path.)
 *
 * Fail-closed: a resolution error denies. IP-pinning on both the HTTP and
 * CONNECT paths means there is no second, attacker-controlled resolution to
 * exploit (DNS-rebind TOCTOU).
 */
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { URL } from "node:url";
import {
  resolveAndClassifyHost,
  stripBrackets,
  type GuardLogger,
  type HostClassification,
  type LookupAll,
  type NavigationDenyInfo,
} from "./navigation-guard.js";

/** How long a host's resolve-and-classify result is cached. */
const DNS_CACHE_TTL_MS = 5_000;

export interface FilteringProxyOptions {
  /** CIDR carve-outs from the default deny-set (config allowPrivateNetworks). */
  allowlist: string[];
  /** Called whenever a request is refused, so the navigate tool can surface it. */
  onDeny: (info: NavigationDenyInfo) => void;
  logger: GuardLogger;
  /** Injectable DNS lookup (tests). Defaults to the real resolver. */
  lookupAll?: LookupAll;
}

export interface FilteringProxyHandle {
  /** The ephemeral loopback port the proxy is listening on. */
  port: number;
  /** Always `127.0.0.1`. */
  host: string;
  /** Stop listening and destroy every in-flight socket/tunnel. */
  close(): Promise<void>;
}

/** Bracket an IPv6 literal for use as a URL/`http.request` host. */
function bracketIfIPv6(ip: string): string {
  return ip.includes(":") ? `[${ip}]` : ip;
}

/** Split a `CONNECT` authority (`host:port` or `[::1]:443`) into host + port. */
function splitAuthority(authority: string): { host: string; port: number } {
  if (authority.startsWith("[")) {
    const end = authority.indexOf("]");
    const host = authority.slice(1, end);
    const portStr = authority.slice(end + 2); // skip "]:"
    return { host, port: Number(portStr) || 443 };
  }
  const idx = authority.lastIndexOf(":");
  if (idx === -1) return { host: authority, port: 443 };
  return { host: authority.slice(0, idx), port: Number(authority.slice(idx + 1)) || 443 };
}

/**
 * Hop-by-hop headers that must not be forwarded to the origin (RFC 7230 §6.1),
 * plus the proxy-specific `proxy-connection` Chromium adds.
 */
const HOP_BY_HOP = new Set([
  "proxy-connection",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/**
 * Start the loopback filtering proxy. Resolves once it is listening, so the
 * caller can safely add the `--proxy-server` flag and launch Chromium.
 */
export async function startFilteringProxy(
  opts: FilteringProxyOptions,
): Promise<FilteringProxyHandle> {
  const { allowlist, onDeny, logger, lookupAll } = opts;

  // Short-TTL classification cache: a page hits few hosts many times.
  const dnsCache = new Map<string, { value: HostClassification; expiresAt: number }>();
  async function classify(host: string): Promise<HostClassification> {
    const now = Date.now();
    const cached = dnsCache.get(host);
    if (cached && cached.expiresAt > now) return cached.value;
    const value = await resolveAndClassifyHost(host, allowlist, lookupAll);
    dnsCache.set(host, { value, expiresAt: now + DNS_CACHE_TTL_MS });
    return value;
  }

  function recordDeny(url: string, classification: HostClassification): void {
    onDeny({
      url,
      ...(classification.ip ? { ip: classification.ip } : {}),
      ...(classification.matchedRange ? { matchedRange: classification.matchedRange } : {}),
      reason: classification.reason ?? "denied-range",
    });
  }

  // Track raw tunnel/upgrade sockets so close() can force them shut (the http
  // server's own tracking does not cover CONNECT/upgrade sockets).
  const openSockets = new Set<net.Socket>();
  function track(socket: net.Socket): void {
    openSockets.add(socket);
    socket.once("close", () => openSockets.delete(socket));
  }

  const server = http.createServer();

  // ── Plain HTTP (absolute-form request line) ──
  server.on("request", (req: http.IncomingMessage, res: http.ServerResponse) => {
    void (async () => {
      let target: URL;
      try {
        target = new URL(req.url ?? "");
      } catch {
        res.writeHead(400).end("charlotte-proxy: bad request");
        return;
      }
      const classification = await classify(stripBrackets(target.hostname));
      if (classification.denied) {
        recordDeny(req.url ?? target.href, classification);
        // Abort the connection rather than returning a 403 body. A 403 is a
        // valid HTTP response, so `page.goto` would RESOLVE and render the
        // blocked page; destroying the socket makes the main-document navigation
        // fail with a network error, which the navigate tool turns into
        // NAVIGATION_BLOCKED (a denied *subresource* just fails silently while
        // the main page loads — exactly right). onDeny is already recorded.
        res.destroy();
        return;
      }
      // Pin: connect to the vetted IP, keep the original Host header.
      const vettedIp = classification.ip ?? stripBrackets(target.hostname);
      const forwardedHeaders: http.OutgoingHttpHeaders = {};
      for (const [name, value] of Object.entries(req.headers)) {
        if (!HOP_BY_HOP.has(name.toLowerCase())) forwardedHeaders[name] = value;
      }
      const upstream = http.request(
        {
          host: bracketIfIPv6(vettedIp),
          port: Number(target.port) || 80,
          path: `${target.pathname}${target.search}`,
          method: req.method,
          headers: forwardedHeaders,
        },
        (upstreamRes) => {
          res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
          upstreamRes.pipe(res);
        },
      );
      upstream.on("error", (error) => {
        logger.debug("filtering proxy: upstream HTTP error", { url: req.url, error });
        if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
        res.end("charlotte-proxy: upstream error");
      });
      req.pipe(upstream);
    })().catch((error) => {
      logger.error("filtering proxy: HTTP handler failed (failing closed)", error);
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
  });

  // ── HTTPS via CONNECT (blind TCP tunnel to the vetted IP; no TLS work) ──
  server.on("connect", (req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer) => {
    track(clientSocket);
    clientSocket.on("error", () => clientSocket.destroy());
    void (async () => {
      const { host, port } = splitAuthority(req.url ?? "");
      const classification = await classify(host);
      if (classification.denied) {
        recordDeny(`https://${req.url}`, classification);
        clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        clientSocket.destroy();
        return;
      }
      const vettedIp = classification.ip ?? host;
      const upstream = net.connect(port, vettedIp, () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head && head.length) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
      track(upstream);
      upstream.on("error", () => clientSocket.destroy());
      clientSocket.on("close", () => upstream.destroy());
    })().catch((error) => {
      logger.error("filtering proxy: CONNECT handler failed (failing closed)", error);
      clientSocket.destroy();
    });
  });

  // ── ws:// upgrade (classified like HTTP, forwarded raw to the vetted IP) ──
  server.on("upgrade", (req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer) => {
    track(clientSocket);
    clientSocket.on("error", () => clientSocket.destroy());
    void (async () => {
      let target: URL;
      try {
        target = new URL(req.url ?? "");
      } catch {
        clientSocket.destroy();
        return;
      }
      const classification = await classify(stripBrackets(target.hostname));
      if (classification.denied) {
        recordDeny(req.url ?? target.href, classification);
        clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        clientSocket.destroy();
        return;
      }
      const vettedIp = classification.ip ?? stripBrackets(target.hostname);
      const upstream = net.connect(Number(target.port) || 80, vettedIp, () => {
        // Replay the upgrade handshake in origin-form to the pinned IP. Headers
        // (incl. the original Host and the Upgrade/Connection pair) are preserved
        // verbatim from rawHeaders so the WebSocket handshake still validates.
        const requestLine = `${req.method} ${target.pathname}${target.search} HTTP/1.1\r\n`;
        let headerBlock = "";
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          headerBlock += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
        }
        upstream.write(requestLine + headerBlock + "\r\n");
        if (head && head.length) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
      track(upstream);
      upstream.on("error", () => clientSocket.destroy());
      clientSocket.on("close", () => upstream.destroy());
    })().catch((error) => {
      logger.error("filtering proxy: upgrade handler failed (failing closed)", error);
      clientSocket.destroy();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    // Loopback only: the proxy must never be reachable off-box.
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const port = (server.address() as AddressInfo).port;
  logger.debug("filtering proxy listening", { port });

  return {
    port,
    host: "127.0.0.1",
    async close(): Promise<void> {
      for (const socket of openSockets) socket.destroy();
      openSockets.clear();
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
