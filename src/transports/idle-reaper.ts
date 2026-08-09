/**
 * Idle-TTL reaper (decision D17, invariant I7).
 *
 * A standalone, browser-free idle timer for the remote HTTP transport's session
 * sweep. After `idleMs` with no `touch()`, it fires `onIdle` exactly once; the
 * transport wires that to a whole-browser teardown
 * (`browserManager.close()` + `pageManager.reset()`) so a walked-away remote
 * client's Chromium process is reclaimed, and the next tool call relaunches
 * through the already-tested #201 crash-recovery path.
 *
 * The timer idiom mirrors {@link ../dev/file-watcher.ts}: a single field-held
 * `setTimeout` handle, cleared before every reschedule, nulled on fire/stop.
 * The scheduled handle is `.unref()`d (guarded — fake-timer handles lack it) so
 * a pending sweep never keeps the process alive on its own.
 */
import { logger } from "../utils/logger.js";

export interface IdleReaperOptions {
  /** Idle milliseconds before onIdle fires. `<= 0` or non-finite => inert. */
  idleMs: number;
  /** Fired once, idleMs after the last touch. May be async; a rejection is swallowed+logged. */
  onIdle: () => void | Promise<void>;
}

export interface IdleReaper {
  /** Reset the idle deadline. No-op after stop() or when inert. */
  touch(): void;
  /** Permanently cancel; idempotent. After stop(), touch() is a no-op. */
  stop(): void;
}

export function createIdleReaper(options: IdleReaperOptions): IdleReaper {
  const { idleMs, onIdle } = options;
  let handle: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const isArmable = idleMs > 0 && Number.isFinite(idleMs);

  return {
    touch(): void {
      if (stopped || !isArmable) return;

      // Clear-before-reschedule (FileWatcher idiom): each touch resets the
      // deadline to idleMs from now.
      if (handle !== null) {
        clearTimeout(handle);
      }

      handle = setTimeout(() => {
        // Null the handle FIRST so onIdle (and anything it triggers) observes a
        // reaper with no pending fire; we deliberately do NOT auto-rearm — the
        // next touch arms the next cycle.
        handle = null;
        Promise.resolve()
          .then(() => onIdle())
          .catch((error) => logger.warn("idle-reaper: onIdle failed", { error }));
      }, idleMs);

      // Guarded: fake-timer handles (vi.useFakeTimers) may lack unref, and a
      // bare .unref() would throw there. A real Node handle unrefs so a pending
      // sweep never holds the event loop open on its own.
      handle.unref?.();
    },

    stop(): void {
      stopped = true;
      if (handle !== null) {
        clearTimeout(handle);
        handle = null;
      }
    },
  };
}
