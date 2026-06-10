import type { Page, CDPSession, Frame } from "puppeteer";
import { logger } from "../utils/logger.js";

/**
 * Read the CDP session associated with a Puppeteer Frame.
 *
 * NOTE (#84): As of puppeteer 24.x the public abstract `Frame` class does NOT
 * expose `client` — only its internal `CdpFrame` subclass does, and that
 * subclass is not part of the published type surface. We therefore still reach
 * into the (untyped at the `Frame` level) `client` getter via a narrow cast
 * rather than `as any`. For same-process (same-origin) frames this returns the
 * parent page's client; for out-of-process (cross-origin) frames it returns the
 * frame's own session. Centralized here so there is a single internal-access
 * site to update if Puppeteer promotes `client` to the public `Frame` type.
 *
 * Tested against puppeteer-core 24.x.
 */
export function frameClient(frame: Frame): CDPSession | undefined {
  return (frame as unknown as { client?: CDPSession }).client;
}

// Domains actually consumed by the render pipeline and interaction helpers:
// Accessibility.getFullAXTree, DOM.getBoxModel/describeNode, CSS getters.
// Runtime is auto-enabled by Puppeteer. `Page` and `Network` were enabled here
// but nothing on this session ever consumed them — dropped (#205). The
// charlotte_network tool enables Network on its OWN dedicated session.
const REQUIRED_DOMAINS = ["Accessibility", "DOM", "CSS"] as const;

/** Domains needed for iframe frame sessions. */
const FRAME_DOMAINS = ["Accessibility", "DOM", "CSS"] as const;

type EnableableDomain = (typeof REQUIRED_DOMAINS)[number];

/**
 * A CDP session is alive only while attached to a transport connection.
 * After detach (frame swap, page close, browser crash) `connection()` returns
 * undefined; sending on it then rejects. Cached sessions must be re-validated
 * before reuse (#202).
 */
function isSessionAlive(session: CDPSession): boolean {
  try {
    return session.connection() !== undefined;
  } catch {
    return false;
  }
}

export class CDPSessionManager {
  private sessions: WeakMap<Page, CDPSession> = new WeakMap();
  private frameSessions = new Map<string, CDPSession>();
  /** Reverse index: page → set of frameIds cached for that page. */
  private pageFrameIds = new Map<Page, Set<string>>();

  /** Number of cached frame sessions (for diagnostics/testing). */
  get frameSessionCount(): number {
    return this.frameSessions.size;
  }

  async getSession(page: Page): Promise<CDPSession> {
    const existing = this.sessions.get(page);
    if (existing && isSessionAlive(existing)) {
      return existing;
    }
    if (existing) {
      // Cached but detached (e.g. after a navigation that re-targeted the page);
      // drop it and recreate rather than serving a dead session forever (#202).
      logger.debug("Cached page CDP session is detached; recreating");
      this.sessions.delete(page);
    }

    logger.debug("Creating new CDP session");
    const session = await page.createCDPSession();
    await this.enableDomains(session, REQUIRED_DOMAINS);
    this.sessions.set(page, session);
    return session;
  }

  /**
   * Get or create a CDP session for a child frame.
   * Uses the frame's own client for out-of-process (cross-origin) frames.
   */
  async getFrameSession(frame: Frame): Promise<CDPSession> {
    const frameId = this.getFrameId(frame);
    const current = frameClient(frame);
    if (!current || typeof current.send !== "function") {
      throw new Error(
        `Puppeteer Frame.client is unavailable or not a CDPSession. ` +
          `This Puppeteer version may have changed internal APIs. See issue #84.`,
      );
    }

    const existing = this.frameSessions.get(frameId);
    // A cross-origin navigation emits `frameswapped`: the Frame object and its
    // _id are reused, but the underlying CDP target (and thus frame.client)
    // changes. `framedetached` does NOT fire, so the old session would be served
    // forever and the frame silently skipped. Validate the cached entry against
    // the frame's CURRENT client identity, and that it is still attached (#202).
    if (existing && existing === current && isSessionAlive(existing)) {
      return existing;
    }
    if (existing) {
      logger.debug("Cached frame session is stale (swapped/detached); recreating", { frameId });
    }

    logger.debug("Creating CDP session for frame", { frameId, url: frame.url() });
    const session = current;
    await this.enableDomains(session, FRAME_DOMAINS);
    this.frameSessions.set(frameId, session);

    // Track page → frameId association for bulk cleanup on page close
    const page = frame.page();
    let ids = this.pageFrameIds.get(page);
    if (!ids) {
      ids = new Set();
      this.pageFrameIds.set(page, ids);
    }
    ids.add(frameId);

    return session;
  }

