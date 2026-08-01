import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import {
  setupHttpHarness,
  setupUnlaunchedHttpHarness,
  readJsonRpc,
  type HttpHarness,
} from "../helpers/http-harness.js";
import { parseToolJson } from "../helpers/mcp-harness.js";

/**
 * I4 — auth rejection is pre-session (docs/remote/slice-1.md step 3).
 *
 * The assertion is stronger than "returns 401": *no request without a valid
 * bearer token causes ANY browser activity, page load, or session mutation.*
 * Testing that honestly requires two different fixtures:
 *
 *  - A **cold** harness whose Chromium was never launched and whose tab was
 *    never opened. Against a pre-launched browser `isConnected()` is true no
 *    matter what the transport does, and the assertion would be vacuous — so
 *    the cold cases use {@link setupUnlaunchedHttpHarness} and assert on the
 *    `SessionContext` directly (browser down, no pages, empty snapshot store).
 *  - A **live** harness mid-session (page already navigated, snapshots
 *    accumulated), where the question is the other half of the invariant: a
 *    rejected request must leave existing state exactly as it found it.
 *
 * Both read the ctx the transport is actually serving, not a proxy for it.
 */
const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures/pages");

/** Everything about the session an unauthorized request must not be able to move. */
interface SessionFingerprint {
  browserConnected: boolean;
  hasPages: boolean;
  tabCount: number;
  activeUrl: string | null;
  snapshotCount: number;
  latestSnapshotId: number;
}

async function fingerprintSession(harness: HttpHarness): Promise<SessionFingerprint> {
  const tabs = harness.pageManager.hasPages() ? await harness.pageManager.listTabs() : [];
  let activeUrl: string | null = null;
  try {
    activeUrl = harness.pageManager.getActivePage().url();
  } catch {
    activeUrl = null;
  }
  return {
    browserConnected: harness.browserManager.isConnected(),
    hasPages: harness.pageManager.hasPages(),
    tabCount: tabs.length,
    activeUrl,
    snapshotCount: harness.snapshotStore.size,
    latestSnapshotId: harness.snapshotStore.getLatestId(),
  };
}

describe("I4: a request without a valid token never reaches the session", () => {
  describe("cold session — browser never launched", () => {
    let harness: HttpHarness;

    /** The state before any rejected request; every case must return to exactly this. */
    const COLD_BASELINE: SessionFingerprint = {
      browserConnected: false,
      hasPages: false,
      tabCount: 0,
      activeUrl: null,
      snapshotCount: 0,
      latestSnapshotId: 0,
    };

    beforeAll(async () => {
      harness = await setupUnlaunchedHttpHarness();
    });

    afterAll(async () => {
      await harness?.teardown();
    });

    it("starts cold: no browser, no pages, no snapshots", async () => {
      // Establishes the baseline is real — the MCP client's own authenticated
      // initialize/tools-list handshake during setup touched none of it.
      expect(await fingerprintSession(harness)).toEqual(COLD_BASELINE);
    });

    it("rejects a tokenless tools/call with 401 and zero browser activity", async () => {
      const response = await harness.callToolRaw(
        "charlotte_navigate",
        { url: "https://example.com/" },
        { token: null },
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
      expect(await fingerprintSession(harness)).toEqual(COLD_BASELINE);
    });

    it("rejects a bad-token tools/call with 401 and zero browser activity", async () => {
      const response = await harness.callToolRaw(
        "charlotte_navigate",
        { url: "https://example.com/" },
        { token: "definitely-not-the-token" },
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
      expect(await fingerprintSession(harness)).toEqual(COLD_BASELINE);
    });

    it("rejects a tokenless initialize before any MCP server is constructed", async () => {
      const response = await harness.postMcp(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "i4-probe", version: "1.0.0" },
          },
        },
        { token: null },
      );

      expect(response.status).toBe(401);
      // A plain JSON error body, not a JSON-RPC envelope: the rejection happens
      // in Express middleware, upstream of the protocol layer entirely.
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toEqual({ error: "unauthorized" });
      expect(await fingerprintSession(harness)).toEqual(COLD_BASELINE);
    });

    it("still serves a tool call once the token is right (the harness is not broken)", async () => {
      const result = await harness.callTool("charlotte_navigate", {
        url: `file://${path.join(FIXTURES_DIR, "simple.html")}`,
      });
      const payload = parseToolJson<Record<string, unknown>>(result);

      expect(payload.snapshot_id).toBe(1);
      // Contrast with every assertion above: an authorized call is exactly what
      // brings the browser up. The 401s were not failing for some other reason.
      expect(harness.browserManager.isConnected()).toBe(true);
    });
  });

  describe("live session — rejected requests leave existing state alone", () => {
    let harness: HttpHarness;
    let liveFingerprint: SessionFingerprint;

    beforeAll(async () => {
      harness = await setupHttpHarness({ serveDirectory: FIXTURES_DIR });
      await harness.callTool("charlotte_navigate", {
        url: `${harness.fixtureServer!.url}/simple.html`,
      });
      await harness.callTool("charlotte_observe", {});
      liveFingerprint = await fingerprintSession(harness);

      // Sanity: the session really is live, or the assertions below prove nothing.
      expect(liveFingerprint.browserConnected).toBe(true);
      expect(liveFingerprint.latestSnapshotId).toBe(2);
      expect(liveFingerprint.activeUrl).toBe(`${harness.fixtureServer!.url}/simple.html`);
    });

    afterAll(async () => {
      await harness?.teardown();
    });

    it("a well-formed request with a wrong token does not mutate the live session", async () => {
      const response = await harness.callToolRaw(
        "charlotte_navigate",
        { url: `${harness.fixtureServer!.url}/form.html` },
        { token: "valid-shape-wrong-value" },
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
      // Snapshot counter did not advance and the page did not navigate away.
      expect(await fingerprintSession(harness)).toEqual(liveFingerprint);
    });

    it("a malformed Authorization scheme does not mutate the live session", async () => {
      const response = await harness.callToolRaw(
        "charlotte_reload",
        {},
        { headers: { authorization: harness.authToken } }, // no "Bearer " prefix
      );

      expect(response.status).toBe(401);
      expect(await fingerprintSession(harness)).toEqual(liveFingerprint);
    });

    it("a malformed JSON body with a VALID token is rejected without touching the session", async () => {
      const response = await harness.postMcp(null, { rawBody: '{"jsonrpc":"2.0","id":7,' });

      // Observed shape pinned here rather than assumed: the token is good, so
      // the request clears auth and the SDK's own body parsing is what fails.
      expect(response.status).toBe(400);
      const message = await readJsonRpc(response);
      expect(message.error).toBeDefined();
      expect(message.error?.code).toBe(-32700); // JSON-RPC "Parse error"

      // The point of the case: a request that got PAST auth but never became a
      // valid tool call must be just as inert as one that was rejected at the door.
      expect(await fingerprintSession(harness)).toEqual(liveFingerprint);
    });

    it("a syntactically valid body with an unknown method does not touch the session", async () => {
      const response = await harness.postMcp({
        jsonrpc: "2.0",
        id: 8,
        method: "tools/nonexistent",
        params: {},
      });

      const message = await readJsonRpc(response);
      expect(message.error).toBeDefined();
      expect(await fingerprintSession(harness)).toEqual(liveFingerprint);
    });
  });
});
