import { z } from "zod";
import type { Page } from "puppeteer";
import { logger } from "../utils/logger.js";
import { CharlotteError, CharlotteErrorCode } from "../types/errors.js";
import { diffRepresentations } from "../state/differ.js";
import type { DiffScope } from "../state/differ.js";
import {
  defineTool,
  DEFAULT_SESSION_ID,
  type SessionContext,
  type ToolDefinition,
} from "./types.js";
import type { Bounds } from "../types/page-representation.js";
import {
  ensureReady,
  renderActivePage,
  resolveElement,
  formatPageResponse,
  formatElementsResponse,
  handleToolError,
  resolveOutputPath,
  writeOutputFile,
  writeBinaryOutputFile,
  stripEmptyFields,
  waitForCompositorFrame,
} from "./tool-helpers.js";

/** Lightweight result from CSS selector queries. */
interface DOMElementResult {
  id: string;
  tag: string;
  text: string;
  bounds: Bounds | null;
}

/**
 * Query the DOM by CSS selector and register matched elements with
 * the ElementIdGenerator so their IDs work with interaction tools.
 */
async function findBySelector(
  page: Page,
  deps: SessionContext,
  selector: string,
): Promise<DOMElementResult[]> {
  const cdpSession = await page.createCDPSession();
  try {
    // Get the document root
    const { root } = await cdpSession.send("DOM.getDocument", { depth: 0 });

    // Query all matching nodes
    const { nodeIds } = await cdpSession.send("DOM.querySelectorAll", {
      nodeId: root.nodeId,
      selector,
    });

    const results: DOMElementResult[] = [];
    let matchIndex = 0;

    for (const nodeId of nodeIds) {
      try {
        // Get node details including backendNodeId
        const { node } = await cdpSession.send("DOM.describeNode", { nodeId });
        const backendNodeId = node.backendNodeId;
        const tag = node.nodeName.toLowerCase();

        // Get text content via Runtime
        const { object } = await cdpSession.send("DOM.resolveNode", { nodeId });
        let textContent = "";
        if (object?.objectId) {
          const textResult = await cdpSession.send("Runtime.callFunctionOn", {
            objectId: object.objectId,
            functionDeclaration: `function() { return (this.textContent || '').trim().substring(0, 100); }`,
            returnByValue: true,
          });
          textContent = (textResult.result?.value as string) ?? "";
        }

        // Get bounds via box model
        let bounds: Bounds | null = null;
        try {
          const { model } = await cdpSession.send("DOM.getBoxModel", { backendNodeId });
          if (model) {
            const contentQuad = model.content;
            const minX = Math.min(contentQuad[0], contentQuad[2], contentQuad[4], contentQuad[6]);
            const minY = Math.min(contentQuad[1], contentQuad[3], contentQuad[5], contentQuad[7]);
            const maxX = Math.max(contentQuad[0], contentQuad[2], contentQuad[4], contentQuad[6]);
            const maxY = Math.max(contentQuad[1], contentQuad[3], contentQuad[5], contentQuad[7]);
            bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
          }
        } catch {
          // Element may be hidden or zero-sized — leave bounds as null
        }

        // Generate a stable hash-based ID, then register it durably so it
        // survives the renders that every interaction tool triggers. The
        // originating selector + match index let resolveElement re-query a
        // fresh backend node ID after the DOM mutates (issue #191).
        const elementId = deps.elementIdGenerator.generateId(
          "dom_element",
          tag,
          textContent.substring(0, 50),
          {
            nearestLandmarkRole: null,
            nearestLandmarkLabel: null,
            nearestLabelledContainer: null,
            siblingIndex: matchIndex,
          },
          backendNodeId,
        );

        deps.elementIdGenerator.registerDomQueryId(elementId, {
          backendDOMNodeId: backendNodeId,
          frameId: null,
          selector,
          matchIndex,
        });

        results.push({
          id: elementId,
          tag,
          text: textContent,
          bounds,
        });
        matchIndex++;
      } catch {
        // Skip nodes that can't be described (e.g. pseudo-elements)
        continue;
      }
    }

    return results;
  } finally {
    await cdpSession.detach();
  }
}

/**
 * Compute Euclidean distance between the centers of two bounding boxes.
 */
