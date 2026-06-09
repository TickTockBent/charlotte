import type { Page, KeyInput, CDPSession } from "puppeteer";
import { CharlotteError, CharlotteErrorCode } from "../types/errors.js";
import { logger } from "../utils/logger.js";

/**
 * Scroll an element into view, get its box model, and return the center coordinates.
 * Shared helper that deduplicates the scroll + getBoxModel + compute-center pattern.
 */
export async function scrollAndGetCenter(
  session: CDPSession,
  backendNodeId: number,
): Promise<{ x: number; y: number }> {
  await session.send("DOM.scrollIntoViewIfNeeded", { backendNodeId });

  const { model } = await session.send("DOM.getBoxModel", { backendNodeId });

  if (!model) {
    throw new CharlotteError(
      CharlotteErrorCode.ELEMENT_NOT_FOUND,
      "Element has no visible box model — it may be hidden or zero-sized.",
      "Call charlotte_observe to check the element's state.",
    );
  }

  const contentQuad = model.content;
  return {
    x: (contentQuad[0] + contentQuad[2] + contentQuad[4] + contentQuad[6]) / 4,
    y: (contentQuad[1] + contentQuad[3] + contentQuad[5] + contentQuad[7]) / 4,
  };
}

/**
 * Maximum total wall-clock duration we allow a slow-typing operation to take.
 * Kept under common MCP tool timeout defaults (often 30–60s) so the guard
 * fails fast with a helpful error instead of letting the tool call time out.
 */
export const MAX_TYPING_DURATION_MS = 30000; // 30 seconds

/**
 * Multiplier applied to the naive `text.length * characterDelayMs` estimate to
 * account for per-keystroke overhead that the estimate ignores: Puppeteer's
 * event dispatch, any clear_first keystrokes, and CDP round-trips. Without this
 * margin a 29s estimate can tip over 30s in practice and still time out.
 */
const TYPING_OVERHEAD_FACTOR = 1.15;

/**
 * Guard against slow-typing operations that would run long enough to risk an
 * MCP tool timeout. Throws a CharlotteError with INVALID_ARGUMENT when the
 * estimated duration (with overhead margin) exceeds {@link MAX_TYPING_DURATION_MS}.
 *
 * No-op when `characterDelayMs` is undefined (full-speed typing is effectively
 * instant and has no meaningful upper bound).
 */
export function assertTypingDurationWithinLimit(
  textLength: number,
  characterDelayMs: number | undefined,
): void {
  if (characterDelayMs === undefined) return;

  const estimatedDurationMs = Math.round(textLength * characterDelayMs * TYPING_OVERHEAD_FACTOR);
  if (estimatedDurationMs > MAX_TYPING_DURATION_MS) {
    throw new CharlotteError(
      CharlotteErrorCode.INVALID_ARGUMENT,
      `Typing would take too long (~${Math.round(estimatedDurationMs / 1000)}s). ` +
        `Maximum allowed duration: ${MAX_TYPING_DURATION_MS / 1000}s.`,
      `Reduce text length (currently ${textLength} chars) or character_delay (currently ${characterDelayMs}ms), ` +
        `or type at full speed by omitting slowly/character_delay.`,
    );
  }
}

/** Maps short modifier names to Puppeteer KeyInput values. */
export const MODIFIER_KEY_MAP: Record<string, KeyInput> = {
  ctrl: "Control" as KeyInput,
  shift: "Shift" as KeyInput,
  alt: "Alt" as KeyInput,
  meta: "Meta" as KeyInput,
};

/**
 * Click an element by backend node ID using CDP to get coordinates, then click at those coords.
 * Accepts an optional CDPSession — if not provided, creates and detaches one internally.
 */
export async function clickElementByBackendNodeId(
  page: Page,
  backendNodeId: number,
  clickType: "left" | "right" | "double" = "left",
  modifiers: Array<"ctrl" | "shift" | "alt" | "meta"> = [],
  session?: CDPSession,
): Promise<void> {
  const ownSession = !session;
  const cdpSession = session ?? (await page.createCDPSession());
  try {
    const { x: centerX, y: centerY } = await scrollAndGetCenter(cdpSession, backendNodeId);

    // Hold down modifier keys before the click
    for (const modifier of modifiers) {
      const modifierKey = MODIFIER_KEY_MAP[modifier];
      await page.keyboard.down(modifierKey);
    }

    try {
      if (clickType === "right") {
        await page.mouse.click(centerX, centerY, { button: "right" });
      } else if (clickType === "double") {
        await page.mouse.click(centerX, centerY, { clickCount: 2 });
      } else {
        await page.mouse.click(centerX, centerY);
      }
    } finally {
      // Release modifier keys in reverse order (always release even if click fails)
      for (const modifier of [...modifiers].reverse()) {
        const modifierKey = MODIFIER_KEY_MAP[modifier];
        await page.keyboard.up(modifierKey);
      }
    }
  } finally {
    if (ownSession) await cdpSession.detach();
  }
}

