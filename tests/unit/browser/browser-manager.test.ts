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

      const mockBrowser = await (puppeteer.launch as ReturnType<typeof vi.fn>).mock.results[0].value;
      await manager.close();

      expect(mockBrowser.close).toHaveBeenCalledTimes(1);
      expect(mockBrowser.disconnect).not.toHaveBeenCalled();
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
      const manager = new BrowserManager(undefined, undefined, "ws://localhost:9222/devtools/browser/abc");
      await manager.launch();

      expect(puppeteer.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          browserWSEndpoint: "ws://localhost:9222/devtools/browser/abc",
        }),
      );
    });

    it("calls puppeteer.connect with browserWSEndpoint for wss:// endpoint", async () => {
      const manager = new BrowserManager(undefined, undefined, "wss://remote:9222/devtools/browser/abc");
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

      const mockBrowser = await (puppeteer.connect as ReturnType<typeof vi.fn>).mock.results[0].value;
      await manager.close();

      expect(mockBrowser.disconnect).toHaveBeenCalledTimes(1);
      expect(mockBrowser.close).not.toHaveBeenCalled();
    });

    it("ensureConnected() throws when remote browser disconnects", async () => {
      const mockBrowser = {
        connected: true,
        on: vi.fn(),
        close: vi.fn(),
        disconnect: vi.fn(),
        process: () => null,
        pages: vi.fn().mockResolvedValue([]),
      };
      (puppeteer.connect as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockBrowser);

      const manager = new BrowserManager(undefined, undefined, "http://localhost:9222");
      await manager.launch();

      // Simulate disconnection
      mockBrowser.connected = false;

      await expect(manager.ensureConnected()).rejects.toThrow(
        "Remote browser disconnected",
      );
    });
  });
});
