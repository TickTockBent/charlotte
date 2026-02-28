import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Page, KeyInput } from "puppeteer";
import { CharlotteError, CharlotteErrorCode } from "../types/errors.js";
import { logger } from "../utils/logger.js";
import type { ToolDependencies } from "./tool-helpers.js";
import {
  renderActivePage,
  renderAfterAction,
  resolveElement,
  formatPageResponse,
  handleToolError,
} from "./tool-helpers.js";

/**
 * Click an element by backend node ID using CDP to get coordinates,
 * or more simply by resolving to an XPath/selector and using page.click.
 *
 * The most reliable approach: use CDP to get the element's coordinates, then click at those coords.
 */
async function clickElementByBackendNodeId(
  page: Page,
  backendNodeId: number,
  clickType: "left" | "right" | "double" = "left",
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
    const centerX =
      (contentQuad[0] + contentQuad[2] + contentQuad[4] + contentQuad[6]) / 4;
    const centerY =
      (contentQuad[1] + contentQuad[3] + contentQuad[5] + contentQuad[7]) / 4;

    if (clickType === "right") {
      await page.mouse.click(centerX, centerY, { button: "right" });
    } else if (clickType === "double") {
      await page.mouse.click(centerX, centerY, { clickCount: 2 });
    } else {
      await page.mouse.click(centerX, centerY);
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
async function waitForPossibleNavigation(
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
    setTimeout(() => { page.off("dialog", handler); resolve(); }, detectionWindowMs);
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
async function focusElementByBackendNodeId(
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
 * Scroll an element into view by backend node ID.
 */
async function scrollIntoViewByBackendNodeId(
  page: Page,
  backendNodeId: number,
): Promise<void> {
  const cdpSession = await page.createCDPSession();
  try {
    await cdpSession.send("DOM.scrollIntoViewIfNeeded", { backendNodeId });
  } finally {
    await cdpSession.detach();
  }
}

/**
 * Hover over an element by backend node ID.
 */
async function hoverElementByBackendNodeId(
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
    const centerX =
      (contentQuad[0] + contentQuad[2] + contentQuad[4] + contentQuad[6]) / 4;
    const centerY =
      (contentQuad[1] + contentQuad[3] + contentQuad[5] + contentQuad[7]) / 4;

    await page.mouse.move(centerX, centerY);
  } finally {
    await cdpSession.detach();
  }
}

/**
 * Get the center coordinates of an element by backend node ID.
 * Scrolls the element into view first.
 */
async function getElementCenter(
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
async function dragElementToElement(
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
async function typeIntoElement(
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
async function selectOptionByBackendNodeId(
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
async function submitFormByBackendNodeId(
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

export function registerInteractionTools(
  server: McpServer,
  deps: ToolDependencies,
): void {
  // ─── charlotte:click ───
  server.registerTool(
    "charlotte:click",
    {
      description:
        "Click an interactive element on the page. Returns full page representation after the click.",
      inputSchema: {
        element_id: z.string().describe("Target element ID from page representation"),
        click_type: z
          .enum(["left", "right", "double"])
          .optional()
          .describe('Click type: "left" (default), "right", "double"'),
      },
    },
    async ({ element_id, click_type }) => {
      try {
        await deps.browserManager.ensureConnected();
        const { page, backendNodeId } = await resolveElement(deps, element_id);
        const clickVariant = click_type ?? "left";

        logger.info("Clicking element", { element_id, clickType: clickVariant });

        await waitForPossibleNavigation(page, () =>
          clickElementByBackendNodeId(page, backendNodeId, clickVariant),
        );

        const representation = await renderAfterAction(deps);
        return formatPageResponse(representation);
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte:type ───
  server.registerTool(
    "charlotte:type",
    {
      description:
        "Type text into an input element. Returns full page representation after typing.",
      inputSchema: {
        element_id: z.string().describe("Target input element ID"),
        text: z.string().describe("Text to enter"),
        clear_first: z
          .boolean()
          .optional()
          .describe("Clear existing value before typing (default: true)"),
        press_enter: z
          .boolean()
          .optional()
          .describe("Press Enter after typing (default: false)"),
      },
    },
    async ({ element_id, text, clear_first, press_enter }) => {
      try {
        await deps.browserManager.ensureConnected();
        const { page, backendNodeId } = await resolveElement(deps, element_id);
        const shouldClearFirst = clear_first ?? true;
        const shouldPressEnter = press_enter ?? false;

        logger.info("Typing into element", {
          element_id,
          textLength: text.length,
          clearFirst: shouldClearFirst,
          pressEnter: shouldPressEnter,
        });

        await typeIntoElement(
          page,
          backendNodeId,
          text,
          shouldClearFirst,
          shouldPressEnter,
        );

        const representation = await renderAfterAction(deps);
        return formatPageResponse(representation);
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte:select ───
  server.registerTool(
    "charlotte:select",
    {
      description:
        "Select an option in a select/dropdown element. Returns full page representation after selection.",
      inputSchema: {
        element_id: z.string().describe("Target select element ID"),
        value: z.string().describe("Value or text of the option to select"),
      },
    },
    async ({ element_id, value }) => {
      try {
        await deps.browserManager.ensureConnected();
        const { page, backendNodeId } = await resolveElement(deps, element_id);

        logger.info("Selecting option", { element_id, value });

        await selectOptionByBackendNodeId(page, backendNodeId, value);

        const representation = await renderAfterAction(deps);
        return formatPageResponse(representation);
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte:toggle ───
  server.registerTool(
    "charlotte:toggle",
    {
      description:
        "Toggle a checkbox or switch element. Returns full page representation after toggle.",
      inputSchema: {
        element_id: z.string().describe("Target checkbox or switch element ID"),
      },
    },
    async ({ element_id }) => {
      try {
        await deps.browserManager.ensureConnected();
        const { page, backendNodeId } = await resolveElement(deps, element_id);

        logger.info("Toggling element", { element_id });

        // Toggle by clicking the element
        await clickElementByBackendNodeId(page, backendNodeId, "left");

        await new Promise((resolve) => setTimeout(resolve, 50));

        const representation = await renderAfterAction(deps);
        return formatPageResponse(representation);
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte:submit ───
  server.registerTool(
    "charlotte:submit",
    {
      description:
        "Submit a form. Can submit by form ID or by clicking its submit button. Returns full page representation after submission.",
      inputSchema: {
        form_id: z.string().describe("Form ID from page representation"),
      },
    },
    async ({ form_id }) => {
      try {
        await deps.browserManager.ensureConnected();

        // Find the form in the current representation
        const representation = await renderActivePage(deps, { detail: "minimal" });
        const form = representation.forms.find((f) => f.id === form_id);

        if (!form) {
          throw new CharlotteError(
            CharlotteErrorCode.ELEMENT_NOT_FOUND,
            `Form '${form_id}' not found on page.`,
            "Call charlotte:observe to get current page state and verify form IDs.",
          );
        }

        const page = deps.pageManager.getActivePage();

        // If the form has a submit button, click it
        if (form.submit) {
          const submitResolved = await resolveElement(deps, form.submit);
          logger.info("Submitting form via submit button", {
            form_id,
            submitButton: form.submit,
          });
          await waitForPossibleNavigation(page, () =>
            clickElementByBackendNodeId(
              page,
              submitResolved.backendNodeId,
              "left",
            ),
          );
        } else {
          // Fall back to dispatching submit event on the form itself
          const formBackendNodeId = deps.elementIdGenerator.resolveId(form_id);
          if (formBackendNodeId === null) {
            throw new CharlotteError(
              CharlotteErrorCode.ELEMENT_NOT_FOUND,
              `Could not resolve form '${form_id}' to a DOM element.`,
            );
          }
          logger.info("Submitting form via submit event", { form_id });
          await waitForPossibleNavigation(page, () =>
            submitFormByBackendNodeId(page, formBackendNodeId),
          );
        }

        const updatedRepresentation = await renderAfterAction(deps);
        return formatPageResponse(updatedRepresentation);
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte:scroll ───
  server.registerTool(
    "charlotte:scroll",
    {
      description:
        "Scroll the page or a specific container. Returns full page representation after scrolling.",
      inputSchema: {
        direction: z
          .enum(["up", "down", "left", "right"])
          .describe("Scroll direction"),
        amount: z
          .string()
          .optional()
          .describe(
            'Scroll amount: "page" (default), "half", or pixel value (e.g. "200")',
          ),
        element_id: z
          .string()
          .optional()
          .describe("Scroll within a specific container element"),
      },
    },
    async ({ direction, amount, element_id }) => {
      try {
        await deps.browserManager.ensureConnected();
        const page = deps.pageManager.getActivePage();

        const scrollAmount = amount ?? "page";
        logger.info("Scrolling", { direction, amount: scrollAmount, element_id });

        // Calculate pixel distance
        const viewport = page.viewport();
        const viewportWidth = viewport?.width ?? 1280;
        const viewportHeight = viewport?.height ?? 720;

        let pixelDistance: number;
        if (scrollAmount === "page") {
          pixelDistance =
            direction === "left" || direction === "right"
              ? viewportWidth
              : viewportHeight;
        } else if (scrollAmount === "half") {
          pixelDistance =
            direction === "left" || direction === "right"
              ? viewportWidth / 2
              : viewportHeight / 2;
        } else {
          pixelDistance = parseInt(scrollAmount, 10);
          if (isNaN(pixelDistance)) {
            throw new CharlotteError(
              CharlotteErrorCode.SESSION_ERROR,
              `Invalid scroll amount: "${scrollAmount}". Use "page", "half", or a pixel value.`,
            );
          }
        }

        // Determine scroll deltas
        let deltaX = 0;
        let deltaY = 0;
        switch (direction) {
          case "up":
            deltaY = -pixelDistance;
            break;
          case "down":
            deltaY = pixelDistance;
            break;
          case "left":
            deltaX = -pixelDistance;
            break;
          case "right":
            deltaX = pixelDistance;
            break;
        }

        if (element_id) {
          // Scroll within a specific container
          const { backendNodeId } = await resolveElement(deps, element_id);
          const cdpSession = await page.createCDPSession();
          try {
            const { object } = await cdpSession.send("DOM.resolveNode", {
              backendNodeId,
            });
            if (object?.objectId) {
              await cdpSession.send("Runtime.callFunctionOn", {
                objectId: object.objectId,
                functionDeclaration: `function(dx, dy) {
                  this.scrollBy(dx, dy);
                }`,
                arguments: [{ value: deltaX }, { value: deltaY }],
              });
            }
          } finally {
            await cdpSession.detach();
          }
        } else {
          // Scroll the page
          await page.evaluate(
            (dx, dy) => {
              window.scrollBy(dx, dy);
            },
            deltaX,
            deltaY,
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 50));

        const representation = await renderAfterAction(deps);
        return formatPageResponse(representation);
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte:hover ───
  server.registerTool(
    "charlotte:hover",
    {
      description:
        "Hover over an element to trigger hover states. Returns full page representation after hover.",
      inputSchema: {
        element_id: z.string().describe("Target element ID"),
      },
    },
    async ({ element_id }) => {
      try {
        await deps.browserManager.ensureConnected();
        const { page, backendNodeId } = await resolveElement(deps, element_id);

        logger.info("Hovering element", { element_id });

        await hoverElementByBackendNodeId(page, backendNodeId);

        const representation = await renderAfterAction(deps);
        return formatPageResponse(representation);
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte:drag ───
  server.registerTool(
    "charlotte:drag",
    {
      description:
        "Drag an element to another element. Uses mouse primitives to simulate drag-and-drop. Returns full page representation after the drag.",
      inputSchema: {
        source_id: z.string().describe("Element ID of the drag source"),
        target_id: z.string().describe("Element ID of the drop target"),
      },
    },
    async ({ source_id, target_id }) => {
      try {
        await deps.browserManager.ensureConnected();
        const { page, backendNodeId: sourceNodeId } = await resolveElement(
          deps,
          source_id,
        );
        const { backendNodeId: targetNodeId } = await resolveElement(
          deps,
          target_id,
        );

        logger.info("Dragging element", { source_id, target_id });

        await dragElementToElement(page, sourceNodeId, targetNodeId);

        // Brief settle for DOM updates after drop
        await new Promise((resolve) => setTimeout(resolve, 100));

        const representation = await renderAfterAction(deps);
        return formatPageResponse(representation);
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte:key ───
  server.registerTool(
    "charlotte:key",
    {
      description:
        'Press a keyboard key, optionally with modifiers. Returns full page representation after keypress.',
      inputSchema: {
        key: z
          .string()
          .describe(
            'Key name: "Escape", "Tab", "Enter", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Backspace", "Delete", "Home", "End", "PageUp", "PageDown", or a single character',
          ),
        modifiers: z
          .array(z.enum(["ctrl", "shift", "alt", "meta"]))
          .optional()
          .describe('Modifier keys to hold: ["ctrl"], ["shift"], ["alt"], ["meta"]'),
      },
    },
    async ({ key, modifiers }) => {
      try {
        await deps.browserManager.ensureConnected();
        const page = deps.pageManager.getActivePage();

        logger.info("Pressing key", { key, modifiers });

        // Hold down modifiers
        const activeModifiers = modifiers ?? [];
        for (const modifier of activeModifiers) {
          const modifierKey = MODIFIER_KEY_MAP[modifier];
          await page.keyboard.down(modifierKey as KeyInput);
        }

        // Press the key
        await page.keyboard.press(key as KeyInput);

        // Release modifiers in reverse order
        for (const modifier of [...activeModifiers].reverse()) {
          const modifierKey = MODIFIER_KEY_MAP[modifier];
          await page.keyboard.up(modifierKey as KeyInput);
        }

        await new Promise((resolve) => setTimeout(resolve, 50));

        const representation = await renderAfterAction(deps);
        return formatPageResponse(representation);
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte:wait_for ───
  server.registerTool(
    "charlotte:wait_for",
    {
      description:
        "Wait for a condition to be met on the page. Returns page representation when the condition is satisfied, or a TIMEOUT error.",
      inputSchema: {
        element_id: z
          .string()
          .optional()
          .describe("Wait for specific element to appear/change"),
        state: z
          .enum(["visible", "hidden", "enabled", "disabled", "exists", "removed"])
          .optional()
          .describe("Target element state to wait for"),
        text: z
          .string()
          .optional()
          .describe("Wait for text to appear on the page"),
        selector: z
          .string()
          .optional()
          .describe("Wait for CSS selector to match"),
        js: z
          .string()
          .optional()
          .describe("Wait for JS expression to return truthy"),
        timeout: z
          .number()
          .optional()
          .describe("Max wait in ms (default: 10000)"),
      },
    },
    async ({ element_id, state, text, selector, js, timeout }) => {
      try {
        await deps.browserManager.ensureConnected();
        const page = deps.pageManager.getActivePage();
        const waitTimeout = timeout ?? 10000;

        // Validate that at least one condition is provided
        if (!element_id && !text && !selector && !js) {
          throw new CharlotteError(
            CharlotteErrorCode.SESSION_ERROR,
            "At least one wait condition is required (element_id, text, selector, or js).",
          );
        }

        logger.info("Waiting for condition", {
          element_id,
          state,
          text,
          selector,
          js,
          timeout: waitTimeout,
        });

        // Build a composite wait condition
        const satisfied = await pollWaitForCondition(
          deps,
          page,
          { element_id, state, text, selector, js },
          waitTimeout,
        );

        if (!satisfied) {
          const representation = await renderAfterAction(deps);
          const timeoutError = new CharlotteError(
            CharlotteErrorCode.TIMEOUT,
            `Wait condition not met within ${waitTimeout}ms.`,
            "The current page state is included in the response. Consider increasing timeout or adjusting your condition.",
          );
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  ...timeoutError.toResponse(),
                  page: representation,
                }),
              },
            ],
            isError: true,
          };
        }

        const representation = await renderAfterAction(deps);
        return formatPageResponse(representation);
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );
}

const MODIFIER_KEY_MAP: Record<string, KeyInput> = {
  ctrl: "Control" as KeyInput,
  shift: "Shift" as KeyInput,
  alt: "Alt" as KeyInput,
  meta: "Meta" as KeyInput,
};

/**
 * Poll for complex wait_for conditions that may involve element state checks.
 */
async function pollWaitForCondition(
  deps: ToolDependencies,
  page: Page,
  condition: {
    element_id?: string;
    state?: string;
    text?: string;
    selector?: string;
    js?: string;
  },
  timeoutMs: number,
): Promise<boolean> {
  const pollInterval = 100;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    let allSatisfied = true;

    // Check element_id + state condition
    if (condition.element_id) {
      const targetState = condition.state ?? "exists";
      const elementSatisfied = await checkElementCondition(
        deps,
        condition.element_id,
        targetState,
      );
      if (!elementSatisfied) allSatisfied = false;
    }

    // Check text condition
    if (allSatisfied && condition.text) {
      const textFound = await page.evaluate((searchText) => {
        return document.body?.innerText?.includes(searchText) ?? false;
      }, condition.text);
      if (!textFound) allSatisfied = false;
    }

    // Check selector condition
    if (allSatisfied && condition.selector) {
      const selectorMatched = await page.$(condition.selector);
      if (!selectorMatched) allSatisfied = false;
    }

    // Check JS condition
    if (allSatisfied && condition.js) {
      try {
        const jsResult = await page.evaluate((expression) => {
          return !!new Function('return ' + expression)();
        }, condition.js);
        if (!jsResult) allSatisfied = false;
      } catch {
        allSatisfied = false;
      }
    }

    if (allSatisfied) return true;

    const remainingTime = deadline - Date.now();
    if (remainingTime <= 0) break;

    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(pollInterval, remainingTime)),
    );
  }

  return false;
}

/**
 * Check if an element meets a specific state condition.
 */
async function checkElementCondition(
  deps: ToolDependencies,
  elementId: string,
  targetState: string,
): Promise<boolean> {
  switch (targetState) {
    case "exists": {
      const backendNodeId = deps.elementIdGenerator.resolveId(elementId);
      return backendNodeId !== null;
    }
    case "removed": {
      const backendNodeId = deps.elementIdGenerator.resolveId(elementId);
      if (backendNodeId !== null) {
        // Re-render to check if it's truly still there
        await renderActivePage(deps, { detail: "minimal" });
        return deps.elementIdGenerator.resolveId(elementId) === null;
      }
      return true;
    }
    case "visible":
    case "hidden":
    case "enabled":
    case "disabled": {
      // Re-render to get fresh state
      const representation = await renderActivePage(deps, { detail: "minimal" });
      const element = representation.interactive.find(
        (el) => el.id === elementId,
      );
      if (!element) {
        // Element doesn't exist — "hidden" and "disabled" are satisfied, others not
        return targetState === "hidden" || targetState === "disabled";
      }

      switch (targetState) {
        case "visible":
          return element.state.visible === true;
        case "hidden":
          return element.state.visible === false;
        case "enabled":
          return element.state.enabled === true;
        case "disabled":
          return element.state.enabled === false;
      }
      return false;
    }
    default:
      return false;
  }
}
