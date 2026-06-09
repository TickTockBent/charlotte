import type { Page, Frame, CDPSession } from "puppeteer";
import { frameClient } from "../browser/cdp-session.js";
import type { CDPSessionManager } from "../browser/cdp-session.js";
import type { Bounds } from "../types/page-representation.js";
import { logger } from "../utils/logger.js";

export interface DiscoveredFrame {
  frame: Frame;
  frameId: string;
  url: string;
  /** CDP session for this frame (may be the parent's session for same-origin). */
  session: CDPSession;
  /**
   * Whether this frame runs in its own renderer process (out-of-process
   * iframe / OOPIF, typically cross-origin). For same-process frames the
   * session is shared with the main frame, so `DOM.getBoxModel` already
   * returns main-frame-viewport coordinates and `contentOffset` must NOT be
   * applied again. For OOPIFs the session is frame-local, so `contentOffset`
   * is required to map frame-local coordinates into page space. See issue #183.
   */
  isOutOfProcess: boolean;
  /** Bounds of the <iframe> element in page-level coordinates. */
  iframeBounds: Bounds | null;
  /** Cumulative offset from page origin to this frame's content origin. */
  contentOffset: { x: number; y: number };
}

/**
 * Discover all child frames in the page up to maxDepth levels.
 * Returns frame metadata including CDP sessions and coordinate offsets.
 */
export async function discoverFrames(
  page: Page,
  cdpSessionManager: CDPSessionManager,
  maxDepth: number,
): Promise<DiscoveredFrame[]> {
  const discovered: DiscoveredFrame[] = [];
  const mainFrame = page.mainFrame();
  const parentSession = await cdpSessionManager.getSession(page);

  // The main frame's CDP client identifies the page's renderer process. A
  // child frame is out-of-process (OOPIF) iff its `client` differs from the
  // main frame's client. We compare against the main frame client (not the
  // session from getSession(), which is a separately-created CDP session and
  // never identity-equal to Frame.client). See issues #183 and #84.
  const mainFrameClient = frameClient(mainFrame);

  await traverseFrames(
    mainFrame,
    parentSession,
    cdpSessionManager,
    mainFrameClient,
    { x: 0, y: 0 },
    0,
    maxDepth,
    discovered,
  );

  logger.debug(`Discovered ${discovered.length} child frame(s)`);
  return discovered;
}

async function traverseFrames(
  parentFrame: Frame,
  parentSession: CDPSession,
  cdpSessionManager: CDPSessionManager,
  mainFrameClient: CDPSession | undefined,
  parentOffset: { x: number; y: number },
  currentDepth: number,
  maxDepth: number,
  discovered: DiscoveredFrame[],
): Promise<void> {
  if (currentDepth >= maxDepth) return;

  const childFrames = parentFrame.childFrames();
  if (childFrames.length === 0) return;

  for (const childFrame of childFrames) {
    // Skip frames without URLs or about:blank frames
    const frameUrl = childFrame.url();
    if (!frameUrl || frameUrl === "about:blank") {
      continue;
    }

    try {
      const frameId = cdpSessionManager.getFrameId(childFrame);

      // Get the iframe element's bounds in the parent frame's coordinate space
      const iframeBoundsInParent = await getIframeBounds(parentSession, frameId);

      // Compute page-level offset: parent's offset + iframe element position
      const contentOffset = {
        x: parentOffset.x + (iframeBoundsInParent?.x ?? 0),
        y: parentOffset.y + (iframeBoundsInParent?.y ?? 0),
      };

      // Page-level bounds for the iframe element
      const iframeBounds = iframeBoundsInParent
        ? {
            x: contentOffset.x,
            y: contentOffset.y,
            w: iframeBoundsInParent.w,
            h: iframeBoundsInParent.h,
          }
        : null;

      // Get a CDP session for this frame
      let frameSession: CDPSession;
      try {
        frameSession = await cdpSessionManager.getFrameSession(childFrame);
      } catch (error) {
        logger.debug(`Could not get session for frame ${frameUrl}`, error);
        continue;
      }

      // OOPIF detection: a frame is out-of-process iff its CDP client differs
      // from the main frame's client. Same-process frames share the client,
      // so their box-model quads are already in page coordinates. See #183.
      // If the main frame client could not be resolved (should not happen for
      // a live page), assume same-process so we don't double-offset.
      const isOutOfProcess = mainFrameClient !== undefined && frameSession !== mainFrameClient;

      discovered.push({
        frame: childFrame,
        frameId,
        url: frameUrl,
        session: frameSession,
        isOutOfProcess,
        iframeBounds,
        contentOffset,
      });

      // Recurse into nested iframes
      try {
        await traverseFrames(
          childFrame,
          frameSession,
          cdpSessionManager,
          mainFrameClient,
          contentOffset,
          currentDepth + 1,
          maxDepth,
          discovered,
        );
      } catch (error) {
        logger.debug(`Failed to traverse nested frames in ${frameUrl}`, error);
      }
    } catch (error) {
      logger.debug(`Failed to discover frame ${frameUrl}`, error);
    }
  }
}

/**
 * Get the bounds of the <iframe> element that hosts a child frame.
 * Uses the parent frame's CDP session to find the frame owner node.
 */
async function getIframeBounds(
  parentSession: CDPSession,
  childFrameId: string,
): Promise<Bounds | null> {
  try {
    // Get the frame owner (the <iframe> element in the parent DOM)
    const { backendNodeId } = await parentSession.send("DOM.getFrameOwner", {
      frameId: childFrameId,
    });

    if (!backendNodeId) return null;

    const { model } = await parentSession.send("DOM.getBoxModel", {
      backendNodeId,
    });

    if (!model?.content) return null;

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
    logger.debug(`Could not get iframe bounds for frame ${childFrameId}`, error);
    return null;
  }
}
