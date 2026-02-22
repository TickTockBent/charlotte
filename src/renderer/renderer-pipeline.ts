import type { Page } from "puppeteer";
import type { CDPSessionManager } from "../browser/cdp-session.js";
import { AccessibilityExtractor, isLandmarkRole, isHeadingRole, isInteractiveRole } from "./accessibility-extractor.js";
import type { ParsedAXNode } from "./accessibility-extractor.js";
import { LayoutExtractor, ZERO_BOUNDS } from "./layout-extractor.js";
import { InteractiveExtractor, ROLE_TO_ELEMENT_TYPE } from "./interactive-extractor.js";
import { ContentExtractor } from "./content-extractor.js";
import { ElementIdGenerator } from "./element-id-generator.js";
import { computeDOMPathSignature } from "./dom-path.js";
import type {
  PageRepresentation,
  InteractiveSummary,
  Landmark,
  Heading,
  Bounds,
} from "../types/page-representation.js";
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

  constructor(
    private cdpSessionManager: CDPSessionManager,
    private elementIdGenerator: ElementIdGenerator,
  ) {}

  async render(
    page: Page,
    options: RenderOptions,
  ): Promise<PageRepresentation> {
    const startTime = Date.now();
    logger.debug("Starting render pipeline", { detail: options.detail });

    const session = await this.cdpSessionManager.getSession(page);

    // Step 1: Extract accessibility tree
    const rootNodes = await this.accessibilityExtractor.extract(session);

    // Step 2: Collect nodes that need layout data
    const nodesNeedingBounds = this.collectNodesNeedingBounds(rootNodes);
    const backendNodeIds = nodesNeedingBounds
      .filter((n) => n.backendDOMNodeId !== null)
      .map((n) => n.backendDOMNodeId as number);

    // Step 3: Extract layout for relevant nodes
    const boundsMap = await this.layoutExtractor.getBoundsForNodes(
      session,
      backendNodeIds,
    );

    // Step 4: Build a fresh ID generator for this render
    const freshIdGenerator = new ElementIdGenerator();

    // Step 5: Extract landmarks with bounds
    const landmarks = this.extractLandmarks(rootNodes, boundsMap, freshIdGenerator);

    // Step 6: Extract headings
    const headings = this.extractHeadings(rootNodes, freshIdGenerator);

    // Step 7: Extract interactive elements and forms
    const { elements, forms } =
      this.interactiveExtractor.extractInteractiveElements(
        rootNodes,
        boundsMap,
        freshIdGenerator,
      );

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

    // Step 9: Atomically replace the shared ID generator
    this.elementIdGenerator.replaceWith(freshIdGenerator);

    // Step 10: Get page metadata
    const url = page.url();
    const title = await page.title();
    const viewport = page.viewport() ?? { width: 1280, height: 720 };

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
    });

    return representation;
  }

  private collectNodesNeedingBounds(rootNodes: ParsedAXNode[]): ParsedAXNode[] {
    const nodes: ParsedAXNode[] = [];

    const traverse = (node: ParsedAXNode) => {
      if (
        isLandmarkRole(node.role) ||
        isHeadingRole(node.role) ||
        this.isInteractiveNode(node)
      ) {
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
      "button", "link", "textbox", "combobox", "listbox",
      "checkbox", "radio", "switch", "slider", "spinbutton",
      "searchbox", "menuitem", "menuitemcheckbox", "menuitemradio",
      "tab", "treeitem",
    ]);
    return interactiveRoles.has(node.role);
  }

  private extractLandmarks(
    rootNodes: ParsedAXNode[],
    boundsMap: Map<number, Bounds>,
    _idGenerator: ElementIdGenerator,
  ): Landmark[] {
    const landmarks: Landmark[] = [];

    const traverse = (node: ParsedAXNode) => {
      if (isLandmarkRole(node.role)) {
        let bounds = ZERO_BOUNDS;
        if (node.backendDOMNodeId !== null) {
          bounds = boundsMap.get(node.backendDOMNodeId) ?? ZERO_BOUNDS;
        }

        landmarks.push({
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
        landmarkCounts[landmarkKey][elementType] = (landmarkCounts[landmarkKey][elementType] ?? 0) + 1;
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

  private getHeadingLevel(node: ParsedAXNode): 1 | 2 | 3 | 4 | 5 | 6 {
    const level = node.properties["level"];
    if (typeof level === "number" && level >= 1 && level <= 6) {
      return level as 1 | 2 | 3 | 4 | 5 | 6;
    }
    return 2; // default if level not specified
  }
}
