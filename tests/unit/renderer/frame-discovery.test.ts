import { describe, it, expect, vi } from "vitest";
import type { Page, Frame, CDPSession } from "puppeteer";
import { discoverFrames } from "../../../src/renderer/frame-discovery.js";
import type { CDPSessionManager } from "../../../src/browser/cdp-session.js";

// ---------------------------------------------------------------------------
// Helpers: construct minimal Puppeteer Page/Frame fakes
// ---------------------------------------------------------------------------

/** Creates a minimal Frame mock. `client` is set to simulate same-process or OOPIF. */
function makeFrame(opts: {
  id: string;
  url: string;
  children?: ReturnType<typeof makeFrame>[];
  /** The CDP client for this frame (used by frameClient() to detect OOPIF) */
  client?: CDPSession;
  parentPage?: ReturnType<typeof makePage>;
}): Frame {
  const frameFake = {
    _id: opts.id,
    url: vi.fn().mockReturnValue(opts.url),
    childFrames: vi.fn().mockReturnValue(opts.children ?? []),
    client: opts.client,
    page: vi.fn().mockReturnValue(opts.parentPage ?? {}),
  };
  return frameFake as unknown as Frame;
}

/** Creates a minimal Page mock with a main frame. */
function makePage(mainFrame: Frame): Page {
  return {
    mainFrame: vi.fn().mockReturnValue(mainFrame),
  } as unknown as Page;
}

/** Creates a CDPSession mock. Each call gets its own unique session object for identity checks. */
function makeSession(): CDPSession {
  return {
    send: vi.fn().mockResolvedValue({}),
  } as unknown as CDPSession;
}

/**
 * Creates a CDPSessionManager mock for the given page and frame configurations.
 *
 * @param mainSession - The CDP session returned for the main page.
 * @param frameSessions - Map from frameId to the CDPSession returned by getFrameSession.
 * @param iframeBounds - Map from frameId to the box-model bounds returned via DOM.getFrameOwner + DOM.getBoxModel.
 */
