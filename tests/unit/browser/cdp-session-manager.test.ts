import { describe, it, expect, beforeEach, vi } from "vitest";
import { CDPSessionManager } from "../../../src/browser/cdp-session.js";

// Lightweight mocks — no real browser needed for cache management tests.

function mockPage(): any {
  return { createCDPSession: vi.fn() };
}

function mockCDPSession(): any {
  // connection() returns a truthy object while attached; isSessionAlive() uses
  // it to decide whether a cached session may be reused (#202).
  const connection = {};
  return {
    send: vi.fn().mockResolvedValue(undefined),
    connection: vi.fn(() => connection),
  };
}

/** A detached session: connection() returns undefined (post frame-swap/crash). */
function deadCDPSession(): any {
  return {
    send: vi.fn().mockResolvedValue(undefined),
    connection: vi.fn(() => undefined),
  };
}

function mockFrame(frameId: string, page: any, client?: any): any {
  return {
    _id: frameId,
    client: client ?? mockCDPSession(),
    page: () => page,
    url: () => `https://example.com/frame/${frameId}`,
  };
}

describe("CDPSessionManager", () => {
  let manager: CDPSessionManager;

  beforeEach(() => {
    manager = new CDPSessionManager();
  });

  describe("getSession", () => {
    it("creates and caches a session per page", async () => {
      const page = mockPage();
      const session = mockCDPSession();
      page.createCDPSession.mockResolvedValue(session);

      const firstCall = await manager.getSession(page);
      const secondCall = await manager.getSession(page);

      expect(firstCall).toBe(session);
      expect(secondCall).toBe(session);
      expect(page.createCDPSession).toHaveBeenCalledTimes(1);
    });

    it("creates separate sessions for different pages", async () => {
      const pageA = mockPage();
      const pageB = mockPage();
      const sessionA = mockCDPSession();
      const sessionB = mockCDPSession();
      pageA.createCDPSession.mockResolvedValue(sessionA);
      pageB.createCDPSession.mockResolvedValue(sessionB);

      const resultA = await manager.getSession(pageA);
      const resultB = await manager.getSession(pageB);

      expect(resultA).toBe(sessionA);
      expect(resultB).toBe(sessionB);
    });
  });

  describe("getFrameSession", () => {
    it("caches frame sessions by frameId", async () => {
      const page = mockPage();
      const client = mockCDPSession();
      const frame = mockFrame("frame-1", page, client);

      const firstCall = await manager.getFrameSession(frame);
      const secondCall = await manager.getFrameSession(frame);

      expect(firstCall).toBe(client);
      expect(secondCall).toBe(client);
      // enableDomains calls send for each domain (Accessibility, DOM, CSS)
      expect(client.send).toHaveBeenCalledTimes(3);
    });

    it("tracks frameSessionCount", async () => {
      const page = mockPage();

      expect(manager.frameSessionCount).toBe(0);

      await manager.getFrameSession(mockFrame("frame-1", page));
      expect(manager.frameSessionCount).toBe(1);

      await manager.getFrameSession(mockFrame("frame-2", page));
      expect(manager.frameSessionCount).toBe(2);
    });

    it("throws when frame.client is missing", async () => {
      const page = mockPage();
      const frame = mockFrame("frame-bad", page, undefined);
      frame.client = undefined;

      await expect(manager.getFrameSession(frame)).rejects.toThrow(/Frame\.client is unavailable/);
    });

    it("throws when frame.client has no send method", async () => {
      const page = mockPage();
      const frame = mockFrame("frame-bad", page, undefined);
      frame.client = { notSend: true };

      await expect(manager.getFrameSession(frame)).rejects.toThrow(/Frame\.client is unavailable/);
    });
  });

  describe("getFrameId", () => {
    it("returns the frame _id", () => {
      const frame = mockFrame("abc-123", mockPage());
      expect(manager.getFrameId(frame)).toBe("abc-123");
    });

    it("throws when _id is missing", () => {
      const frame = { _id: undefined } as any;
      expect(() => manager.getFrameId(frame)).toThrow(/Frame\._id is unavailable/);
    });

    it("throws when _id is empty string", () => {
      const frame = { _id: "" } as any;
      expect(() => manager.getFrameId(frame)).toThrow(/Frame\._id is unavailable/);
    });

    it("throws when _id is not a string", () => {
      const frame = { _id: 42 } as any;
      expect(() => manager.getFrameId(frame)).toThrow(/Frame\._id is unavailable/);
    });
  });

  describe("removeFrameSession", () => {
    it("removes a single cached frame session", async () => {
      const page = mockPage();
      await manager.getFrameSession(mockFrame("frame-1", page));
      await manager.getFrameSession(mockFrame("frame-2", page));

      expect(manager.frameSessionCount).toBe(2);

      manager.removeFrameSession("frame-1");

      expect(manager.frameSessionCount).toBe(1);
    });

    it("is a no-op for unknown frameId", () => {
      manager.removeFrameSession("nonexistent");
      expect(manager.frameSessionCount).toBe(0);
    });

    it("cleans up empty reverse-index entries after all frames removed", async () => {
      const page = mockPage();
      await manager.getFrameSession(mockFrame("frame-1", page));
      await manager.getFrameSession(mockFrame("frame-2", page));

      manager.removeFrameSession("frame-1");
      manager.removeFrameSession("frame-2");

      // After removing all frames individually, clearPageFrameSessions
      // should be a no-op (the page entry was already pruned)
      manager.clearPageFrameSessions(page);
      expect(manager.frameSessionCount).toBe(0);
    });

    it("allows re-caching after removal", async () => {
      const page = mockPage();
      const clientA = mockCDPSession();
      const clientB = mockCDPSession();

      await manager.getFrameSession(mockFrame("frame-1", page, clientA));
      manager.removeFrameSession("frame-1");

      const reacquired = await manager.getFrameSession(mockFrame("frame-1", page, clientB));
      expect(reacquired).toBe(clientB);
    });
  });

  // #202: cached sessions must be re-validated for liveness/identity.
  describe("session liveness and frame-swap staleness (issue #202)", () => {
    it("recreates a page session when the cached one is detached", async () => {
      const page = mockPage();
      const dead = deadCDPSession();
      const fresh = mockCDPSession();
      page.createCDPSession.mockResolvedValueOnce(dead).mockResolvedValueOnce(fresh);

      const first = await manager.getSession(page);
      expect(first).toBe(dead);

      // Cached session reports detached → must recreate rather than serve it.
      const second = await manager.getSession(page);
      expect(second).toBe(fresh);
      expect(page.createCDPSession).toHaveBeenCalledTimes(2);
    });

    it("recreates a frame session after a frame swap (same _id, new client)", async () => {
      const page = mockPage();
      const oldClient = mockCDPSession();
      const newClient = mockCDPSession();

      // Same frameId, but a cross-origin navigation swapped the underlying
      // client. framedetached did NOT fire, so the cache still holds oldClient.
      const beforeSwap = mockFrame("frame-x", page, oldClient);
      const afterSwap = mockFrame("frame-x", page, newClient);

      const first = await manager.getFrameSession(beforeSwap);
      expect(first).toBe(oldClient);

      const second = await manager.getFrameSession(afterSwap);
      expect(second).toBe(newClient);
    });

    it("recreates a frame session when the cached client is detached", async () => {
      const page = mockPage();
      const dead = deadCDPSession();
      // The frame keeps the same client object, but it has detached.
      const frame = mockFrame("frame-dead", page, dead);

      const first = await manager.getFrameSession(frame);
      expect(first).toBe(dead);

      // Detached → recreate. Same object is re-enabled and re-cached.
      await manager.getFrameSession(frame);
      // enableDomains ran twice (3 domains each) because the cache was rejected.
      expect(dead.send).toHaveBeenCalledTimes(6);
    });
  });

  describe("clearAll (issue #201)", () => {
    it("drops every cached page and frame session", async () => {
      const pageA = mockPage();
      const sessionA = mockCDPSession();
      pageA.createCDPSession.mockResolvedValue(sessionA);
      await manager.getSession(pageA);
      await manager.getFrameSession(mockFrame("frame-1", pageA));
      await manager.getFrameSession(mockFrame("frame-2", pageA));

      expect(manager.frameSessionCount).toBe(2);

      manager.clearAll();

      expect(manager.frameSessionCount).toBe(0);
      // The page session cache was cleared too: a fresh session is created.
      const sessionB = mockCDPSession();
      pageA.createCDPSession.mockResolvedValue(sessionB);
      const reacquired = await manager.getSession(pageA);
      expect(reacquired).toBe(sessionB);
    });
  });

  describe("clearPageFrameSessions", () => {
    it("removes all frame sessions for a specific page", async () => {
      const pageA = mockPage();
      const pageB = mockPage();

      await manager.getFrameSession(mockFrame("frame-a1", pageA));
      await manager.getFrameSession(mockFrame("frame-a2", pageA));
      await manager.getFrameSession(mockFrame("frame-b1", pageB));

      expect(manager.frameSessionCount).toBe(3);

      manager.clearPageFrameSessions(pageA);

      expect(manager.frameSessionCount).toBe(1);
    });

    it("does not affect sessions from other pages", async () => {
      const pageA = mockPage();
      const pageB = mockPage();
      const clientB = mockCDPSession();

      await manager.getFrameSession(mockFrame("frame-a1", pageA));
      await manager.getFrameSession(mockFrame("frame-b1", pageB, clientB));

      manager.clearPageFrameSessions(pageA);

      // pageB's session should still be cached
      const frame = mockFrame("frame-b1", pageB, clientB);
      const result = await manager.getFrameSession(frame);
      expect(result).toBe(clientB);
    });

    it("is idempotent — safe to call twice", async () => {
      const page = mockPage();
      await manager.getFrameSession(mockFrame("frame-1", page));

      manager.clearPageFrameSessions(page);
      manager.clearPageFrameSessions(page);

      expect(manager.frameSessionCount).toBe(0);
    });

    it("is safe to call on a page with no frame sessions", () => {
      const page = mockPage();
      manager.clearPageFrameSessions(page);
      expect(manager.frameSessionCount).toBe(0);
    });
  });
});
