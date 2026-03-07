import type { ParsedAXNode } from "./accessibility-extractor.js";
import { isLandmarkRole, isHeadingRole, isInteractiveRole } from "./accessibility-extractor.js";

// ─── Display node intermediate representation ───

interface DisplayNode {
  tag: string;
  label?: string;
  metadata?: string;
  children: DisplayNode[];
  collapsible: boolean;
}

// ─── Role → display tag mappings ───

const INTERACTIVE_TAG: Record<string, string> = {
  button: "button",
  link: "link",
  textbox: "input",
  searchbox: "search",
  combobox: "select",
  listbox: "select",
  checkbox: "checkbox",
  radio: "radio",
  switch: "toggle",
  slider: "slider",
  spinbutton: "spinbutton",
  menuitem: "menuitem",
  menuitemcheckbox: "menuitem",
  menuitemradio: "menuitem",
  tab: "tab",
  treeitem: "treeitem",
};

const CONTENT_MARKER_ROLES = new Set([
  "paragraph",
  "blockquote",
  "image",
  "img",
  "figure",
]);

const LEAF_ROLES = new Set([
  "StaticText",
  "text",
  "InlineTextBox",
  "LineBreak",
  "separator",
]);

const LANDMARK_TAGS = new Set([
  "banner",
  "navigation",
  "main",
  "complementary",
  "contentinfo",
  "form",
  "region",
  "search",
]);

// ─── Helpers ───

function containsInteractive(node: ParsedAXNode): boolean {
  if (isInteractiveRole(node.role)) return true;
  return node.children.some((child) => containsInteractive(child));
}

function countListItems(node: ParsedAXNode): number {
  return node.children.filter((c) => c.role === "listitem").length;
}

function getTableDimensions(
  node: ParsedAXNode,
): { rows: number; cols: number } | null {
  let rows = 0;
  let maxCols = 0;
  const countRows = (n: ParsedAXNode) => {
    if (n.role === "row") {
      rows++;
      const cols = n.children.filter(
        (c) =>
          c.role === "cell" ||
          c.role === "columnheader" ||
          c.role === "rowheader" ||
          c.role === "gridcell",
      ).length;
      if (cols > maxCols) maxCols = cols;
    }
    for (const child of n.children) countRows(child);
  };
  countRows(node);
  return rows > 0 ? { rows, cols: maxCols } : null;
}

function getHeadingLevel(node: ParsedAXNode): number {
  const level = node.properties["level"];
  if (typeof level === "number" && level >= 1 && level <= 6) return level;
  return 2;
}

// ─── Tree building ───

function buildDisplayTree(nodes: ParsedAXNode[]): DisplayNode[] {
  const result: DisplayNode[] = [];

  for (const node of nodes) {
    if (LEAF_ROLES.has(node.role)) continue;

    if (isLandmarkRole(node.role)) {
      const label =
        node.name && node.name !== node.role ? node.name : undefined;
      result.push({
        tag: node.role,
        label,
        children: buildDisplayTree(node.children),
        collapsible: false,
      });
      continue;
    }

    if (isHeadingRole(node.role)) {
      const level = getHeadingLevel(node);
      const hasLinkChild = node.children.some((c) => c.role === "link");
      result.push({
        tag: hasLinkChild ? `h${level}→link` : `h${level}`,
        label: node.name || undefined,
        children: [],
        collapsible: false,
      });
      continue;
    }

    if (isInteractiveRole(node.role)) {
      result.push({
        tag: INTERACTIVE_TAG[node.role] ?? node.role,
        children: [],
        collapsible: true,
      });
      continue;
    }

    if (CONTENT_MARKER_ROLES.has(node.role)) {
      result.push({
        tag: node.role === "img" ? "image" : node.role,
        children: [],
        collapsible: true,
      });
      continue;
    }

    // Lists: passthrough if they contain interactive elements, marker otherwise
    if (node.role === "list") {
      if (containsInteractive(node)) {
        result.push(...buildDisplayTree(node.children));
      } else {
        const count = countListItems(node);
        result.push({
          tag: "list",
          metadata: count > 0 ? `(${count})` : undefined,
          children: [],
          collapsible: true,
        });
      }
      continue;
    }

    // Tables: passthrough if they contain interactive elements, marker otherwise
    if (node.role === "table") {
      if (containsInteractive(node)) {
        result.push(...buildDisplayTree(node.children));
      } else {
        const dims = getTableDimensions(node);
        result.push({
          tag: "table",
          metadata: dims ? `${dims.rows}×${dims.cols}` : undefined,
          children: [],
          collapsible: true,
        });
      }
      continue;
    }

    // Everything else: passthrough — flatten children into parent
    result.push(...buildDisplayTree(node.children));
  }

  return collapseConsecutive(result);
}

function collapseConsecutive(items: DisplayNode[]): DisplayNode[] {
  if (items.length <= 1) return items;

  const collapsed: DisplayNode[] = [];
  let i = 0;

  while (i < items.length) {
    const current = items[i];

    if (
      !current.collapsible ||
      current.children.length > 0 ||
      current.label ||
      current.metadata
    ) {
      collapsed.push(current);
      i++;
      continue;
    }

    // Count consecutive same-tag collapsible items
    let count = 1;
    while (i + count < items.length) {
      const next = items[i + count];
      if (
        next.tag !== current.tag ||
        !next.collapsible ||
        next.children.length > 0 ||
        next.label ||
        next.metadata
      ) {
        break;
      }
      count++;
    }

    if (count > 1) {
      collapsed.push({
        tag: `${current.tag} × ${count}`,
        children: [],
        collapsible: false,
      });
    } else {
      collapsed.push(current);
    }

    i += count;
  }

  return collapsed;
}

// ─── Rendering ───

function renderLines(
  items: DisplayNode[],
  isLastStack: boolean[] = [],
): string[] {
  const lines: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const isLast = i === items.length - 1;

    let prefix = "";
    for (const parentIsLast of isLastStack) {
      prefix += parentIsLast ? "   " : "│  ";
    }
    prefix += isLast ? "└─ " : "├─ ";

    let display: string;
    if (LANDMARK_TAGS.has(item.tag)) {
      display = item.label
        ? `[${item.tag} "${item.label}"]`
        : `[${item.tag}]`;
    } else {
      display = item.tag;
      if (item.label) display += ` "${item.label}"`;
      if (item.metadata) display += ` ${item.metadata}`;
    }

    lines.push(prefix + display);

    if (item.children.length > 0) {
      lines.push(...renderLines(item.children, [...isLastStack, isLast]));
    }
  }

  return lines;
}

// ─── Public API ───

export function extractStructuralTree(
  rootNodes: ParsedAXNode[],
  pageTitle?: string,
): string {
  const displayTree = buildDisplayTree(rootNodes);
  const treeLines = renderLines(displayTree);

  const parts: string[] = [];
  if (pageTitle) parts.push(pageTitle);
  parts.push(...treeLines);

  return parts.join("\n");
}
