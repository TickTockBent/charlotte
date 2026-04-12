import puppeteer, { type Browser, type Page, type LaunchOptions, type ChromeReleaseChannel } from "puppeteer";
import { logger } from "../utils/logger.js";
import { CharlotteError, CharlotteErrorCode } from "../types/errors.js";
import { createDefaultConfig } from "../types/config.js";
import type { CharlotteConfig } from "../types/config.js";

export class BrowserManager {
  private browser: Browser | null = null;
  private launchOptions: LaunchOptions = {};
  private launching: Promise<void> | null = null;
  private config: CharlotteConfig;
  private cdpEndpoint: string | undefined;

  constructor(config?: CharlotteConfig, launchOptions?: LaunchOptions, cdpEndpoint?: string) {
    // Accept optional config; callers without config get a permissive default
    this.config = config ?? createDefaultConfig();
    this.cdpEndpoint = cdpEndpoint;
    // Set launch defaults once — ensureConnected() and launch() both use these.
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
    if (options) {
      this.launchOptions = { ...this.launchOptions, ...options };
    }
    if (this.cdpEndpoint) {
      await this.doConnect();
    } else {
      await this.doLaunch();
    }
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

  private async doConnect(): Promise<void> {
    const endpoint = this.cdpEndpoint!;
    const isWebSocket = endpoint.startsWith("ws://") || endpoint.startsWith("wss://");
    const isChannel = endpoint.startsWith("channel:");

    logger.info("Connecting to existing browser via CDP", { endpoint, isWebSocket, isChannel });

    // defaultViewport: null tells Puppeteer not to override the browser's viewport —
    // the user's existing Chrome already has its own window size.
    let connectOptions;
    if (isChannel) {
      const channel = endpoint.slice("channel:".length) as ChromeReleaseChannel;
      connectOptions = { channel, defaultViewport: null };
    } else if (isWebSocket) {
      connectOptions = { browserWSEndpoint: endpoint, defaultViewport: null };
    } else {
      connectOptions = { browserURL: endpoint, defaultViewport: null };
    }

    this.browser = await puppeteer.connect(connectOptions);

    this.browser.on("disconnected", () => {
      logger.warn("Remote browser disconnected");
      this.browser = null;
    });

    logger.info("Connected to existing browser via CDP", { endpoint });
  }

  async ensureConnected(): Promise<void> {
    if (this.browser && this.browser.connected) {
      return;
    }

    if (this.cdpEndpoint) {
      throw new CharlotteError(
        CharlotteErrorCode.SESSION_ERROR,
        "Remote browser disconnected. Cannot reconnect in CDP mode — restart the remote browser and Charlotte.",
      );
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
      if (this.cdpEndpoint) {
        logger.info("Disconnecting from remote browser");
        this.browser.disconnect();
      } else {
        logger.info("Closing Chromium");
        await this.browser.close();
      }
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
