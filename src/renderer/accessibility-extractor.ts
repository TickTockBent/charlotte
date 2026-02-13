import type { CDPSession } from "puppeteer";
import { logger } from "../utils/logger.js";

export interface ParsedAXNode {
  nodeId: string;
  role: string;
  name: string;
  description: string;
  value: string | null;
  properties: Record<string, unknown>;
  backendDOMNodeId: number | null;
  children: ParsedAXNode[];
  parent: ParsedAXNode | null;
}

const LANDMARK_ROLES = new Set([
  "banner",
  "navigation",
  "main",
  "complementary",
  "contentinfo",
  "form",
  "region",
  "search",
]);

const HEADING_ROLE = "heading";

const INTERACTIVE_ROLES = new Set([
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

export function isLandmarkRole(role: string): boolean {
  return LANDMARK_ROLES.has(role);
}

export function isHeadingRole(role: string): boolean {
  return role === HEADING_ROLE;
}

export function isInteractiveRole(role: string): boolean {
  return INTERACTIVE_ROLES.has(role);
}

interface RawAXNode {
  nodeId: string;
  ignored?: boolean;
  role?: { type: string; value: string };
  name?: { type: string; value: string; sources?: unknown[] };
  description?: { type: string; value: string };
  value?: { type: string; value: unknown };
  properties?: Array<{ name: string; value: { type: string; value: unknown } }>;
  childIds?: string[];
  parentId?: string;
  backendDOMNodeId?: number;
}

function extractProperties(
  rawProperties?: Array<{ name: string; value: { type: string; value: unknown } }>,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  if (!rawProperties) return properties;

  for (const prop of rawProperties) {
    properties[prop.name] = prop.value.value;
  }
  return properties;
}

export class AccessibilityExtractor {
  async extract(session: CDPSession): Promise<ParsedAXNode[]> {
    logger.debug("Extracting accessibility tree");

    const result = await session.send("Accessibility.getFullAXTree" as any);
    const rawNodes: RawAXNode[] = (result as any).nodes;

    if (!rawNodes || rawNodes.length === 0) {
      logger.warn("Empty accessibility tree returned");
      return [];
    }

    logger.debug(`Got ${rawNodes.length} AX nodes`);

    // Build lookup map
    const nodeMap = new Map<string, ParsedAXNode>();
    const childToParent = new Map<string, string>();

    // First pass: create ParsedAXNode for each non-ignored node
    for (const raw of rawNodes) {
      if (raw.ignored) continue;

      const role = raw.role?.value ?? "none";
      const name = raw.name?.value ?? "";
      const description = raw.description?.value ?? "";
      const rawValue = raw.value?.value;
      const value =
        rawValue !== undefined && rawValue !== null
          ? String(rawValue)
          : null;

      const parsed: ParsedAXNode = {
        nodeId: raw.nodeId,
        role,
        name,
        description,
        value,
        properties: extractProperties(raw.properties),
        backendDOMNodeId: raw.backendDOMNodeId ?? null,
        children: [],
        parent: null,
      };

      nodeMap.set(raw.nodeId, parsed);

      if (raw.childIds) {
        for (const childId of raw.childIds) {
          childToParent.set(childId, raw.nodeId);
        }
      }
    }

    // Second pass: link parent-child relationships
    const rootNodes: ParsedAXNode[] = [];

    for (const [nodeId, node] of nodeMap) {
      const parentId = childToParent.get(nodeId);
      if (parentId && nodeMap.has(parentId)) {
        const parentNode = nodeMap.get(parentId)!;
        node.parent = parentNode;
        parentNode.children.push(node);
      } else {
        rootNodes.push(node);
      }
    }

    logger.debug(`Reconstructed tree with ${rootNodes.length} root node(s)`);
    return rootNodes;
  }
}
