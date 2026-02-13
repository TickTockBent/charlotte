import { TYPE_PREFIX_MAP, type DOMPathSignature } from "../types/element-id.js";
import type { InteractiveElement } from "../types/page-representation.js";
import { hashToHex4 } from "../utils/hash.js";

export class ElementIdGenerator {
  private idToBackendNodeId = new Map<string, number>();
  private backendNodeIdToId = new Map<number, string>();
  private usedIds = new Set<string>();

  generateId(
    elementType: string,
    role: string,
    name: string,
    domPath: DOMPathSignature,
    backendDOMNodeId: number | null,
  ): string {
    const prefix = TYPE_PREFIX_MAP[elementType] ?? "el";

    const compositeKey = [
      elementType,
      role,
      name,
      domPath.nearestLandmarkRole ?? "",
      domPath.nearestLandmarkLabel ?? "",
      domPath.nearestLabelledContainer ?? "",
      String(domPath.siblingIndex),
    ].join("|");

    const hexHash = hashToHex4(compositeKey);
    let candidateId = `${prefix}-${hexHash}`;

    // Collision handling: append disambiguator
    if (this.usedIds.has(candidateId)) {
      let disambiguator = 2;
      while (this.usedIds.has(`${candidateId}-${disambiguator}`)) {
        disambiguator++;
      }
      candidateId = `${candidateId}-${disambiguator}`;
    }

    this.usedIds.add(candidateId);

    if (backendDOMNodeId !== null) {
      this.idToBackendNodeId.set(candidateId, backendDOMNodeId);
      this.backendNodeIdToId.set(backendDOMNodeId, candidateId);
    }

    return candidateId;
  }

  resolveId(elementId: string): number | null {
    return this.idToBackendNodeId.get(elementId) ?? null;
  }

  getIdForBackendNode(backendDOMNodeId: number): string | null {
    return this.backendNodeIdToId.get(backendDOMNodeId) ?? null;
  }

  findSimilar(
    elementId: string,
    currentElements: InteractiveElement[],
  ): InteractiveElement | null {
    // Extract type prefix from the missing ID
    const dashIndex = elementId.indexOf("-");
    if (dashIndex === -1) return null;
    const prefix = elementId.substring(0, dashIndex);

    // Find elements with the same prefix (same type)
    const sameType = currentElements.filter((el) =>
      el.id.startsWith(prefix + "-"),
    );

    if (sameType.length === 0) return null;

    // If there's exactly one element of the same type, it's likely the one
    if (sameType.length === 1) return sameType[0];

    // Otherwise, we can't disambiguate — return null
    return null;
  }

  clear(): void {
    this.idToBackendNodeId.clear();
    this.backendNodeIdToId.clear();
    this.usedIds.clear();
  }

  /**
   * Replace the current maps atomically with new data.
   * Used during re-render to swap in new ID mappings without
   * leaving an empty state between clear() and rebuild.
   */
  replaceWith(other: ElementIdGenerator): void {
    this.idToBackendNodeId = new Map(other.idToBackendNodeId);
    this.backendNodeIdToId = new Map(other.backendNodeIdToId);
    this.usedIds = new Set(other.usedIds);
  }
}
