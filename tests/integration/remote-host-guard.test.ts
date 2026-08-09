/**
 * Inbound Host-header DNS-rebind guard (D16, invariant I10).
 *
 * A DNS-rebind attacker rebinds their own domain (`evil.example`) to
 * `127.0.0.1` and makes a victim's browser POST to Charlotte's loopback
 * listener; the browser sends `Host: evil.example`. The guard refuses any
 * request whose Host hostname is not on the startup allowlist, 403 before any
 * auth check, session touch, or browser activity (I10, mirroring I4).
 *
 * Node's undici `fetch` treats `Host` as a forbidden header and silently drops
 * it, so the harness `postMcp` cannot override Host. These tests use raw
 * `node:http` with an explicit `Host` header instead. No browser is launched —
 * this exercises the HTTP boundary only; the harness MCP client still connects
 * with Host `127.0.0.1`, which is always allowlisted.
 */
import { describe, it, expect } from "vitest";
import http from "node:http";
import { setupUnlaunchedHttpHarness, type HttpHarness } from "../helpers/http-harness.js";

/**
 * Raw HTTP request with a caller-chosen `Host` header — the one thing undici's
 * `fetch` refuses to send. Returns the status and the raw body text.
 */
function rawRequest(
  harness: HttpHarness,
  opts: { path: string; host: string; method?: string; token?: string },
): Promise<{ status: number; body: string }> {
  const url = new URL(harness.baseUrl);
  const method = opts.method ?? "POST";
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: url.hostname,
        port: Number(url.port),
        path: opts.path,
        method,
        headers: {
          Host: opts.host,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end(
      method === "POST"
        ? JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
        : undefined,
    );
  });
}

describe("inbound Host-header DNS-rebind guard (I10)", () => {
  it("I10: refuses a foreign Host on /mcp before auth (403, not 401)", async () => {
    const harness = await setupUnlaunchedHttpHarness();
    try {
      const response = await rawRequest(harness, {
        path: "/mcp",
        host: "evil.example",
        token: harness.authToken,
      });
      // 403 (guard), NOT 401 (auth) — the guard precedes the auth middleware.
      expect(response.status).toBe(403);
      const parsed = JSON.parse(response.body) as { error?: unknown };
      expect(parsed.error).toBeDefined();
    } finally {
      await harness.teardown();
    }
  });

  it("I10: refuses a foreign Host on /healthz (whole-app coverage)", async () => {
    const harness = await setupUnlaunchedHttpHarness();
    try {
      const response = await rawRequest(harness, {
        path: "/healthz",
        host: "attacker.com",
        method: "GET",
      });
      expect(response.status).toBe(403);
    } finally {
      await harness.teardown();
    }
  });

  it("I10: a loopback Host passes on both /healthz and /mcp", async () => {
    const harness = await setupUnlaunchedHttpHarness();
    try {
      const port = new URL(harness.baseUrl).port;
      const health = await rawRequest(harness, {
        path: "/healthz",
        host: `127.0.0.1:${port}`,
        method: "GET",
      });
      expect(health.status).toBe(200);
      const healthBody = JSON.parse(health.body) as { version?: unknown };
      expect(healthBody.version).toBeDefined();

      const mcp = await rawRequest(harness, {
        path: "/mcp",
        host: "localhost",
        token: harness.authToken,
      });
      // Both guard and auth pass; a real tools/list round-trips (200).
      expect(mcp.status).not.toBe(403);
      expect(mcp.status).toBe(200);
    } finally {
      await harness.teardown();
    }
  });

  it("I10: the publicOrigin hostname is allowlisted; other hosts still 403", async () => {
    const harness = await setupUnlaunchedHttpHarness({
      publicOrigin: "https://charlotte.example.com",
    });
    try {
      const allowed = await rawRequest(harness, {
        path: "/mcp",
        host: "charlotte.example.com",
        token: harness.authToken,
      });
      expect(allowed.status).not.toBe(403);

      const refused = await rawRequest(harness, {
        path: "/mcp",
        host: "evil.example",
        token: harness.authToken,
      });
      expect(refused.status).toBe(403);
    } finally {
      await harness.teardown();
    }
  });

  it("I10: operator allowedHosts extends the allowlist", async () => {
    const harness = await setupUnlaunchedHttpHarness({
      allowedHosts: ["proxy.internal"],
    });
    try {
      const response = await rawRequest(harness, {
        path: "/mcp",
        host: "proxy.internal",
        token: harness.authToken,
      });
      expect(response.status).not.toBe(403);
    } finally {
      await harness.teardown();
    }
  });

  it("I10: does not regress I3 — a default-Host client call still succeeds", async () => {
    const harness = await setupUnlaunchedHttpHarness();
    try {
      // postMcp goes through undici fetch, which sends the default Host
      // (127.0.0.1:<port>) — always allowlisted.
      const response = await harness.postMcp({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      });
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
    } finally {
      await harness.teardown();
    }
  });
});
