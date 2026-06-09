import type { Page } from "puppeteer";
import type { CDPSessionManager } from "../browser/cdp-session.js";
import {
  AccessibilityExtractor,
  isLandmarkRole,
  isHeadingRole,
  isInteractiveRole,
} from "./accessibility-extractor.js";
import type { ParsedAXNode } from "./accessibility-extractor.js";
import { LayoutExtractor, ZERO_BOUNDS } from "./layout-extractor.js";
import {
  InteractiveExtractor,
  ROLE_TO_ELEMENT_TYPE,
  reclassifyFileInputs,
} from "./interactive-extractor.js";
import { ContentExtractor } from "./content-extractor.js";
import { ElementIdGenerator } from "./element-id-generator.js";
import { extractStructuralTree } from "./structural-tree-extractor.js";
import type { StructuralTreeOptions } from "./structural-tree-extractor.js";
import { computeDOMPathSignature } from "./dom-path.js";
import { discoverFrames } from "./frame-discovery.js";
import type { DiscoveredFrame } from "./frame-discovery.js";
import type {
  PageRepresentation,
  InteractiveSummary,
  IframeInfo,
  Landmark,
  Heading,
  Bounds,
  TruncationInfo,
} from "../types/page-representation.js";
import { createDefaultConfig } from "../types/config.js";
import type { CharlotteConfig } from "../types/config.js";
import { logger } from "../utils/logger.js";

export type DetailLevel = "minimal" | "summary" | "full";

/**
 * A frame's accessibility tree plus its source URL. `frameUrl` is undefined for
 * the main frame. Used to build a landmark-aware interactive summary across the
 * main frame and any iframes (#68).
 */
interface FrameTree {
  rootNodes: ParsedAXNode[];
  frameUrl?: string;
}

export interface RenderOptions {
  detail: DetailLevel;
  selector?: string;
  includeStyles?: boolean;
}

export class RendererPipeline {
  private accessibilityExtractor = new AccessibilityExtractor();
  private layoutExtractor = new LayoutExtractor();
  private interactiveExtractor = new InteractiveExtractor();
  private contentExtractor = new ContentExtractor();

  private config: CharlotteConfig;

  /**
   * Per-page render mutex. Concurrent renders of the same page race the shared
   * ElementIdGenerator (last writer wins via replaceWith(), so the loser's
   * representation holds IDs that no longer resolve) and tear when a navigation
   * lands mid-render. Chaining renders per page serializes them (#202).
   */
  private renderChains = new WeakMap<Page, Promise<unknown>>();

  constructor(
    private cdpSessionManager: CDPSessionManager,
    private elementIdGenerator: ElementIdGenerator,
    config?: CharlotteConfig,
  ) {
    // Accept optional config; callers without config get a permissive default
    this.config = config ?? createDefaultConfig();
  }

  async render(page: Page, options: RenderOptions): Promise<PageRepresentation> {
    // Serialize renders of the same page. Run after any in-flight render
    // settles (success OR failure) so one failed render cannot wedge the chain.
    const previous = this.renderChains.get(page) ?? Promise.resolve();
    const result = previous.catch(() => {}).then(() => this.renderInternal(page, options));
    // Store a swallowed copy so the chain link never rejects.
    this.renderChains.set(
      page,
      result.catch(() => {}),
    );
    return result;
  }

