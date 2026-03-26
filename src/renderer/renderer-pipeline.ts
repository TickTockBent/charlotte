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
} from "../types/page-representation.js";
import { createDefaultConfig } from "../types/config.js";
import type { CharlotteConfig } from "../types/config.js";
import { logger } from "../utils/logger.js";

export type DetailLevel = "minimal" | "summary" | "full";

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

  constructor(
    private cdpSessionManager: CDPSessionManager,
    private elementIdGenerator: ElementIdGenerator,
    config?: CharlotteConfig,
  ) {
    // Accept optional config; callers without config get a permissive default
    this.config = config ?? createDefaultConfig();
  }

  async render(page: Page, options: RenderOptions): Promise<PageRepresentation> {
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

    if (options.detail !== "minimal") {
      contentSummary = this.contentExtractor.extractSummary(rootNodes);
    }

    if (options.detail === "full") {
      fullContent = this.contentExtractor.extractFullContent(rootNodes);
    }

    // Step 8.5: Generate interactive summary for minimal detail
    let interactiveSummary: InteractiveSummary | undefined;
    if (options.detail === "minimal") {
      interactiveSummary = this.buildInteractiveSummary(rootNodes);
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

        // Rebuild interactive summary if needed (now includes iframe elements)
        if (options.detail === "minimal") {
          interactiveSummary = this.buildInteractiveSummaryFromElements(elements);
        }
      }
    }

    // Step 10: Atomically replace the shared ID generator
    this.elementIdGenerator.replaceWith(freshIdGenerator);

    // Step 11: Get page metadata
    const url = page.url();
    const title = await page.title();
    const viewport = page.viewport() ?? this.config.defaultViewport;

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
      interactive: elements,
      forms,
      ...(interactiveSummary ? { interactive_summary: interactiveSummary } : {}),
      ...(iframeInfos ? { iframes: iframeInfos } : {}),
      errors: {
        console: [],
        network: [],
      },
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
  }> {
    const iframeInfos: IframeInfo[] = [];
    const contentSummaries: string[] = [];
    const fullContents: string[] = [];

    const maxDepth = this.config?.iframeDepth ?? 3;
    let discoveredFrames: DiscoveredFrame[];

    try {
      discoveredFrames = await discoverFrames(page, this.cdpSessionManager, maxDepth);
    } catch (error) {
      logger.debug("Frame discovery failed", error);
      return { iframeInfos, contentSummaries, fullContents };
    }

    for (const discoveredFrame of discoveredFrames) {
      try {
        await this.extractSingleFrame(
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

        iframeInfos.push({
          frame_id: discoveredFrame.frameId,
          url: discoveredFrame.url,
          bounds: discoveredFrame.iframeBounds,
        });
      } catch (error) {
        logger.debug(`Failed to extract iframe content from ${discoveredFrame.url}`, error);
      }
    }

    return { iframeInfos, contentSummaries, fullContents };
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
  ): Promise<void> {
    const { session, frameId, url: frameUrl, contentOffset } = discoveredFrame;

    // Extract AX tree for this frame
    const frameRootNodes = await this.accessibilityExtractor.extract(session, frameId);
    if (frameRootNodes.length === 0) return;

    // Collect and extract layout with offset
    const nodesNeedingBounds = this.collectNodesNeedingBounds(frameRootNodes);
    const backendNodeIds = nodesNeedingBounds
      .filter((n) => n.backendDOMNodeId !== null)
      .map((n) => n.backendDOMNodeId as number);

    const boundsMap = await this.layoutExtractor.getBoundsForNodes(
      session,
      backendNodeIds,
      contentOffset,
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
      const frameFullContent = this.contentExtractor.extractFullContent(frameRootNodes);
      if (frameFullContent) {
        fullContents.push(`--- iframe: ${frameUrl} ---\n${frameFullContent}`);
      }
    }
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
      if (isLandmarkRole(node.role) || isHeadingRole(node.role) || this.isInteractiveNode(node)) {
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

  private isInteractiveNode(node: ParsedAXNode): boolean {
    const interactiveRoles = new Set([
      "button",
      "link",
      "textbox",
      "combobox",
      "listbox",
      "checkbox",
      "radio",
      "switch",
      "slider",
      "spinbutton",
      "searchbox",
      "menuitem",
      "menuitemcheckbox",
      "menuitemradio",
      "tab",
      "treeitem",
    ]);
    return interactiveRoles.has(node.role);
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

  private buildInteractiveSummary(rootNodes: ParsedAXNode[]): InteractiveSummary {
    const PAGE_ROOT_KEY = "(page root)";
    const landmarkCounts: Record<string, Record<string, number>> = {};
    let total = 0;

    const traverse = (node: ParsedAXNode, currentLandmarkKey: string) => {
      let landmarkKey = currentLandmarkKey;

      if (isLandmarkRole(node.role)) {
        const label = node.name || node.role;
        landmarkKey = label !== node.role ? `${node.role} (${label})` : node.role;
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
        traverse(child, landmarkKey);
      }
    };

    for (const root of rootNodes) {
      traverse(root, PAGE_ROOT_KEY);
    }

    return { total, by_landmark: landmarkCounts };
  }

  /**
   * Build interactive summary from the already-extracted elements array.
   * Used when iframe elements have been merged in and we need to rebuild
   * the summary to include them.
   */
  private buildInteractiveSummaryFromElements(
    elements: { type: string; frame?: string }[],
  ): InteractiveSummary {
    const PAGE_ROOT_KEY = "(page root)";
    const IFRAME_KEY = "(iframe)";
    const landmarkCounts: Record<string, Record<string, number>> = {};
    let total = 0;

    for (const element of elements) {
      const landmarkKey = element.frame ? IFRAME_KEY : PAGE_ROOT_KEY;
      if (!landmarkCounts[landmarkKey]) {
        landmarkCounts[landmarkKey] = {};
      }
      landmarkCounts[landmarkKey][element.type] =
        (landmarkCounts[landmarkKey][element.type] ?? 0) + 1;
      total++;
    }

    return { total, by_landmark: landmarkCounts };
  }

  private getHeadingLevel(node: ParsedAXNode): 1 | 2 | 3 | 4 | 5 | 6 {
    const level = node.properties["level"];
    if (typeof level === "number" && level >= 1 && level <= 6) {
      return level as 1 | 2 | 3 | 4 | 5 | 6;
    }
    return 2; // default if level not specified
  }
}
