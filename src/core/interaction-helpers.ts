import type { Page, KeyInput, CDPSession } from "puppeteer";
import { CharlotteError, CharlotteErrorCode } from "../types/errors.js";
import { logger } from "../utils/logger.js";

/**
 * Shape of the `exceptionDetails` carried by a CDP `Runtime.callFunctionOn` /
 * `Runtime.evaluate` response. Structurally typed so we don't pull in a
 * transitive `devtools-protocol` import.
 */
interface CdpExceptionDetails {
  text?: string;
  exception?: { description?: string; value?: unknown };
}

/**
 * Throw a CharlotteError if a CDP `Runtime.callFunctionOn` / `Runtime.evaluate`
 * response carries an in-page exception.
 *
 * CDP returns exceptions thrown by injected functions *in-band* via
 * `exceptionDetails` — Puppeteer's `Connection` only rejects the send() promise
 * on protocol-level errors, not on in-page throws. Every call site that runs a
 * function which can throw (e.g. "option not found") must inspect this field or
 * the throw is silently swallowed and the tool falsely reports success (#186).
 *
 * Mirrors the check in `evaluate.ts` and `wait-for.ts`.
 */
export function assertNoInPageException(
  result: { exceptionDetails?: CdpExceptionDetails },
  options: { code?: CharlotteErrorCode; suggestion?: string } = {},
): void {
  const { exceptionDetails } = result;
  if (!exceptionDetails) return;

  const exceptionMessage =
    exceptionDetails.exception?.description ??
    exceptionDetails.exception?.value ??
    exceptionDetails.text ??
    "Unknown in-page error";

  throw new CharlotteError(
    options.code ?? CharlotteErrorCode.EVALUATION_ERROR,
    String(exceptionMessage),
    options.suggestion,
  );
}

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

  return centerOfQuad(model.content);
}

