import puppeteer, {
  type Browser,
  type Page,
  type LaunchOptions,
  type ChromeReleaseChannel,
} from "puppeteer";
import { logger } from "../utils/logger.js";
import { CharlotteError, CharlotteErrorCode } from "../types/errors.js";
import { createDefaultConfig } from "../types/config.js";
import type { CharlotteConfig } from "../types/config.js";

export type OnFirstConnect = (browser: Browser) => Promise<void> | void;
export type OnDisconnected = () => void;

/**
 * Browser launch tunables resolved from config/CLI (issues #19, #184).
 */
export interface BrowserLaunchConfig extends LaunchOptions {
  /**
   * Disable the Chromium sandbox. Default false — the sandbox is ON.
   * The sandbox is the primary defense between a hostile page and the
   * invoking user, so it is only disabled when explicitly requested
   * (CLI --no-sandbox, env CHARLOTTE_NO_SANDBOX, or config file). Real
   * containers usually need this; bare-metal installs should not.
   */
  noSandbox?: boolean;
}

export class BrowserManager {
  private browser: Browser | null = null;
  private launchOptions: LaunchOptions = {};
  private launching: Promise<void> | null = null;
  private config: CharlotteConfig;
  private cdpEndpoint: string | undefined;
  private onFirstConnect: OnFirstConnect | undefined;
  private onDisconnected: OnDisconnected | undefined;
  private firstConnectDone = false;

  constructor(
    config?: CharlotteConfig,
    launchOptions?: BrowserLaunchConfig,
    cdpEndpoint?: string,
    onFirstConnect?: OnFirstConnect,
  ) {
    // Accept optional config; callers without config get a permissive default
    this.config = config ?? createDefaultConfig();
    this.cdpEndpoint = cdpEndpoint;
    this.onFirstConnect = onFirstConnect;

    // Sandbox is ON by default (issue #184). It is only disabled when the
    // caller explicitly opts out via noSandbox; in that case we add the two
    // Chromium flags that disable it. Bare-metal installs keep the sandbox;
    // containers pass noSandbox explicitly.
    const { noSandbox, ...puppeteerLaunchOptions } = launchOptions ?? {};
    const baseArgs = ["--disable-gpu", "--disable-dev-shm-usage"];
    if (noSandbox) {
      baseArgs.unshift("--no-sandbox", "--disable-setuid-sandbox");
    }

    // Set launch defaults once — ensureConnected() and launch() both use these.
    this.launchOptions = {
      headless: true,
      defaultViewport: this.config.defaultViewport,
      args: baseArgs,
      ...puppeteerLaunchOptions,
    };
  }

  /**
   * Register a callback invoked whenever the browser transport drops
   * (crash, kill, remote disconnect). Used to reset per-session state
   * (PageManager tabs, CDP session caches) so the next tool call recovers
   * to a clean blank tab instead of operating on dead Page objects (#201).
   */
  setOnDisconnected(callback: OnDisconnected): void {
    this.onDisconnected = callback;
  }

  /** Fire the disconnect hook, swallowing callback errors. */
  private handleDisconnect(): void {
    this.browser = null;
    if (this.onDisconnected) {
      try {
        this.onDisconnected();
      } catch (error) {
        logger.warn("onDisconnected callback failed", { error });
      }
    }
  }

  async launch(options?: BrowserLaunchConfig): Promise<void> {
    if (options) {
      const { noSandbox, ...puppeteerLaunchOptions } = options;
      if (noSandbox !== undefined) {
        const args = [...(this.launchOptions.args ?? [])].filter(
          (arg) => arg !== "--no-sandbox" && arg !== "--disable-setuid-sandbox",
        );
        if (noSandbox) {
          args.unshift("--no-sandbox", "--disable-setuid-sandbox");
        }
        this.launchOptions.args = args;
      }
      this.launchOptions = { ...this.launchOptions, ...puppeteerLaunchOptions };
    }
    if (this.cdpEndpoint) {
      // Connect AND adopt as one unit so firstConnectDone reflects a fully
      // ready session (mirrors the ensureConnected() path).
      await this.connectAndAdopt();
    } else {
      await this.doLaunch();
    }
  }

  private async doLaunch(): Promise<void> {
    logger.info("Launching Chromium");
    this.browser = await puppeteer.launch(this.launchOptions);

    this.browser.on("disconnected", () => {
      logger.warn("Chromium disconnected unexpectedly");
      this.handleDisconnect();
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
      // Note: the `channel` connect option is marked @experimental in Puppeteer's types.
      // It may change or be removed in future Puppeteer releases.
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
      this.handleDisconnect();
    });

    logger.info("Connected to existing browser via CDP", { endpoint });
  }

  /**
   * Connect to the remote browser AND run page adoption as a single unit.
   * Folding adoption into the launching promise means concurrent callers
   * awaiting `this.launching` only return once tabs are adopted — otherwise
   * the loser of the race sees "No active tab" (#202). `firstConnectDone`
   * is only set after adoption succeeds, so a thrown adoption retries on the
   * next call instead of wedging permanently.
   */
  private async connectAndAdopt(): Promise<void> {
    // Reuse an already-connected browser when retrying after a failed adoption;
    // otherwise establish the transport.
    if (!this.browser || !this.browser.connected) {
      await this.doConnect();
    }
    if (this.onFirstConnect && this.browser) {
      await this.onFirstConnect(this.browser);
    }
    this.firstConnectDone = true;
  }

  async ensureConnected(): Promise<void> {
    // Fully ready: connected AND (in CDP mode) page adoption has completed.
    // We deliberately do NOT short-circuit on a connected-but-unadopted CDP
    // session, so a prior adoption failure is retried here (#202).
    if (this.browser && this.browser.connected && (!this.cdpEndpoint || this.firstConnectDone)) {
      return;
    }

    // A launch/connect is already in flight (concurrent tool calls at startup).
    // Wait for it rather than starting a second one.
    if (this.launching) {
      await this.launching;
      if (!this.browser || !this.browser.connected) {
        throw new CharlotteError(
          CharlotteErrorCode.SESSION_ERROR,
          "Browser launch failed during concurrent reconnection attempt.",
        );
      }
      return;
    }

    if (this.cdpEndpoint) {
      // A previously-established CDP transport was lost, most often because the
      // host slept and the control websocket dropped while the remote browser
      // itself stayed alive. Re-attach instead of failing permanently: for
      // browserURL and channel endpoints puppeteer.connect re-resolves the live
      // target, so the session transparently recovers on the next tool call.
      // handleDisconnect() has already reset per-session state (#201) and
      // connectAndAdopt() re-runs page adoption, so we land on a clean tab.
      const reconnecting = this.firstConnectDone && (!this.browser || !this.browser.connected);
      if (reconnecting) {
        logger.warn("Remote browser transport lost; re-attaching via CDP", {
          endpoint: this.cdpEndpoint,
        });
      }

      this.launching = this.connectAndAdopt();
      try {
        await this.launching;
      } catch (error) {
        // Reconnect genuinely failed (e.g. the remote browser is really gone).
        // Surface a clear, actionable error rather than a raw puppeteer stack.
        const detail = error instanceof Error ? error.message : String(error);
        throw new CharlotteError(
          CharlotteErrorCode.SESSION_ERROR,
          reconnecting
            ? `Remote browser disconnected and re-attach to ${this.cdpEndpoint} failed; is the remote browser still running? (${detail})`
            : `Failed to connect to remote browser at ${this.cdpEndpoint} (${detail})`,
        );
      } finally {
        this.launching = null;
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
        await this.browser.disconnect();
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
