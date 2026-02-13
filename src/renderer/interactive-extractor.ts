import type { ParsedAXNode } from "./accessibility-extractor.js";
import { isInteractiveRole } from "./accessibility-extractor.js";
import type { ElementIdGenerator } from "./element-id-generator.js";
import { computeDOMPathSignature } from "./dom-path.js";
import { ZERO_BOUNDS } from "./layout-extractor.js";
import type {
  Bounds,
  InteractiveElement,
  InteractiveElementType,
  ElementState,
  FormRepresentation,
} from "../types/page-representation.js";

const ROLE_TO_ELEMENT_TYPE: Record<string, InteractiveElementType> = {
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
  return {
    enabled: props["disabled"] !== true,
    visible: true, // will be overridden by layout extractor if bounds are zero
    focused: props["focused"] === true,
    checked:
      props["checked"] === "true" || props["checked"] === true
        ? true
        : props["checked"] === "mixed"
          ? true
          : undefined,
    expanded:
      props["expanded"] !== undefined
        ? props["expanded"] === true
        : undefined,
    selected:
      props["selected"] !== undefined
        ? props["selected"] === true
        : undefined,
    required: props["required"] === true ? true : undefined,
    invalid:
      props["invalid"] !== undefined && props["invalid"] !== "false"
        ? true
        : undefined,
  };
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
        );

        let bounds: Bounds | null = null;
        if (node.backendDOMNodeId !== null) {
          bounds = boundsMap.get(node.backendDOMNodeId) ?? null;
        }

        const state = extractElementState(node);

        // If no bounds available, mark as not visible
        if (!bounds || (bounds.w === 0 && bounds.h === 0)) {
          state.visible = false;
        }

        const element: InteractiveElement = {
          id: elementId,
          type: elementType,
          label: node.name || node.description || "",
          bounds: bounds ?? ZERO_BOUNDS,
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

        // Extract options for select/combobox from children
        if (elementType === "select") {
          const options: string[] = [];
          const collectOptions = (optionNode: ParsedAXNode) => {
            if (
              optionNode.role === "option" ||
              optionNode.role === "listitem"
            ) {
              options.push(optionNode.name || optionNode.value || "");
            }
            for (const child of optionNode.children) {
              collectOptions(child);
            }
          };
          for (const child of node.children) {
            collectOptions(child);
          }
          if (options.length > 0) {
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
    const forms = this.buildFormRepresentations(formNodes, elements, idGenerator, boundsMap);

    return { elements, forms };
  }

  private buildFormRepresentations(
    formNodes: ParsedAXNode[],
    interactiveElements: InteractiveElement[],
    idGenerator: ElementIdGenerator,
    boundsMap: Map<number, Bounds>,
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
            return resolvedId === node.backendDOMNodeId;
          });

          if (matchingElement) {
            if (
              node.role === "button" &&
              (node.properties["type"] === "submit" ||
                node.name?.toLowerCase().includes("submit"))
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
