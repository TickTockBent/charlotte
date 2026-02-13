import type { Page, CDPSession } from "puppeteer";
import { logger } from "../utils/logger.js";

const REQUIRED_DOMAINS = [
  "Accessibility",
  "DOM",
  "CSS",
  "Page",
  "Network",
] as const;

export class CDPSessionManager {
  private sessions: WeakMap<Page, CDPSession> = new WeakMap();

  async getSession(page: Page): Promise<CDPSession> {
    const existing = this.sessions.get(page);
    if (existing) {
      return existing;
    }

    logger.debug("Creating new CDP session");
    const session = await page.createCDPSession();
    await this.enableDomains(session);
    this.sessions.set(page, session);
    return session;
  }

  private async enableDomains(session: CDPSession): Promise<void> {
    for (const domain of REQUIRED_DOMAINS) {
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
