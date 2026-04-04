import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Page } from "puppeteer";
import { logger } from "../utils/logger.js";
import { CharlotteError, CharlotteErrorCode } from "../types/errors.js";
import { diffRepresentations } from "../state/differ.js";
import type { DiffScope } from "../state/differ.js";
import type { ToolDependencies } from "./tool-helpers.js";
import type { Bounds } from "../types/page-representation.js";
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
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
  deps: ToolDependencies,
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

        // Register with ElementIdGenerator so the ID works with click, hover, drag, etc.
        const elementId = deps.elementIdGenerator.generateId(
          "dom_element",
          tag,
          textContent.substring(0, 50),
          {
            nearestLandmarkRole: null,
            nearestLandmarkLabel: null,
            nearestLabelledContainer: null,
            siblingIndex: results.length,
          },
          backendNodeId,
        );

        results.push({
          id: elementId,
          tag,
          text: textContent,
          bounds,
        });
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

export function registerObservationTools(
  server: McpServer,
  deps: ToolDependencies,
): Record<string, RegisteredTool> {
  const tools: Record<string, RegisteredTool> = {};

  tools["charlotte_observe"] = server.registerTool(
    "charlotte_observe",
    {
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
    },
    async ({ detail, view, selector, include_styles, output_file }) => {
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

        return formatPageResponse(representation);
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  tools["charlotte_find"] = server.registerTool(
    "charlotte_find",
    {
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
            "CSS selector to query the DOM directly. Returns elements that may not be in the accessibility tree. Results include Charlotte element IDs for use with interaction tools.",
          ),
      },
    },
    async ({ text, role, type, near, within, selector }) => {
      try {
        await ensureReady(deps);
        logger.info("Finding elements", { text, role, type, near, within, selector });

        // CSS selector mode: query DOM directly, bypass accessibility tree
        if (selector) {
          const page = deps.pageManager.getActivePage();
          const domElements = await findBySelector(page, deps, selector);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(domElements),
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
          const { backendNodeId: _nearNodeId } = await resolveElement(deps, near);
          // Find the reference element in the interactive list
          const referenceElement = representation.interactive.find(
            (element) => element.id === near,
          );

          if (referenceElement?.bounds) {
            matchingElements = matchingElements
              .filter((element) => {
                if (!element.bounds || element.id === near) return false;
                const distance = centerDistance(element.bounds, referenceElement.bounds!);
                return distance <= NEAR_THRESHOLD_PX;
              })
              .sort((elementA, elementB) => {
                const distanceA = centerDistance(elementA.bounds!, referenceElement.bounds!);
                const distanceB = centerDistance(elementB.bounds!, referenceElement.bounds!);
                return distanceA - distanceB;
              });
          }
        }

        // Spatial filter: within
        if (within) {
          const { backendNodeId: _withinNodeId } = await resolveElement(deps, within);
          const containerElement = representation.interactive.find(
            (element) => element.id === within,
          );

          if (containerElement?.bounds) {
            matchingElements = matchingElements.filter((element) => {
              if (!element.bounds || element.id === within) return false;
              return isContainedWithin(element.bounds, containerElement.bounds!);
            });
          }
        }

        return formatElementsResponse(matchingElements);
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  tools["charlotte_screenshot"] = server.registerTool(
    "charlotte_screenshot",
    {
      description:
        "Capture a visual screenshot. Fallback for when structured representation isn't sufficient (complex visualizations, canvas elements, images). Use save: true to persist as a file artifact that can be referenced later.",
      inputSchema: {
        selector: z
          .string()
          .optional()
          .describe("CSS selector to capture specific element (default: full page)"),
        format: z
          .enum(["png", "jpeg", "webp"])
          .optional()
          .describe('"png" (default), "jpeg", "webp"'),
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
      },
    },
    async ({ selector, format, quality, save, output_file }) => {
      try {
        if (save && output_file) {
          throw new CharlotteError(
            CharlotteErrorCode.SESSION_ERROR,
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
        logger.info("Taking screenshot", {
          selector,
          format: screenshotFormat,
          quality,
          save,
        });

        let screenshotBase64: string;

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
        } else {
          screenshotBase64 = (await page.screenshot({
            type: screenshotFormat,
            quality: screenshotFormat !== "png" ? quality : undefined,
            encoding: "base64",
            fullPage: true,
          })) as string;
        }

        // Write to file and return brief confirmation instead of inline base64
        if (output_file) {
          const resolvedPath = await resolveOutputPath(output_file, deps.config);
          const buffer = Buffer.from(screenshotBase64, "base64");
          return await writeBinaryOutputFile(resolvedPath, buffer);
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
              artifact: {
                id: artifact.id,
                filename: artifact.filename,
                path: artifact.path,
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
  );

  // ─── charlotte_screenshot_manage ───
  tools["charlotte_screenshot_manage"] = server.registerTool(
    "charlotte_screenshot_manage",
    {
      description:
        "Manage saved screenshot artifacts: list all, retrieve by ID (returns image data), or delete by ID.",
      inputSchema: {
        action: z
          .enum(["list", "get", "delete"])
          .describe("Action to perform on screenshot artifacts"),
        id: z
          .string()
          .optional()
          .describe("Screenshot artifact ID (required for get and delete)"),
      },
    },
    async ({ action, id }) => {
      try {
        if (action === "list") {
          const artifacts = deps.artifactStore.list();
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
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
                  directory: deps.artifactStore.screenshotDir,
                }),
              },
            ],
          };
        }

        // get and delete both require an id
        if (!id) {
          return handleToolError(
            new CharlotteError(
              CharlotteErrorCode.SESSION_ERROR,
              `The '${action}' action requires an 'id' parameter.`,
            ),
          );
        }

        if (action === "get") {
          const artifact = deps.artifactStore.get(id);
          if (!artifact) {
            return handleToolError(
              new CharlotteError(
                CharlotteErrorCode.ELEMENT_NOT_FOUND,
                `Screenshot artifact '${id}' not found.`,
                "Use charlotte_screenshot_manage({ action: 'list' }) to list available artifacts.",
              ),
            );
          }

          const fileData = await deps.artifactStore.readFile(id);
          if (!fileData) {
            return handleToolError(
              new CharlotteError(
                CharlotteErrorCode.SESSION_ERROR,
                `Screenshot file for '${id}' is missing from disk.`,
                "The file may have been deleted externally.",
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
                  artifact: {
                    id: artifact.id,
                    filename: artifact.filename,
                    path: artifact.path,
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
        }

        // action === "delete"
        const deleted = await deps.artifactStore.delete(id);
        if (!deleted) {
          return handleToolError(
            new CharlotteError(
              CharlotteErrorCode.ELEMENT_NOT_FOUND,
              `Screenshot artifact '${id}' not found.`,
              "Use charlotte_screenshot_manage({ action: 'list' }) to list available artifacts.",
            ),
          );
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
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
  );

  // ─── charlotte_diff ───
  tools["charlotte_diff"] = server.registerTool(
    "charlotte_diff",
    {
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
    },
    async ({ snapshot_id, scope }) => {
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
              text: JSON.stringify(diff),
            },
          ],
        };
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  return tools;
}