function centerDistance(boundsA: Bounds, boundsB: Bounds): number {
  const centerAx = boundsA.x + boundsA.w / 2;
  const centerAy = boundsA.y + boundsA.h / 2;
  const centerBx = boundsB.x + boundsB.w / 2;
  const centerBy = boundsB.y + boundsB.h / 2;
  return Math.sqrt((centerAx - centerBx) ** 2 + (centerAy - centerBy) ** 2);
}

/**
 * Check if boundsInner is geometrically contained within boundsOuter.
 */
function isContainedWithin(boundsInner: Bounds, boundsOuter: Bounds): boolean {
  return (
    boundsInner.x >= boundsOuter.x &&
    boundsInner.y >= boundsOuter.y &&
    boundsInner.x + boundsInner.w <= boundsOuter.x + boundsOuter.w &&
    boundsInner.y + boundsInner.h <= boundsOuter.y + boundsOuter.h
  );
}

const NEAR_THRESHOLD_PX = 200;

const observeTool = defineTool({
  name: "charlotte_observe",
  description:
    'Get current page state without performing any action. Use detail levels to control verbosity: "minimal" for landmarks, headings, and interactive element counts by landmark (use charlotte_find to get specific elements with actionable IDs, or observe({ detail: "summary" }) to see all elements), "summary" (default) for content summaries and full element list, "full" for all text content. Use view: "tree" for a compact structural outline (cheapest orientation tool), or view: "tree-labeled" to include labels on interactive elements (still much cheaper than minimal JSON, and shows which button/link/input is which).',
  inputSchema: {
    detail: z
      .enum(["minimal", "summary", "full"])
      .optional()
      .describe(
        '"summary" (default), "full" (includes all text content), "minimal" (landmarks + interactive only)',
      ),
    view: z
      .enum(["default", "tree", "tree-labeled"])
      .optional()
      .describe(
        '"default" (structured JSON), "tree" (compact structural outline — element types only, cheapest), or "tree-labeled" (structural outline with interactive element labels — shows which button/link/input is which, still ~70% cheaper than minimal JSON)',
      ),
    selector: z.string().optional().describe("CSS selector to scope observation to a subtree"),
    include_styles: z
      .boolean()
      .optional()
      .describe("Include computed styles for visible elements (default: false)"),
    output_file: z
      .string()
      .optional()
      .describe(
        "Write observation data to this file path instead of returning inline. Relative paths resolve against output_dir (see charlotte_configure). Returns only a confirmation with the file path and size.",
      ),
  },
  async handler(deps, { detail, view, selector, include_styles, output_file }) {
    try {
      await ensureReady(deps);

      // Tree views: lightweight structural outline, skips full render pipeline
      if (view === "tree" || view === "tree-labeled") {
        const page = deps.pageManager.getActivePage();
        const pendingDialogInfo = deps.pageManager.getPendingDialogInfo();
        if (pendingDialogInfo) {
          return {
            content: [{ type: "text" as const, text: "(dialog blocking page)" }],
          };
        }
        const labelInteractive = view === "tree-labeled";
        logger.info("Rendering structural tree view", { labeled: labelInteractive });
        const tree = await deps.rendererPipeline.renderTree(page, { labelInteractive });
        return {
          content: [{ type: "text" as const, text: tree }],
        };
      }

      const detailLevel = detail ?? "summary";
      logger.info("Observing page", { detail: detailLevel, selector });

      const representation = await renderActivePage(deps, {
        detail: detailLevel,
        selector,
        includeStyles: include_styles,
        source: "observe",
      });

      if (output_file) {
        const resolvedPath = await resolveOutputPath(output_file, deps.config);
        const cleaned = stripEmptyFields(representation);
        // Pretty-printed for readability (inline responses use compact JSON)
        return await writeOutputFile(resolvedPath, JSON.stringify(cleaned, null, 2));
      }

      return formatPageResponse(representation, {
        maxResponseBytes: deps.config.limits.maxResponseBytes,
      });
    } catch (error: unknown) {
      return handleToolError(error);
    }
  },
});

