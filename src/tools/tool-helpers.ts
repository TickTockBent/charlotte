import type { Page } from "puppeteer";
import type { PageManager } from "../browser/page-manager.js";
import type { BrowserManager } from "../browser/browser-manager.js";
import type { RendererPipeline } from "../renderer/renderer-pipeline.js";
import type { ElementIdGenerator } from "../renderer/element-id-generator.js";
import type { SnapshotStore } from "../state/snapshot-store.js";
import type { CharlotteConfig } from "../types/config.js";
import type {
  PageRepresentation,
  InteractiveElement,
} from "../types/page-representation.js";
import type { DetailLevel } from "../renderer/renderer-pipeline.js";
import { CharlotteError, CharlotteErrorCode } from "../types/errors.js";
import { diffRepresentations } from "../state/differ.js";

export interface ToolDependencies {
  browserManager: BrowserManager;
  pageManager: PageManager;
  rendererPipeline: RendererPipeline;
  elementIdGenerator: ElementIdGenerator;
  snapshotStore: SnapshotStore;
  config: CharlotteConfig;
}

export interface RenderOptions {
  detail?: DetailLevel;
  selector?: string;
  includeStyles?: boolean;
  /** Who triggered this render. Controls auto-snapshot behavior. */
  source?: "observe" | "action" | "internal";
  /** Force a snapshot regardless of auto_snapshot config. */
  forceSnapshot?: boolean;
}

/**
 * Render the active page, attach console/network errors, and optionally
 * push a snapshot to the store.
 */
export async function renderActivePage(
  deps: ToolDependencies,
  options: RenderOptions = {},
): Promise<PageRepresentation> {
  const {
    detail = "summary",
    selector,
    includeStyles,
    source = "internal",
    forceSnapshot = false,
  } = options;

  const page = deps.pageManager.getActivePage();
  const representation = await deps.rendererPipeline.render(page, {
    detail,
    selector,
    includeStyles,
  });

  // Attach collected errors from page manager
  representation.errors = {
    console: deps.pageManager.getConsoleErrors(),
    network: deps.pageManager.getNetworkErrors(),
  };

  // Determine whether to push a snapshot.
  // "internal" renders (e.g. resolveElement re-renders) never auto-snapshot.
  const shouldSnapshot =
    forceSnapshot ||
    (source !== "internal" &&
      (deps.config.autoSnapshot === "every_action" ||
        (deps.config.autoSnapshot === "observe_only" && source === "observe")));

  if (shouldSnapshot) {
    deps.snapshotStore.push(representation);
  }

  return representation;
}

/**
 * Resolve an element ID to a Puppeteer ElementHandle via CDP backend node ID.
 * If the ID is stale (not found after re-render), throws ELEMENT_NOT_FOUND
 * with a findSimilar suggestion.
 */
export async function resolveElement(
  deps: ToolDependencies,
  elementId: string,
): Promise<{ page: Page; backendNodeId: number }> {
  const page = deps.pageManager.getActivePage();

  // Step 1: Check current map
  let backendNodeId = deps.elementIdGenerator.resolveId(elementId);
  if (backendNodeId !== null) {
    return { page, backendNodeId };
  }

  // Step 2: Re-render and check again (map was invalidated)
  const freshRepresentation = await renderActivePage(deps, { detail: "minimal" });
  backendNodeId = deps.elementIdGenerator.resolveId(elementId);
  if (backendNodeId !== null) {
    return { page, backendNodeId };
  }

  // Step 3: Element is genuinely gone — suggest similar
  const similar = deps.elementIdGenerator.findSimilar(
    elementId,
    freshRepresentation.interactive,
  );

  const suggestion = similar
    ? `Element '${elementId}' not found. Did you mean '${similar.id}' (${similar.type}: "${similar.label}")?`
    : `Element '${elementId}' not found. Call charlotte:observe to get current page state.`;

  throw new CharlotteError(
    CharlotteErrorCode.ELEMENT_NOT_FOUND,
    `Element '${elementId}' not found on page.`,
    suggestion,
  );
}

/**
 * Render after an interaction action and attach a delta diff.
 * Captures the pre-action snapshot (latest in store), renders post-action
 * state, and computes a structural diff between them.
 */
export async function renderAfterAction(
  deps: ToolDependencies,
): Promise<PageRepresentation> {
  const preActionSnapshot = deps.snapshotStore.getLatest();

  const representation = await renderActivePage(deps, { source: "action" });

  // Compute delta if we have a pre-action snapshot to compare against
  if (preActionSnapshot) {
    const postSnapshotId = representation.snapshot_id;
    representation.delta = diffRepresentations(
      preActionSnapshot.representation,
      representation,
      preActionSnapshot.id,
      postSnapshotId,
    );
  }

  return representation;
}

/**
 * Format a PageRepresentation as an MCP tool response.
 */
export function formatPageResponse(representation: PageRepresentation): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(representation, null, 2),
      },
    ],
  };
}

/**
 * Format an array of interactive elements as an MCP tool response.
 */
export function formatElementsResponse(elements: InteractiveElement[]): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(elements, null, 2),
      },
    ],
  };
}

/**
 * Format a CharlotteError as an MCP tool error response.
 */
export function formatErrorResponse(error: CharlotteError): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(error.toResponse()),
      },
    ],
    isError: true,
  };
}

/**
 * Wrap a tool handler to catch CharlotteErrors and unexpected errors,
 * returning consistent error responses.
 */
export function handleToolError(error: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  if (error instanceof CharlotteError) {
    return formatErrorResponse(error);
  }

  const sessionError = new CharlotteError(
    CharlotteErrorCode.SESSION_ERROR,
    `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
  );
  return formatErrorResponse(sessionError);
}
