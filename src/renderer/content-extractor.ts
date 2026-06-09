import type { ParsedAXNode } from "./accessibility-extractor.js";
import { isLandmarkRole } from "./accessibility-extractor.js";
import { logger } from "../utils/logger.js";

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

function countElements(node: ParsedAXNode, counts: LandmarkCounts, isRoot = false): void {
  // Skip counting the traversal root itself. Otherwise a form landmark counts
  // itself ("1 forms" on the very form you're looking at), while containing
  // landmarks never count nested forms (form is a landmark, so recursion stops
  // at it). Net result: the forms count was self-referential and useless.
  if (isRoot) {
    for (const child of node.children) {
      if (!isLandmarkRole(child.role)) {
        countElements(child, counts);
      }
    }
    return;
  }

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
        countElements(node, counts, /* isRoot */ true);
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
        countElements(root, topLevelCounts, /* isRoot */ true);
      }
    }

    // If we have landmark summaries, use those
    if (landmarkSummaries.length > 0) {
      return landmarkSummaries.join("; ");
    }

    // Fallback: summarize the whole page
    return formatCounts(topLevelCounts);
  }

  /**
   * Concatenate page text content from the AX tree.
   *
   * `maxChars`, when provided, bounds the result: traversal stops accumulating
   * once the running character count reaches the cap, and the returned string is
   * hard-truncated with an explicit marker so a 100k-element document body can't
   * blow the response size (issue #188). The total character count (pre-cap) is
   * returned so callers can surface a truncation indicator.
   *
   * A depth guard (`MAX_TRAVERSAL_DEPTH`) prevents a stack overflow on
   * pathological/deeply-nested DOMs.
   */
  extractFullContent(
    rootNodes: ParsedAXNode[],
    maxChars?: number,
  ): { text: string; totalChars: number; truncated: boolean } {
    const textParts: string[] = [];
    let totalChars = 0;
    // Once we cross the cap we stop collecting further text but keep walking is
    // pointless — bail out of traversal entirely via this flag.
    let capReached = false;

    const traverse = (node: ParsedAXNode, depth: number) => {
      if (capReached) return;
      if (depth > MAX_TRAVERSAL_DEPTH) return;

      const push = (text: string) => {
        textParts.push(text);
        // +1 accounts for the "\n" join separator between parts.
        totalChars += text.length + 1;
        if (maxChars !== undefined && totalChars >= maxChars) {
          capReached = true;
        }
      };

      // Include text from nodes that represent content.
      // For content-role nodes (headings, paragraphs, etc.), the AX tree `name`
      // already includes all descendant text including CSS pseudo-element content.
      // We emit the name and skip children to avoid duplicating that text.
      if (node.name && isContentRole(node.role)) {
        push(node.name);
        return;
      }

      // For StaticText/text nodes not under a content-role parent (which would
      // have returned above), include the text directly.
      if (node.role === "StaticText" || node.role === "text") {
        if (node.name) push(node.name);
      }

      for (const child of node.children) {
        if (capReached) return;
        traverse(child, depth + 1);
      }
    };

    for (const root of rootNodes) {
      if (capReached) break;
      try {
        traverse(root, 0);
      } catch (error) {
        logger.warn("Skipping malformed AX node during content extraction", error);
      }
    }

    const joined = textParts.join("\n");

    if (maxChars !== undefined && joined.length > maxChars) {
      const truncatedText =
        joined.slice(0, maxChars) +
        `\n\n[...full_content truncated at ${maxChars} characters. ` +
        `Use a narrower selector or output_file to retrieve the complete text.]`;
      return { text: truncatedText, totalChars: joined.length, truncated: true };
    }

    return { text: joined, totalChars: joined.length, truncated: false };
  }
}

/**
 * Maximum AX-tree recursion depth. Real pages nest a few dozen levels deep at
 * most; a depth far beyond that signals a pathological/adversarial DOM, and we
 * stop rather than risk a stack overflow (issue #188).
 */
const MAX_TRAVERSAL_DEPTH = 5000;

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
