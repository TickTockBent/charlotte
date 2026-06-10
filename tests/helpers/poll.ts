/**
 * Test-side polling helpers.
 *
 * `src/utils/wait.ts#pollUntilCondition` polls a Puppeteer Page against a
 * selector/js/text condition. Integration tests instead need to wait on
 * arbitrary in-process state (e.g. `pageManager.getPendingDialogInfo()`),
 * which these predicate-based helpers cover. Replacing fixed `setTimeout`
 * sleeps with condition polling removes the timing races flagged in #206.
 */

export interface PollOptions {
  /** Max time to wait, in milliseconds. Default 5000. */
  timeout?: number;
  /** Interval between checks, in milliseconds. Default 20. */
  interval?: number;
  /** Message used when the predicate never becomes truthy. */
  message?: string;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_INTERVAL_MS = 20;

/**
 * Poll `predicate` until it returns truthy, then return its value. Throws if the
 * timeout elapses first. The predicate may be sync or async.
 */
export async function pollUntil<T>(
  predicate: () => T | Promise<T>,
  options: PollOptions = {},
): Promise<NonNullable<T>> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const interval = options.interval ?? DEFAULT_INTERVAL_MS;
  const deadline = Date.now() + timeout;

  for (;;) {
    const value = await predicate();
    if (value) return value as NonNullable<T>;
    if (Date.now() >= deadline) {
      throw new Error(options.message ?? `pollUntil timed out after ${timeout}ms`);
    }
    await sleep(Math.min(interval, Math.max(0, deadline - Date.now())));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
