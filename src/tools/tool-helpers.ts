import type { Page } from "puppeteer";
import type { PageManager } from "../browser/page-manager.js";
import type { BrowserManager } from "../browser/browser-manager.js";
import type { RendererPipeline } from "../renderer/renderer-pipeline.js";
import type { ElementIdGenerator } from "../renderer/element-id-generator.js";
import type { SnapshotStore } from "../state/snapshot-store.js";
import type { ArtifactStore } from "../state/artifact-store.js";
import type { CharlotteConfig } from "../types/config.js";
import type { DevModeState } from "../dev/dev-mode-state.js";
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
  artifactStore: ArtifactStore;
  config: CharlotteConfig;
  devModeState?: DevModeState;
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
 *
 * When a JavaScript dialog is blocking the page, the renderer pipeline cannot
 * complete (page.title() and other JS-dependent calls hang). In that case,
 * returns a minimal stub representation with the pending_dialog info attached.
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

  // If a dialog is blocking, we can't render — page.title() and other
  // JS-dependent CDP calls will hang. Return a stub with dialog info.
  const pendingDialogInfo = deps.pageManager.getPendingDialogInfo();
  if (pendingDialogInfo) {
    const viewport = page.viewport() ?? { width: 1280, height: 720 };
    return {
      url: page.url(),
      title: "(dialog blocking)",
      viewport: { width: viewport.width, height: viewport.height },
      snapshot_id: 0,
      timestamp: new Date().toISOString(),
      structure: { landmarks: [], headings: [] },
      interactive: [],
      forms: [],
      errors: {
        console: deps.pageManager.getConsoleErrors(),
        network: deps.pageManager.getNetworkErrors(),
      },
      pending_dialog: pendingDialogInfo,
    };
  }

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

  // Attach pending reload event from dev mode, if any
  const pendingReloadEvent = deps.devModeState?.consumePendingReloadEvent();
  if (pendingReloadEvent) {
    representation.reload_event = pendingReloadEvent;
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
 * Strip empty/default fields from a PageRepresentation to reduce response size.
 * Returns a cleaned copy — does not mutate the original.
 */
function stripEmptyFields(representation: PageRepresentation): Record<string, unknown> {
  const cleaned: Record<string, unknown> = { ...representation };

  // When interactive_summary is present (minimal detail), strip the full
  // interactive array and forms from the serialized output. The internal
  // representation keeps them for find/wait_for/differ.
  if (representation.interactive_summary) {
    delete cleaned.interactive;
    delete cleaned.forms;
  } else {
    // Strip empty interactive array
    if (representation.interactive.length === 0) {
      delete cleaned.interactive;
    }
    // Strip empty forms array
    if (representation.forms.length === 0) {
      delete cleaned.forms;
    }
  }

  // Strip empty errors
  const hasConsoleErrors = representation.errors.console.length > 0;
  const hasNetworkErrors = representation.errors.network.length > 0;
  if (!hasConsoleErrors && !hasNetworkErrors) {
    delete cleaned.errors;
  }

  // Strip empty structure fields
  if (cleaned.structure) {
    const structure = { ...(cleaned.structure as Record<string, unknown>) };
    const originalStructure = representation.structure;

    if (originalStructure.landmarks.length === 0) {
      delete structure.landmarks;
    }
    if (originalStructure.headings.length === 0) {
      delete structure.headings;
    }
    if (!originalStructure.content_summary) {
      delete structure.content_summary;
    }

    cleaned.structure = structure;
  }

  // Strip absent pending_dialog
  if (!cleaned.pending_dialog) {
    delete cleaned.pending_dialog;
  }

  return cleaned;
}

/**
 * Format a PageRepresentation as an MCP tool response.
 * Uses compact JSON (no indentation) with empty fields stripped.
 */
export function formatPageResponse(representation: PageRepresentation): {
  content: Array<{ type: "text"; text: string }>;
} {
  const cleaned = stripEmptyFields(representation);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(cleaned),
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
        text: JSON.stringify(elements),
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