const findTool = defineTool({
  name: "charlotte_find",
  description:
    "Search for elements matching criteria. Filters interactive elements by text, role, type, or spatial proximity. Use the selector parameter to find DOM elements by CSS selector — this reaches elements not in the accessibility tree (custom widgets, non-semantic divs). Selector results return Charlotte element IDs usable with click, hover, drag, etc.",
  inputSchema: {
    text: z
      .string()
      .optional()
      .describe("Text content to search for (case-insensitive substring match)"),
    role: z.string().optional().describe("ARIA role filter"),
    type: z
      .string()
      .optional()
      .describe(
        "Interactive element type filter (button, link, text_input, select, checkbox, etc.)",
      ),
    near: z
      .string()
      .optional()
      .describe("Element ID — find elements spatially near this one (within ~200px)"),
    within: z
      .string()
      .optional()
      .describe("Element ID — find elements geometrically contained within this one's bounds"),
    selector: z
      .string()
      .optional()
      .describe(
        "CSS selector to query the DOM directly. Returns elements that may not be in the accessibility tree. Results include durable Charlotte element IDs (dom-…) that remain valid across subsequent renders and interactions, and work with fill_form; they are re-resolved against the live DOM by re-running the selector.",
      ),
    output_file: z
      .string()
      .optional()
      .describe(
        "Write the full match results to this file path instead of returning them inline. Relative paths resolve against output_dir (see charlotte_configure). Returns only a confirmation with the file path and size. Use for broad selectors (e.g. 'div', '*') that match many elements.",
      ),
  },
  async handler(deps, { text, role, type, near, within, selector, output_file }) {
    try {
      await ensureReady(deps);
      logger.info("Finding elements", { text, role, type, near, within, selector });

      // CSS selector mode: query DOM directly, bypass accessibility tree
      if (selector) {
        const page = deps.pageManager.getActivePage();
        const domElements = await findBySelector(page, deps, selector);
        if (output_file) {
          const resolvedPath = await resolveOutputPath(output_file, deps.config);
          return await writeOutputFile(resolvedPath, JSON.stringify(domElements, null, 2));
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ session_id: DEFAULT_SESSION_ID, elements: domElements }),
            },
          ],
        };
      }

      // Render the page to get current elements
      const representation = await renderActivePage(deps, { detail: "minimal" });
      let matchingElements = [...representation.interactive];

      // Filter by text (case-insensitive substring)
      if (text) {
        const lowerText = text.toLowerCase();
        matchingElements = matchingElements.filter(
          (element) =>
            element.label.toLowerCase().includes(lowerText) ||
            element.value?.toLowerCase().includes(lowerText) ||
            element.placeholder?.toLowerCase().includes(lowerText),
        );
      }

      // Filter by type
      if (type) {
        matchingElements = matchingElements.filter((element) => element.type === type);
      }

      // Filter by role — we match against the type since our pipeline
      // maps roles to element types. For direct ARIA roles the caller
      // can use the text or type filters. Here we do a fuzzy match.
      if (role) {
        const lowerRole = role.toLowerCase();
        matchingElements = matchingElements.filter((element) => {
          // Match against element type (which is derived from ARIA role)
          if (element.type.toLowerCase().includes(lowerRole)) return true;
          // Also match common role aliases
          const roleAliases: Record<string, string[]> = {
            button: ["button"],
            link: ["link"],
            textbox: ["text_input", "textarea"],
            combobox: ["select"],
            checkbox: ["checkbox"],
            radio: ["radio"],
            switch: ["toggle"],
          };
          const aliases = roleAliases[lowerRole];
          if (aliases) {
            return aliases.includes(element.type);
          }
          return false;
        });
      }

      // Spatial filter: near
      if (near) {
        await resolveElement(deps, near);
        // Find the reference element in the interactive list
        const referenceElement = representation.interactive.find((element) => element.id === near);

        // A reference with no bounds can't anchor a spatial filter. Silently
        // skipping it would return the UNFILTERED set with no indication —
        // reject so the caller knows the filter didn't apply (#204).
        if (!referenceElement?.bounds) {
          throw new CharlotteError(
            CharlotteErrorCode.INVALID_ARGUMENT,
            `Reference element '${near}' has no bounds; cannot apply spatial filter.`,
            "Pick a reference element that is laid out on the page (has bounds), or drop the 'near' filter.",
          );
        }

        const referenceBounds = referenceElement.bounds;
        matchingElements = matchingElements
          .filter((element) => {
            if (!element.bounds || element.id === near) return false;
            const distance = centerDistance(element.bounds, referenceBounds);
            return distance <= NEAR_THRESHOLD_PX;
          })
          .sort((elementA, elementB) => {
            const distanceA = centerDistance(elementA.bounds!, referenceBounds);
            const distanceB = centerDistance(elementB.bounds!, referenceBounds);
            return distanceA - distanceB;
          });
      }

      // Spatial filter: within
      if (within) {
        await resolveElement(deps, within);
        const containerElement = representation.interactive.find(
          (element) => element.id === within,
        );

        // Same rationale as 'near': a boundsless container can't contain
        // anything, so reject instead of silently returning everything (#204).
        if (!containerElement?.bounds) {
          throw new CharlotteError(
            CharlotteErrorCode.INVALID_ARGUMENT,
            `Reference element '${within}' has no bounds; cannot apply spatial filter.`,
            "Pick a container element that is laid out on the page (has bounds), or drop the 'within' filter.",
          );
        }

        const containerBounds = containerElement.bounds;
        matchingElements = matchingElements.filter((element) => {
          if (!element.bounds || element.id === within) return false;
          return isContainedWithin(element.bounds, containerBounds);
        });
      }

      if (output_file) {
        const resolvedPath = await resolveOutputPath(output_file, deps.config);
        return await writeOutputFile(resolvedPath, JSON.stringify(matchingElements, null, 2));
      }

      return formatElementsResponse(matchingElements);
    } catch (error: unknown) {
      return handleToolError(error);
    }
  },
});

