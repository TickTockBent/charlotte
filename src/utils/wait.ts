import type { Page } from "puppeteer";
import { CharlotteError, CharlotteErrorCode } from "../types/errors.js";

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
 *
 * Throws CharlotteError(INVALID_ARGUMENT) immediately if the JS expression
 * evaluates to a function (the agent passed a lambda instead of an expression).
 */
export async function pollUntilCondition(
  page: Page,
  condition: WaitCondition,
  options: WaitOptions,
): Promise<boolean> {
  const pollInterval = options.pollInterval ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + options.timeout;

  while (Date.now() < deadline) {
    // evaluateCondition throws INVALID_ARGUMENT for function-type results — let it propagate
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
 *
 * Throws CharlotteError(INVALID_ARGUMENT) if the JS expression evaluates to a
 * function (agent passed a lambda like `() => ...` instead of an expression).
 * This is an immediate failure — not a polling retry — because the expression
 * itself is invalid, not just unsatisfied.
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

      // Detect function-type results: agent passed a lambda instead of an expression.
      // Fail immediately with INVALID_ARGUMENT — polling would never fix this.
      if (evalResult.result.type === "function") {
        throw new CharlotteError(
          CharlotteErrorCode.INVALID_ARGUMENT,
          "The 'js' condition evaluated to a function. Pass an expression (e.g. `document.title === 'x'`), not a function literal (e.g. `() => ...`).",
          "Change the 'js' parameter to a plain expression that returns a truthy/falsy value.",
        );
      }

      // Exception during evaluation: condition is not met this iteration.
      // The caller (pollUntilCondition) accumulates the last exception text
      // if it needs to surface it in a timeout error.
      if (evalResult.exceptionDetails) {
        return false;
      }

      // Truthy if the value is truthy OR the result is a non-null object
      // (handles cases like `document.querySelector(...)` returning a DOM node
      // which serializes to `{}` under returnByValue — still a truthy result).
      const resultValue = evalResult.result.value;
      const resultType = evalResult.result.type;
      const isTruthy =
        !!resultValue ||
        (resultType === "object" && evalResult.result.subtype !== "null" && !resultValue);
      if (!isTruthy) return false;
    } catch (err) {
      // Re-throw CharlotteErrors (e.g. INVALID_ARGUMENT) so callers can handle them.
      if (err instanceof CharlotteError) {
        throw err;
      }
      // Protocol/serialization errors count as "not satisfied"
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