  private async renderInternal(page: Page, options: RenderOptions): Promise<PageRepresentation> {
    const startTime = Date.now();
    logger.debug("Starting render pipeline", { detail: options.detail });

    const session = await this.cdpSessionManager.getSession(page);

    // Step 1: Extract accessibility tree (main frame)
    const rootNodes = await this.accessibilityExtractor.extract(session);

    // Step 2: Collect nodes that need layout data
    const nodesNeedingBounds = this.collectNodesNeedingBounds(rootNodes);
    const backendNodeIds = nodesNeedingBounds
      .filter((n) => n.backendDOMNodeId !== null)
      .map((n) => n.backendDOMNodeId as number);

    // Step 3: Extract layout for relevant nodes
    const boundsMap = await this.layoutExtractor.getBoundsForNodes(session, backendNodeIds);

    // Step 4: Build a fresh ID generator for this render
    const freshIdGenerator = new ElementIdGenerator();

    // Step 5: Extract landmarks with bounds (pass "main" frameId for consistent hash input)
    const landmarks = this.extractLandmarks(rootNodes, boundsMap, freshIdGenerator, "main");

    // Step 6: Extract headings
    const headings = this.extractHeadings(rootNodes, freshIdGenerator);

    // Step 7: Extract interactive elements and forms
    const { elements, forms } = this.interactiveExtractor.extractInteractiveElements(
      rootNodes,
      boundsMap,
      freshIdGenerator,
    );

    // Step 7.5: Reclassify file inputs from "button" to "file_input"
    await reclassifyFileInputs(elements, session, freshIdGenerator);

    // Step 8: Extract content based on detail level
    let contentSummary: string | undefined;
    let fullContent: string | undefined;
    // Tracks any output cap that fired so we can attach a truncation marker (#188).
    let fullContentTruncation: { total_chars: number; returned_chars: number } | undefined;

    if (options.detail !== "minimal") {
      contentSummary = this.contentExtractor.extractSummary(rootNodes);
    }

    if (options.detail === "full") {
      const extracted = this.contentExtractor.extractFullContent(
        rootNodes,
        this.config.limits.maxFullContentChars,
      );
      fullContent = extracted.text;
      if (extracted.truncated) {
        fullContentTruncation = {
          total_chars: extracted.totalChars,
          returned_chars: this.config.limits.maxFullContentChars,
        };
      }
    }

    // Step 8.5: Generate interactive summary for minimal detail
    let interactiveSummary: InteractiveSummary | undefined;
    if (options.detail === "minimal") {
      interactiveSummary = this.buildInteractiveSummary([{ rootNodes }]);
    }

    // Step 9: Extract iframe content if enabled
    let iframeInfos: IframeInfo[] | undefined;

    if (this.config?.includeIframes) {
      const iframeResult = await this.extractIframeContent(
        page,
        options,
        freshIdGenerator,
        landmarks,
        headings,
        elements,
        forms,
      );

      if (iframeResult.iframeInfos.length > 0) {
        iframeInfos = iframeResult.iframeInfos;

        // Merge iframe content summaries
        if (contentSummary !== undefined && iframeResult.contentSummaries.length > 0) {
          contentSummary += "; " + iframeResult.contentSummaries.join("; ");
        }
        if (fullContent !== undefined && iframeResult.fullContents.length > 0) {
          fullContent += "\n\n" + iframeResult.fullContents.join("\n\n");
        }

        // Rebuild interactive summary across main + iframe trees so that
        // per-landmark grouping is preserved for iframe elements too (#68).
        if (options.detail === "minimal") {
          interactiveSummary = this.buildInteractiveSummary([
            { rootNodes },
            ...iframeResult.frameTrees,
          ]);
        }
      }
    }

    // Step 9.5: Cap the interactive element list so an adversarial page (100k
    // links) cannot produce a multi-MB response. The full set is kept long
    // enough to register every ID with the generator above; we truncate only
    // the serialized array and record how many were dropped (#188).
    const maxInteractive = this.config.limits.maxInteractiveElements;
    let interactiveTruncation: { total: number; returned: number } | undefined;
    let cappedElements = elements;
    if (elements.length > maxInteractive) {
      interactiveTruncation = { total: elements.length, returned: maxInteractive };
      cappedElements = elements.slice(0, maxInteractive);
    }

    // Step 10: Atomically replace the shared ID generator
    this.elementIdGenerator.replaceWith(freshIdGenerator);

    // Step 11: Get page metadata
    const url = page.url();
    const title = await page.title();
    const viewport = page.viewport() ?? this.config.defaultViewport;

    const truncation = this.buildTruncationInfo(interactiveTruncation, fullContentTruncation);

    const representation: PageRepresentation = {
      url,
      title,
      viewport: { width: viewport.width, height: viewport.height },
      snapshot_id: 0, // Will be set by snapshot store when pushed
      timestamp: new Date().toISOString(),
      structure: {
        landmarks,
        headings,
        ...(contentSummary !== undefined ? { content_summary: contentSummary } : {}),
        ...(fullContent !== undefined ? { full_content: fullContent } : {}),
      },
      interactive: cappedElements,
      forms,
      ...(interactiveSummary ? { interactive_summary: interactiveSummary } : {}),
      ...(iframeInfos ? { iframes: iframeInfos } : {}),
      errors: {
        console: [],
        network: [],
      },
      ...(truncation ? { truncation } : {}),
    };

    logger.debug("Render pipeline complete", {
      duration: Date.now() - startTime,
      landmarks: landmarks.length,
      headings: headings.length,
      interactive: elements.length,
      forms: forms.length,
      iframes: iframeInfos?.length ?? 0,
    });

    return representation;
  }

