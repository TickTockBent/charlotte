import type { Page, KeyInput } from "puppeteer";
import { CharlotteError, CharlotteErrorCode } from "../types/errors.js";
import { logger } from "../utils/logger.js";

/** Maps short modifier names to Puppeteer KeyInput values. */
export const MODIFIER_KEY_MAP: Record<string, KeyInput> = {
  ctrl: "Control" as KeyInput,
  shift: "Shift" as KeyInput,
  alt: "Alt" as KeyInput,
  meta: "Meta" as KeyInput,
};

/**
 * Click an element by backend node ID using CDP to get coordinates,
 * or more simply by resolving to an XPath/selector and using page.click.
 *
 * The most reliable approach: use CDP to get the element's coordinates, then click at those coords.
 */
export async function clickElementByBackendNodeId(
  page: Page,
  backendNodeId: number,
  clickType: "left" | "right" | "double" = "left",
  modifiers: Array<"ctrl" | "shift" | "alt" | "meta"> = [],
): Promise<void> {
  // Get the element's box model to find clickable coordinates
  const cdpSession = await page.createCDPSession();
  try {
    // First, scroll the element into view
    await cdpSession.send("DOM.scrollIntoViewIfNeeded", { backendNodeId });

    // Get box model for coordinates
    const { model } = await cdpSession.send("DOM.getBoxModel", {
      backendNodeId,
    });

    if (!model) {
      throw new CharlotteError(
        CharlotteErrorCode.ELEMENT_NOT_FOUND,
        "Element has no visible box model — it may be hidden or zero-sized.",
        "Call charlotte:observe to check the element's state.",
      );
    }

    // content quad: [x1,y1, x2,y2, x3,y3, x4,y4]
    const contentQuad = model.content;
    const centerX = (contentQuad[0] + contentQuad[2] + contentQuad[4] + contentQuad[6]) / 4;
    const centerY = (contentQuad[1] + contentQuad[3] + contentQuad[5] + contentQuad[7]) / 4;

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
    await cdpSession.detach();
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
    // resolve later when the dialog is handled via charlotte:dialog.
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
 */
export async function focusElementByBackendNodeId(
  page: Page,
  backendNodeId: number,
): Promise<void> {
  const cdpSession = await page.createCDPSession();
  try {
    await cdpSession.send("DOM.focus", { backendNodeId });
  } finally {
    await cdpSession.detach();
  }
}

/**
 * Hover over an element by backend node ID.
 */
export async function hoverElementByBackendNodeId(
  page: Page,
  backendNodeId: number,
): Promise<void> {
  const cdpSession = await page.createCDPSession();
  try {
    await cdpSession.send("DOM.scrollIntoViewIfNeeded", { backendNodeId });
    const { model } = await cdpSession.send("DOM.getBoxModel", {
      backendNodeId,
    });

    if (!model) {
      throw new CharlotteError(
        CharlotteErrorCode.ELEMENT_NOT_FOUND,
        "Element has no visible box model for hover.",
      );
    }

    const contentQuad = model.content;
    const centerX = (contentQuad[0] + contentQuad[2] + contentQuad[4] + contentQuad[6]) / 4;
    const centerY = (contentQuad[1] + contentQuad[3] + contentQuad[5] + contentQuad[7]) / 4;

    await page.mouse.move(centerX, centerY);
  } finally {
    await cdpSession.detach();
  }
}

/**
 * Get the center coordinates of an element by backend node ID.
 * Scrolls the element into view first.
 */
export async function getElementCenter(
  page: Page,
  backendNodeId: number,
): Promise<{ x: number; y: number }> {
  const cdpSession = await page.createCDPSession();
  try {
    await cdpSession.send("DOM.scrollIntoViewIfNeeded", { backendNodeId });
    const { model } = await cdpSession.send("DOM.getBoxModel", {
      backendNodeId,
    });

    if (!model) {
      throw new CharlotteError(
        CharlotteErrorCode.ELEMENT_NOT_FOUND,
        "Element has no visible box model — it may be hidden or zero-sized.",
        "Call charlotte:observe to check the element's state.",
      );
    }

    const contentQuad = model.content;
    return {
      x: (contentQuad[0] + contentQuad[2] + contentQuad[4] + contentQuad[6]) / 4,
      y: (contentQuad[1] + contentQuad[3] + contentQuad[5] + contentQuad[7]) / 4,
    };
  } finally {
    await cdpSession.detach();
  }
}

/**
 * Drag one element to another using mouse primitives.
 * Sequence: move to source → mousedown → move to target → mouseup
 * Includes intermediate move steps and delays to ensure drag events fire reliably.
 */
export async function dragElementToElement(
  page: Page,
  sourceBackendNodeId: number,
  targetBackendNodeId: number,
): Promise<void> {
  const sourceCenter = await getElementCenter(page, sourceBackendNodeId);
  const targetCenter = await getElementCenter(page, targetBackendNodeId);

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
}

/**
 * Type text into an input element. Uses CDP to focus, optionally clears, then types via keyboard.
 */
export async function typeIntoElement(
  page: Page,
  backendNodeId: number,
  text: string,
  clearFirst: boolean,
  pressEnter: boolean,
): Promise<void> {
  // Focus the element
  await focusElementByBackendNodeId(page, backendNodeId);

  if (clearFirst) {
    // Select all text then delete — works cross-platform
    await page.keyboard.down("Control");
    await page.keyboard.press("a");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
  }

  // Type the text character by character
  await page.keyboard.type(text);

  if (pressEnter) {
    await page.keyboard.press("Enter");
  }
}

/**
 * Select a value in a <select> element using CDP to set the value and dispatch change events.
 */
export async function selectOptionByBackendNodeId(
  page: Page,
  backendNodeId: number,
  value: string,
): Promise<void> {
  const cdpSession = await page.createCDPSession();
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
    await cdpSession.detach();
  }
}

/**
 * Submit a form by backend node ID — calls form.submit() via CDP.
 */
export async function submitFormByBackendNodeId(
  page: Page,
  backendNodeId: number,
): Promise<void> {
  const cdpSession = await page.createCDPSession();
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
    await cdpSession.detach();
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
): Promise<void> {
  const cdpSession = await page.createCDPSession();
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
        "Use charlotte:find to locate file_input elements.",
      );
    }
    await cdpSession.send("DOM.setFileInputFiles", {
      files: filePaths,
      backendNodeId,
    });
  } finally {
    await cdpSession.detach();
  }
}
