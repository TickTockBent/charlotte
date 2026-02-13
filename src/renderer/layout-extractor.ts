import type { CDPSession } from "puppeteer";
import type { Bounds } from "../types/page-representation.js";
import { logger } from "../utils/logger.js";

export const ZERO_BOUNDS: Bounds = { x: 0, y: 0, w: 0, h: 0 };

export class LayoutExtractor {
  async getBounds(
    session: CDPSession,
    backendNodeId: number,
  ): Promise<Bounds | null> {
    try {
      const result = await session.send("DOM.getBoxModel" as any, {
        backendNodeId,
      });

      const model = (result as any).model;
      if (!model || !model.content) return null;

      // content quad is [x1,y1, x2,y2, x3,y3, x4,y4]
      const quad: number[] = model.content;
      const minX = Math.min(quad[0], quad[2], quad[4], quad[6]);
      const minY = Math.min(quad[1], quad[3], quad[5], quad[7]);
      const maxX = Math.max(quad[0], quad[2], quad[4], quad[6]);
      const maxY = Math.max(quad[1], quad[3], quad[5], quad[7]);

      return {
        x: Math.round(minX),
        y: Math.round(minY),
        w: Math.round(maxX - minX),
        h: Math.round(maxY - minY),
      };
    } catch {
      // Element may be invisible, detached, or zero-size
      return null;
    }
  }

  async getBoundsForNodes(
    session: CDPSession,
    backendNodeIds: number[],
  ): Promise<Map<number, Bounds>> {
    const boundsMap = new Map<number, Bounds>();

    // Process in parallel for performance, but cap concurrency
    const batchSize = 50;
    for (let i = 0; i < backendNodeIds.length; i += batchSize) {
      const batch = backendNodeIds.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (nodeId) => {
          const bounds = await this.getBounds(session, nodeId);
          return { nodeId, bounds };
        }),
      );

      for (const { nodeId, bounds } of results) {
        boundsMap.set(nodeId, bounds ?? ZERO_BOUNDS);
      }
    }

    logger.debug(
      `Extracted bounds for ${boundsMap.size}/${backendNodeIds.length} nodes`,
    );
    return boundsMap;
  }
}
