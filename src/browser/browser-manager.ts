import puppeteer, { type Browser, type Page, type LaunchOptions } from "puppeteer";
import { logger } from "../utils/logger.js";
import { CharlotteError, CharlotteErrorCode } from "../types/errors.js";
import { createDefaultConfig } from "../types/config.js";
import type { CharlotteConfig } from "../types/config.js";

export class BrowserManager {
  private browser: Browser | null = null;
  private launchOptions: LaunchOptions = {};
  private launching: Promise<void> | null = null;
  private config: CharlotteConfig;

  constructor(config?: CharlotteConfig, launchOptions?: LaunchOptions) {
    // Accept optional config; callers without config get a permissive default
    this.config = config ?? createDefaultConfig();
    this.launchOptions = {
      headless: true,
      defaultViewport: this.config.defaultViewport,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
      ],
      ...launchOptions,
    };
  }

  async launch(options?: LaunchOptions): Promise<void> {
    this.launchOptions = {
      headless: true,
      defaultViewport: this.config.defaultViewport,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
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
      // Verify the concurrent launch actually succeeded
      if (!this.browser || !this.browser.connected) {
        throw new CharlotteError(
          CharlotteErrorCode.SESSION_ERROR,
          "Browser launch failed during concurrent reconnection attempt.",
        );
      }
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

  async getBrowser(): Promise<Browser> {
    await this.ensureConnected();
    if (!this.browser || !this.browser.connected) {
      throw new CharlotteError(
        CharlotteErrorCode.SESSION_ERROR,
        "Browser is not connected after ensureConnected().",
      );
    }
    return this.browser;
  }

  async newPage(): Promise<Page> {
    const browser = await this.getBrowser();
    return browser.newPage();
  }

  isConnected(): boolean {
    return this.browser !== null && this.browser.connected;
  }
}
