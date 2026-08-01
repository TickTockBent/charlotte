import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import { BrowserManager } from "../../src/browser/browser-manager.js";
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
    browserManager = new BrowserManager(config, { noSandbox: true });
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

    it("serves instructions that do not advertise the absent meta-tool", async () => {
      const message = await callMcp("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "http-smoke", version: "1.0.0" },
      });

      const instructions = message.result?.instructions as string;
      expect(instructions).toContain("Active profile: browse.");
      expect(instructions).not.toContain("charlotte_tools");
      expect(instructions).toContain("change the server config (http.profile)");
    });

    it("lists exactly the browse profile, with charlotte_tools absent", async () => {
      const message = await callMcp("tools/list", {});

      const tools = message.result?.tools as Array<{ name: string }>;
      const names = tools.map((tool) => tool.name);
      expect(names).toEqual(PROFILE_TOOLS.browse);
      expect(names).not.toContain("charlotte_tools");
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
});
