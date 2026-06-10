import { createDefaultConfig } from "../../../src/types/config.js";
import { describe, it, expect, vi } from "vitest";
import { DevModeState } from "../../../src/dev/dev-mode-state.js";
import type { PageManager } from "../../../src/browser/page-manager.js";

/** A deferred promise whose resolve handle is exposed so a test can settle it. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("DevModeState", () => {
  describe("consumePendingReloadEvent", () => {
    it("returns null when no events are pending", () => {
      const devModeState = new DevModeState(createDefaultConfig());
      expect(devModeState.consumePendingReloadEvent()).toBeNull();
    });

    it("returns null when called again after consumption", () => {
      const devModeState = new DevModeState(createDefaultConfig());
      // No events buffered
      expect(devModeState.consumePendingReloadEvent()).toBeNull();
      expect(devModeState.consumePendingReloadEvent()).toBeNull();
    });

    it("isServing returns false initially", () => {
      const devModeState = new DevModeState(createDefaultConfig());
      expect(devModeState.isServing()).toBe(false);
    });

    it("getServerInfo returns null initially", () => {
      const devModeState = new DevModeState(createDefaultConfig());
      expect(devModeState.getServerInfo()).toBeNull();
    });

    it("stopAll succeeds when nothing is running", async () => {
      const devModeState = new DevModeState(createDefaultConfig());
      // Should not throw
      await devModeState.stopAll();
    });
  });

  describe("trailing reload on mid-reload file change (#203)", () => {
    it("schedules a second reload when a change arrives while a reload is in progress", async () => {
      const devModeState = new DevModeState(createDefaultConfig());

      // First reload blocks until we resolve it, so the second file change
      // arrives while reloadInProgress is set.
      const firstReload = deferred<void>();
      let reloadCount = 0;
      const reload = vi.fn(() => {
        reloadCount += 1;
        // First call returns the blocking deferred; later (trailing) calls
        // resolve immediately.
        return reloadCount === 1 ? firstReload.promise : Promise.resolve();
      });

      const mockPageManager = {
        hasPages: () => true,
        getActivePage: () => ({ reload }) as unknown,
      } as unknown as PageManager;

      // Reach the private handler — it is the file-watcher callback.
      const handleFilesChanged = (
        devModeState as unknown as {
          handleFilesChanged: (changed: string[], pm: PageManager) => void;
        }
      ).handleFilesChanged.bind(devModeState);

      // First change kicks off reload #1 (still pending).
      handleFilesChanged(["a.html"], mockPageManager);
      expect(reload).toHaveBeenCalledTimes(1);

      // Second change arrives mid-reload — must NOT reload immediately; instead
      // a trailing reload is chained onto the in-progress one.
      handleFilesChanged(["b.html"], mockPageManager);
      expect(reload).toHaveBeenCalledTimes(1);

      // The accumulated pending event should now include both files.
      const pending = devModeState.consumePendingReloadEvent();
      expect(pending).not.toBeNull();
      expect(pending!.files_changed).toEqual(expect.arrayContaining(["a.html", "b.html"]));

      // Let the first reload finish; the trailing reload then runs.
      firstReload.resolve();
      // Flush the chained microtasks/promises.
      await vi.waitFor(() => {
        expect(reload).toHaveBeenCalledTimes(2);
      });
    });
  });
});
