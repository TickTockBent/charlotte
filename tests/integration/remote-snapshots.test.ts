import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { StaticServer } from "../../src/dev/static-server.js";
import { setupHttpHarness, type HttpHarness } from "../helpers/http-harness.js";
import { parseToolJson } from "../helpers/mcp-harness.js";

/**
 * I5 — snapshot identity over HTTP (docs/remote/slice-1.md step 3).
 *
 * Two halves:
 *
 *  1. **Monotonic within a session.** The single implicit session (pillar 2)
 *     is the only thing making a snapshot ID mean anything across separate
 *     HTTP requests — the transport itself is stateless and builds a fresh MCP
 *     shell per request. If IDs reset, skipped, or restarted per connection,
 *     every ID an agent quoted in an earlier chat turn would be a lie.
 *  2. **Explicit across restarts.** After a server restart the ring buffer is
 *     empty and the counter is back at 1, so an ID the agent is still holding
 *     from the previous process now either points at nothing or — worse —
 *     could collide with a NEW snapshot of a different page. The requirement
 *     is that a stale reference produces the existing snapshot-not-found error
 *     result, never a silently wrong diff.
 *
 * The stale-reference error shape is pinned here, not merely smoke-checked:
 * this is the failure mode an agent has to be able to recognize in chat.
 */
const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures/pages");

/** Payload shape of a successful `charlotte_diff` (src/state/differ.ts). */
interface DiffPayload {
  session_id: string;
  from_snapshot: number;
  to_snapshot: number;
  changes: unknown;
  summary: unknown;
}

/** Payload shape of any Charlotte error result (`CharlotteError.toResponse`). */
interface ErrorPayload {
  session_id: string;
  error: { code: string; message: string; suggestion?: string };
}

/** Read `snapshot_id` out of a tool result. */
function snapshotIdOf(result: CallToolResult): number {
  const payload = parseToolJson<{ snapshot_id?: number }>(result);
  if (typeof payload.snapshot_id !== "number") {
    throw new Error(`Tool result carried no snapshot_id: ${JSON.stringify(payload)}`);
  }
  return payload.snapshot_id;
}

