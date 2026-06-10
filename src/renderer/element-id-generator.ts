import { TYPE_PREFIX_MAP, type DOMPathSignature } from "../types/element-id.js";
import type { InteractiveElement } from "../types/page-representation.js";
import { hashToHex } from "../utils/hash.js";

/**
 * A selector-registered element discovered via charlotte_find's CSS selector
 * mode. These live in a separate map that survives {@link ElementIdGenerator.replaceWith}
 * (which wipes the per-render maps) so the ID keeps working across the renders
 * that every interaction tool triggers. The originating selector is retained so
 * {@link resolveElement} can re-query a fresh backend node ID when the DOM mutates.
 */
export interface DomQueryRegistration {
  backendDOMNodeId: number;
  frameId: string | null;
  /** CSS selector that produced this element. */
  selector: string;
  /** Index of this element within the selector's match list (querySelectorAll order). */
  matchIndex: number;
}

export class ElementIdGenerator {
  private idToBackendNodeId = new Map<string, number>();
  private backendNodeIdToId = new Map<number, string>();
  private idToFrameId = new Map<string, string>();
  private usedIds = new Set<string>();

  /**
   * Durable registrations for selector-mode (`dom-`) IDs. Kept separate from
   * the per-render maps so they persist across replaceWith(). Cleared on
   * navigation via {@link clearDomQueryIds}.
   */
  private domQueryIds = new Map<string, DomQueryRegistration>();

  generateId(
    elementType: string,
    role: string,
    name: string,
    domPath: DOMPathSignature,
    backendDOMNodeId: number | null,
    frameId?: string | null,
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
      frameId ?? "",
    ].join("|");

    const baseId = `${prefix}-${hashToHex(compositeKey)}`;
    let candidateId = baseId;

    // Collision handling: salt the disambiguator into the hash so a suffixed ID
    // never migrates onto the base ID if the base element disappears. Without
    // salting, a traversal-order "-2" suffix would silently become the base ID
    // on a later render, resolving a cached agent ID to the wrong element.
    if (this.usedIds.has(candidateId)) {
      let disambiguator = 2;
      let saltedId = `${prefix}-${hashToHex(`${compositeKey}#${disambiguator}`)}`;
      while (this.usedIds.has(saltedId)) {
        disambiguator++;
        saltedId = `${prefix}-${hashToHex(`${compositeKey}#${disambiguator}`)}`;
      }
      candidateId = saltedId;
    }

    this.usedIds.add(candidateId);

    if (backendDOMNodeId !== null) {
      this.idToBackendNodeId.set(candidateId, backendDOMNodeId);
      this.backendNodeIdToId.set(backendDOMNodeId, candidateId);
    }

    if (frameId) {
      this.idToFrameId.set(candidateId, frameId);
    }

