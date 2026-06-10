import type { CDPSession } from "puppeteer";
import type { Bounds } from "../types/page-representation.js";
import { logger } from "../utils/logger.js";

/**
 * Shared sentinel for nodes with no layout box. This object is handed out by
 * reference (into boundsMap entries and landmark bounds), so it MUST stay
 * immutable — a single mutation would corrupt every node that shares it.
 * `Object.freeze` enforces that at runtime; the `Readonly<Bounds>` type enforces
 * it at compile time (previously it was typed as a plain mutable `Bounds`, which
 * is why the audit flagged the protection as ineffective/misleading).
 */
export const ZERO_BOUNDS: Readonly<Bounds> = Object.freeze({ x: 0, y: 0, w: 0, h: 0 });

export class LayoutExtractor {
  async getBounds(session: CDPSession, backendNodeId: number): Promise<Bounds | null> {
    try {
      const { model } = await session.send("DOM.getBoxModel", {
        backendNodeId,
      });

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
    } catch (error) {
      // Expected: element is invisible, detached, or has no layout box
      if (
        error instanceof Error &&
        (error.message.includes("Could not find node") ||
          error.message.includes("No node with given id found") ||
          error.message.includes("DOM agent is not enabled"))
      ) {
        return null;
      }
      // Unexpected: CDP session corruption, protocol errors, etc.
      logger.debug(`Unexpected layout extraction error for node ${backendNodeId}`, error);
      return null;
    }
  }

  async getBoundsForNodes(
    session: CDPSession,
    backendNodeIds: number[],
    frameOffset?: { x: number; y: number },
  ): Promise<Map<number, Bounds>> {
    const boundsMap = new Map<number, Bounds>();
    const offsetX = frameOffset?.x ?? 0;
    const offsetY = frameOffset?.y ?? 0;

    // Multiple AX nodes can share one backing DOM node (e.g. a control and its
    // label wrapper), so the same backendNodeId can appear more than once.
    // Dedupe up front so each node triggers at most one DOM.getBoxModel call
    // per render per frame (#199).
    const uniqueNodeIds = [...new Set(backendNodeIds)];

    // Process in parallel for performance, but cap concurrency
    const batchSize = 50;
    for (let i = 0; i < uniqueNodeIds.length; i += batchSize) {
      const batch = uniqueNodeIds.slice(i, i + batchSize);
      const settledResults = await Promise.allSettled(
        batch.map(async (nodeId) => {
          const bounds = await this.getBounds(session, nodeId);
          return { nodeId, bounds };
        }),
      );

      const results = settledResults
        .filter(
          (r): r is PromiseFulfilledResult<{ nodeId: number; bounds: Bounds | null }> =>
            r.status === "fulfilled",
        )
        .map((r) => r.value);

      for (const { nodeId, bounds } of results) {
        if (bounds && (offsetX !== 0 || offsetY !== 0)) {
          // Translate frame-local bounds to page-level coordinates
          boundsMap.set(nodeId, {
            x: bounds.x + offsetX,
            y: bounds.y + offsetY,
            w: bounds.w,
            h: bounds.h,
          });
        } else {
          boundsMap.set(nodeId, bounds ?? ZERO_BOUNDS);
        }
      }
    }

    logger.debug(`Extracted bounds for ${boundsMap.size}/${uniqueNodeIds.length} unique nodes`);
    return boundsMap;
  }
}
