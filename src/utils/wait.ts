import type { Page } from "puppeteer";

export interface WaitCondition {
  /** Wait for a CSS selector to match */
  selector?: string;
  /** Wait for JS expression to return truthy */
  js?: string;
  /** Wait for text to appear in the page */
  text?: string;
}

export interface WaitOptions {
  /** Max wait time in milliseconds */
  timeout: number;
  /** Polling interval in milliseconds */
  pollInterval?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 100;

/**
 * Poll a page until a condition is met or timeout is reached.
 * Returns true if the condition was satisfied, false if timed out.
 */
export async function pollUntilCondition(
  page: Page,
  condition: WaitCondition,
  options: WaitOptions,
): Promise<boolean> {
  const pollInterval = options.pollInterval ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + options.timeout;

  while (Date.now() < deadline) {
    const satisfied = await evaluateCondition(page, condition);
    if (satisfied) return true;

    const remainingTime = deadline - Date.now();
    if (remainingTime <= 0) break;

    await sleep(Math.min(pollInterval, remainingTime));
  }

  return false;
}

/**
 * Evaluate a single WaitCondition against the current page state.
 */
async function evaluateCondition(page: Page, condition: WaitCondition): Promise<boolean> {
  if (condition.selector) {
    const element = await page.$(condition.selector);
    if (!element) return false;
  }

  if (condition.text) {
    const textToFind = condition.text;
    const found = await page.evaluate((searchText) => {
      return document.body?.innerText?.includes(searchText) ?? false;
    }, textToFind);
    if (!found) return false;
  }

  if (condition.js) {
    const cdpSession = await page.createCDPSession();
    try {
      const evalResult = await cdpSession.send("Runtime.evaluate", {
        expression: condition.js,
        returnByValue: true,
        awaitPromise: true,
      });
      const isTruthy = !evalResult.exceptionDetails && !!evalResult.result.value;
      if (!isTruthy) return false;
    } catch {
      return false;
    } finally {
      await cdpSession.detach().catch(() => {});
    }
  }

  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