    return candidateId;
  }

  /**
   * Register a selector-mode (`dom-`) element so its ID survives subsequent
   * renders. The originating selector + match index are retained so the
   * element can be re-resolved against the live DOM even after the backend
   * node ID changes.
   */
  registerDomQueryId(elementId: string, registration: DomQueryRegistration): void {
    this.usedIds.add(elementId);
    this.domQueryIds.set(elementId, registration);
    this.idToBackendNodeId.set(elementId, registration.backendDOMNodeId);
    this.backendNodeIdToId.set(registration.backendDOMNodeId, elementId);
    if (registration.frameId) {
      this.idToFrameId.set(elementId, registration.frameId);
    }
  }

  /** Look up a durable selector-mode registration, or null if none exists. */
  getDomQueryRegistration(elementId: string): DomQueryRegistration | null {
    return this.domQueryIds.get(elementId) ?? null;
  }

  /**
   * Drop all selector-mode registrations. Called on navigation, where the
   * previous document (and therefore its DOM nodes) is gone.
   */
  clearDomQueryIds(): void {
    this.domQueryIds.clear();
  }

  resolveId(elementId: string): number | null {
    return this.idToBackendNodeId.get(elementId) ?? null;
  }

  /** Returns the CDP frame ID for an element, or null if it belongs to the main frame. */
  resolveFrame(elementId: string): string | null {
    return this.idToFrameId.get(elementId) ?? null;
  }

  getIdForBackendNode(backendDOMNodeId: number): string | null {
    return this.backendNodeIdToId.get(backendDOMNodeId) ?? null;
  }

  /**
   * Re-key an element ID with a new type prefix, preserving the hash and any
   * disambiguator suffix. Used when a post-extraction step reclassifies an
   * element's type (e.g. a button that is actually `<input type="file">`) so
   * the ID prefix stays consistent with TYPE_PREFIX_MAP (prefix-based reasoning
   * and findSimilar both rely on it). Returns the new ID, or the original if it
   * has no prefix or already uses the requested one.
   */
  reassignPrefix(elementId: string, newPrefix: string): string {
    const dashIndex = elementId.indexOf("-");
    if (dashIndex === -1) return elementId;
    const currentPrefix = elementId.substring(0, dashIndex);
    if (currentPrefix === newPrefix) return elementId;

    const newId = `${newPrefix}${elementId.substring(dashIndex)}`;

    const backendNodeId = this.idToBackendNodeId.get(elementId);
    if (backendNodeId !== undefined) {
      this.idToBackendNodeId.delete(elementId);
      this.idToBackendNodeId.set(newId, backendNodeId);
      this.backendNodeIdToId.set(backendNodeId, newId);
    }

    const frameId = this.idToFrameId.get(elementId);
    if (frameId !== undefined) {
      this.idToFrameId.delete(elementId);
      this.idToFrameId.set(newId, frameId);
    }

    this.usedIds.delete(elementId);
    this.usedIds.add(newId);

    return newId;
  }

  findSimilar(elementId: string, currentElements: InteractiveElement[]): InteractiveElement | null {
    // Extract type prefix from the missing ID
    const dashIndex = elementId.indexOf("-");
    if (dashIndex === -1) return null;
    const prefix = elementId.substring(0, dashIndex);

    // Find elements with the same prefix (same type)
    const sameType = currentElements.filter((el) => el.id.startsWith(prefix + "-"));

    if (sameType.length === 0) return null;

    // If there's exactly one element of the same type, it's likely the one
    if (sameType.length === 1) return sameType[0];

    // Otherwise, we can't disambiguate — return null
    return null;
  }

  clear(): void {
    this.idToBackendNodeId.clear();
    this.backendNodeIdToId.clear();
    this.idToFrameId.clear();
    this.usedIds.clear();
    this.domQueryIds.clear();
  }

  /**
   * Replace the current maps atomically with new data.
   * Used during re-render to swap in new ID mappings without
   * leaving an empty state between clear() and rebuild.
   *
   * Durable selector-mode (`dom-`) registrations are NOT discarded — they are
   * carried over and re-merged so a `dom-` ID keeps resolving across the render
   * that every interaction tool triggers. They are only dropped on navigation
   * via {@link clearDomQueryIds}.
   */
  replaceWith(other: ElementIdGenerator): void {
    this.idToBackendNodeId = new Map(other.idToBackendNodeId);
    this.backendNodeIdToId = new Map(other.backendNodeIdToId);
    this.idToFrameId = new Map(other.idToFrameId);
    this.usedIds = new Set(other.usedIds);

    // Re-merge surviving selector-mode registrations. The fresh render's AX
    // tree does not contain selector-only elements, so without this they would
    // be lost on the very next render (the original single-use bug).
    for (const [elementId, registration] of this.domQueryIds) {
      this.usedIds.add(elementId);
      this.idToBackendNodeId.set(elementId, registration.backendDOMNodeId);
      this.backendNodeIdToId.set(registration.backendDOMNodeId, elementId);
      if (registration.frameId) {
        this.idToFrameId.set(elementId, registration.frameId);
      }
    }
  }
}
