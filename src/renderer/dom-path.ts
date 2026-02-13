import type { ParsedAXNode } from "./accessibility-extractor.js";
import { isLandmarkRole } from "./accessibility-extractor.js";
import type { DOMPathSignature } from "../types/element-id.js";

export function computeDOMPathSignature(node: ParsedAXNode): DOMPathSignature {
  let nearestLandmarkRole: string | null = null;
  let nearestLandmarkLabel: string | null = null;
  let nearestLabelledContainer: string | null = null;

  // Walk ancestors to find nearest landmark and nearest labelled container
  let ancestor = node.parent;
  while (ancestor) {
    if (!nearestLabelledContainer && ancestor.name) {
      nearestLabelledContainer = ancestor.name;
    }

    if (!nearestLandmarkRole && isLandmarkRole(ancestor.role)) {
      nearestLandmarkRole = ancestor.role;
      nearestLandmarkLabel = ancestor.name || null;
      break; // Landmark is more specific, stop here
    }

    ancestor = ancestor.parent;
  }

  // Compute sibling index: position among siblings with the same role
  let siblingIndex = 0;
  if (node.parent) {
    const sameRoleSiblings = node.parent.children.filter(
      (child) => child.role === node.role,
    );
    siblingIndex = sameRoleSiblings.indexOf(node);
    if (siblingIndex === -1) siblingIndex = 0;
  }

  return {
    nearestLandmarkRole,
    nearestLandmarkLabel,
    nearestLabelledContainer,
    siblingIndex,
  };
}
