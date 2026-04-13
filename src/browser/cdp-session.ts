import type { Page, CDPSession, Frame } from "puppeteer";
import { logger } from "../utils/logger.js";

const REQUIRED_DOMAINS = ["Accessibility", "DOM", "CSS", "Page", "Network"] as const;

/** Domains needed for iframe frame sessions (subset — no Page/Network). */
const FRAME_DOMAINS = ["Accessibility", "DOM", "CSS"] as const;

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
    if (existing) {
      return existing;
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
    const existing = this.frameSessions.get(frameId);
    if (existing) {
      return existing;
    }

    logger.debug("Creating CDP session for frame", { frameId, url: frame.url() });
    // CdpFrame exposes .client which is the CDP session for that frame's target.
    // This is a Puppeteer internal (tested with puppeteer 24.x). If Puppeteer
    // changes the internal API, this will need updating. See issue #84.
    const client = (frame as any).client;
    if (!client || typeof client.send !== "function") {
      throw new Error(
        `Puppeteer Frame.client is unavailable or not a CDPSession. ` +
          `This Puppeteer version may have changed internal APIs. See issue #84.`,
      );
    }
    const session = client as CDPSession;
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

  /** Extract the CDP frame ID from a Puppeteer Frame. */
  getFrameId(frame: Frame): string {
    // Puppeteer Frame exposes _id as the CDP frame ID.
    // This is a Puppeteer internal (tested with puppeteer 24.x). See issue #84.
    const id = (frame as any)._id;
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
      // Also remove from reverse index
      for (const ids of this.pageFrameIds.values()) {
        ids.delete(frameId);
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

  private async enableDomains(session: CDPSession, domains: readonly string[]): Promise<void> {
    for (const domain of domains) {
      try {
        await session.send(`${domain}.enable` as any);
        logger.debug(`Enabled CDP domain: ${domain}`);
      } catch (error) {
        // Some domains may not need explicit enabling
        logger.debug(`Could not enable CDP domain: ${domain}`, error);
      }
    }
  }
}