  /**
   * Extract content from all discoverable child frames and merge into the
   * main-frame arrays (landmarks, headings, elements, forms).
   */
  private async extractIframeContent(
    page: Page,
    options: RenderOptions,
    freshIdGenerator: ElementIdGenerator,
    landmarks: Landmark[],
    headings: Heading[],
    elements: ReturnType<InteractiveExtractor["extractInteractiveElements"]>["elements"],
    forms: ReturnType<InteractiveExtractor["extractInteractiveElements"]>["forms"],
  ): Promise<{
    iframeInfos: IframeInfo[];
    contentSummaries: string[];
    fullContents: string[];
    /** Per-frame AX trees, used to rebuild a landmark-aware summary (#68). */
    frameTrees: FrameTree[];
  }> {
    const iframeInfos: IframeInfo[] = [];
    const contentSummaries: string[] = [];
    const fullContents: string[] = [];
    const frameTrees: FrameTree[] = [];

    const maxDepth = this.config?.iframeDepth ?? 3;
    let discoveredFrames: DiscoveredFrame[];

    try {
      discoveredFrames = await discoverFrames(page, this.cdpSessionManager, maxDepth);
    } catch (error) {
      logger.debug("Frame discovery failed", error);
      return { iframeInfos, contentSummaries, fullContents, frameTrees };
    }

    for (const discoveredFrame of discoveredFrames) {
      try {
        const frameRootNodes = await this.extractSingleFrame(
          discoveredFrame,
          options,
          freshIdGenerator,
          landmarks,
          headings,
          elements,
          forms,
          contentSummaries,
          fullContents,
        );

        if (frameRootNodes.length > 0) {
          frameTrees.push({ rootNodes: frameRootNodes, frameUrl: discoveredFrame.url });
        }

        iframeInfos.push({
          frame_id: discoveredFrame.frameId,
          url: discoveredFrame.url,
          bounds: discoveredFrame.iframeBounds,
        });
      } catch (error) {
        logger.debug(`Failed to extract iframe content from ${discoveredFrame.url}`, error);
      }
    }

    return { iframeInfos, contentSummaries, fullContents, frameTrees };
  }