function makeCdpManager(opts: {
  mainSession: CDPSession;
  frameSessions?: Map<string, CDPSession>;
  /** If provided, parentSession.send("DOM.getFrameOwner") returns backendNodeId 42 and DOM.getBoxModel returns the given bounds. */
  iframeBoundsMap?: Map<string, { x: number; y: number; w: number; h: number }>;
}): CDPSessionManager {
  const { mainSession, frameSessions = new Map(), iframeBoundsMap = new Map() } = opts;

  // Install DOM.getFrameOwner / DOM.getBoxModel handlers on the main session mock
  const mainSend = vi.fn(async (method: string, params: Record<string, unknown>) => {
    if (method === "DOM.getFrameOwner") {
      const frameId = params["frameId"] as string;
      if (iframeBoundsMap.has(frameId)) {
        return { backendNodeId: 42 };
      }
      return { backendNodeId: 0 };
    }
    if (method === "DOM.getBoxModel") {
      // Try to find bounds from the current call context using lastFrameId
      // We check all known frameIds and return the first match
      for (const [, bounds] of iframeBoundsMap) {
        const { x, y, w, h } = bounds;
        return {
          model: {
            content: [x, y, x + w, y, x + w, y + h, x, y + h],
            width: w,
            height: h,
          },
        };
      }
      return { model: null };
    }
    return {};
  });
  (mainSession as unknown as { send: typeof mainSend }).send = mainSend;

  return {
    getSession: vi.fn().mockResolvedValue(mainSession),
    getFrameSession: vi.fn(async (frame: Frame) => {
      const frameId = (frame as unknown as { _id: string })._id;
      const session = frameSessions.get(frameId);
      if (!session) throw new Error(`No session for frame ${frameId}`);
      return session;
    }),
    getFrameId: vi.fn((frame: Frame) => {
      return (frame as unknown as { _id: string })._id;
    }),
  } as unknown as CDPSessionManager;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("discoverFrames", () => {
  it("returns an empty array when the main frame has no children", async () => {
    const mainSession = makeSession();
    const mainFrame = makeFrame({ id: "main", url: "https://example.com", children: [] });
    const page = makePage(mainFrame);
    (mainFrame as unknown as { page: () => Page }).page = vi.fn().mockReturnValue(page);

    const cdpManager = makeCdpManager({ mainSession });

    const discovered = await discoverFrames(page, cdpManager, 3);
    expect(discovered).toHaveLength(0);
  });

  it("skips child frames with no URL", async () => {
    const mainSession = makeSession();
    const noUrlFrame = makeFrame({ id: "no-url", url: "" });
    const mainFrame = makeFrame({ id: "main", url: "https://example.com", children: [noUrlFrame] });
    const page = makePage(mainFrame);

    const cdpManager = makeCdpManager({ mainSession });

    const discovered = await discoverFrames(page, cdpManager, 3);
    expect(discovered).toHaveLength(0);
  });

  it("skips about:blank child frames", async () => {
    const mainSession = makeSession();
    const blankFrame = makeFrame({ id: "blank", url: "about:blank" });
    const mainFrame = makeFrame({
      id: "main",
      url: "https://example.com",
      children: [blankFrame],
    });
    const page = makePage(mainFrame);

    const cdpManager = makeCdpManager({ mainSession });

    const discovered = await discoverFrames(page, cdpManager, 3);
    expect(discovered).toHaveLength(0);
  });

  it("discovers a single child frame and returns its metadata", async () => {
    const mainSession = makeSession();
    const childSession = makeSession();

    const childFrame = makeFrame({
      id: "child-1",
      url: "https://example.com/embed",
      // client same as mainFrame.client → same-process
      client: mainSession,
    });
    const mainFrame = makeFrame({
      id: "main",
      url: "https://example.com",
      children: [childFrame],
      client: mainSession,
    });
    const page = makePage(mainFrame);

    const iframeBoundsMap = new Map([["child-1", { x: 10, y: 20, w: 300, h: 200 }]]);
    const cdpManager = makeCdpManager({
      mainSession,
      frameSessions: new Map([["child-1", childSession]]),
      iframeBoundsMap,
    });

    const discovered = await discoverFrames(page, cdpManager, 2);

    expect(discovered).toHaveLength(1);
    expect(discovered[0].frameId).toBe("child-1");
    expect(discovered[0].url).toBe("https://example.com/embed");
  });

  it("respects maxDepth and does not traverse beyond it", async () => {
    const mainSession = makeSession();
    const childSession = makeSession();
    const grandchildSession = makeSession();

    const grandchildFrame = makeFrame({
      id: "gc-1",
      url: "https://example.com/deep",
      client: grandchildSession,
    });
    const childFrame = makeFrame({
      id: "child-1",
      url: "https://example.com/embed",
      children: [grandchildFrame],
      client: childSession,
    });
    const mainFrame = makeFrame({
      id: "main",
      url: "https://example.com",
      children: [childFrame],
      client: mainSession,
    });
    const page = makePage(mainFrame);

    const cdpManager = makeCdpManager({
      mainSession,
      frameSessions: new Map([
        ["child-1", childSession],
        ["gc-1", grandchildSession],
      ]),
    });

    // maxDepth=1 should only find the direct child, not the grandchild
    const discovered = await discoverFrames(page, cdpManager, 1);
    const frameIds = discovered.map((d) => d.frameId);
    expect(frameIds).not.toContain("gc-1");
  });

  // OOPIF detection: isOutOfProcess invariant
  describe("same-process vs OOPIF classification (isOutOfProcess)", () => {
    it("marks a same-process frame as isOutOfProcess=false", async () => {
      // Same-process: childFrame.client === mainFrameClient
      const sharedClient = makeSession();

      const childFrame = makeFrame({
        id: "same-proc",
        url: "https://example.com/inner",
        client: sharedClient,
      });
      const mainFrame = makeFrame({
        id: "main",
        url: "https://example.com",
        children: [childFrame],
        client: sharedClient, // Same client → same process
      });
      const page = makePage(mainFrame);

      const cdpManager = makeCdpManager({
        mainSession: makeSession(),
        frameSessions: new Map([["same-proc", sharedClient]]),
      });

      const discovered = await discoverFrames(page, cdpManager, 2);

      expect(discovered).toHaveLength(1);
      expect(discovered[0].isOutOfProcess).toBe(false);
    });

    it("marks a cross-origin (OOPIF) frame as isOutOfProcess=true", async () => {
      // OOPIF: childFrame.client !== mainFrameClient
      const mainClient = makeSession();
      const oopifClient = makeSession(); // Different object = different process

      const childFrame = makeFrame({
        id: "oopif-1",
        url: "https://other-origin.com/embed",
        client: oopifClient, // Different from mainClient → OOPIF
      });
      const mainFrame = makeFrame({
        id: "main",
        url: "https://example.com",
        children: [childFrame],
        client: mainClient,
      });
      const page = makePage(mainFrame);

      const cdpManager = makeCdpManager({
        mainSession: makeSession(),
        frameSessions: new Map([["oopif-1", oopifClient]]),
      });

      const discovered = await discoverFrames(page, cdpManager, 2);

      expect(discovered).toHaveLength(1);
      expect(discovered[0].isOutOfProcess).toBe(true);
    });

    it("sets isOutOfProcess=false when main frame client is undefined (defensive)", async () => {
      // If frameClient() returns undefined (Puppeteer API changed), assume same-process
      // to avoid double-offsetting coordinates.
      const someClient = makeSession();

      const childFrame = makeFrame({
        id: "child-1",
        url: "https://example.com/inner",
        client: someClient,
      });
      const mainFrame = makeFrame({
        id: "main",
        url: "https://example.com",
        children: [childFrame],
        client: undefined, // frameClient() would return undefined
      });
      const page = makePage(mainFrame);

      const cdpManager = makeCdpManager({
        mainSession: makeSession(),
        frameSessions: new Map([["child-1", someClient]]),
      });

      const discovered = await discoverFrames(page, cdpManager, 2);

      // When mainFrameClient is undefined, isOutOfProcess must be false (safe default)
      expect(discovered).toHaveLength(1);
      expect(discovered[0].isOutOfProcess).toBe(false);
    });
  });

  it("skips a frame gracefully when getFrameSession throws", async () => {
    const mainSession = makeSession();

    const badFrame = makeFrame({ id: "bad-1", url: "https://problematic.com" });
    const goodFrame = makeFrame({ id: "good-1", url: "https://works.com", client: mainSession });
    const mainFrame = makeFrame({
      id: "main",
      url: "https://example.com",
      children: [badFrame, goodFrame],
    });
    const page = makePage(mainFrame);

    const goodSession = makeSession();
    const manager: CDPSessionManager = {
      getSession: vi.fn().mockResolvedValue(mainSession),
      getFrameSession: vi.fn(async (frame: Frame) => {
        const frameId = (frame as unknown as { _id: string })._id;
        if (frameId === "bad-1") throw new Error("Cannot get session");
        return goodSession;
      }),
      getFrameId: vi.fn((frame: Frame) => (frame as unknown as { _id: string })._id),
    } as unknown as CDPSessionManager;

    // Override send to handle DOM.getFrameOwner
    (mainSession as unknown as { send: ReturnType<typeof vi.fn> }).send = vi
      .fn()
      .mockResolvedValue({ backendNodeId: 0 });

    const discovered = await discoverFrames(page, manager, 2);
    // bad-1 should be skipped; good-1 should be discovered
    const frameIds = discovered.map((d) => d.frameId);
    expect(frameIds).not.toContain("bad-1");
    expect(frameIds).toContain("good-1");
  });

  it("accumulates contentOffset correctly for nested frames", async () => {
    // page → childFrame at (100, 50) → grandchild at (20, 10) relative to child
    // Expected grandchild contentOffset: x=120, y=60
    const mainSession = makeSession();
    const childClient = makeSession();
    const grandchildClient = makeSession();

    const grandchildFrame = makeFrame({
      id: "gc-1",
      url: "https://example.com/deep",
      client: grandchildClient,
    });
    const childFrame = makeFrame({
      id: "child-1",
      url: "https://example.com/embed",
      children: [grandchildFrame],
      client: childClient,
    });
    const mainFrame = makeFrame({
      id: "main",
      url: "https://example.com",
      children: [childFrame],
      client: mainSession,
    });
    const page = makePage(mainFrame);

    // Track which session was used so we can return different offsets
    // The first getFrameOwner is called on mainSession (child frame bounds = x:100, y:50)
    // The second getFrameOwner is called on childSession (grandchild bounds = x:20, y:10)
    const childSessionSend = vi.fn(async (method: string) => {
      if (method === "DOM.getFrameOwner") return { backendNodeId: 99 };
      if (method === "DOM.getBoxModel") {
        return {
          model: {
            content: [20, 10, 70, 10, 70, 60, 20, 60],
            width: 50,
            height: 50,
          },
        };
      }
      return {};
    });
    (childClient as unknown as { send: typeof childSessionSend }).send = childSessionSend;

    const mainSessionSend = vi.fn(async (method: string) => {
      if (method === "DOM.getFrameOwner") return { backendNodeId: 42 };
      if (method === "DOM.getBoxModel") {
        return {
          model: {
            content: [100, 50, 200, 50, 200, 150, 100, 150],
            width: 100,
            height: 100,
          },
        };
      }
      return {};
    });
    (mainSession as unknown as { send: typeof mainSessionSend }).send = mainSessionSend;

    const cdpManager: CDPSessionManager = {
      getSession: vi.fn().mockResolvedValue(mainSession),
      getFrameSession: vi.fn(async (frame: Frame) => {
        const frameId = (frame as unknown as { _id: string })._id;
        if (frameId === "child-1") return childClient;
        if (frameId === "gc-1") return grandchildClient;
        throw new Error(`Unexpected frame ${frameId}`);
      }),
      getFrameId: vi.fn((frame: Frame) => (frame as unknown as { _id: string })._id),
    } as unknown as CDPSessionManager;

    const discovered = await discoverFrames(page, cdpManager, 3);

    const childEntry = discovered.find((d) => d.frameId === "child-1");
    expect(childEntry?.contentOffset).toEqual({ x: 100, y: 50 });

    const gcEntry = discovered.find((d) => d.frameId === "gc-1");
    // grandchild offset = child offset (100,50) + grandchild position in child (20,10)
    expect(gcEntry?.contentOffset).toEqual({ x: 120, y: 60 });
  });
});
