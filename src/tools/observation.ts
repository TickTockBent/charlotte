import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logger } from "../utils/logger.js";
import { CharlotteError, CharlotteErrorCode } from "../types/errors.js";
import { diffRepresentations } from "../state/differ.js";
import type { DiffScope } from "../state/differ.js";
import type { ToolDependencies } from "./tool-helpers.js";
import type {
  InteractiveElement,
  Bounds,
} from "../types/page-representation.js";
import {
  renderActivePage,
  resolveElement,
  formatPageResponse,
  formatElementsResponse,
  handleToolError,
} from "./tool-helpers.js";

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
): void {
  server.registerTool(
    "charlotte:observe",
    {
      description:
        'Get current page state without performing any action. Use detail levels to control verbosity: "minimal" for landmarks, headings, and interactive element counts by landmark (use charlotte:find to get specific elements with actionable IDs, or observe({ detail: "summary" }) to see all elements), "summary" (default) for content summaries and full element list, "full" for all text content.',
      inputSchema: {
        detail: z
          .enum(["minimal", "summary", "full"])
          .optional()
          .describe(
            '"summary" (default), "full" (includes all text content), "minimal" (landmarks + interactive only)',
          ),
        selector: z
          .string()
          .optional()
          .describe("CSS selector to scope observation to a subtree"),
        include_styles: z
          .boolean()
          .optional()
          .describe(
            "Include computed styles for visible elements (default: false)",
          ),
      },
    },
    async ({ detail, selector, include_styles }) => {
      try {
        await deps.browserManager.ensureConnected();

        const detailLevel = detail ?? "summary";
        logger.info("Observing page", { detail: detailLevel, selector });

        const representation = await renderActivePage(deps, {
          detail: detailLevel,
          selector,
          includeStyles: include_styles,
          source: "observe",
        });
        return formatPageResponse(representation);
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  server.registerTool(
    "charlotte:find",
    {
      description:
        "Search for elements matching criteria. Filters interactive elements by text, role, type, or spatial proximity.",
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
          .describe(
            "Element ID — find elements spatially near this one (within ~200px)",
          ),
        within: z
          .string()
          .optional()
          .describe(
            "Element ID — find elements geometrically contained within this one's bounds",
          ),
      },
    },
    async ({ text, role, type, near, within }) => {
      try {
        await deps.browserManager.ensureConnected();
        logger.info("Finding elements", { text, role, type, near, within });

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
          matchingElements = matchingElements.filter(
            (element) => element.type === type,
          );
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
          const { backendNodeId } = await resolveElement(deps, near);
          // Find the reference element in the interactive list
          const referenceElement = representation.interactive.find(
            (element) => element.id === near,
          );

          if (referenceElement?.bounds) {
            matchingElements = matchingElements
              .filter((element) => {
                if (!element.bounds || element.id === near) return false;
                const distance = centerDistance(
                  element.bounds,
                  referenceElement.bounds!,
                );
                return distance <= NEAR_THRESHOLD_PX;
              })
              .sort((elementA, elementB) => {
                const distanceA = centerDistance(
                  elementA.bounds!,
                  referenceElement.bounds!,
                );
                const distanceB = centerDistance(
                  elementB.bounds!,
                  referenceElement.bounds!,
                );
                return distanceA - distanceB;
              });
          }
        }

        // Spatial filter: within
        if (within) {
          const { backendNodeId } = await resolveElement(deps, within);
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

  server.registerTool(
    "charlotte:screenshot",
    {
      description:
        "Capture a visual screenshot. Fallback for when structured representation isn't sufficient (complex visualizations, canvas elements, images).",
      inputSchema: {
        selector: z
          .string()
          .optional()
          .describe("CSS selector to capture specific element (default: full page)"),
        format: z
          .enum(["png", "jpeg", "webp"])
          .optional()
          .describe('"png" (default), "jpeg", "webp"'),
        quality: z
          .number()
          .optional()
          .describe("1-100 for jpeg/webp quality"),
      },
    },
    async ({ selector, format, quality }) => {
      try {
        await deps.browserManager.ensureConnected();
        const page = deps.pageManager.getActivePage();

        const screenshotFormat = format ?? "png";
        logger.info("Taking screenshot", {
          selector,
          format: screenshotFormat,
          quality,
        });

        let screenshotBuffer: string;

        if (selector) {
          const element = await page.$(selector);
          if (!element) {
            return handleToolError(
              new (await import("../types/errors.js")).CharlotteError(
                (await import("../types/errors.js")).CharlotteErrorCode.ELEMENT_NOT_FOUND,
                `No element found matching selector '${selector}'.`,
                "Check the selector syntax or use charlotte:observe to see available elements.",
              ),
            );
          }

          screenshotBuffer = (await element.screenshot({
            type: screenshotFormat,
            quality:
              screenshotFormat !== "png" ? quality : undefined,
            encoding: "base64",
          })) as string;
        } else {
          screenshotBuffer = (await page.screenshot({
            type: screenshotFormat,
            quality:
              screenshotFormat !== "png" ? quality : undefined,
            encoding: "base64",
            fullPage: true,
          })) as string;
        }

        return {
          content: [
            {
              type: "image" as const,
              data: screenshotBuffer,
              mimeType: `image/${screenshotFormat}`,
            },
          ],
        };
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  // ─── charlotte:diff ───
  server.registerTool(
    "charlotte:diff",
    {
      description:
        "Compare current page state to a previous snapshot. Returns structural diff showing added, removed, moved, and changed elements.",
      inputSchema: {
        snapshot_id: z
          .number()
          .optional()
          .describe(
            "Compare against a specific snapshot ID (default: previous snapshot)",
          ),
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
        await deps.browserManager.ensureConnected();

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
                : "No snapshots available. Call charlotte:observe first.",
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
}