/**
 * Wait for any navigation triggered by an action, or fall back to a brief settle pause.
 *
 * Listens for the `framenavigated` CDP event to detect if a click caused navigation.
 * If navigation is detected within `detectionWindowMs`, waits for the page load event
 * (up to `loadTimeoutMs`). If no navigation fires, returns after `settleMs`.
 *
 * Also races against dialog events — if the action triggers a JavaScript dialog
 * (alert, confirm, prompt, beforeunload), the action promise will block indefinitely.
 * This function detects that and returns early so the caller can surface `pending_dialog`.
 */
export async function waitForPossibleNavigation(
  page: Page,
  action: () => Promise<void>,
  { detectionWindowMs = 500, loadTimeoutMs = 10000, settleMs = 50 } = {},
): Promise<void> {
  let navigationDetected = false;
  let dialogDetected = false;

  // Listen for navigation start via page event (fires on any navigation)
  const navigationStartPromise = new Promise<void>((resolve) => {
    const handler = () => {
      navigationDetected = true;
      page.off("framenavigated", handler);
      resolve();
    };
    page.on("framenavigated", handler);

    // Clean up listener if no navigation fires within detection window
    setTimeout(() => {
      page.off("framenavigated", handler);
      resolve();
    }, detectionWindowMs);
  });

  // Listen for dialog (blocks the action from completing)
  const dialogPromise = new Promise<void>((resolve) => {
    const handler = () => {
      dialogDetected = true;
      page.off("dialog", handler);
      resolve();
    };
    page.on("dialog", handler);
    // Clean up on timeout — if no dialog fires, we don't need this listener
    setTimeout(() => {
      page.off("dialog", handler);
      resolve();
    }, detectionWindowMs);
  });

  // Race: action vs dialog
  const actionPromise = action();
  await Promise.race([
    actionPromise.then(() => "action" as const),
    dialogPromise.then(() => "dialog" as const),
  ]);

  if (dialogDetected) {
    // Dialog is blocking the action. Don't await actionPromise — it will
    // resolve later when the dialog is handled via charlotte_dialog.
    // Guard against unhandled rejection from the fire-and-forget promise.
    actionPromise.catch(() => {
      logger.debug("Post-dialog action promise rejected (expected)");
    });
    return;
  }

  // Action completed normally — check for navigation
  await navigationStartPromise;

  if (navigationDetected) {
    // Navigation occurred — wait for the page to finish loading
    try {
      await page.waitForNavigation({ waitUntil: "load", timeout: loadTimeoutMs });
    } catch {
      // Page may have already finished loading before we called waitForNavigation,
      // or the load timed out. Either way, render what we have.
      logger.debug("Post-navigation load wait ended (page may already be loaded)");
    }
  } else {
    // No navigation — brief settle for in-page DOM updates
    await new Promise((resolve) => setTimeout(resolve, settleMs));
  }
}

/**
 * Focus an element by backend node ID using CDP.
 * Accepts an optional CDPSession — if not provided, creates and detaches one internally.
 */
export async function focusElementByBackendNodeId(
  page: Page,
  backendNodeId: number,
  session?: CDPSession,
): Promise<void> {
  const ownSession = !session;
  const cdpSession = session ?? (await page.createCDPSession());
  try {
    await cdpSession.send("DOM.focus", { backendNodeId });
  } finally {
    if (ownSession) await cdpSession.detach();
  }
}

/**
 * Hover over an element by backend node ID.
 * Accepts an optional CDPSession — if not provided, creates and detaches one internally.
 */
export async function hoverElementByBackendNodeId(
  page: Page,
  backendNodeId: number,
  session?: CDPSession,
): Promise<void> {
  const ownSession = !session;
  const cdpSession = session ?? (await page.createCDPSession());
  try {
    const { x, y } = await scrollAndGetCenter(cdpSession, backendNodeId);
    await page.mouse.move(x, y);
  } finally {
    if (ownSession) await cdpSession.detach();
  }
}

/**
 * Drag one element to another using mouse primitives.
 * Sequence: move to source → mousedown → move to target → mouseup
 * Includes intermediate move steps and delays to ensure drag events fire reliably.
 * Uses a single CDP session for both source and target coordinate lookups.
 * Accepts an optional CDPSession — if not provided, creates and detaches one internally.
 */
