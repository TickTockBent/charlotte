import { describe, it, expect } from "vitest";
import { DevModeState } from "../../../src/dev/dev-mode-state.js";

describe("DevModeState", () => {
  describe("consumePendingReloadEvent", () => {
    it("returns null when no events are pending", () => {
      const devModeState = new DevModeState();
      expect(devModeState.consumePendingReloadEvent()).toBeNull();
    });

    it("returns null when called again after consumption", () => {
      const devModeState = new DevModeState();
      // No events buffered
      expect(devModeState.consumePendingReloadEvent()).toBeNull();
      expect(devModeState.consumePendingReloadEvent()).toBeNull();
    });

    it("isServing returns false initially", () => {
      const devModeState = new DevModeState();
      expect(devModeState.isServing()).toBe(false);
    });

    it("getServerInfo returns null initially", () => {
      const devModeState = new DevModeState();
      expect(devModeState.getServerInfo()).toBeNull();
    });

    it("stopAll succeeds when nothing is running", async () => {
      const devModeState = new DevModeState();
      // Should not throw
      await devModeState.stopAll();
    });
  });
});
