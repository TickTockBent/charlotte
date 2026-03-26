import type { CDPSession } from "puppeteer";
import type { ParsedAXNode } from "./accessibility-extractor.js";
import { isInteractiveRole } from "./accessibility-extractor.js";
import type { ElementIdGenerator } from "./element-id-generator.js";
import { computeDOMPathSignature } from "./dom-path.js";
import type {
  Bounds,
  InteractiveElement,
  InteractiveElementType,
  ElementState,
  FormRepresentation,
} from "../types/page-representation.js";

export const ROLE_TO_ELEMENT_TYPE: Record<string, InteractiveElementType> = {
  button: "button",
  link: "link",
  textbox: "text_input",
  searchbox: "text_input",
  combobox: "select",
  listbox: "select",
  checkbox: "checkbox",
  radio: "radio",
  switch: "toggle",
  slider: "range",
  spinbutton: "range",
  menuitem: "button",
  menuitemcheckbox: "checkbox",
  menuitemradio: "radio",
  tab: "button",
  treeitem: "button",
};

function mapRoleToElementType(role: string): InteractiveElementType {
  return ROLE_TO_ELEMENT_TYPE[role] ?? "button";
}

function extractElementState(node: ParsedAXNode): ElementState {
  const props = node.properties;
  const state: ElementState = {};

  // Only include non-default values to reduce serialization size.
  // Defaults: enabled=true (omit), visible=true (omit), focused=false (omit)
  if (props["disabled"] === true) {
    state.enabled = false;
  }
  // visible defaults to true; overridden to false by bounds check downstream
  if (props["focused"] === true) {
    state.focused = true;
  }
  if (props["checked"] === "true" || props["checked"] === true || props["checked"] === "mixed") {
    state.checked = true;
  }
  if (props["expanded"] !== undefined) {
    state.expanded = props["expanded"] === true;
  }
  if (props["selected"] !== undefined) {
    state.selected = props["selected"] === true;
  }
  if (props["required"] === true) {
    state.required = true;
  }
  if (props["invalid"] !== undefined && props["invalid"] !== "false") {
    state.invalid = true;
  }

  return state;
}

interface ExtractionResult {
  elements: InteractiveElement[];
  forms: FormRepresentation[];
}

export class InteractiveExtractor {
  extractInteractiveElements(
    rootNodes: ParsedAXNode[],
    boundsMap: Map<number, Bounds>,
    idGenerator: ElementIdGenerator,
    frameId?: string,
  ): ExtractionResult {
    const elements: InteractiveElement[] = [];
    const formNodes: ParsedAXNode[] = [];

    const traverse = (node: ParsedAXNode) => {
      if (node.role === "form") {
        formNodes.push(node);
      }

      if (isInteractiveRole(node.role)) {
        const elementType = mapRoleToElementType(node.role);
        const domPath = computeDOMPathSignature(node);
        const elementId = idGenerator.generateId(
          elementType,
          node.role,
          node.name,
          domPath,
          node.backendDOMNodeId,
          frameId,
        );

        let bounds: Bounds | null = null;
        if (node.backendDOMNodeId !== null) {
          bounds = boundsMap.get(node.backendDOMNodeId) ?? null;
        }

        const state = extractElementState(node);

        // If no bounds available or zero-sized, mark as not visible and null out bounds
        if (!bounds || (bounds.w === 0 && bounds.h === 0)) {
          state.visible = false;
          bounds = null;
        }

        const element: InteractiveElement = {
          id: elementId,
          type: elementType,
          label: node.name || node.description || "",
          bounds,
          state,
        };

        // Add type-specific fields
        if (elementType === "link") {
          element.href = node.value ?? undefined;
        }

        if (
          elementType === "text_input" ||
          elementType === "textarea" ||
          elementType === "select"
        ) {
          element.value = node.value ?? "";
        }

        // Extract options for select/combobox from children (capped to avoid bloat)
        if (elementType === "select") {
          const maxOptions = 50;
          const options: string[] = [];
          let totalCount = 0;
          const collectOptions = (optionNode: ParsedAXNode) => {
            if (optionNode.role === "option" || optionNode.role === "listitem") {
              totalCount++;
              if (options.length < maxOptions) {
                options.push(optionNode.name || optionNode.value || "");
              }
            }
            for (const child of optionNode.children) {
              collectOptions(child);
            }
          };
          for (const child of node.children) {
            collectOptions(child);
          }
          if (options.length > 0) {
            if (totalCount > maxOptions) {
              options.push(`... and ${totalCount - maxOptions} more options`);
            }
            element.options = options;
          }
        }

        elements.push(element);
      }

      for (const child of node.children) {
        traverse(child);
      }
    };

    for (const root of rootNodes) {
      traverse(root);
    }

    // Build form representations
    const forms = this.buildFormRepresentations(formNodes, elements, idGenerator, boundsMap, frameId);

    return { elements, forms };
  }

  private buildFormRepresentations(
    formNodes: ParsedAXNode[],
    interactiveElements: InteractiveElement[],
    idGenerator: ElementIdGenerator,
    _boundsMap: Map<number, Bounds>,
    frameId?: string,
  ): FormRepresentation[] {
    const forms: FormRepresentation[] = [];

    for (const formNode of formNodes) {
      const domPath = computeDOMPathSignature(formNode);
      const formId = idGenerator.generateId(
        "form",
        formNode.role,
        formNode.name,
        domPath,
        formNode.backendDOMNodeId,
        frameId,
      );

      // Collect IDs of interactive elements that are descendants of this form
      const formFieldIds: string[] = [];
      let submitButtonId: string | null = null;

      const collectFields = (node: ParsedAXNode) => {
        if (isInteractiveRole(node.role)) {
          // Find the matching interactive element by backendDOMNodeId
          const matchingElement = interactiveElements.find((el) => {
            if (node.backendDOMNodeId === null) return false;
            const resolvedId = idGenerator.resolveId(el.id);
            if (resolvedId === null) return false;
            return resolvedId === node.backendDOMNodeId;
          });

          if (matchingElement) {
            if (
              node.role === "button" &&
              (node.properties["type"] === "submit" || node.name?.toLowerCase().includes("submit"))
            ) {
              submitButtonId = matchingElement.id;
            } else {
              formFieldIds.push(matchingElement.id);
            }
          }
        }

        for (const child of node.children) {
          collectFields(child);
        }
      };

      for (const child of formNode.children) {
        collectFields(child);
      }

      forms.push({
        id: formId,
        fields: formFieldIds,
        submit: submitButtonId,
      });
    }

    return forms;
  }
}

/**
 * Post-extraction step: reclassify button-typed elements that are actually
 * `<input type="file">` in the DOM. The AX tree represents file inputs as
 * buttons, so we check the underlying DOM node via CDP.
 */
export async function reclassifyFileInputs(
  elements: InteractiveElement[],
  session: CDPSession,
  idGenerator: ElementIdGenerator,
): Promise<void> {
  for (const element of elements) {
    if (element.type !== "button") continue;
    const backendNodeId = idGenerator.resolveId(element.id);
    if (backendNodeId === null) continue;
    try {
      const { node } = await session.send("DOM.describeNode", { backendNodeId });
      if (node.nodeName === "INPUT") {
        const attrs = node.attributes ?? [];
        for (let i = 0; i < attrs.length; i += 2) {
          if (attrs[i] === "type" && attrs[i + 1] === "file") {
            element.type = "file_input";
            break;
          }
        }
      }
    } catch {
      // Node may have been detached — skip
    }
  }
}