  /**
   * Extract the CDP frame ID from a Puppeteer Frame.
   *
   * NOTE (#84): Puppeteer 24.x does NOT expose a public accessor for the CDP
   * frame ID. The public `Frame` API only surfaces a Promise-returning
   * `frameElement()` and (experimental) `client` getter — neither gives the
   * `Page.frameId` string that CDP commands like `Accessibility.getFullAXTree`
   * and `DOM.getFrameOwner` require. We therefore still read the internal `_id`
   * field. This is the only remaining undocumented-internals dependency after
   * the `client` migration (also #84); if a future Puppeteer release adds a
   * public frame-id getter, switch to it here.
   *
   * Tested against puppeteer-core 24.x. The smoke test in
   * tests/integration/iframe.test.ts asserts this field still exists so an
   * upgrade that removes it fails loudly rather than silently.
   */
  getFrameId(frame: Frame): string {
    const id = (frame as unknown as { _id?: unknown })._id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(
        `Puppeteer Frame._id is unavailable or empty. ` +
          `This Puppeteer version may have changed internal APIs. See issue #84.`,
      );
    }
    return id;
  }

  /**
   * Remove a single frame session entry. Called when a frame detaches.
   * The CDP session itself is owned by Puppeteer and detaches automatically
   * when the frame target is destroyed — we only drop our cache entry.
   */
  removeFrameSession(frameId: string): void {
    const removed = this.frameSessions.delete(frameId);
    if (removed) {
      // Also remove from reverse index; drop empty Sets to avoid dangling Page refs
      for (const [page, ids] of this.pageFrameIds.entries()) {
        ids.delete(frameId);
        if (ids.size === 0) {
          this.pageFrameIds.delete(page);
        }
      }
      logger.debug("Removed stale frame session", { frameId });
    }
  }

  /**
   * Remove all frame sessions associated with a page.
   * Called on page close for bulk cleanup.
   */
  clearPageFrameSessions(page: Page): void {
    const ids = this.pageFrameIds.get(page);
    if (!ids || ids.size === 0) {
      this.pageFrameIds.delete(page);
      return;
    }
    for (const frameId of ids) {
      this.frameSessions.delete(frameId);
    }
    logger.debug(`Cleared ${ids.size} frame session(s) for closed page`);
    this.pageFrameIds.delete(page);
  }

  /**
   * Drop every cached session (page and frame). Called when the browser
   * transport drops: all cached sessions are bound to the dead connection
   * and must be recreated against the relaunched browser (#201/#202).
   */
  clearAll(): void {
    this.sessions = new WeakMap();
    this.frameSessions.clear();
    this.pageFrameIds.clear();
    logger.debug("Cleared all CDP session caches");
  }

  private async enableDomains(
    session: CDPSession,
    domains: readonly EnableableDomain[],
  ): Promise<void> {
    for (const domain of domains) {
      try {
        await session.send(`${domain}.enable`);
        logger.debug(`Enabled CDP domain: ${domain}`);
      } catch (error) {
        // Some domains may not need explicit enabling
        logger.debug(`Could not enable CDP domain: ${domain}`, error);
      }
    }
  }
}
