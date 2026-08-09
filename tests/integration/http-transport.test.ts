import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import { BrowserManager } from "../../src/browser/browser-manager.js";
import { resolveTestNoSandbox } from "../helpers/sandbox-env.js";
import { PageManager } from "../../src/browser/page-manager.js";
import { CDPSessionManager } from "../../src/browser/cdp-session.js";
import { RendererPipeline } from "../../src/renderer/renderer-pipeline.js";
import { ElementIdGenerator } from "../../src/renderer/element-id-generator.js";
import { SnapshotStore } from "../../src/state/snapshot-store.js";
import { ArtifactStore } from "../../src/state/artifact-store.js";
import { createDefaultConfig } from "../../src/types/config.js";
import type { SessionContext } from "../../src/core/types.js";
import { startHttpTransport, type HttpTransportHandle } from "../../src/transports/http.js";
import { PROFILE_TOOLS } from "../../src/tools/tool-groups.js";
import { pollUntil } from "../helpers/poll.js";

/**
 * Step-2 smoke tests for the streamable HTTP transport
 * (docs/remote/slice-1.md, step 2).
 *
 * Deliberately modest: it proves the transport starts, authenticates, speaks
 * the protocol, and round-trips one real tool call against the shared session.
 * The parity harness and the full I3/I4/I5 assertion set are step 3.
 *
 * Chromium is never launched by the transport itself — the 401 cases assert
 * that directly through `BrowserManager.isConnected()`.
 */

const SIMPLE_FIXTURE = `file://${path.resolve(import.meta.dirname, "../fixtures/pages/simple.html")}`;
const TEST_TOKEN = "test-token-3f9a2c";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

/**
 * Read a JSON-RPC response body.
 *
 * The 2025-era ("legacy") stateless leg answers over SSE whenever the request
 * accepts `text/event-stream` — which is what the R2 spike says claude.ai's
 * connector client sends — so the single `data:` frame is unwrapped here.
 */
