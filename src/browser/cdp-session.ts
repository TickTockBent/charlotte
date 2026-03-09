import type { Page, CDPSession, Frame } from "puppeteer";
import { logger } from "../utils/logger.js";

const REQUIRED_DOMAINS = ["Accessibility", "DOM", "CSS", "Page", "Network"] as const;

/** Domains needed for iframe frame sessions (subset — no Page/Network). */
const FRAME_DOMAINS = ["Accessibility", "DOM", "CSS"] as const;

export class CDPSessionManager {
  private sessions: WeakMap<Page, CDPSession> = new WeakMap();
  private frameSessions = new Map<string, CDPSession>();

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
    // changes the internal API, this will need updating.
    const session = (frame as any).client as CDPSession;
    await this.enableDomains(session, FRAME_DOMAINS);
    this.frameSessions.set(frameId, session);
    return session;
  }

  /** Extract the CDP frame ID from a Puppeteer Frame. */
  getFrameId(frame: Frame): string {
    // Puppeteer Frame exposes _id as the CDP frame ID.
    // This is a Puppeteer internal (tested with puppeteer 24.x).
    return (frame as any)._id as string;
  }

  private async enableDomains(
    session: CDPSession,
    domains: readonly string[],
  ): Promise<void> {
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