const screenshotTool = defineTool({
  name: "charlotte_screenshot",
  description:
    "Capture a visual screenshot. Fallback for when structured representation isn't sufficient (complex visualizations, canvas elements, images). Use save: true to persist as a file artifact that can be referenced later.",
  inputSchema: {
    selector: z
      .string()
      .optional()
      .describe("CSS selector to capture specific element (default: full page)"),
    format: z.enum(["png", "jpeg", "webp"]).optional().describe('"png" (default), "jpeg", "webp"'),
    quality: z.number().min(1).max(100).optional().describe("1-100 for jpeg/webp quality"),
    save: z
      .boolean()
      .optional()
      .describe(
        "Save as a persistent file artifact (default: false). When true, the screenshot is written to disk and artifact metadata is returned alongside the image.",
      ),
    output_file: z
      .string()
      .optional()
      .describe(
        "Write screenshot to this file path instead of returning base64 inline. Relative paths resolve against output_dir (see charlotte_configure). Returns only a confirmation with the file path and size.",
      ),
    full_page: z
      .boolean()
      .optional()
      .describe(
        "Capture the entire scrollable page (default: true, or false in remote mode). Set false to capture only the current viewport — much smaller output for long pages. Ignored when 'selector' is provided.",
      ),
    max_height: z
      .number()
      .int()
      .min(100)
      .max(16384)
      .optional()
      .describe(
        "Maximum screenshot height in pixels (default: 2000). When full_page is true and the page exceeds this height, the screenshot is clipped from the top. Prevents multi-minute waits on very long pages (e.g. Wikipedia articles 28000+px tall). Set to 16384 to disable clipping.",
      ),
  },
  async handler(deps, { selector, format, quality, save, output_file, full_page, max_height }) {
    try {
      if (save && output_file) {
        throw new CharlotteError(
          CharlotteErrorCode.INVALID_ARGUMENT,
          "Cannot use both 'save' and 'output_file' on the same screenshot call.",
          "Use 'save: true' to persist as an artifact, or 'output_file' to write to a specific path — not both.",
        );
      }

      await ensureReady(deps);
      const page = deps.pageManager.getActivePage();

      // Ensure the compositor has a fresh frame before capturing.
      // Without this, SPAs that replace a loading state with rendered
      // content via React/Vue/etc. may produce a stale screenshot
      // showing the old loading spinner.
      await waitForCompositorFrame(page);

      const screenshotFormat = format ?? "png";
      // Remote (HTTP) mode defaults full_page to viewport so the common path is
      // inline-safe and cheap (D6 §3); stdio keeps the true default. An explicit
      // full_page wins in both modes. Selector captures ignore full_page.
      const effectiveFullPage = full_page ?? (deps.config.remoteArtifacts.enabled ? false : true);
      logger.info("Taking screenshot", {
        selector,
        format: screenshotFormat,
        quality,
        save,
        full_page: effectiveFullPage,
      });

      let screenshotBase64: string;

      // Compute clip for full-page captures that would exceed max_height.
      // Chromium's compositor scales super-linearly with screenshot height:
      // a 28000px Wikipedia article takes 60+ seconds, while a 4000px clip
      // takes ~3 seconds. We cap the height to keep screenshots responsive.
      const maxScreenshotHeight = max_height ?? 2000;
      let clipRegion: { x: number; y: number; width: number; height: number } | undefined;
      if (!selector && effectiveFullPage && maxScreenshotHeight < 16384) {
        try {
          const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
          if (scrollHeight > maxScreenshotHeight) {
            const viewportWidth = await page.evaluate(() => document.documentElement.scrollWidth);
            clipRegion = {
              x: 0,
              y: 0,
              width: viewportWidth,
              height: maxScreenshotHeight,
            };
            logger.info("Clipping full-page screenshot", {
              scrollHeight,
              clipHeight: maxScreenshotHeight,
            });
          }
        } catch {
          // If we can't read the scroll height, proceed with fullPage
        }
      }

      if (selector) {
        const element = await page.$(selector);
        if (!element) {
          return handleToolError(
            new CharlotteError(
              CharlotteErrorCode.ELEMENT_NOT_FOUND,
              `No element found matching selector '${selector}'.`,
              "Check the selector syntax or use charlotte_observe to see available elements.",
            ),
          );
        }

        screenshotBase64 = (await element.screenshot({
          type: screenshotFormat,
          quality: screenshotFormat !== "png" ? quality : undefined,
          encoding: "base64",
        })) as string;
      } else if (clipRegion) {
        // Use clip instead of fullPage to avoid super-linear compositor cost
        screenshotBase64 = (await page.screenshot({
          type: screenshotFormat,
          quality: screenshotFormat !== "png" ? quality : undefined,
          encoding: "base64",
          clip: clipRegion,
        })) as string;
      } else {
        screenshotBase64 = (await page.screenshot({
          type: screenshotFormat,
          quality: screenshotFormat !== "png" ? quality : undefined,
          encoding: "base64",
          fullPage: effectiveFullPage,
        })) as string;
      }

      // Empty-encode error (D6 §5, UNIVERSAL — both modes). webp cannot encode
      // pages taller than 16,383px and returns a success-looking empty string;
      // catch it BEFORE the output_file branch so an empty encode is never
      // written to disk, inlined, or saved.
      if (screenshotBase64.length === 0) {
        return handleToolError(
          new CharlotteError(
            CharlotteErrorCode.SESSION_ERROR,
            `Screenshot encoding produced no data (format '${screenshotFormat}').`,
            "Some encoders (e.g. webp) cannot encode pages taller than 16,383px. Try format: 'png', or full_page: false / a selector.",
          ),
        );
      }

      // Write to file and return brief confirmation instead of inline base64.
      // output_file writes to disk and is exempt from the remote inline cap.
      if (output_file) {
        const resolvedPath = await resolveOutputPath(output_file, deps.config);
        const buffer = Buffer.from(screenshotBase64, "base64");
        return await writeBinaryOutputFile(resolvedPath, buffer);
      }

      // Over-cap refuse+steer (D6 §1/§2, remote only, inline path). Applies to
      // both the inline and `save` deliveries below: an over-cap screenshot is
      // neither inlined nor saved — it is refused with actionable alternatives.
      const rawBytes = Buffer.from(screenshotBase64, "base64").length;
      if (
        deps.config.remoteArtifacts.enabled &&
        rawBytes > deps.config.remoteArtifacts.maxInlineBytes
      ) {
        return handleToolError(
          new CharlotteError(
            CharlotteErrorCode.INVALID_ARGUMENT,
            `Screenshot is ${Math.round(rawBytes / 1024)} KB, over the ${Math.round(
              deps.config.remoteArtifacts.maxInlineBytes / 1024,
            )} KB inline limit for remote mode.`,
            "Retry with full_page: false (viewport only), a 'selector' to capture one element, or a narrower region.",
          ),
        );
      }

      const content: Array<
        { type: "image"; data: string; mimeType: string } | { type: "text"; text: string }
      > = [
        {
          type: "image" as const,
          data: screenshotBase64,
          mimeType: `image/${screenshotFormat}`,
        },
      ];

      // Persist as artifact when requested
      if (save) {
        const pageUrl = page.url();
        const pageTitle = await page.title();
        const buffer = Buffer.from(screenshotBase64, "base64");

        const artifact = await deps.artifactStore.save(buffer, {
          format: screenshotFormat,
          selector,
          url: pageUrl,
          title: pageTitle,
        });

        content.push({
          type: "text" as const,
          text: JSON.stringify({
            session_id: DEFAULT_SESSION_ID,
            artifact: {
              id: artifact.id,
              filename: artifact.filename,
              // I8 (D6 §4): omit the server filesystem path in remote mode.
              ...(deps.config.remoteArtifacts.enabled ? {} : { path: artifact.path }),
              size: artifact.size,
              format: artifact.format,
              timestamp: artifact.timestamp,
            },
          }),
        });
      }

      return { content };
    } catch (error: unknown) {
      return handleToolError(error);
    }
  },
});

