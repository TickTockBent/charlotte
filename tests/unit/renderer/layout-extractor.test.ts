import { describe, it, expect, vi } from "vitest";
import type { CDPSession } from "puppeteer";
import { LayoutExtractor, ZERO_BOUNDS } from "../../../src/renderer/layout-extractor.js";

/** A box-model response whose content quad maps to bounds {x,y,w,h}. */
function boxModel(x: number, y: number, w: number, h: number) {
  return {
    model: {
      content: [x, y, x + w, y, x + w, y + h, x, y + h],
      width: w,
      height: h,
    },
  };
}

/** A CDPSession mock that rejects DOM.getBoxModel calls with the given message. */
function rejectingSession(message: string): CDPSession {
  return {
    send: vi.fn().mockRejectedValue(new Error(message)),
  } as unknown as CDPSession;
}

describe("LayoutExtractor", () => {
  describe("getBounds — single node", () => {
    it("extracts bounds from a rectangular box-model quad", async () => {
      const extractor = new LayoutExtractor();
      const send = vi.fn().mockResolvedValue(boxModel(10, 20, 100, 50));
      const session = { send } as unknown as CDPSession;

      const bounds = await extractor.getBounds(session, 42);
      expect(bounds).toEqual({ x: 10, y: 20, w: 100, h: 50 });
    });

    it("rounds fractional coordinates to integers", async () => {
      const extractor = new LayoutExtractor();
      // A skewed/rotated quad with non-integer corners
      const send = vi.fn().mockResolvedValue({
        model: {
          content: [10.4, 20.6, 110.7, 20.6, 110.7, 70.9, 10.4, 70.9],
          width: 100,
          height: 50,
        },
      });
      const session = { send } as unknown as CDPSession;

      const bounds = await extractor.getBounds(session, 1);
      expect(bounds).toEqual({ x: 10, y: 21, w: 100, h: 50 });
    });

    it("returns null when model is missing from the CDP response", async () => {
      const extractor = new LayoutExtractor();
      const send = vi.fn().mockResolvedValue({ model: null });
      const session = { send } as unknown as CDPSession;

      const bounds = await extractor.getBounds(session, 1);
      expect(bounds).toBeNull();
    });

    it("returns null when content is missing from the box model", async () => {
      const extractor = new LayoutExtractor();
      const send = vi.fn().mockResolvedValue({ model: { content: null, width: 0, height: 0 } });
      const session = { send } as unknown as CDPSession;

      const bounds = await extractor.getBounds(session, 1);
      expect(bounds).toBeNull();
    });

    it("returns null when node is not found (expected CDP error)", async () => {
      const extractor = new LayoutExtractor();
      const session = rejectingSession("Could not find node with given id");

      const bounds = await extractor.getBounds(session, 99);
      expect(bounds).toBeNull();
    });

    it("returns null when 'No node with given id found' error occurs", async () => {
      const extractor = new LayoutExtractor();
      const session = rejectingSession("No node with given id found");

      const bounds = await extractor.getBounds(session, 99);
      expect(bounds).toBeNull();
    });

    it("returns null when DOM agent is not enabled", async () => {
      const extractor = new LayoutExtractor();
      const session = rejectingSession("DOM agent is not enabled");

      const bounds = await extractor.getBounds(session, 99);
      expect(bounds).toBeNull();
    });

    it("returns null on unexpected CDP errors (does not rethrow)", async () => {
      const extractor = new LayoutExtractor();
      const session = rejectingSession("Some unexpected protocol error");

      const bounds = await extractor.getBounds(session, 99);
      expect(bounds).toBeNull();
    });

    it("computes correct bounds for a non-axis-aligned (rotated) quad using min/max", async () => {
      const extractor = new LayoutExtractor();
      // Simulated rotated quad: corners not aligned to axes
      const send = vi.fn().mockResolvedValue({
        model: {
          // A diamond shape: top (50,0), right (100,50), bottom (50,100), left (0,50)
          content: [50, 0, 100, 50, 50, 100, 0, 50],
          width: 100,
          height: 100,
        },
      });
      const session = { send } as unknown as CDPSession;

      const bounds = await extractor.getBounds(session, 1);
      // minX=0, minY=0, maxX=100, maxY=100 → w=100, h=100
      expect(bounds).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    });
  });

  describe("getBoundsForNodes — batch extraction", () => {
    it("returns an empty map for an empty input list", async () => {
      const extractor = new LayoutExtractor();
      const send = vi.fn();
      const session = { send } as unknown as CDPSession;

      const boundsMap = await extractor.getBoundsForNodes(session, []);
      expect(boundsMap.size).toBe(0);
      expect(send).not.toHaveBeenCalled();
    });

    it("maps each node id to its bounds", async () => {
      const extractor = new LayoutExtractor();
      const send = vi.fn(async (_method: string, params: { backendNodeId: number }) =>
        boxModel(params.backendNodeId * 5, 0, 10, 10),
      );
      const session = { send } as unknown as CDPSession;

      const boundsMap = await extractor.getBoundsForNodes(session, [1, 2, 3]);
      expect(boundsMap.size).toBe(3);
      expect(boundsMap.get(1)).toEqual({ x: 5, y: 0, w: 10, h: 10 });
      expect(boundsMap.get(2)).toEqual({ x: 10, y: 0, w: 10, h: 10 });
      expect(boundsMap.get(3)).toEqual({ x: 15, y: 0, w: 10, h: 10 });
    });

    it("sets ZERO_BOUNDS for nodes whose box model could not be resolved", async () => {
      const extractor = new LayoutExtractor();
      // Node 1 resolves, node 2 is not found
      const send = vi.fn(async (_method: string, params: { backendNodeId: number }) => {
        if (params.backendNodeId === 1) return boxModel(5, 5, 20, 30);
        throw new Error("Could not find node with given id");
      });
      const session = { send } as unknown as CDPSession;

      const boundsMap = await extractor.getBoundsForNodes(session, [1, 2]);
      expect(boundsMap.get(1)).toEqual({ x: 5, y: 5, w: 20, h: 30 });
      // Null bounds → ZERO_BOUNDS sentinel
      expect(boundsMap.get(2)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
      expect(boundsMap.get(2)).toBe(ZERO_BOUNDS);
    });
  });

  describe("backendNodeId deduplication (#199)", () => {
    it("issues at most one DOM.getBoxModel per unique node id", async () => {
      const extractor = new LayoutExtractor();
      const send = vi.fn(async (_method: string, params: { backendNodeId: number }) =>
        boxModel(params.backendNodeId, 0, 10, 10),
      );
      const session = { send } as unknown as CDPSession;

      // 5 ids but with heavy duplication (multiple AX nodes sharing a DOM node).
      const backendNodeIds = [1, 1, 2, 3, 3, 3, 4, 5, 5];

      const bounds = await extractor.getBoundsForNodes(session, backendNodeIds);

      // One call per unique id (5), not per occurrence (9).
      expect(send).toHaveBeenCalledTimes(5);
      expect(bounds.size).toBe(5);
      for (const uniqueId of [1, 2, 3, 4, 5]) {
        expect(bounds.has(uniqueId)).toBe(true);
      }
    });

    it("returns identical bounds for a fully-deduplicated input", async () => {
      const extractor = new LayoutExtractor();
      const send = vi.fn(async (_method: string, params: { backendNodeId: number }) =>
        boxModel(params.backendNodeId * 10, 5, 20, 30),
      );
      const session = { send } as unknown as CDPSession;

      const bounds = await extractor.getBoundsForNodes(session, [7, 7, 7]);
      expect(send).toHaveBeenCalledTimes(1);
      expect(bounds.get(7)).toEqual({ x: 70, y: 5, w: 20, h: 30 });
    });

    it("deduplicates then correctly maps unique bounds", async () => {
      const extractor = new LayoutExtractor();
      const send = vi.fn(async (_method: string, params: { backendNodeId: number }) =>
        boxModel(params.backendNodeId * 100, 0, 50, 50),
      );
      const session = { send } as unknown as CDPSession;

      // 3 unique ids, each repeated
      const bounds = await extractor.getBoundsForNodes(session, [10, 20, 10, 30, 20, 30, 30]);
      expect(send).toHaveBeenCalledTimes(3);
      expect(bounds.get(10)).toEqual({ x: 1000, y: 0, w: 50, h: 50 });
      expect(bounds.get(20)).toEqual({ x: 2000, y: 0, w: 50, h: 50 });
      expect(bounds.get(30)).toEqual({ x: 3000, y: 0, w: 50, h: 50 });
    });
  });

  // Pinned invariant: backendDOMNodeId can be null on AX nodes — callers must
  // skip layout extraction for those nodes (CLAUDE.md documented invariant).
  describe("null backendDOMNodeId invariant (CLAUDE.md documented)", () => {
    it("getBoundsForNodes skips null-id nodes when caller pre-filters them", async () => {
      // The LayoutExtractor's getBoundsForNodes takes number[]. The pipeline is
      // responsible for not passing null; verify that passing only valid ids works.
      const extractor = new LayoutExtractor();
      const send = vi.fn(async () => boxModel(0, 0, 10, 10));
      const session = { send } as unknown as CDPSession;

      // Simulates what the pipeline does: it filters out null backendDOMNodeIds
      // before calling getBoundsForNodes. Passing an empty array after filtering
      // must succeed without any CDP calls.
      const boundsMap = await extractor.getBoundsForNodes(session, []);
      expect(send).not.toHaveBeenCalled();
      expect(boundsMap.size).toBe(0);
    });

    it("ZERO_BOUNDS is returned for nodes that fail layout extraction (not throws)", async () => {
      // This pins the behaviour: a node with null backendDOMNodeId would resolve
      // to ZERO_BOUNDS if somehow passed. More importantly, no exception escapes.
      const extractor = new LayoutExtractor();
      const send = vi.fn().mockRejectedValue(new Error("Could not find node with given id"));
      const session = { send } as unknown as CDPSession;

      const boundsMap = await extractor.getBoundsForNodes(session, [42]);
      // A failed lookup falls back to ZERO_BOUNDS, not an exception.
      expect(boundsMap.get(42)).toBe(ZERO_BOUNDS);
    });
  });

  describe("frame offset translation", () => {
    it("translates bounds by the supplied frame offset", async () => {
      const extractor = new LayoutExtractor();
      const send = vi.fn(async () => boxModel(10, 20, 100, 50));
      const session = { send } as unknown as CDPSession;

      const bounds = await extractor.getBoundsForNodes(session, [1], { x: 100, y: 200 });
      expect(bounds.get(1)).toEqual({ x: 110, y: 220, w: 100, h: 50 });
    });

    it("does not translate when offset is zero (same-process frame)", async () => {
      const extractor = new LayoutExtractor();
      const send = vi.fn(async () => boxModel(5, 10, 30, 20));
      const session = { send } as unknown as CDPSession;

      const bounds = await extractor.getBoundsForNodes(session, [1], { x: 0, y: 0 });
      // With zero offset, bounds must be stored directly (not re-boxed with same values)
      expect(bounds.get(1)).toEqual({ x: 5, y: 10, w: 30, h: 20 });
    });

    it("translates only x and y, preserving width and height", async () => {
      const extractor = new LayoutExtractor();
      const send = vi.fn(async () => boxModel(0, 0, 200, 100));
      const session = { send } as unknown as CDPSession;

      const bounds = await extractor.getBoundsForNodes(session, [1], { x: 50, y: 75 });
      const result = bounds.get(1)!;
      expect(result.w).toBe(200);
      expect(result.h).toBe(100);
      expect(result.x).toBe(50);
      expect(result.y).toBe(75);
    });

    it("applies offset to each node independently in a batch", async () => {
      const extractor = new LayoutExtractor();
      const send = vi.fn(async (_method: string, params: { backendNodeId: number }) => {
        // Each node is at x=nodeId*10, y=0
        return boxModel(params.backendNodeId * 10, 0, 20, 20);
      });
      const session = { send } as unknown as CDPSession;

      const bounds = await extractor.getBoundsForNodes(session, [1, 2, 3], { x: 100, y: 50 });
      expect(bounds.get(1)).toEqual({ x: 110, y: 50, w: 20, h: 20 });
      expect(bounds.get(2)).toEqual({ x: 120, y: 50, w: 20, h: 20 });
      expect(bounds.get(3)).toEqual({ x: 130, y: 50, w: 20, h: 20 });
    });
  });

  describe("ZERO_BOUNDS sentinel (#205)", () => {
    it("is frozen so the shared sentinel cannot be mutated", () => {
      expect(Object.isFrozen(ZERO_BOUNDS)).toBe(true);
      expect(() => {
        // @ts-expect-error -- intentionally violating readonly to prove freeze
        ZERO_BOUNDS.x = 999;
      }).toThrow();
      expect(ZERO_BOUNDS).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    });

    it("is the exact same object reference for all null-bounds entries", async () => {
      const extractor = new LayoutExtractor();
      const send = vi.fn().mockRejectedValue(new Error("Could not find node with given id"));
      const session = { send } as unknown as CDPSession;

      const boundsMap = await extractor.getBoundsForNodes(session, [1, 2, 3]);
      // All three null entries must point to the SAME sentinel object
      expect(boundsMap.get(1)).toBe(ZERO_BOUNDS);
      expect(boundsMap.get(2)).toBe(ZERO_BOUNDS);
      expect(boundsMap.get(3)).toBe(ZERO_BOUNDS);
    });
  });

  describe("batch processing (>50 nodes)", () => {
    it("processes more than 50 nodes across multiple batches", async () => {
      const extractor = new LayoutExtractor();
      const callCount = { count: 0 };
      const send = vi.fn(async (_method: string, params: { backendNodeId: number }) => {
        callCount.count++;
        return boxModel(params.backendNodeId, 0, 10, 10);
      });
      const session = { send } as unknown as CDPSession;

      // 75 unique nodes — should be split into batches of 50 and 25
      const nodeIds = Array.from({ length: 75 }, (_, i) => i + 1);
      const boundsMap = await extractor.getBoundsForNodes(session, nodeIds);

      expect(send).toHaveBeenCalledTimes(75);
      expect(boundsMap.size).toBe(75);
    });

    it("handles exactly 50 nodes in a single batch", async () => {
      const extractor = new LayoutExtractor();
      const send = vi.fn(async () => boxModel(1, 1, 10, 10));
      const session = { send } as unknown as CDPSession;

      const nodeIds = Array.from({ length: 50 }, (_, i) => i + 1);
      const boundsMap = await extractor.getBoundsForNodes(session, nodeIds);

      expect(send).toHaveBeenCalledTimes(50);
      expect(boundsMap.size).toBe(50);
    });
  });
});
