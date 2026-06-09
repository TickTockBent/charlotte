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
  getSessionForElement,
  formatPageResponse,
  handleToolError,
  coercedBoolean,
} from "./tool-helpers.js";
import {
  MODIFIER_KEY_MAP,
  clickAtCoordinates,
  clickElementByBackendNodeId,
  focusElementByBackendNodeId,
  hoverElementByBackendNodeId,
  dragElementToElement,
  typeIntoElement,
  selectOptionByBackendNodeId,
  submitFormByBackendNodeId,
  setFileInputFiles,
  waitForPossibleNavigation,
  assertTypingDurationWithinLimit,
  resolveCharacterDelay,
} from "./interaction-helpers.js";
import { registerWaitForTools } from "./wait-for.js";

// Re-export for backward compatibility (used by dialog and popup integration tests)
export { waitForPossibleNavigation } from "./interaction-helpers.js";

/** Element types charlotte_toggle accepts (checkbox/radio/switch roles). */
const TOGGLEABLE_TYPES = new Set(["checkbox", "radio", "toggle"]);

export function registerInteractionTools(
  server: McpServer,
  deps: ToolDependencies,
): Record<string, RegisteredTool> {
  const tools: Record<string, RegisteredTool> = {};

  // ─── charlotte_click ───
  tools["charlotte_click"] = server.registerTool(
    "charlotte_click",
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
        const resolved = await resolveElement(deps, element_id);
        const session = await getSessionForElement(deps, resolved);
        const clickVariant = click_type ?? "left";
        const activeModifiers = modifiers ?? [];

        logger.info("Clicking element", {
          element_id,
          clickType: clickVariant,
          modifiers: activeModifiers,
        });

        await waitForPossibleNavigation(resolved.page, () =>
          clickElementByBackendNodeId(
            resolved.page,
            resolved.backendNodeId,
            clickVariant,
            activeModifiers,
            session,
          ),
        );

        const representation = await renderAfterAction(deps);
        return formatPageResponse(representation, {
          maxResponseBytes: deps.config.limits.maxResponseBytes,
        });
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte_click_at ───
  tools["charlotte_click_at"] = server.registerTool(
    "charlotte_click_at",
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
          await clickAtCoordinates(page, x, y, clickVariant, activeModifiers);
        });

        const representation = await renderAfterAction(deps);
        return formatPageResponse(representation, {
          maxResponseBytes: deps.config.limits.maxResponseBytes,
        });
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte_type ───
  tools["charlotte_type"] = server.registerTool(
    "charlotte_type",
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
            "Milliseconds between keystrokes (implies slowly: true). Default when slowly is true: 50ms. " +
              "Total typing time is capped at approximately 30s (including per-keystroke overhead); " +
              "requests whose estimated duration exceeds that are rejected.",
          ),
      },
    },
    async ({ element_id, text, clear_first, press_enter, slowly, character_delay }) => {
      try {
        const shouldClearFirst = clear_first ?? true;
        const shouldPressEnter = press_enter ?? false;
        const delayMs = resolveCharacterDelay(slowly, character_delay);

        // Pure argument validation — guard against typing operations long enough
        // to risk an MCP tool timeout before doing any browser work. Floor the
        // effective per-character delay at 2ms so even *full-speed* typing of a
        // ~100KB payload (delayMs undefined) is bounded, not just slow typing (#204).
        assertTypingDurationWithinLimit(text.length, Math.max(delayMs ?? 0, 2));

        await ensureReady(deps);
        const resolved = await resolveElement(deps, element_id);
        const session = await getSessionForElement(deps, resolved);

        logger.info("Typing into element", {
          element_id,
          textLength: text.length,
          clearFirst: shouldClearFirst,
          pressEnter: shouldPressEnter,
          characterDelay: delayMs,
        });

        // press_enter can submit a form (navigation) or trigger a JS dialog from
        // a keydown/submit handler — guard against the dialog blocking forever (#182).
        await waitForPossibleNavigation(resolved.page, () =>
          typeIntoElement(
            resolved.page,
            resolved.backendNodeId,
            text,
            shouldClearFirst,
            shouldPressEnter,
            delayMs,
            session,
          ),
        );

        const representation = await renderAfterAction(deps);
        return formatPageResponse(representation, {
          maxResponseBytes: deps.config.limits.maxResponseBytes,
        });
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte_select ───
  tools["charlotte_select"] = server.registerTool(
    "charlotte_select",
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
        const resolved = await resolveElement(deps, element_id);
        const session = await getSessionForElement(deps, resolved);

        logger.info("Selecting option", { element_id, value });

        // A change handler may open a dialog or navigate — guard so the action
        // promise can't block on a dialog forever (#182).
        await waitForPossibleNavigation(resolved.page, () =>
          selectOptionByBackendNodeId(resolved.page, resolved.backendNodeId, value, session),
        );

        const representation = await renderAfterAction(deps);
        return formatPageResponse(representation, {
          maxResponseBytes: deps.config.limits.maxResponseBytes,
        });
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte_toggle ───
  tools["charlotte_toggle"] = server.registerTool(
    "charlotte_toggle",
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

        // Validate the target is actually a toggleable control before clicking.
        // charlotte_toggle is otherwise an unvalidated left click on any element,
        // so a misrouted call (e.g. a link/button) would fire its real action
        // with no error. Restrict to checkbox/radio/switch roles (#204).
        const preToggleRepresentation = await renderActivePage(deps, { detail: "minimal" });
        const targetElement = preToggleRepresentation.interactive.find(
          (el) => el.id === element_id,
        );
        if (targetElement && !TOGGLEABLE_TYPES.has(targetElement.type)) {
          throw new CharlotteError(
            CharlotteErrorCode.INVALID_ARGUMENT,
            `Element '${element_id}' is a ${targetElement.type}, not a checkbox/radio/switch — charlotte_toggle only operates on toggleable controls.`,
            "Use charlotte_click for buttons, links, and other elements.",
          );
        }

        const resolved = await resolveElement(deps, element_id);
        const session = await getSessionForElement(deps, resolved);

        logger.info("Toggling element", { element_id });

        // Toggle by clicking the element. A change handler may open a dialog or
        // navigate — guard so the click can't block on a dialog forever (#182).
        await waitForPossibleNavigation(resolved.page, () =>
          clickElementByBackendNodeId(resolved.page, resolved.backendNodeId, "left", [], session),
        );

        const representation = await renderAfterAction(deps);
        return formatPageResponse(representation, {
          maxResponseBytes: deps.config.limits.maxResponseBytes,
        });
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte_submit ───
  tools["charlotte_submit"] = server.registerTool(
    "charlotte_submit",
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
            "Call charlotte_observe to get current page state and verify form IDs.",
          );
        }

        const page = deps.pageManager.getActivePage();

        // If the form has a submit button, click it
        if (form.submit) {
          const submitResolved = await resolveElement(deps, form.submit);
          const submitSession = await getSessionForElement(deps, submitResolved);
          logger.info("Submitting form via submit button", {
            form_id,
            submitButton: form.submit,
          });
          await waitForPossibleNavigation(page, () =>
            clickElementByBackendNodeId(
              submitResolved.page,
              submitResolved.backendNodeId,
              "left",
              [],
              submitSession,
            ),
          );
        } else {
          // Fall back to dispatching submit event on the form itself
          const formResolved = await resolveElement(deps, form_id);
          const formSession = await getSessionForElement(deps, formResolved);
          logger.info("Submitting form via submit event", { form_id });
          await waitForPossibleNavigation(page, () =>
            submitFormByBackendNodeId(formResolved.page, formResolved.backendNodeId, formSession),
          );
        }

        const updatedRepresentation = await renderAfterAction(deps);
        return formatPageResponse(updatedRepresentation);
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte_scroll ───
  tools["charlotte_scroll"] = server.registerTool(
    "charlotte_scroll",
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
              CharlotteErrorCode.INVALID_ARGUMENT,
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
          const resolved = await resolveElement(deps, element_id);
          const cdpSession = await getSessionForElement(deps, resolved);
          const { object } = await cdpSession.send("DOM.resolveNode", {
            backendNodeId: resolved.backendNodeId,
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
        return formatPageResponse(representation, {
          maxResponseBytes: deps.config.limits.maxResponseBytes,
        });
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte_hover ───
  tools["charlotte_hover"] = server.registerTool(
    "charlotte_hover",
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
        const resolved = await resolveElement(deps, element_id);
        const session = await getSessionForElement(deps, resolved);

        logger.info("Hovering element", { element_id });

        await hoverElementByBackendNodeId(resolved.page, resolved.backendNodeId, session);

        const representation = await renderAfterAction(deps);
        return formatPageResponse(representation, {
          maxResponseBytes: deps.config.limits.maxResponseBytes,
        });
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte_drag ───
  tools["charlotte_drag"] = server.registerTool(
    "charlotte_drag",
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
        const sourceResolved = await resolveElement(deps, source_id);
        const targetResolved = await resolveElement(deps, target_id);

        if (sourceResolved.frameId !== targetResolved.frameId) {
          throw new CharlotteError(
            CharlotteErrorCode.SESSION_ERROR,
            "Cannot drag between different frames — source and target must be in the same frame.",
            "Use charlotte_find to locate elements within the same frame.",
          );
        }

        const session = await getSessionForElement(deps, sourceResolved);

        logger.info("Dragging element", { source_id, target_id });

        // A drop handler may open a dialog or navigate — guard so the drag can't
        // block on a dialog forever (#182).
        await waitForPossibleNavigation(
          sourceResolved.page,
          () =>
            dragElementToElement(
              sourceResolved.page,
              sourceResolved.backendNodeId,
              targetResolved.backendNodeId,
              session,
            ),
          // Drags include built-in settle pauses; give DOM updates a beat to land.
          { settleMs: 100 },
        );

        const representation = await renderAfterAction(deps);
        return formatPageResponse(representation, {
          maxResponseBytes: deps.config.limits.maxResponseBytes,
        });
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte_key ───
  tools["charlotte_key"] = server.registerTool(
    "charlotte_key",
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
        // Validate: exactly one of key or keys must be provided
        if (key && keys) {
          throw new CharlotteError(
            CharlotteErrorCode.INVALID_ARGUMENT,
            "Provide either key or keys, not both.",
          );
        }
        if (!key && !keys) {
          throw new CharlotteError(
            CharlotteErrorCode.INVALID_ARGUMENT,
            "Provide either key (single) or keys (sequence).",
          );
        }

        // Guard long key sequences the same way charlotte_type guards slow typing:
        // keys:[500 items] with delay:200 would run 100s into the MCP timeout (#180,
        // #204). Each press also has a small fixed per-key cost, so floor the
        // effective delay at 2ms so even a full-speed mega-sequence is bounded.
        if (keys) {
          assertTypingDurationWithinLimit(keys.length, Math.max(delay ?? 0, 2));
        }

        await ensureReady(deps);
        const page = deps.pageManager.getActivePage();

        // Focus target element if specified
        if (element_id) {
          const resolved = await resolveElement(deps, element_id);
          const session = await getSessionForElement(deps, resolved);
          await focusElementByBackendNodeId(resolved.page, resolved.backendNodeId, session);
        }

        // Enter (and other keys) on a focused form can submit/navigate or fire a
        // dialog from a keydown handler — guard so the dispatch can't block on a
        // dialog forever (#182).
        await waitForPossibleNavigation(page, async () => {
          if (key) {
            // Single key with optional modifiers
            logger.info("Pressing key", { key, modifiers, element_id });

            const activeModifiers = modifiers ?? [];
            for (const modifier of activeModifiers) {
              const modifierKey = MODIFIER_KEY_MAP[modifier];
              await page.keyboard.down(modifierKey as KeyInput);
            }

            try {
              await page.keyboard.press(key as KeyInput);
            } finally {
              for (const modifier of [...activeModifiers].reverse()) {
                const modifierKey = MODIFIER_KEY_MAP[modifier];
                await page.keyboard.up(modifierKey as KeyInput);
              }
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
        });

        const representation = await renderAfterAction(deps);
        return formatPageResponse(representation, {
          maxResponseBytes: deps.config.limits.maxResponseBytes,
        });
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte_upload ───
  tools["charlotte_upload"] = server.registerTool(
    "charlotte_upload",
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
        const resolved = await resolveElement(deps, element_id);
        const session = await getSessionForElement(deps, resolved);

        // Validate all files exist before sending to CDP
        for (const filePath of paths) {
          try {
            await fs.access(filePath);
          } catch {
            throw new CharlotteError(
              CharlotteErrorCode.INVALID_ARGUMENT,
              `File not found: ${filePath}`,
              "Provide absolute paths to files that exist on disk.",
            );
          }
        }

        logger.info("Uploading files", { element_id, fileCount: paths.length });

        await setFileInputFiles(resolved.page, resolved.backendNodeId, paths, session);

        const representation = await renderAfterAction(deps);
        return formatPageResponse(representation, {
          maxResponseBytes: deps.config.limits.maxResponseBytes,
        });
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte_fill_form ───

  const FILLABLE_TYPES = new Set([
    "text_input",
    "textarea",
    "select",
    "checkbox",
    "radio",
    "toggle",
    "date_input",
    "color_input",
  ]);

  tools["charlotte_fill_form"] = server.registerTool(
    "charlotte_fill_form",
    {
      description:
        "Fill multiple form fields in a single call. Auto-detects element types (text input, select, checkbox, etc.) and applies the appropriate action. Returns a single page representation with delta covering all changes. All fields are validated up front before any field is mutated; if validation fails, no fields are changed. Note: if a field action fails mid-list (e.g. a handler throws after earlier fields succeeded), earlier fields remain applied.",
      inputSchema: {
        fields: z
          .array(
            z.object({
              element_id: z.string().describe("Element ID of the form field"),
              value: z
                .string()
                .describe(
                  "Value to set: text for inputs/textareas, option value or text for selects. " +
                    'For checkbox/radio/toggle, pass the DESIRED state as "true" (checked) or "false" (unchecked) — ' +
                    "the element is clicked only when its current state differs, so re-filling is idempotent. " +
                    'Any non-"false" value is treated as "true".',
                ),
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
          frameId: string | null;
          type: string;
          value: string;
          /** Current checked state for checkbox/radio/toggle, captured at validation time. */
          currentlyChecked: boolean;
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
              "Call charlotte_find to locate form fields by role or text.",
            );
          }

          if (!FILLABLE_TYPES.has(element.type)) {
            const hint =
              element.type === "file_input"
                ? "Use charlotte_upload for file inputs."
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
            frameId: resolved.frameId,
            type: element.type,
            value: field.value,
            // "mixed" (indeterminate) counts as not-checked so an explicit
            // value: "true" forces it on.
            currentlyChecked: element.state.checked === true,
            page: resolved.page,
          });
        }

        logger.info("Filling form fields", { fieldCount: resolvedFields.length });

        // Fill each field using the appropriate action. Each field action is
        // guarded so a change/input handler that opens a dialog can't block the
        // whole fill forever (#182). If a dialog appears, waitForPossibleNavigation
        // returns early and renderAfterAction surfaces pending_dialog.
        for (const field of resolvedFields) {
          // Stop issuing further field actions once a dialog is blocking — they
          // would queue behind the blocked execution context.
          if (deps.pageManager.getPendingDialogInfo()) break;

          const fieldSession = await getSessionForElement(deps, {
            page: field.page,
            backendNodeId: field.backendNodeId,
            frameId: field.frameId,
          });
          switch (field.type) {
            case "text_input":
            case "textarea":
            case "date_input":
            case "color_input":
              await waitForPossibleNavigation(field.page, () =>
                typeIntoElement(
                  field.page,
                  field.backendNodeId,
                  field.value,
                  true,
                  false,
                  undefined,
                  fieldSession,
                ),
              );
              break;
            case "select":
              await waitForPossibleNavigation(field.page, () =>
                selectOptionByBackendNodeId(
                  field.page,
                  field.backendNodeId,
                  field.value,
                  fieldSession,
                ),
              );
              break;
            case "checkbox":
            case "radio":
            case "toggle": {
              // Set-semantics, not toggle: the value expresses the DESIRED state.
              // Only click when the current state differs, so value: "true" on an
              // already-checked box is a no-op instead of unchecking it (#204).
              const desiredChecked = field.value.toLowerCase() !== "false";
              if (desiredChecked !== field.currentlyChecked) {
                await waitForPossibleNavigation(field.page, () =>
                  clickElementByBackendNodeId(
                    field.page,
                    field.backendNodeId,
                    "left",
                    [],
                    fieldSession,
                  ),
                );
              }
              break;
            }
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

  // ─── charlotte_wait_for (delegated to wait-for.ts) ───
  const waitForTools = registerWaitForTools(server, deps);
  Object.assign(tools, waitForTools);

  return tools;
}