export async function dragElementToElement(
  page: Page,
  sourceBackendNodeId: number,
  targetBackendNodeId: number,
  session?: CDPSession,
): Promise<void> {
  const ownSession = !session;
  const cdpSession = session ?? (await page.createCDPSession());
  try {
    const sourceCenter = await scrollAndGetCenter(cdpSession, sourceBackendNodeId);
    const targetCenter = await scrollAndGetCenter(cdpSession, targetBackendNodeId);

    // Move to source and press down
    await page.mouse.move(sourceCenter.x, sourceCenter.y);
    await page.mouse.down();

    // Intermediate move to trigger dragstart (some browsers need movement to begin a drag)
    await page.mouse.move(
      sourceCenter.x + (targetCenter.x - sourceCenter.x) * 0.25,
      sourceCenter.y + (targetCenter.y - sourceCenter.y) * 0.25,
      { steps: 5 },
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Move to target
    await page.mouse.move(targetCenter.x, targetCenter.y, { steps: 10 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Release
    await page.mouse.up();
  } finally {
    if (ownSession) await cdpSession.detach();
  }
}

/**
 * Type text into an input element. Uses CDP to focus, optionally clears, then types via keyboard.
 * Accepts an optional CDPSession — if not provided, creates one internally for the focus step.
 */
export async function typeIntoElement(
  page: Page,
  backendNodeId: number,
  text: string,
  clearFirst: boolean,
  pressEnter: boolean,
  characterDelay?: number,
  session?: CDPSession,
): Promise<void> {
  // Focus the element
  await focusElementByBackendNodeId(page, backendNodeId, session);

  if (clearFirst) {
    // Select all text then delete — works cross-platform
    await page.keyboard.down("Control");
    await page.keyboard.press("a");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
  }

  // Type the text — with optional per-character delay for sites with
  // key-by-key event handlers (autocomplete, search-as-you-type, etc.)
  await page.keyboard.type(text, characterDelay ? { delay: characterDelay } : undefined);

  if (pressEnter) {
    await page.keyboard.press("Enter");
  }
}

/**
 * Select a value in a <select> element using CDP to set the value and dispatch change events.
 * Accepts an optional CDPSession — if not provided, creates and detaches one internally.
 */
export async function selectOptionByBackendNodeId(
  page: Page,
  backendNodeId: number,
  value: string,
  session?: CDPSession,
): Promise<void> {
  const ownSession = !session;
  const cdpSession = session ?? (await page.createCDPSession());
  try {
    // Resolve the node to get a remote object reference
    const { object } = await cdpSession.send("DOM.resolveNode", {
      backendNodeId,
    });

    if (!object?.objectId) {
      throw new CharlotteError(
        CharlotteErrorCode.ELEMENT_NOT_FOUND,
        "Could not resolve select element.",
      );
    }

    // Use Runtime.callFunctionOn to set the value and fire events
    await cdpSession.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: `function(targetValue) {
        const options = Array.from(this.options);
        const matchByValue = options.find(o => o.value === targetValue);
        const matchByText = options.find(o => o.textContent.trim() === targetValue);
        const match = matchByValue || matchByText;
        if (match) {
          this.value = match.value;
          this.dispatchEvent(new Event('input', { bubbles: true }));
          this.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          throw new Error('Option "' + targetValue + '" not found');
        }
      }`,
      arguments: [{ value }],
    });
  } finally {
    if (ownSession) await cdpSession.detach();
  }
}

/**
 * Submit a form by backend node ID — calls form.submit() via CDP.
 */
export async function submitFormByBackendNodeId(
  page: Page,
  backendNodeId: number,
  session?: CDPSession,
): Promise<void> {
  const ownSession = !session;
  const cdpSession = session ?? (await page.createCDPSession());
  try {
    const { object } = await cdpSession.send("DOM.resolveNode", {
      backendNodeId,
    });

    if (!object?.objectId) {
      throw new CharlotteError(
        CharlotteErrorCode.ELEMENT_NOT_FOUND,
        "Could not resolve form element.",
      );
    }

    await cdpSession.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: `function() {
        this.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }`,
    });
  } finally {
    if (ownSession) await cdpSession.detach();
  }
}

/**
 * Set files on a file input element using CDP DOM.setFileInputFiles.
 * Validates that the target element is actually an <input type="file">.
 */
export async function setFileInputFiles(
  page: Page,
  backendNodeId: number,
  filePaths: string[],
  session?: CDPSession,
): Promise<void> {
  const ownSession = !session;
  const cdpSession = session ?? (await page.createCDPSession());
  try {
    const { node } = await cdpSession.send("DOM.describeNode", { backendNodeId });
    const isFileInput =
      node.nodeName === "INPUT" &&
      (node.attributes ?? []).some(
        (attr: string, i: number, arr: string[]) => attr === "type" && arr[i + 1] === "file",
      );
    if (!isFileInput) {
      throw new CharlotteError(
        CharlotteErrorCode.SESSION_ERROR,
        "Element is not a file input.",
        "Use charlotte_find to locate file_input elements.",
      );
    }
    await cdpSession.send("DOM.setFileInputFiles", {
      files: filePaths,
      backendNodeId,
    });
  } finally {
    if (ownSession) await cdpSession.detach();
  }
}
