import { describe, it, expect, vi, beforeEach } from "vitest";
import puppeteer from "puppeteer";
import { BrowserManager } from "../../../src/browser/browser-manager.js";

// Mock puppeteer at module level
vi.mock("puppeteer", () => {
  const createMockBrowser = (connected = true) => ({
    connected,
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    process: () => ({ pid: 1234 }),
    pages: vi.fn().mockResolvedValue([]),
  });

  return {
    default: {
      launch: vi.fn().mockResolvedValue(createMockBrowser()),
      connect: vi.fn().mockResolvedValue(createMockBrowser()),
    },
  };
});

describe("BrowserManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("launch mode (default)", () => {
    it("calls puppeteer.launch()", async () => {
      const manager = new BrowserManager();
      await manager.launch();

      expect(puppeteer.launch).toHaveBeenCalledTimes(1);
      expect(puppeteer.connect).not.toHaveBeenCalled();
    });

    it("close() calls browser.close()", async () => {
      const manager = new BrowserManager();
      await manager.launch();

      const mockBrowser = await (puppeteer.launch as ReturnType<typeof vi.fn>).mock.results[0]
        .value;
      await manager.close();

      expect(mockBrowser.close).toHaveBeenCalledTimes(1);
      expect(mockBrowser.disconnect).not.toHaveBeenCalled();
    });
  });

  // Issue #184: sandbox is ON by default; --no-sandbox only added on opt-out.
  describe("Chromium sandbox (issue #184)", () => {
    function launchedArgs(): string[] {
      const call = (puppeteer.launch as ReturnType<typeof vi.fn>).mock.calls[0];
      return (call?.[0]?.args ?? []) as string[];
    }

    it("does NOT pass --no-sandbox by default (sandbox enabled)", async () => {
      const manager = new BrowserManager();
      await manager.launch();

      const args = launchedArgs();
      expect(args).not.toContain("--no-sandbox");
      expect(args).not.toContain("--disable-setuid-sandbox");
    });

    it("passes --no-sandbox when noSandbox opt-out is set in constructor", async () => {
      const manager = new BrowserManager(undefined, { noSandbox: true });
      await manager.launch();

      const args = launchedArgs();
      expect(args).toContain("--no-sandbox");
      expect(args).toContain("--disable-setuid-sandbox");
    });

    it("passes --no-sandbox when noSandbox opt-out is set in launch()", async () => {
      const manager = new BrowserManager();
      await manager.launch({ noSandbox: true });

      const args = launchedArgs();
      expect(args).toContain("--no-sandbox");
      expect(args).toContain("--disable-setuid-sandbox");
    });

    it("retains other hardening args regardless of sandbox setting", async () => {
      const manager = new BrowserManager();
      await manager.launch();

      const args = launchedArgs();
      expect(args).toContain("--disable-gpu");
      expect(args).toContain("--disable-dev-shm-usage");
    });
  });

  describe("CDP connected mode", () => {
    it("calls puppeteer.connect with browserURL for HTTP endpoint", async () => {
      const manager = new BrowserManager(undefined, undefined, "http://localhost:9222");
      await manager.launch();

      expect(puppeteer.connect).toHaveBeenCalledWith(
        expect.objectContaining({ browserURL: "http://localhost:9222" }),
      );
      expect(puppeteer.launch).not.toHaveBeenCalled();
    });

    it("calls puppeteer.connect with browserWSEndpoint for ws:// endpoint", async () => {
      const manager = new BrowserManager(
        undefined,
        undefined,
        "ws://localhost:9222/devtools/browser/abc",
      );
      await manager.launch();

      expect(puppeteer.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          browserWSEndpoint: "ws://localhost:9222/devtools/browser/abc",
        }),
      );
    });

    it("calls puppeteer.connect with browserWSEndpoint for wss:// endpoint", async () => {
      const manager = new BrowserManager(
        undefined,
        undefined,
        "wss://remote:9222/devtools/browser/abc",
      );
      await manager.launch();

      expect(puppeteer.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          browserWSEndpoint: "wss://remote:9222/devtools/browser/abc",
        }),
      );
    });

    it("close() calls browser.disconnect() instead of browser.close()", async () => {
      const manager = new BrowserManager(undefined, undefined, "http://localhost:9222");
      await manager.launch();

      const mockBrowser = await (puppeteer.connect as ReturnType<typeof vi.fn>).mock.results[0]
        .value;
      await manager.close();

      expect(mockBrowser.disconnect).toHaveBeenCalledTimes(1);
      expect(mockBrowser.close).not.toHaveBeenCalled();
    });

    it("calls puppeteer.connect with channel for channel: prefix", async () => {
      const manager = new BrowserManager(undefined, undefined, "channel:chrome");
      await manager.launch();

      expect(puppeteer.connect).toHaveBeenCalledWith(
        expect.objectContaining({ channel: "chrome" }),
      );
      expect(puppeteer.launch).not.toHaveBeenCalled();
    });

    it("calls puppeteer.connect with channel for channel:chrome-canary", async () => {
      const manager = new BrowserManager(undefined, undefined, "channel:chrome-canary");
      await manager.launch();

      expect(puppeteer.connect).toHaveBeenCalledWith(
        expect.objectContaining({ channel: "chrome-canary" }),
      );
    });

    it("does not connect until getBrowser() is called (lazy)", async () => {
      const manager = new BrowserManager(undefined, undefined, "http://localhost:9222");
      expect(puppeteer.connect).not.toHaveBeenCalled();

      await manager.getBrowser();
      expect(puppeteer.connect).toHaveBeenCalledTimes(1);
    });

    it("invokes onFirstConnect callback once on first connect", async () => {
      const onFirstConnect = vi.fn().mockResolvedValue(undefined);
      const manager = new BrowserManager(
        undefined,
        undefined,
        "http://localhost:9222",
        onFirstConnect,
      );

      expect(onFirstConnect).not.toHaveBeenCalled();

      await manager.getBrowser();
      expect(onFirstConnect).toHaveBeenCalledTimes(1);

      await manager.getBrowser();
      expect(onFirstConnect).toHaveBeenCalledTimes(1);
    });

    it("ensureConnected() re-attaches when the remote browser disconnects", async () => {
      // After a host sleep the CDP transport drops while Chrome stays alive.
      // ensureConnected() should re-attach (puppeteer.connect again) instead of
      // failing permanently.
      const makeBrowser = () => ({
        connected: true,
        on: vi.fn(),
        close: vi.fn(),
        disconnect: vi.fn(),
        process: () => null,
        pages: vi.fn().mockResolvedValue([]),
      });
      const first = makeBrowser();
      const second = makeBrowser();
      (puppeteer.connect as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second);

      const manager = new BrowserManager(undefined, undefined, "http://localhost:9222");
      await manager.launch();
      expect(puppeteer.connect).toHaveBeenCalledTimes(1);

      // Simulate the transport dropping.
      first.connected = false;

      await manager.ensureConnected();
      expect(puppeteer.connect).toHaveBeenCalledTimes(2);
      expect(manager.isConnected()).toBe(true);
    });

    it("ensureConnected() surfaces a clear error if re-attach fails", async () => {
      const first = {
        connected: true,
        on: vi.fn(),
        close: vi.fn(),
        disconnect: vi.fn(),
        process: () => null,
        pages: vi.fn().mockResolvedValue([]),
      };
      (puppeteer.connect as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(first)
        .mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const manager = new BrowserManager(undefined, undefined, "http://localhost:9222");
      await manager.launch();

      // Transport drops, and the remote browser is genuinely gone.
      first.connected = false;

      await expect(manager.ensureConnected()).rejects.toThrow(/re-attach .* failed/);
    });
  });

  // #201/#202: lifecycle resilience.
  describe("disconnect recovery and first-connect (issues #201, #202)", () => {
    /** Build a mock browser whose `disconnected` listener we can fire manually. */
    function disconnectableBrowser() {
      let disconnectListener: (() => void) | undefined;
      const browser = {
        connected: true,
        on: vi.fn((event: string, listener: () => void) => {
          if (event === "disconnected") disconnectListener = listener;
        }),
        close: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        process: () => ({ pid: 4321 }),
        pages: vi.fn().mockResolvedValue([]),
      };
      return {
        browser,
        fireDisconnect: () => {
          browser.connected = false;
          disconnectListener?.();
        },
      };
    }

    it("invokes onDisconnected when the launched browser drops", async () => {
      const { browser, fireDisconnect } = disconnectableBrowser();
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(browser);

      const manager = new BrowserManager();
      const onDisconnected = vi.fn();
      manager.setOnDisconnected(onDisconnected);
      await manager.launch();

      expect(onDisconnected).not.toHaveBeenCalled();
      fireDisconnect();
      expect(onDisconnected).toHaveBeenCalledTimes(1);
      expect(manager.isConnected()).toBe(false);
    });

    it("relaunches after a crash so the next ensureConnected() recovers", async () => {
      const first = disconnectableBrowser();
      const second = disconnectableBrowser();
      (puppeteer.launch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(first.browser)
        .mockResolvedValueOnce(second.browser);

      const manager = new BrowserManager();
      manager.setOnDisconnected(vi.fn());
      await manager.launch();

      first.fireDisconnect();
      expect(manager.isConnected()).toBe(false);

      await manager.ensureConnected();
      expect(puppeteer.launch).toHaveBeenCalledTimes(2);
      expect(manager.isConnected()).toBe(true);
    });

    it("swallows errors thrown by the onDisconnected callback", async () => {
      const { browser, fireDisconnect } = disconnectableBrowser();
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(browser);

      const manager = new BrowserManager();
      manager.setOnDisconnected(() => {
        throw new Error("reset blew up");
      });
      await manager.launch();

      expect(() => fireDisconnect()).not.toThrow();
    });

    it("CDP first-connect adoption is awaited by concurrent ensureConnected callers", async () => {
      // Adoption resolves on a deferred so we can prove concurrent callers wait
      // for it (the folded launching promise), not just the raw connect (#202).
      let releaseAdoption: () => void = () => {};
      const adoptionGate = new Promise<void>((resolve) => {
        releaseAdoption = resolve;
      });
      let adoptionDone = false;
      const onFirstConnect = vi.fn(async () => {
        await adoptionGate;
        adoptionDone = true;
      });

      const manager = new BrowserManager(
        undefined,
        undefined,
        "http://localhost:9222",
        onFirstConnect,
      );

      const callerA = manager.ensureConnected();
      const callerB = manager.ensureConnected();

      // Neither caller may resolve until adoption completes.
      releaseAdoption();
      await Promise.all([callerA, callerB]);

      expect(adoptionDone).toBe(true);
      // Adoption ran exactly once despite two concurrent callers.
      expect(onFirstConnect).toHaveBeenCalledTimes(1);
      expect(puppeteer.connect).toHaveBeenCalledTimes(1);
    });

    it("retries adoption if onFirstConnect throws on the first attempt", async () => {
      const onFirstConnect = vi
        .fn()
        .mockRejectedValueOnce(new Error("adoption failed"))
        .mockResolvedValueOnce(undefined);

      const manager = new BrowserManager(
        undefined,
        undefined,
        "http://localhost:9222",
        onFirstConnect,
      );

      // First attempt: adoption throws and must propagate (not silently wedge).
      await expect(manager.ensureConnected()).rejects.toThrow("adoption failed");

      // Second attempt: adoption is retried (firstConnectDone was NOT latched).
      await manager.ensureConnected();
      expect(onFirstConnect).toHaveBeenCalledTimes(2);
    });
  });
});