/** Compute the centroid of a CDP box-model content quad ([x1,y1,...,x4,y4]). */
function centerOfQuad(contentQuad: number[]): { x: number; y: number } {
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

/** Default inter-keystroke delay applied when `slowly` is requested without an explicit delay. */
export const DEFAULT_SLOW_TYPING_DELAY_MS = 50;

/**
 * Resolve the effective inter-keystroke delay for a type operation.
 * An explicit `characterDelay` always wins; otherwise `slowly: true` implies
 * {@link DEFAULT_SLOW_TYPING_DELAY_MS}, and full-speed typing returns undefined.
 */
export function resolveCharacterDelay(
  slowly: boolean | undefined,
  characterDelay: number | undefined,
): number | undefined {
  return characterDelay ?? (slowly ? DEFAULT_SLOW_TYPING_DELAY_MS : undefined);
}

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
 * The caller supplies the cached {@link CDPSession} (from `CDPSessionManager` via
 * `getSessionForElement`) — helpers no longer create/detach their own sessions (#202).
 */
export async function clickElementByBackendNodeId(
  page: Page,
  backendNodeId: number,
  clickType: "left" | "right" | "double" = "left",
  modifiers: Array<"ctrl" | "shift" | "alt" | "meta"> = [],
  session: CDPSession,
): Promise<void> {
  const { x: centerX, y: centerY } = await scrollAndGetCenter(session, backendNodeId);
  await clickAtCoordinates(page, centerX, centerY, clickType, modifiers);
}

/**
 * Click at viewport coordinates while holding the given modifier keys.
 *
 * Single source of truth for the modifier-down → click-variant → modifier-up
 * sequence shared by `charlotte_click` (via {@link clickElementByBackendNodeId})
 * and `charlotte_click_at` (raw coordinates) — previously duplicated byte-for-byte
 * (#204). Modifiers are always released in reverse order, even if the click throws.
 */
export async function clickAtCoordinates(
  page: Page,
  x: number,
  y: number,
  clickType: "left" | "right" | "double" = "left",
  modifiers: Array<"ctrl" | "shift" | "alt" | "meta"> = [],
): Promise<void> {
  // Hold down modifier keys before the click
  for (const modifier of modifiers) {
    const modifierKey = MODIFIER_KEY_MAP[modifier];
    await page.keyboard.down(modifierKey);
  }

  try {
    if (clickType === "right") {
      await page.mouse.click(x, y, { button: "right" });
    } else if (clickType === "double") {
      await page.mouse.click(x, y, { clickCount: 2 });
    } else {
      await page.mouse.click(x, y);
    }
  } finally {
    // Release modifier keys in reverse order (always release even if click fails)
    for (const modifier of [...modifiers].reverse()) {
      const modifierKey = MODIFIER_KEY_MAP[modifier];
      await page.keyboard.up(modifierKey);
    }
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
 * The caller supplies the cached {@link CDPSession} (#202).
 */
export async function focusElementByBackendNodeId(
  page: Page,
  backendNodeId: number,
  session: CDPSession,
): Promise<void> {
  await session.send("DOM.focus", { backendNodeId });
}

/**
 * Hover over an element by backend node ID.
 * The caller supplies the cached {@link CDPSession} (#202).
 */
export async function hoverElementByBackendNodeId(
  page: Page,
  backendNodeId: number,
  session: CDPSession,
): Promise<void> {
  const { x, y } = await scrollAndGetCenter(session, backendNodeId);
  await page.mouse.move(x, y);
}

/**
 * Drag one element to another using mouse primitives.
 * Sequence: move to source → mousedown → (scroll target in) → move to target → mouseup
 * Includes intermediate move steps and delays to ensure drag events fire reliably.
 * Uses the caller-supplied cached {@link CDPSession} (#202).
 *
 * Coordinates are viewport-relative, so scrolling one element into view can move
 * the other. The old code read the source center, then scrolled the *target* into
 * view (moving the page) and pressed down on the now-stale source coordinates —
 * so drags only worked when both elements were already on screen together (#185).
 *
 * Instead we scroll and press the source FIRST, then scroll the target into view
 * while the button is held and re-read the target center at that final scroll
 * position. This works even when the two elements are more than a viewport apart.
 */
export async function dragElementToElement(
  page: Page,
  sourceBackendNodeId: number,
  targetBackendNodeId: number,
  session: CDPSession,
): Promise<void> {
  // Scroll the source into view and press down on its (current) center.
  const sourceCenter = await scrollAndGetCenter(session, sourceBackendNodeId);
  await page.mouse.move(sourceCenter.x, sourceCenter.y);
  await page.mouse.down();

  // Small intermediate move so engines that gate dragstart on movement begin the
  // drag before we scroll/reposition.
  await page.mouse.move(sourceCenter.x + 4, sourceCenter.y + 4, { steps: 3 });
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Now scroll the target into view (the page may move) and read its center at
  // the resulting scroll position — never relying on a pre-scroll coordinate.
  const targetCenter = await scrollAndGetCenter(session, targetBackendNodeId);

  // Move toward the target in two hops so hover/dragover handlers along the path fire.
  await page.mouse.move(sourceCenter.x + (targetCenter.x - sourceCenter.x) * 0.5, targetCenter.y, {
    steps: 5,
  });
  await page.mouse.move(targetCenter.x, targetCenter.y, { steps: 10 });
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Release over the target.
  await page.mouse.up();
}

/**
 * Select all editable content of an element in page context, platform-independently.
 *
 * For native form fields (`<input>`/`<textarea>`) this calls `.select()`. For
 * contenteditable hosts it builds a Range over the element's children and applies
 * it to the document Selection. This avoids the Ctrl+A vs Meta+A accelerator
 * difference between Linux/Windows and macOS Chromium (#204).
 *
 * The caller supplies the cached {@link CDPSession} (#202).
 */
export async function selectAllContentByBackendNodeId(
  page: Page,
  backendNodeId: number,
  session: CDPSession,
): Promise<void> {
  const { object } = await session.send("DOM.resolveNode", { backendNodeId });
  if (!object?.objectId) {
    throw new CharlotteError(
      CharlotteErrorCode.ELEMENT_NOT_FOUND,
      "Could not resolve element to clear.",
    );
  }

  const callResult = await session.send("Runtime.callFunctionOn", {
    objectId: object.objectId,
    functionDeclaration: `function() {
      if (typeof this.select === 'function' && (this.tagName === 'INPUT' || this.tagName === 'TEXTAREA')) {
        this.select();
        return;
      }
      // contenteditable / rich-text hosts: select the element's contents.
      const selection = (this.ownerDocument || document).getSelection();
      if (selection) {
        const range = (this.ownerDocument || document).createRange();
        range.selectNodeContents(this);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }`,
  });

  // Surface in-page exceptions instead of silently leaving content unselected.
  assertNoInPageException(callResult, { code: CharlotteErrorCode.SESSION_ERROR });
}

/**
 * Type text into an input element. Uses CDP to focus, optionally clears, then types via keyboard.
 * The caller supplies the cached {@link CDPSession} used for the focus step (#202).
 */
export async function typeIntoElement(
  page: Page,
  backendNodeId: number,
  text: string,
  clearFirst: boolean,
  pressEnter: boolean,
  characterDelay: number | undefined,
  session: CDPSession,
): Promise<void> {
  // Focus the element
  await focusElementByBackendNodeId(page, backendNodeId, session);

  if (clearFirst) {
    // Select all existing content, then delete it.
    //
    // The old approach pressed Ctrl+A, but on macOS-hosted Chromium the
    // select-all accelerator is Meta+A (Cmd+A) — Ctrl+A there moves the caret
    // to line start, so typing PREPENDED instead of replacing for macOS users
    // of the published package (#204). Rather than branch on process.platform
    // (which describes the *server* host, not necessarily where Chromium runs),
    // we select via the DOM in page context, which is platform-independent:
    //   - <input>/<textarea> expose .select()
    //   - contenteditable hosts use the Selection/Range API
    // We then press Backspace to delete the selection through normal key events
    // so input/change handlers fire as a user would trigger them.
    await selectAllContentByBackendNodeId(page, backendNodeId, session);
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
 * The caller supplies the cached {@link CDPSession} (#202).
 *
 * Throws ELEMENT_NOT_FOUND (listing the available options) when no option matches
 * the requested value or text. The in-page function returns a structured result
 * rather than throwing, and we both inspect `exceptionDetails` and verify the
 * resulting `value` — so a missing option can never be reported as success (#186).
 */
export async function selectOptionByBackendNodeId(
  page: Page,
  backendNodeId: number,
  value: string,
  session: CDPSession,
): Promise<void> {
  // Resolve the node to get a remote object reference
  const { object } = await session.send("DOM.resolveNode", {
    backendNodeId,
  });

  if (!object?.objectId) {
    throw new CharlotteError(
      CharlotteErrorCode.ELEMENT_NOT_FOUND,
      "Could not resolve select element.",
    );
  }

  // Use Runtime.callFunctionOn to set the value and fire events. The function
  // returns a structured result describing whether a match was found and the
  // resulting value, so the caller can verify the post-state.
  const callResult = await session.send("Runtime.callFunctionOn", {
    objectId: object.objectId,
    returnByValue: true,
    functionDeclaration: `function(targetValue) {
      const options = Array.from(this.options);
      const matchByValue = options.find(o => o.value === targetValue);
      const matchByText = options.find(o => o.textContent.trim() === targetValue);
      const match = matchByValue || matchByText;
      const available = options.map(o => o.value);
      if (!match) {
        return { matched: false, available, value: this.value };
      }
      this.value = match.value;
      this.dispatchEvent(new Event('input', { bubbles: true }));
      this.dispatchEvent(new Event('change', { bubbles: true }));
      return { matched: true, available, value: this.value };
    }`,
    arguments: [{ value }],
  });

  // In-page throws surface here via exceptionDetails, not a rejected promise.
  assertNoInPageException(callResult, { code: CharlotteErrorCode.ELEMENT_NOT_FOUND });

  const result = callResult.result?.value as
    | { matched: boolean; available: string[]; value: string }
    | undefined;

  if (!result || !result.matched) {
    const available = result?.available ?? [];
    const optionList = available.length
      ? available.map((option) => `"${option}"`).join(", ")
      : "(no options)";
    throw new CharlotteError(
      CharlotteErrorCode.ELEMENT_NOT_FOUND,
      `Option "${value}" not found in select element.`,
      `Available option values: ${optionList}. Pass an option's value or visible text.`,
    );
  }
}

/**
 * Submit a form by backend node ID via CDP.
 *
 * Uses `form.requestSubmit()` — which runs constraint validation, fires a
 * cancelable `submit` event, and then performs the *native* submission/navigation.
 * Dispatching a bare `new Event('submit')` (the old behavior) only runs JS submit
 * listeners and does NOT trigger the default action, so plain server-rendered
 * forms never actually submitted (#189). `requestSubmit` is universally available
 * in modern Chromium; we fall back to `submit()` only on exotic/detached cases.
 *
 * The caller supplies the cached {@link CDPSession} (#202).
 */
export async function submitFormByBackendNodeId(
  page: Page,
  backendNodeId: number,
  session: CDPSession,
): Promise<void> {
  const { object } = await session.send("DOM.resolveNode", {
    backendNodeId,
  });

  if (!object?.objectId) {
    throw new CharlotteError(
      CharlotteErrorCode.ELEMENT_NOT_FOUND,
      "Could not resolve form element.",
    );
  }

  const callResult = await session.send("Runtime.callFunctionOn", {
    objectId: object.objectId,
    functionDeclaration: `function() {
      // requestSubmit fires a cancelable submit event AND performs the native
      // submission; fall back to submit() only if it is somehow unavailable.
      if (typeof this.requestSubmit === 'function') {
        this.requestSubmit();
      } else {
        this.submit();
      }
    }`,
  });

  // Surface in-page exceptions (e.g. requestSubmit on a detached node) instead
  // of silently reporting success (#186).
  assertNoInPageException(callResult, { code: CharlotteErrorCode.SESSION_ERROR });
}

/**
 * Set files on a file input element using CDP DOM.setFileInputFiles.
 * Validates that the target element is actually an <input type="file">.
 * The caller supplies the cached {@link CDPSession} (#202).
 */
export async function setFileInputFiles(
  page: Page,
  backendNodeId: number,
  filePaths: string[],
  session: CDPSession,
): Promise<void> {
  const { node } = await session.send("DOM.describeNode", { backendNodeId });
  const isFileInput =
    node.nodeName === "INPUT" &&
    (node.attributes ?? []).some(
      (attr: string, i: number, arr: string[]) => attr === "type" && arr[i + 1] === "file",
    );
  if (!isFileInput) {
    throw new CharlotteError(
      CharlotteErrorCode.ELEMENT_NOT_INTERACTIVE,
      "Element is not a file input.",
      "Use charlotte_find to locate file_input elements.",
    );
  }
  await session.send("DOM.setFileInputFiles", {
    files: filePaths,
    backendNodeId,
  });
}