async function readJsonRpc(response: Response): Promise<JsonRpcResponse> {
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

describe("HTTP transport (slice 1 step 2 smoke)", () => {
  let ctx: SessionContext;
  let browserManager: BrowserManager;
  let transport: HttpTransportHandle;
  let baseUrl: string;
  let artifactDirectory: string;
  let requestId = 0;

  /** POST a JSON-RPC message to /mcp, optionally with a bearer token. */
  function postMcp(body: unknown, token?: string): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (token !== undefined) {
      headers.authorization = `Bearer ${token}`;
    }
    return fetch(`${baseUrl}/mcp`, { method: "POST", headers, body: JSON.stringify(body) });
  }

  /** POST an authenticated JSON-RPC call and unwrap the response. */
  async function callMcp(method: string, params: unknown): Promise<JsonRpcResponse> {
    requestId += 1;
    const response = await postMcp({ jsonrpc: "2.0", id: requestId, method, params }, TEST_TOKEN);
    expect(response.status).toBe(200);
    return readJsonRpc(response);
  }

  beforeAll(async () => {
    const config = createDefaultConfig();
    const cdpSessionManager = new CDPSessionManager();
    const pageManager = new PageManager(config, cdpSessionManager);
    browserManager = new BrowserManager(config, { noSandbox: resolveTestNoSandbox() });
    const elementIdGenerator = new ElementIdGenerator();
    artifactDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "charlotte-http-test-"));
    const artifactStore = new ArtifactStore(artifactDirectory);
    await artifactStore.initialize();

    ctx = {
      browserManager,
      pageManager,
      cdpSessionManager,
      rendererPipeline: new RendererPipeline(cdpSessionManager, elementIdGenerator, config),
      elementIdGenerator,
      snapshotStore: new SnapshotStore(config.snapshotDepth),
      artifactStore,
      config,
    };

    // Port 0 → ephemeral; the handle reports the port actually bound.
    transport = await startHttpTransport(ctx, {
      port: 0,
      host: "127.0.0.1",
      authToken: TEST_TOKEN,
      profile: "browse",
    });
    baseUrl = `http://127.0.0.1:${transport.port}`;
  });

  afterAll(async () => {
    await transport?.close();
    await browserManager?.close();
    await fs.rm(artifactDirectory, { recursive: true, force: true }).catch(() => {});
  });

  describe("startup", () => {
    it("refuses to start without a bearer token", async () => {
      await expect(
        startHttpTransport(ctx, { port: 0, host: "127.0.0.1", profile: "browse" }),
      ).rejects.toThrow(/CHARLOTTE_AUTH_TOKEN/);
    });

    it("refuses to start on a blank token", async () => {
      await expect(
        startHttpTransport(ctx, {
          port: 0,
          host: "127.0.0.1",
          authToken: "   ",
          profile: "browse",
        }),
      ).rejects.toThrow(/"authToken"/);
    });

    it("binds an ephemeral port and reports it", () => {
      expect(transport.port).toBeGreaterThan(0);
      expect(transport.host).toBe("127.0.0.1");
    });
  });

  describe("GET /healthz", () => {
    it("answers unauthenticated with version, uptime, and browser state", async () => {
      const response = await fetch(`${baseUrl}/healthz`);
      expect(response.status).toBe(200);

      const body = (await response.json()) as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(["browser_connected", "uptime_s", "version"]);
      expect(typeof body.version).toBe("string");
      expect(typeof body.uptime_s).toBe("number");
      expect(body.uptime_s).toBeGreaterThanOrEqual(0);
      expect(typeof body.browser_connected).toBe("boolean");
    });
  });

  describe("auth (I4: rejection is pre-session, pre-browser)", () => {
    const initializeMessage = {
      jsonrpc: "2.0" as const,
      id: 99,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "http-smoke", version: "1.0.0" },
      },
    };

    it("rejects a request with no Authorization header", async () => {
      const response = await postMcp(initializeMessage);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
      expect(browserManager.isConnected()).toBe(false);
    });

    it("rejects a wrong token", async () => {
      const response = await postMcp(initializeMessage, "not-the-token");
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
      expect(browserManager.isConnected()).toBe(false);
    });

    it("rejects a malformed Authorization header", async () => {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: TEST_TOKEN, // missing the "Bearer " scheme
        },
        body: JSON.stringify(initializeMessage),
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
      expect(browserManager.isConnected()).toBe(false);
    });
  });

  describe("protocol", () => {
    it("completes a legacy-era initialize handshake", async () => {
      const message = await callMcp("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "http-smoke", version: "1.0.0" },
      });

      expect(message.error).toBeUndefined();
      expect(message.result?.protocolVersion).toBe("2025-11-25");
      expect(message.result?.serverInfo).toMatchObject({ name: "charlotte" });
      // Stateless: no session handshake is issued to a legacy client.
      expect(message.result).not.toHaveProperty("sessionId");
    });

    it("serves instructions that point at the read-only charlotte_tools reporter", async () => {
      const message = await callMcp("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "http-smoke", version: "1.0.0" },
      });

      const instructions = message.result?.instructions as string;
      expect(instructions).toContain("Active profile: browse.");
      expect(instructions).toContain("Call charlotte_tools to list the exposed groups (read-only)");
      expect(instructions).toContain("change http.profile to expose more");
    });

    it("lists the browse profile plus the read-only charlotte_tools reporter", async () => {
      const message = await callMcp("tools/list", {});

      const tools = message.result?.tools as Array<{ name: string }>;
      const names = tools.map((tool) => tool.name);
      expect(names).toEqual([...PROFILE_TOOLS.browse, "charlotte_tools"]);
      expect(names).toContain("charlotte_tools");

      // The SDK never adds cache fields to 2025-era responses — claude.ai's current
      // connector is legacy-era, so it does not receive ttlMs/cacheScope (D20).
      expect(message.result).not.toHaveProperty("ttlMs");
      expect(message.result).not.toHaveProperty("cacheScope");
    });
  });

  describe("tool round-trip", () => {
    it("navigates to a fixture page and returns a session-tagged payload", async () => {
      const message = await callMcp("tools/call", {
        name: "charlotte_navigate",
        arguments: { url: SIMPLE_FIXTURE },
      });

      expect(message.error).toBeUndefined();
      const content = message.result?.content as Array<{ type: string; text: string }>;
      const payload = JSON.parse(content[0].text) as Record<string, unknown>;

      expect(payload.session_id).toBe("default");
      expect(payload.url).toBe(SIMPLE_FIXTURE);
      expect(payload.title).toBe("Simple Test Page");
      expect(payload.snapshot_id).toBe(1);

      // The tool call — not the transport — is what brings the browser up.
      expect(browserManager.isConnected()).toBe(true);
    });

    it("keeps one shared session across requests (snapshot IDs advance)", async () => {
      const message = await callMcp("tools/call", {
        name: "charlotte_observe",
        arguments: {},
      });

      const content = message.result?.content as Array<{ type: string; text: string }>;
      const payload = JSON.parse(content[0].text) as Record<string, unknown>;
      expect(payload.session_id).toBe("default");
      expect(payload.snapshot_id).toBe(2);
    });
  });

  /**
   * Request observation (D2 — observe-then-build).
   *
   * claude.ai's connector probes discovery endpoints Charlotte does not serve;
   * these tests pin the two things the observation run depends on: that the
   * probes are visible at all, and that the log never carries the credential
   * that would make the log itself a secret.
   */
  describe("request observation", () => {
    const PROBE_PATH = "/.well-known/oauth-authorization-server";

    /** Run `fn` with stderr captured, restoring the real stream afterwards. */
    async function withCapturedStderr(fn: (lines: string[]) => Promise<void>): Promise<string> {
      const chunks: string[] = [];
      const spy = vi.spyOn(process.stderr, "write").mockImplementation(((
        chunk: string | Uint8Array,
      ) => {
        chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
      }) as typeof process.stderr.write);
      try {
        await fn(chunks);
      } finally {
        spy.mockRestore();
      }
      return chunks.join("");
    }

    /** Wait for a log line to arrive — `res.on("finish")` fires after fetch resolves. */
    function waitForLog(chunks: string[], needle: string): Promise<unknown> {
      return pollUntil(() => chunks.join("").includes(needle), {
        timeout: 2000,
        message: `no log line containing ${JSON.stringify(needle)}`,
      });
    }

    it("is off by default: unmatched paths 404 as JSON, nothing is logged", async () => {
      const logged = await withCapturedStderr(async () => {
        const response = await fetch(`${baseUrl}${PROBE_PATH}`);
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: "not_found" });
      });

      expect(logged).not.toContain("unmatched route");
      expect(logged).not.toContain("http request");
    });

    describe("enabled via config", () => {
      let observed: HttpTransportHandle;
      let observedUrl: string;

      beforeAll(async () => {
        observed = await startHttpTransport(ctx, {
          port: 0,
          host: "127.0.0.1",
          authToken: TEST_TOKEN,
          profile: "browse",
          debugRequests: true,
        });
        observedUrl = `http://127.0.0.1:${observed.port}`;
      });

      afterAll(async () => {
        await observed?.close();
      });

      it("logs an unmatched discovery probe with its path and query", async () => {
        const logged = await withCapturedStderr(async (chunks) => {
          const response = await fetch(`${observedUrl}${PROBE_PATH}?resource=charlotte`);
          expect(response.status).toBe(404);
          expect(await response.json()).toEqual({ error: "not_found" });
          await waitForLog(chunks, "http response");
        });

        expect(logged).toContain("unmatched route");
        expect(logged).toContain(`${PROBE_PATH}?resource=charlotte`);
        // The status is attributed to the path that produced it.
        expect(logged).toMatch(/"message":"http response".*"status":404/);
      });

      it("redacts the bearer token but records that it was present", async () => {
        const logged = await withCapturedStderr(async (chunks) => {
          const response = await fetch(`${observedUrl}/mcp`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json, text/event-stream",
              authorization: `Bearer ${TEST_TOKEN}`,
            },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
          });
          expect(response.status).toBe(200);

          // /mcp itself is unaffected by observation mode.
          const message = await readJsonRpc(response);
          const tools = message.result?.tools as Array<{ name: string }>;
          expect(tools.map((tool) => tool.name)).toEqual([
            ...PROFILE_TOOLS.browse,
            "charlotte_tools",
          ]);
          await waitForLog(chunks, "http response");
        });

        expect(logged).toContain("http request");
        expect(logged).toContain("scheme=Bearer");
        // The whole point: a shared log file must not leak the credential.
        expect(logged).not.toContain(TEST_TOKEN);
        expect(logged).toMatch(/"message":"http response".*"status":200/);
      });

      it("leaves /healthz answering unauthenticated", async () => {
        const response = await fetch(`${observedUrl}/healthz`);
        expect(response.status).toBe(200);

        const body = (await response.json()) as Record<string, unknown>;
        expect(Object.keys(body).sort()).toEqual(["browser_connected", "uptime_s", "version"]);
      });

      it("still rejects an unauthenticated /mcp request with 401", async () => {
        const response = await fetch(`${observedUrl}/mcp`, { method: "POST", body: "{}" });
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: "unauthorized" });
      });
    });

    it("is enabled by CHARLOTTE_DEBUG_HTTP even when the config says false", async () => {
      const previous = process.env.CHARLOTTE_DEBUG_HTTP;
      process.env.CHARLOTTE_DEBUG_HTTP = "1";
      let observed: HttpTransportHandle | undefined;
      try {
        observed = await startHttpTransport(ctx, {
          port: 0,
          host: "127.0.0.1",
          authToken: TEST_TOKEN,
          profile: "browse",
          debugRequests: false,
        });
        const logged = await withCapturedStderr(async (chunks) => {
          const response = await fetch(`http://127.0.0.1:${observed!.port}/register`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          });
          expect(response.status).toBe(404);
          expect(await response.json()).toEqual({ error: "not_found" });
          await waitForLog(chunks, "unmatched route");
        });

        expect(logged).toContain('"path":"/register"');
        expect(logged).toContain('"method":"POST"');
      } finally {
        await observed?.close();
        if (previous === undefined) {
          delete process.env.CHARLOTTE_DEBUG_HTTP;
        } else {
          process.env.CHARLOTTE_DEBUG_HTTP = previous;
        }
      }
    });
  });
});