describe("I5: snapshot IDs over HTTP", () => {
  // One fixture server shared by the pre-restart and post-restart harnesses, so
  // "the server restarted" is the only variable between them.
  let fixtureServer: StaticServer;
  let fixtureBaseUrl: string;

  beforeAll(async () => {
    fixtureServer = new StaticServer();
    const info = await fixtureServer.start({
      directoryPath: FIXTURES_DIR,
      allowedRoot: FIXTURES_DIR,
    });
    fixtureBaseUrl = info.url;
  });

  afterAll(async () => {
    await fixtureServer?.stop().catch(() => {});
  });

  describe("monotonicity within one session", () => {
    let harness: HttpHarness;

    beforeAll(async () => {
      harness = await setupHttpHarness();
    });

    afterAll(async () => {
      await harness?.teardown();
    });

    it("advances by exactly one per rendering call, across separate HTTP requests", async () => {
      const observedIds: number[] = [];

      observedIds.push(
        snapshotIdOf(
          await harness.callTool("charlotte_navigate", { url: `${fixtureBaseUrl}/simple.html` }),
        ),
      );
      observedIds.push(
        snapshotIdOf(
          await harness.callTool("charlotte_navigate", { url: `${fixtureBaseUrl}/form.html` }),
        ),
      );
      observedIds.push(snapshotIdOf(await harness.callTool("charlotte_observe", {})));

      // Strictly increasing, starting at 1, with no gaps and no resets: each of
      // these was a separate TCP request against a stateless handler.
      expect(observedIds).toEqual([1, 2, 3]);
      expect(harness.snapshotStore.getLatestId()).toBe(3);
      expect(harness.snapshotStore.size).toBe(3);
    });

    it("keeps advancing after further calls (no per-request counter reset)", async () => {
      const nextId = snapshotIdOf(await harness.callTool("charlotte_observe", {}));
      expect(nextId).toBe(4);

      const afterThat = snapshotIdOf(await harness.callTool("charlotte_observe", {}));
      expect(afterThat).toBe(5);
    });

    it("diffs against a live in-session snapshot (the control for the stale case)", async () => {
      const result = await harness.callTool("charlotte_diff", { snapshot_id: 1 });
      expect(result.isError).toBeFalsy();

      const payload = parseToolJson<DiffPayload>(result);
      expect(payload.from_snapshot).toBe(1);
      expect(payload.to_snapshot).toBeGreaterThan(1);
      expect(payload.changes).toBeDefined();
    });
  });

  describe("cross-restart references error explicitly", () => {
    let staleSnapshotId: number;
    let restarted: HttpHarness;

    beforeAll(async () => {
      // ─── The "before restart" process ───
      const original = await setupHttpHarness();
      await original.callTool("charlotte_navigate", { url: `${fixtureBaseUrl}/simple.html` });
      await original.callTool("charlotte_observe", {});
      await original.callTool("charlotte_observe", {});
      staleSnapshotId = snapshotIdOf(await original.callTool("charlotte_observe", {}));
      expect(staleSnapshotId).toBe(4);

      // ─── Restart: the ENTIRE stack goes away ───
      // Transport, MCP client, Chromium, SessionContext, snapshot store, temp
      // artifact dir. Nothing survives except the ID the agent is still holding.
      await original.teardown();

      restarted = await setupHttpHarness();
      // One navigation on the new process: the store now holds ONLY id 1, so
      // the stale id 4 is above the high-water mark of a store that has been
      // reset — precisely the collision-adjacent case that must not diff.
      const freshId = snapshotIdOf(
        await restarted.callTool("charlotte_navigate", { url: `${fixtureBaseUrl}/form.html` }),
      );
      expect(freshId).toBe(1);
    });

    afterAll(async () => {
      await restarted?.teardown();
    });

    it("returns the snapshot-not-found error, not a diff", async () => {
      const result = await restarted.callTool("charlotte_diff", { snapshot_id: staleSnapshotId });

      expect(result.isError).toBe(true);

      const payload = parseToolJson<ErrorPayload>(result);
      // Pinned shape — this is what an agent has to recognize mid-conversation.
      expect(payload).toEqual({
        session_id: "default",
        error: {
          code: "SNAPSHOT_EXPIRED",
          message: `Snapshot ${staleSnapshotId} has been evicted from the buffer.`,
          suggestion: "Oldest available snapshot is 1.",
        },
      });

      // And explicitly NOT a diff: no from/to snapshot, no change set. A silent
      // wrong diff is the failure this assertion exists to exclude.
      const asDiff = payload as unknown as Partial<DiffPayload>;
      expect(asDiff.from_snapshot).toBeUndefined();
      expect(asDiff.to_snapshot).toBeUndefined();
      expect(asDiff.changes).toBeUndefined();
    });

    it("does not silently reuse the fresh snapshot that now owns a low ID", async () => {
      // Guard against the nastiest version of the bug: id 1 exists in the new
      // process and describes a DIFFERENT page. Referencing it must diff
      // against form.html's snapshot, never against the dead process's.
      const result = await restarted.callTool("charlotte_diff", { snapshot_id: 1 });
      expect(result.isError).toBeFalsy();

      const payload = parseToolJson<DiffPayload>(result);
      expect(payload.from_snapshot).toBe(1);
      expect(payload.to_snapshot).toBeGreaterThan(1);
    });

    it("errors the same way for a stale id far beyond the new high-water mark", async () => {
      const result = await restarted.callTool("charlotte_diff", { snapshot_id: 9999 });

      expect(result.isError).toBe(true);
      const payload = parseToolJson<ErrorPayload>(result);
      expect(payload.error.code).toBe("SNAPSHOT_EXPIRED");
      expect(payload.error.message).toBe("Snapshot 9999 has been evicted from the buffer.");
    });
  });
});