// ─── charlotte_screenshots ───
const screenshotsTool = defineTool({
  name: "charlotte_screenshots",
  description:
    "List all saved screenshot artifacts. Returns metadata for each saved screenshot including ID, filename, page URL, and timestamp.",
  inputSchema: {},
  async handler(deps) {
    try {
      const artifacts = deps.artifactStore.list();

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              session_id: DEFAULT_SESSION_ID,
              screenshots: artifacts.map((a) => ({
                id: a.id,
                filename: a.filename,
                format: a.format,
                size: a.size,
                url: a.url,
                title: a.title,
                selector: a.selector,
                timestamp: a.timestamp,
              })),
              count: artifacts.length,
              // I8 (D6 §4): omit the server screenshot directory in remote mode.
              ...(deps.config.remoteArtifacts.enabled
                ? {}
                : { directory: deps.artifactStore.screenshotDir }),
            }),
          },
        ],
      };
    } catch (error: unknown) {
      return handleToolError(error);
    }
  },
});

// ─── charlotte_screenshot_get ───
const screenshotGetTool = defineTool({
  name: "charlotte_screenshot_get",
  description:
    "Retrieve a previously saved screenshot artifact by its ID. Returns the image data and metadata.",
  inputSchema: {
    id: z.string().describe("Screenshot artifact ID (e.g. ss-20260224103000-a1b2c3)"),
  },
  async handler(deps, { id }) {
    try {
      const artifact = deps.artifactStore.get(id);
      if (!artifact) {
        return handleToolError(
          new CharlotteError(
            CharlotteErrorCode.ELEMENT_NOT_FOUND,
            `Screenshot artifact '${id}' not found.`,
            "Use charlotte_screenshots to list available artifacts.",
          ),
        );
      }

      const fileData = await deps.artifactStore.readFile(id);
      if (!fileData) {
        return handleToolError(
          new CharlotteError(
            CharlotteErrorCode.SESSION_ERROR,
            `Screenshot file for '${id}' is missing from disk.`,
            "The file may have been deleted externally. Use charlotte_screenshots to see current artifacts.",
          ),
        );
      }

      // Over-cap refuse (D6 §1/§2, remote only): a stored image above the inline
      // limit is refused rather than blown into the token-metered result.
      if (
        deps.config.remoteArtifacts.enabled &&
        fileData.length > deps.config.remoteArtifacts.maxInlineBytes
      ) {
        return handleToolError(
          new CharlotteError(
            CharlotteErrorCode.INVALID_ARGUMENT,
            `Stored screenshot '${id}' is ${Math.round(fileData.length / 1024)} KB, over the ${Math.round(
              deps.config.remoteArtifacts.maxInlineBytes / 1024,
            )} KB inline limit for remote mode.`,
            "Re-capture with full_page: false or a selector for an inline-deliverable image.",
          ),
        );
      }

      return {
        content: [
          {
            type: "image" as const,
            data: fileData.toString("base64"),
            mimeType: artifact.mimeType,
          },
          {
            type: "text" as const,
            text: JSON.stringify({
              session_id: DEFAULT_SESSION_ID,
              artifact: {
                id: artifact.id,
                filename: artifact.filename,
                // I8 (D6 §4): omit the server filesystem path in remote mode.
                ...(deps.config.remoteArtifacts.enabled ? {} : { path: artifact.path }),
                format: artifact.format,
                size: artifact.size,
                url: artifact.url,
                title: artifact.title,
                selector: artifact.selector,
                timestamp: artifact.timestamp,
              },
            }),
          },
        ],
      };
    } catch (error: unknown) {
      return handleToolError(error);
    }
  },
});