  /**
   * Extract AX tree, layout, landmarks, headings, interactive elements, forms,
   * and content from a single child frame. Merges results into the provided arrays.
   */
  private async extractSingleFrame(
    discoveredFrame: DiscoveredFrame,
    options: RenderOptions,
    freshIdGenerator: ElementIdGenerator,
    landmarks: Landmark[],
    headings: Heading[],
    elements: ReturnType<InteractiveExtractor["extractInteractiveElements"]>["elements"],
    forms: ReturnType<InteractiveExtractor["extractInteractiveElements"]>["forms"],
    contentSummaries: string[],
    fullContents: string[],
  ): Promise<ParsedAXNode[]> {
    const { session, frameId, url: frameUrl, contentOffset, isOutOfProcess } = discoveredFrame;

    // Extract AX tree for this frame
    const frameRootNodes = await this.accessibilityExtractor.extract(session, frameId);
    if (frameRootNodes.length === 0) return [];

    // Collect and extract layout with offset
    const nodesNeedingBounds = this.collectNodesNeedingBounds(frameRootNodes);
    const backendNodeIds = nodesNeedingBounds
      .filter((n) => n.backendDOMNodeId !== null)
      .map((n) => n.backendDOMNodeId as number);

    // Only out-of-process frames use a frame-local CDP session whose box-model
    // quads are frame-local and therefore need translation by contentOffset.
    // Same-process frames share the main session, which already returns
    // main-frame-viewport coordinates — applying the offset there double-counts
    // the iframe position. See issue #183.
    const layoutOffset = isOutOfProcess ? contentOffset : undefined;

    const boundsMap = await this.layoutExtractor.getBoundsForNodes(
      session,
      backendNodeIds,
      layoutOffset,
    );

    // Extract landmarks (with frame annotation)
    const frameLandmarks = this.extractLandmarks(
      frameRootNodes,
      boundsMap,
      freshIdGenerator,
      frameId,
    );
    for (const landmark of frameLandmarks) {
      landmark.frame = frameUrl;
      landmarks.push(landmark);
    }

    // Extract headings (with frame annotation)
    const frameHeadings = this.extractHeadings(frameRootNodes, freshIdGenerator, frameId);
    for (const heading of frameHeadings) {
      heading.frame = frameUrl;
      headings.push(heading);
    }

    // Extract interactive elements and forms (with frame annotation)
    const frameResult = this.interactiveExtractor.extractInteractiveElements(
      frameRootNodes,
      boundsMap,
      freshIdGenerator,
      frameId,
    );

    // Reclassify file inputs for this frame
    await reclassifyFileInputs(frameResult.elements, session, freshIdGenerator);

    for (const element of frameResult.elements) {
      element.frame = frameUrl;
      elements.push(element);
    }

    for (const form of frameResult.forms) {
      form.frame = frameUrl;
      forms.push(form);
    }

    // Extract content
    if (options.detail !== "minimal") {
      const frameSummary = this.contentExtractor.extractSummary(frameRootNodes);
      if (frameSummary) {
        contentSummaries.push(`iframe (${frameUrl}): ${frameSummary}`);
      }
    }

    if (options.detail === "full") {
      const frameFullContent = this.contentExtractor.extractFullContent(
        frameRootNodes,
        this.config.limits.maxFullContentChars,
      );
      if (frameFullContent.text) {
        fullContents.push(`--- iframe: ${frameUrl} ---\n${frameFullContent.text}`);
      }
    }

    return frameRootNodes;
  }

  /**
   * Lightweight render that returns only the structural tree view.
   * Extracts the AX tree and produces a compact tree string — skips
   * layout extraction, interactive extraction, and content extraction.
   */
  async renderTree(page: Page, options?: StructuralTreeOptions): Promise<string> {
    const session = await this.cdpSessionManager.getSession(page);
    const rootNodes = await this.accessibilityExtractor.extract(session);
    const title = await page.title();
    return extractStructuralTree(rootNodes, title, options);
  }

  private collectNodesNeedingBounds(rootNodes: ParsedAXNode[]): ParsedAXNode[] {
    const nodes: ParsedAXNode[] = [];

    const traverse = (node: ParsedAXNode) => {
      // Reuse the single source of truth for interactive roles
      // (accessibility-extractor's isInteractiveRole) rather than re-creating a
      // duplicate 16-entry Set on every call (#205).
      if (isLandmarkRole(node.role) || isHeadingRole(node.role) || isInteractiveRole(node.role)) {
        nodes.push(node);
      }

      for (const child of node.children) {
        traverse(child);
      }
    };

    for (const root of rootNodes) {
      traverse(root);
    }

    return nodes;
  }

  private extractLandmarks(
    rootNodes: ParsedAXNode[],
    boundsMap: Map<number, Bounds>,
    idGenerator: ElementIdGenerator,
    frameId?: string,
  ): Landmark[] {
    const landmarks: Landmark[] = [];

    const traverse = (node: ParsedAXNode) => {
      if (isLandmarkRole(node.role)) {
        let bounds = ZERO_BOUNDS;
        if (node.backendDOMNodeId !== null) {
          bounds = boundsMap.get(node.backendDOMNodeId) ?? ZERO_BOUNDS;
        }

        const domPath = computeDOMPathSignature(node);
        const landmarkId = idGenerator.generateId(
          "region",
          node.role,
          node.name,
          domPath,
          node.backendDOMNodeId,
          frameId,
        );

        landmarks.push({
          id: landmarkId,
          role: node.role,
          label: node.name || node.role,
          bounds,
        });
      }

      for (const child of node.children) {
        traverse(child);
      }
    };

    for (const root of rootNodes) {
      traverse(root);
    }

    return landmarks;
  }

