import type { ParsedAXNode } from "./accessibility-extractor.js";
import { isLandmarkRole } from "./accessibility-extractor.js";

interface LandmarkCounts {
  role: string;
  label: string;
  headings: number;
  links: number;
  buttons: number;
  inputs: number;
  images: number;
  lists: number;
  tables: number;
  forms: number;
  paragraphs: number;
}

function createEmptyCounts(role: string, label: string): LandmarkCounts {
  return {
    role,
    label,
    headings: 0,
    links: 0,
    buttons: 0,
    inputs: 0,
    images: 0,
    lists: 0,
    tables: 0,
    forms: 0,
    paragraphs: 0,
  };
}

function countElements(node: ParsedAXNode, counts: LandmarkCounts): void {
  switch (node.role) {
    case "heading":
      counts.headings++;
      break;
    case "link":
      counts.links++;
      break;
    case "button":
      counts.buttons++;
      break;
    case "textbox":
    case "searchbox":
    case "combobox":
    case "listbox":
    case "checkbox":
    case "radio":
    case "slider":
    case "spinbutton":
    case "switch":
      counts.inputs++;
      break;
    case "img":
    case "image":
      counts.images++;
      break;
    case "list":
      counts.lists++;
      break;
    case "table":
      counts.tables++;
      break;
    case "form":
      counts.forms++;
      break;
    case "paragraph":
      counts.paragraphs++;
      break;
  }

  for (const child of node.children) {
    // Don't recurse into nested landmarks — they get their own counts
    if (!isLandmarkRole(child.role)) {
      countElements(child, counts);
    }
  }
}

function formatCounts(counts: LandmarkCounts): string {
  const parts: string[] = [];

  if (counts.headings > 0) parts.push(`${counts.headings} headings`);
  if (counts.paragraphs > 0) parts.push(`${counts.paragraphs} paragraphs`);
  if (counts.links > 0) parts.push(`${counts.links} links`);
  if (counts.buttons > 0) parts.push(`${counts.buttons} buttons`);
  if (counts.inputs > 0) parts.push(`${counts.inputs} inputs`);
  if (counts.forms > 0) parts.push(`${counts.forms} forms`);
  if (counts.images > 0) parts.push(`${counts.images} images`);
  if (counts.lists > 0) parts.push(`${counts.lists} lists`);
  if (counts.tables > 0) parts.push(`${counts.tables} tables`);

  const label = counts.label || counts.role;
  if (parts.length === 0) return `${label}: empty`;
  return `${label}: ${parts.join(", ")}`;
}

export class ContentExtractor {
  extractSummary(rootNodes: ParsedAXNode[]): string {
    const landmarkSummaries: string[] = [];
    const topLevelCounts = createEmptyCounts("page", "page");

    const findLandmarks = (node: ParsedAXNode): void => {
      if (isLandmarkRole(node.role)) {
        const counts = createEmptyCounts(node.role, node.name || node.role);
        countElements(node, counts);
        landmarkSummaries.push(formatCounts(counts));
        // Don't recurse into landmark children here — countElements
        // already skips nested landmarks, which get found by continued traversal
      }

      // Always recurse into children to find landmarks at any depth
      for (const child of node.children) {
        findLandmarks(child);
      }
    };

    for (const root of rootNodes) {
      findLandmarks(root);

      // Count non-landmark content at root level (for fallback summary)
      if (!isLandmarkRole(root.role)) {
        countElements(root, topLevelCounts);
      }
    }

    // If we have landmark summaries, use those
    if (landmarkSummaries.length > 0) {
      return landmarkSummaries.join("; ");
    }

    // Fallback: summarize the whole page
    return formatCounts(topLevelCounts);
  }

  extractFullContent(rootNodes: ParsedAXNode[]): string {
    const textParts: string[] = [];

    const traverse = (node: ParsedAXNode) => {
      // Include text from nodes that represent content.
      // For content-role nodes (headings, paragraphs, etc.), the AX tree `name`
      // already includes all descendant text including CSS pseudo-element content.
      // We emit the name and skip children to avoid duplicating that text.
      if (node.name && isContentRole(node.role)) {
        textParts.push(node.name);
        return;
      }

      // For StaticText/text nodes not under a content-role parent (which would
      // have returned above), include the text directly.
      if (node.role === "StaticText" || node.role === "text") {
        if (node.name) textParts.push(node.name);
      }

      for (const child of node.children) {
        traverse(child);
      }
    };

    for (const root of rootNodes) {
      traverse(root);
    }

    return textParts.join("\n");
  }
}

function isContentRole(role: string): boolean {
  return (
    role === "heading" ||
    role === "paragraph" ||
    role === "listitem" ||
    role === "cell" ||
    role === "label" ||
    role === "legend" ||
    role === "caption" ||
    role === "blockquote"
  );
}
