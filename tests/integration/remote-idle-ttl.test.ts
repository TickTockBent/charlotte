/**
 * Idle-TTL session sweep — real-browser integration (D17, I7).
 *
 * Injects a short `sessionIdleTtlMs` (a TEST value, NOT the ⟨tune⟩ 30-min
 * default) and proves the whole-browser sweep end to end:
 *
 *  - the sweep tears an active browser down after the TTL, and the next tool
 *    call recovers on a FRESH session (no stale page data) via the #201 path;
 *  - the sweep is a safe no-op when the browser was never launched (onIdle's
 *    `browserManager.close()` + `pageManager.reset()` are null-safe).
 *
 * Robustness: the persistent MCP client keeps an SSE stream open that would
 * touch the reaper and prevent idle-out, so every case closes the client
 * immediately and drives all activity through the raw one-shot path
 * (`callToolRaw` + `readJsonRpc`, or `postMcp`). Touch is recorded at request
 * START, so injected TTLs are chosen with margin over a single navigate.
 *
 * Fixtures are navigated via `file://` URLs (as lifecycle.test.ts and
 * http-transport.test.ts do): HTTP mode arms the outbound SSRF guard, which
 * denies loopback by default, so a local static fixture server would be blocked
 * — `file://` is the guard-neutral path a real navigation smoke test uses.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as path from "node:path";
import {
  setupHttpHarness,
  setupUnlaunchedHttpHarness,
  readJsonRpc,
  type HttpHarness,
  type JsonRpcResponse,
} from "../helpers/http-harness.js";
import { pollUntil } from "../helpers/poll.js";

const FIXTURES = path.resolve(import.meta.dirname, "../fixtures/pages");
const SIMPLE = `file://${path.join(FIXTURES, "simple.html")}`;
const SPA = `file://${path.join(FIXTURES, "spa.html")}`;

/** Pull a navigate tool result's JSON payload off a raw JSON-RPC response. */
async function readNavigatePayload(response: Response): Promise<Record<string, unknown>> {
  const message: JsonRpcResponse = await readJsonRpc(response);
  expect(message.error).toBeUndefined();
  const content = message.result?.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text) as Record<string, unknown>;
}

describe("idle-TTL session sweep (D17, I7)", () => {
  let harness: HttpHarness | undefined;

  afterEach(async () => {
    await harness?.teardown();
    harness = undefined;
  });

  it("tears the active browser down after idle, and the next call recovers on a fresh session", async () => {
    // 4000 ms fuse: only so the RECOVERY navigate (which re-arms the timer at
    // request start) isn't itself re-swept mid-flight — a TTL-shorter-than-a-
    // tool-call artifact of the aggressive test TTL, NOT the teardown/recovery
    // race D18 fixes structurally (production runs 30 min). First idle-out just
    // waits ~4000 ms.
    harness = await setupHttpHarness({ sessionIdleTtlMs: 4000 });
    // Drop the persistent client so its keepalive cannot touch the reaper.
    await harness.client.close();

    // Fixture A: establish a live session.
    const first = await readNavigatePayload(
      await harness.callToolRaw("charlotte_navigate", { url: SIMPLE }),
    );
    expect(first.title).toBe("Simple Test Page");
    expect(harness.browserManager.isConnected()).toBe(true);

    // Idle past the TTL — the sweep tears the whole browser down.
    await pollUntil(() => !harness!.browserManager.isConnected(), {
      timeout: 12000,
      interval: 100,
      message: "idle sweep never tore the browser down",
    });
    expect(harness.pageManager.hasPages()).toBe(false);

    // Fixture B: the next call relaunches a fresh session; it must see B's data,
    // not stale A data, and the browser must be connected again.
    const second = await readNavigatePayload(
      await harness.callToolRaw("charlotte_navigate", { url: SPA }),
    );
    expect(second.title).toBe("SPA Test Page");
    expect(harness.browserManager.isConnected()).toBe(true);
  });

  it("is a safe no-op when the browser was never launched", async () => {
    harness = await setupUnlaunchedHttpHarness({ sessionIdleTtlMs: 800 });
    await harness.client.close();

    // tools/list touches (arms the reaper) but does not launch the browser.
    const listResponse = await harness.postMcp({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    const listMessage = await readJsonRpc(listResponse);
    expect(listMessage.error).toBeUndefined();
    expect(harness.browserManager.isConnected()).toBe(false);

    // Wait past the TTL: onIdle runs against a never-launched browser and must
    // stay a null-safe no-op — no throw, still nothing connected. (The wait
    // exceeds the 800 ms TTL, so the sweep provably fired.) The case ends here:
    // launch-after-teardown recovery is already covered by case 1, and a cold
    // launch+navigate against an 800 ms armed timer would only reintroduce the
    // mid-navigate race this test set deliberately avoids.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(harness.browserManager.isConnected()).toBe(false);
  });

  it("a call landing inside a forced teardown window gets a fresh session or a clean error, never a blank page", async () => {
    // Reaper inert (TTL 0) — we force the teardown window by hand, not via the
    // timer, so the recovery call reliably lands mid-teardown.
    harness = await setupHttpHarness({ sessionIdleTtlMs: 0 });
    await harness.client.close();

    const first = await readNavigatePayload(
      await harness.callToolRaw("charlotte_navigate", { url: SIMPLE }),
    );
    expect(first.title).toBe("Simple Test Page");
    expect(harness.browserManager.isConnected()).toBe(true);

    // Force the window: fire teardown (simulating the sweep) and the recovery
    // call so they overlap. close() sets this.closing synchronously, so the
    // navigate reliably lands inside the teardown window (D18).
    const closeP = harness.ctx.browserManager.close();
    const response = await harness.callToolRaw("charlotte_navigate", { url: SPA });
    await closeP;

    // I7: fresh session OR a clean recoverable error — NEVER a blank page.
    const message = await readJsonRpc(response);
    if (message.error) {
      expect(typeof message.error.message).toBe("string");
      expect(message.error.message.length).toBeGreaterThan(0);
    } else {
      const content = message.result?.content as Array<{ type: string; text: string }>;
      const payload = JSON.parse(content[0].text) as Record<string, unknown>;
      expect(payload.title).toBe("SPA Test Page");
    }

    // The session recovered either way.
    expect(harness.browserManager.isConnected()).toBe(true);
  });
});