  private extractHeadings(
    rootNodes: ParsedAXNode[],
    idGenerator: ElementIdGenerator,
    frameId?: string,
  ): Heading[] {
    const headings: Heading[] = [];

    const traverse = (node: ParsedAXNode) => {
      if (isHeadingRole(node.role)) {
        const level = this.getHeadingLevel(node);
        const domPath = computeDOMPathSignature(node);
        const headingId = idGenerator.generateId(
          "heading",
          node.role,
          node.name,
          domPath,
          node.backendDOMNodeId,
          frameId,
        );

        headings.push({
          level,
          text: node.name || "",
          id: headingId,
        });
      }

      for (const child of node.children) {
        traverse(child);
      }
    };

    for (const root of rootNodes) {
      traverse(root);
    }

    return headings;
  }

  /**
   * Build the interactive summary by walking the AX trees of the main frame
   * and any iframes, preserving per-landmark grouping for every frame (#68).
   *
   * Landmark keys match `structure.landmarks` ("role (label)" or "role"), with
   * "(page root)" for elements outside any landmark. Iframe landmark keys are
   * prefixed with the frame URL (e.g. "iframe (child.html) > main") so the
   * per-landmark breakdown is not collapsed into a single "(iframe)" bucket.
   */
  private buildInteractiveSummary(frameTrees: FrameTree[]): InteractiveSummary {
    const PAGE_ROOT_KEY = "(page root)";
    const landmarkCounts: Record<string, Record<string, number>> = {};
    let total = 0;

    const traverse = (node: ParsedAXNode, currentLandmarkKey: string, framePrefix: string) => {
      let landmarkKey = currentLandmarkKey;

      if (isLandmarkRole(node.role)) {
        const label = node.name || node.role;
        const baseKey = label !== node.role ? `${node.role} (${label})` : node.role;
        landmarkKey = framePrefix ? `${framePrefix} > ${baseKey}` : baseKey;
      }

      if (isInteractiveRole(node.role)) {
        const elementType = ROLE_TO_ELEMENT_TYPE[node.role] ?? "button";
        if (!landmarkCounts[landmarkKey]) {
          landmarkCounts[landmarkKey] = {};
        }
        landmarkCounts[landmarkKey][elementType] =
          (landmarkCounts[landmarkKey][elementType] ?? 0) + 1;
        total++;
      }

      for (const child of node.children) {
        traverse(child, landmarkKey, framePrefix);
      }
    };

    for (const tree of frameTrees) {
      // For iframes, the default (non-landmark) bucket is "iframe (url)" so
      // elements outside any landmark inside the frame are still attributed to
      // that frame rather than the page root.
      const framePrefix = tree.frameUrl ? `iframe (${tree.frameUrl})` : "";
      const rootKey = framePrefix || PAGE_ROOT_KEY;
      for (const root of tree.rootNodes) {
        traverse(root, rootKey, framePrefix);
      }
    }

    return { total, by_landmark: landmarkCounts };
  }

  /**
   * Assemble the optional `truncation` block from whichever caps fired during
   * render (#188). Returns undefined when nothing was truncated so a clean page
   * never carries the field.
   */
  private buildTruncationInfo(
    interactive: { total: number; returned: number } | undefined,
    fullContent: { total_chars: number; returned_chars: number } | undefined,
  ): TruncationInfo | undefined {
    if (!interactive && !fullContent) return undefined;

    const suggestions: string[] = [];
    if (interactive) {
      suggestions.push(
        "Use charlotte_find to query a narrower set of interactive elements, " +
          "or scope observation with a selector.",
      );
    }
    if (fullContent) {
      suggestions.push(
        "Use a narrower selector or observe with output_file to retrieve the full text.",
      );
    }

    return {
      ...(interactive ? { interactive } : {}),
      ...(fullContent ? { full_content: fullContent } : {}),
      suggestion: suggestions.join(" "),
    };
  }

  private getHeadingLevel(node: ParsedAXNode): 1 | 2 | 3 | 4 | 5 | 6 {
    const level = node.properties["level"];
    if (typeof level === "number" && level >= 1 && level <= 6) {
      return level as 1 | 2 | 3 | 4 | 5 | 6;
    }
    return 2; // default if level not specified
  }
}
