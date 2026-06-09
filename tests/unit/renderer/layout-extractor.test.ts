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

describe("LayoutExtractor", () => {
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
  });

  describe("frame offset translation", () => {
    it("translates bounds by the supplied frame offset", async () => {
      const extractor = new LayoutExtractor();
      const send = vi.fn(async () => boxModel(10, 20, 100, 50));
      const session = { send } as unknown as CDPSession;

      const bounds = await extractor.getBoundsForNodes(session, [1], { x: 100, y: 200 });
      expect(bounds.get(1)).toEqual({ x: 110, y: 220, w: 100, h: 50 });
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
  });
});