// ─── charlotte_screenshot_delete ───
const screenshotDeleteTool = defineTool({
  name: "charlotte_screenshot_delete",
  description: "Delete a saved screenshot artifact by its ID. Removes the file from disk.",
  inputSchema: {
    id: z.string().describe("Screenshot artifact ID to delete"),
  },
  async handler(deps, { id }) {
    try {
      const deleted = await deps.artifactStore.delete(id);
      if (!deleted) {
        return handleToolError(
          new CharlotteError(
            CharlotteErrorCode.ELEMENT_NOT_FOUND,
            `Screenshot artifact '${id}' not found.`,
            "Use charlotte_screenshots to list available artifacts.",
          ),
        );
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              session_id: DEFAULT_SESSION_ID,
              success: true,
              deleted: id,
              remaining: deps.artifactStore.count,
            }),
          },
        ],
      };
    } catch (error: unknown) {
      return handleToolError(error);
    }
  },
});

// ─── charlotte_diff ───
const diffTool = defineTool({
  name: "charlotte_diff",
  description:
    "Compare current page state to a previous snapshot. Returns structural diff showing added, removed, moved, and changed elements.",
  inputSchema: {
    snapshot_id: z
      .number()
      .optional()
      .describe("Compare against a specific snapshot ID (default: previous snapshot)"),
    scope: z
      .enum(["all", "structure", "interactive", "content"])
      .optional()
      .describe(
        '"all" (default), "structure" (landmarks/headings), "interactive" (elements/forms), "content" (text/url/title)',
      ),
  },
  async handler(deps, { snapshot_id, scope }) {
    try {
      await ensureReady(deps);

      const diffScope = (scope ?? "all") as DiffScope;
      logger.info("Computing diff", { snapshot_id, scope: diffScope });

      // Get the reference snapshot
      let referenceSnapshot;
      if (snapshot_id !== undefined) {
        referenceSnapshot = deps.snapshotStore.get(snapshot_id);
        if (!referenceSnapshot) {
          const oldestId = deps.snapshotStore.getOldestId();
          throw new CharlotteError(
            CharlotteErrorCode.SNAPSHOT_EXPIRED,
            `Snapshot ${snapshot_id} has been evicted from the buffer.`,
            oldestId !== null
              ? `Oldest available snapshot is ${oldestId}.`
              : "No snapshots available. Call charlotte_observe first.",
          );
        }
      } else {
        // Use previous snapshot (second-most-recent)
        referenceSnapshot = deps.snapshotStore.getPrevious();
        if (!referenceSnapshot) {
          throw new CharlotteError(
            CharlotteErrorCode.SNAPSHOT_EXPIRED,
            "No previous snapshot available for comparison.",
            "Perform at least two observations or actions before calling diff.",
          );
        }
      }

      // Render current state (this also pushes a new snapshot)
      const currentRepresentation = await renderActivePage(deps, {
        source: "observe",
      });

      const diff = diffRepresentations(
        referenceSnapshot.representation,
        currentRepresentation,
        referenceSnapshot.id,
        currentRepresentation.snapshot_id,
        diffScope,
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ session_id: DEFAULT_SESSION_ID, ...diff }),
          },
        ],
      };
    } catch (error: unknown) {
      return handleToolError(error);
    }
  },
});

export const observationTools: ToolDefinition[] = [
  observeTool,
  findTool,
  screenshotTool,
  screenshotsTool,
  screenshotGetTool,
  screenshotDeleteTool,
  diffTool,
];
