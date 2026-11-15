import { describe, it, expect, vi } from "vitest";
import { navigationTools } from "../../../src/core/navigation.js";

const navigateTool = navigationTools[0];

/**
 * charlotte_navigate must activate the tab in the browser window BEFORE it
 * navigates. Focus-based consumers (another CDP client picking the tab where
 * document.hasFocus() is true, page scripts gating on focus) otherwise keep
 * operating on the previously focused tab while the agent believes it is
 * working on the navigated one. The pending-dialog stub in renderActivePage
 * gives this test a light render path, so no renderer pipeline is needed.
 */
describe("charlotte_navigate tab focus", () => {
  it("brings the navigated tab to front before goto", async () => {
    const page = {
      bringToFront: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(undefined),
      url: () => "https://example.com/",
      viewport: () => null,
    };
    const deps = {
      browserManager: { ensureConnected: vi.fn().mockResolvedValue(undefined) },
      pageManager: {
        hasPages: () => true,
        getActivePage: () => page,
        clearErrors: vi.fn(),
        getLastNavigationBlock: () => null,
        getPendingDialogInfo: () => ({ type: "alert", message: "hi" }),
        getConsoleErrors: () => [],
        getNetworkErrors: () => [],
      },
      elementIdGenerator: { clearDomQueryIds: vi.fn() },
      config: {
        defaultViewport: { width: 1440, height: 900 },
        limits: { maxResponseBytes: 2_000_000 },
      },
    };

    const res = await navigateTool.handler(deps as never, { url: "https://example.com/" } as never);

    expect(page.bringToFront).toHaveBeenCalledTimes(1);
    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(page.goto).toHaveBeenCalledWith("https://example.com/", {
      waitUntil: "load",
      timeout: 30000,
    });
    // Focus must be established BEFORE navigation starts, so the tab is
    // focused even while the page is still loading.
    const bringToFrontOrder = vi.mocked(page.bringToFront).mock.invocationCallOrder[0];
    const gotoOrder = vi.mocked(page.goto).mock.invocationCallOrder[0];
    expect(bringToFrontOrder).toBeLessThan(gotoOrder);

    const payload = JSON.parse(res.content[0].text);
    expect(payload.url).toBe("https://example.com/");
    expect(payload.pending_dialog).toEqual({ type: "alert", message: "hi" });
  });
});
