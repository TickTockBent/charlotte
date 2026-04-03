import * as fs from "node:fs/promises";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KeyInput } from "puppeteer";
import { CharlotteError, CharlotteErrorCode } from "../types/errors.js";
import { logger } from "../utils/logger.js";
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDependencies } from "./tool-helpers.js";
import {
  ensureReady,
  renderActivePage,
  renderAfterAction,
  resolveElement,
  formatPageResponse,
  handleToolError,
  coercedBoolean,
} from "./tool-helpers.js";
import {
  MODIFIER_KEY_MAP,
  clickElementByBackendNodeId,
  focusElementByBackendNodeId,
  hoverElementByBackendNodeId,
  dragElementToElement,
  typeIntoElement,
  selectOptionByBackendNodeId,
  submitFormByBackendNodeId,
  setFileInputFiles,
  waitForPossibleNavigation,
} from "./interaction-helpers.js";
import { registerWaitForTools } from "./wait-for.js";

// Re-export for backward compatibility (used by dialog and popup integration tests)
export { waitForPossibleNavigation } from "./interaction-helpers.js";

export function registerInteractionTools(
  server: McpServer,
  deps: ToolDependencies,
): Record<string, RegisteredTool> {
  const tools: Record<string, RegisteredTool> = {};

  // ─── charlotte:click ───
  tools["charlotte:click"] = server.registerTool(
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
        modifiers: z
          .array(z.enum(["ctrl", "shift", "alt", "meta"]))
          .optional()
          .describe(
            'Modifier keys to hold during click: ["ctrl"], ["shift"], ["alt"], ["meta"], or combinations like ["ctrl", "shift"]',
          ),
      },
    },
    async ({ element_id, click_type, modifiers }) => {
      try {
        await ensureReady(deps);
        const { page, backendNodeId } = await resolveElement(deps, element_id);
        const clickVariant = click_type ?? "left";
        const activeModifiers = modifiers ?? [];

        logger.info("Clicking element", {
          element_id,
          clickType: clickVariant,
          modifiers: activeModifiers,
        });

        await waitForPossibleNavigation(page, () =>
          clickElementByBackendNodeId(page, backendNodeId, clickVariant, activeModifiers),
        );

        const representation = await renderAfterAction(deps);
        return formatPageResponse(representation);
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte:click_at ───
  tools["charlotte:click_at"] = server.registerTool(
    "charlotte:click_at",
    {
      description:
        "Click at specific page coordinates. Use when target elements are not in the accessibility tree (custom widgets, canvas, non-semantic interactive divs). Dispatches real CDP-level mouse events. Returns full page representation after the click.",
      inputSchema: {
        x: z.number().describe("X coordinate in page pixels"),
        y: z.number().describe("Y coordinate in page pixels"),
        click_type: z
          .enum(["left", "right", "double"])
          .optional()
          .describe('Click type: "left" (default), "right", "double"'),
        modifiers: z
          .array(z.enum(["ctrl", "shift", "alt", "meta"]))
          .optional()
          .describe(
            'Modifier keys to hold during click: ["ctrl"], ["shift"], ["alt"], ["meta"], or combinations',
          ),
      },
    },
    async ({ x, y, click_type, modifiers }) => {
      try {
        await ensureReady(deps);
        const page = deps.pageManager.getActivePage();
        const clickVariant = click_type ?? "left";
        const activeModifiers = modifiers ?? [];

        logger.info("Clicking at coordinates", {
          x,
          y,
          clickType: clickVariant,
          modifiers: activeModifiers,
        });

        // Move to target coordinates first to trigger pointer/mouse enter events.
        // Real users always hover before clicking; frameworks like Next.js depend
        // on hover-triggered prefetch before click handlers fire.
        await page.mouse.move(x, y);
        await new Promise((resolve) => setTimeout(resolve, 50));

        await waitForPossibleNavigation(page, async () => {
          // Hold down modifier keys
          for (const modifier of activeModifiers) {
            const modifierKey = MODIFIER_KEY_MAP[modifier];
            await page.keyboard.down(modifierKey);
          }

          try {
            if (clickVariant === "right") {
              await page.mouse.click(x, y, { button: "right" });
            } else if (clickVariant === "double") {
              await page.mouse.click(x, y, { clickCount: 2 });
            } else {
              await page.mouse.click(x, y);
            }
          } finally {
            // Release modifier keys in reverse order
            for (const modifier of [...activeModifiers].reverse()) {
              const modifierKey = MODIFIER_KEY_MAP[modifier];
              await page.keyboard.up(modifierKey);
            }
          }
        });

        const representation = await renderAfterAction(deps);
        return formatPageResponse(representation);
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte:type ───
  tools["charlotte:type"] = server.registerTool(
    "charlotte:type",
    {
      description:
        "Type text into an input element. Returns full page representation after typing.",
      inputSchema: {
        element_id: z.string().describe("Target input element ID"),
        text: z.string().describe("Text to enter"),
        clear_first: coercedBoolean
          .optional()
          .describe("Clear existing value before typing (default: true)"),
        press_enter: coercedBoolean
          .optional()
          .describe("Press Enter after typing (default: false)"),
        slowly: coercedBoolean
          .optional()
          .describe(
            "Type one character at a time with a delay between keystrokes. Use for sites with autocomplete, search-as-you-type, or per-key validation (default: false)",
          ),
        character_delay: z
          .number()
          .min(1)
          .optional()
          .describe(
            "Milliseconds between keystrokes (implies slowly: true). Default when slowly is true: 50ms",
          ),
      },
    },
    async ({ element_id, text, clear_first, press_enter, slowly, character_delay }) => {
      try {
        await ensureReady(deps);
        const { page, backendNodeId } = await resolveElement(deps, element_id);
        const shouldClearFirst = clear_first ?? true;
        const shouldPressEnter = press_enter ?? false;
        const delayMs = character_delay ?? (slowly ? 50 : undefined);

        logger.info("Typing into element", {
          element_id,
          textLength: text.length,
          clearFirst: shouldClearFirst,
          pressEnter: shouldPressEnter,
          characterDelay: delayMs,
        });

        await typeIntoElement(
          page,
          backendNodeId,
          text,
          shouldClearFirst,
          shouldPressEnter,
          delayMs,
        );

        const representation = await renderAfterAction(deps);
        return formatPageResponse(representation);
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte:select ───
  tools["charlotte:select"] = server.registerTool(
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
        await ensureReady(deps);
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
  tools["charlotte:toggle"] = server.registerTool(
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
        await ensureReady(deps);
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
  tools["charlotte:submit"] = server.registerTool(
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
        await ensureReady(deps);

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
            clickElementByBackendNodeId(page, submitResolved.backendNodeId, "left"),
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
  tools["charlotte:scroll"] = server.registerTool(
    "charlotte:scroll",
    {
      description:
        "Scroll the page or a specific container. Returns full page representation after scrolling.",
      inputSchema: {
        direction: z.enum(["up", "down", "left", "right"]).describe("Scroll direction"),
        amount: z
          .string()
          .optional()
          .describe('Scroll amount: "page" (default), "half", or pixel value (e.g. "200")'),
        element_id: z.string().optional().describe("Scroll within a specific container element"),
      },
    },
    async ({ direction, amount, element_id }) => {
      try {
        await ensureReady(deps);
        const page = deps.pageManager.getActivePage();

        const scrollAmount = amount ?? "page";
        logger.info("Scrolling", { direction, amount: scrollAmount, element_id });

        // Calculate pixel distance
        const viewport = page.viewport();
        const { defaultViewport } = deps.config;
        const viewportWidth = viewport?.width ?? defaultViewport.width;
        const viewportHeight = viewport?.height ?? defaultViewport.height;

        let pixelDistance: number;
        if (scrollAmount === "page") {
          pixelDistance =
            direction === "left" || direction === "right" ? viewportWidth : viewportHeight;
        } else if (scrollAmount === "half") {
          pixelDistance =
            direction === "left" || direction === "right" ? viewportWidth / 2 : viewportHeight / 2;
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
  tools["charlotte:hover"] = server.registerTool(
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
        await ensureReady(deps);
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
  tools["charlotte:drag"] = server.registerTool(
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
        await ensureReady(deps);
        const { page, backendNodeId: sourceNodeId } = await resolveElement(deps, source_id);
        const { backendNodeId: targetNodeId } = await resolveElement(deps, target_id);

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
  tools["charlotte:key"] = server.registerTool(
    "charlotte:key",
    {
      description:
        "Send keyboard input to the page or a specific element. Supports single key with modifiers, or a sequence of keys. Use for keyboard-driven UIs (games, terminals, code editors) and non-input elements with keydown listeners.",
      inputSchema: {
        key: z
          .string()
          .optional()
          .describe(
            'Single key to press: "Escape", "Tab", "Enter", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Backspace", "Delete", "Home", "End", "PageUp", "PageDown", "Space", or a single character. Mutually exclusive with keys.',
          ),
        keys: z
          .array(z.string())
          .optional()
          .describe(
            'Sequence of keys to press in order: ["ArrowDown", "ArrowDown", "Enter"]. Each key is pressed and released before the next. Mutually exclusive with key.',
          ),
        modifiers: z
          .array(z.enum(["ctrl", "shift", "alt", "meta"]))
          .optional()
          .describe(
            "Modifier keys to hold during a single key press. Only valid with key, not keys.",
          ),
        element_id: z
          .string()
          .optional()
          .describe(
            "Element to focus before sending keys. If omitted, keys go to the currently focused element.",
          ),
        delay: z
          .number()
          .min(0)
          .optional()
          .describe(
            "Milliseconds between key presses in a sequence (default: 0). Only valid with keys.",
          ),
      },
    },
    async ({ key, keys, modifiers, element_id, delay }) => {
      try {
        await ensureReady(deps);
        const page = deps.pageManager.getActivePage();

        // Validate: exactly one of key or keys must be provided
        if (key && keys) {
          throw new CharlotteError(
            CharlotteErrorCode.SESSION_ERROR,
            "Provide either key or keys, not both.",
          );
        }
        if (!key && !keys) {
          throw new CharlotteError(
            CharlotteErrorCode.SESSION_ERROR,
            "Provide either key (single) or keys (sequence).",
          );
        }

        // Focus target element if specified
        if (element_id) {
          const { page: resolvedPage, backendNodeId } = await resolveElement(deps, element_id);
          await focusElementByBackendNodeId(resolvedPage, backendNodeId);
        }

        if (key) {
          // Single key with optional modifiers
          logger.info("Pressing key", { key, modifiers, element_id });

          const activeModifiers = modifiers ?? [];
          for (const modifier of activeModifiers) {
            const modifierKey = MODIFIER_KEY_MAP[modifier];
            await page.keyboard.down(modifierKey as KeyInput);
          }

          await page.keyboard.press(key as KeyInput);

          for (const modifier of [...activeModifiers].reverse()) {
            const modifierKey = MODIFIER_KEY_MAP[modifier];
            await page.keyboard.up(modifierKey as KeyInput);
          }
        } else if (keys) {
          // Key sequence
          logger.info("Pressing key sequence", { keys, element_id, delay });

          const delayMs = delay ?? 0;
          for (let i = 0; i < keys.length; i++) {
            await page.keyboard.press(keys[i] as KeyInput);
            if (delayMs > 0 && i < keys.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 50));

        const representation = await renderAfterAction(deps);
        return formatPageResponse(representation);
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte:upload ───
  tools["charlotte:upload"] = server.registerTool(
    "charlotte:upload",
    {
      description:
        "Set files on a file input element. Validates that files exist and that the target is a file input. Returns full page representation after upload.",
      inputSchema: {
        element_id: z.string().describe("Target file input element ID"),
        paths: z.array(z.string()).min(1).describe("Absolute file paths to upload"),
      },
    },
    async ({ element_id, paths }) => {
      try {
        await ensureReady(deps);
        const { page, backendNodeId } = await resolveElement(deps, element_id);

        // Validate all files exist before sending to CDP
        for (const filePath of paths) {
          try {
            await fs.access(filePath);
          } catch {
            throw new CharlotteError(
              CharlotteErrorCode.SESSION_ERROR,
              `File not found: ${filePath}`,
              "Provide absolute paths to files that exist on disk.",
            );
          }
        }

        logger.info("Uploading files", { element_id, fileCount: paths.length });

        await setFileInputFiles(page, backendNodeId, paths);

        const representation = await renderAfterAction(deps);
        return formatPageResponse(representation);
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte:fill_form ───

  const FILLABLE_TYPES = new Set([
    "text_input", "textarea", "select", "checkbox", "radio", "toggle", "date_input", "color_input",
  ]);

  tools["charlotte:fill_form"] = server.registerTool(
    "charlotte:fill_form",
    {
      description:
        "Fill multiple form fields in a single call. Auto-detects element types (text input, select, checkbox, etc.) and applies the appropriate action. Returns a single page representation with delta covering all changes. Validates all fields before mutating any — if one field is invalid, no fields are changed.",
      inputSchema: {
        fields: z
          .array(
            z.object({
              element_id: z.string().describe("Element ID of the form field"),
              value: z.string().describe("Value to set: text for inputs/textareas, option value or text for selects. For checkbox/radio/toggle the element is clicked (toggling its state) and value is ignored."),
            }),
          )
          .min(1)
          .describe("Array of {element_id, value} pairs to fill"),
      },
    },
    async ({ fields }) => {
      try {
        await ensureReady(deps);

        // Render to get element types from the interactive array
        const representation = await renderActivePage(deps, { detail: "minimal" });

        // Validate all fields up front before performing any actions
        const resolvedFields: Array<{
          backendNodeId: number;
          type: string;
          value: string;
          page: import("puppeteer").Page;
        }> = [];

        for (const field of fields) {
          // Check type before resolving — gives better errors for non-fillable elements
          const element = representation.interactive.find((el) => el.id === field.element_id);
          if (!element) {
            // Fall through to resolveElement for proper "not found" with suggestions
            await resolveElement(deps, field.element_id);
            // If resolveElement didn't throw, the element exists but isn't interactive
            throw new CharlotteError(
              CharlotteErrorCode.ELEMENT_NOT_FOUND,
              `Element '${field.element_id}' is not an interactive form field.`,
              "Call charlotte:find to locate form fields by role or text.",
            );
          }

          if (!FILLABLE_TYPES.has(element.type)) {
            const hint = element.type === "file_input"
              ? "Use charlotte:upload for file inputs."
              : "fill_form supports: text_input, textarea, select, checkbox, radio, toggle, date_input, color_input.";
            throw new CharlotteError(
              CharlotteErrorCode.ELEMENT_NOT_INTERACTIVE,
              `Element '${field.element_id}' is type '${element.type}' which cannot be filled.`,
              hint,
            );
          }

          const resolved = await resolveElement(deps, field.element_id);
          resolvedFields.push({
            backendNodeId: resolved.backendNodeId,
            type: element.type,
            value: field.value,
            page: resolved.page,
          });
        }

        logger.info("Filling form fields", { fieldCount: resolvedFields.length });

        // Fill each field using the appropriate action
        for (const field of resolvedFields) {
          switch (field.type) {
            case "text_input":
            case "textarea":
            case "date_input":
            case "color_input":
              await typeIntoElement(field.page, field.backendNodeId, field.value, true, false);
              break;
            case "select":
              await selectOptionByBackendNodeId(field.page, field.backendNodeId, field.value);
              break;
            case "checkbox":
            case "radio":
            case "toggle":
              await clickElementByBackendNodeId(field.page, field.backendNodeId, "left");
              break;
          }
        }

        // Single render after all fields are filled
        const result = await renderAfterAction(deps);
        return formatPageResponse(result);
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte:wait_for (delegated to wait-for.ts) ───
  const waitForTools = registerWaitForTools(server, deps);
  Object.assign(tools, waitForTools);

  return tools;
}
