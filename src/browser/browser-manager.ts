import puppeteer, { type Browser, type Page, type LaunchOptions } from "puppeteer";
import { logger } from "../utils/logger.js";
import { CharlotteError, CharlotteErrorCode } from "../types/errors.js";

export class BrowserManager {
  private browser: Browser | null = null;
  private launchOptions: LaunchOptions = {};
  private launching: Promise<void> | null = null;

  async launch(options?: LaunchOptions): Promise<void> {
    this.launchOptions = {
      headless: true,
      args: [
        "--disable-gpu",
        "--disable-dev-shm-usage",
      ],
      ...options,
    };

    await this.doLaunch();
  }

  private async doLaunch(): Promise<void> {
    logger.info("Launching Chromium");
    this.browser = await puppeteer.launch(this.launchOptions);

    this.browser.on("disconnected", () => {
      logger.warn("Chromium disconnected unexpectedly");
      this.browser = null;
    });

    logger.info("Chromium launched", {
      pid: this.browser.process()?.pid,
    });
  }

  async ensureConnected(): Promise<void> {
    if (this.browser && this.browser.connected) {
      return;
    }

    // Prevent concurrent relaunch attempts
    if (this.launching) {
      await this.launching;
      return;
    }

    logger.info("Browser not connected, relaunching");
    this.launching = this.doLaunch();
    try {
      await this.launching;
    } finally {
      this.launching = null;
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      logger.info("Closing Chromium");
      await this.browser.close();
      this.browser = null;
    }
  }

  getBrowser(): Browser {
    if (!this.browser || !this.browser.connected) {
      throw new CharlotteError(
        CharlotteErrorCode.SESSION_ERROR,
        "Browser is not connected. Call ensureConnected() first.",
      );
    }
    return this.browser;
  }

  async newPage(): Promise<Page> {
    await this.ensureConnected();
    const browser = this.getBrowser();
    return browser.newPage();
  }

  isConnected(): boolean {
    return this.browser !== null && this.browser.connected;
  }
}
