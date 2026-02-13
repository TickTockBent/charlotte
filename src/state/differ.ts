import type {
  PageRepresentation,
  Landmark,
  Heading,
  InteractiveElement,
  FormRepresentation,
  Bounds,
  ElementState,
} from "../types/page-representation.js";
import type { DiffChange, SnapshotDiff } from "../types/snapshot.js";

export type DiffScope = "all" | "structure" | "interactive" | "content";

/**
 * Compare two PageRepresentations and produce a SnapshotDiff describing
 * what changed between them.
 */
export function diffRepresentations(
  fromRepresentation: PageRepresentation,
  toRepresentation: PageRepresentation,
  fromSnapshotId: number,
  toSnapshotId: number,
  scope: DiffScope = "all",
): SnapshotDiff {
  const changes: DiffChange[] = [];

  if (scope === "all" || scope === "structure") {
    changes.push(...diffLandmarks(fromRepresentation.structure.landmarks, toRepresentation.structure.landmarks));
    changes.push(...diffHeadings(fromRepresentation.structure.headings, toRepresentation.structure.headings));
  }

  if (scope === "all" || scope === "interactive") {
    changes.push(...diffInteractiveElements(fromRepresentation.interactive, toRepresentation.interactive));
    changes.push(...diffForms(fromRepresentation.forms, toRepresentation.forms));
  }

  if (scope === "all" || scope === "content") {
    changes.push(...diffContent(fromRepresentation, toRepresentation));
  }

  const summary = buildSummary(changes);

  return {
    from_snapshot: fromSnapshotId,
    to_snapshot: toSnapshotId,
    changes,
    summary,
  };
}

// ─── Landmark diffing ────────────────────────────────────────────────

function landmarkKey(landmark: Landmark): string {
  return `${landmark.role}:${landmark.label}`;
}

function diffLandmarks(fromLandmarks: Landmark[], toLandmarks: Landmark[]): DiffChange[] {
  const changes: DiffChange[] = [];
  const fromByKey = new Map(fromLandmarks.map((landmark) => [landmarkKey(landmark), landmark]));
  const toByKey = new Map(toLandmarks.map((landmark) => [landmarkKey(landmark), landmark]));

  // Removed landmarks
  for (const [key, landmark] of fromByKey) {
    if (!toByKey.has(key)) {
      changes.push({
        type: "removed",
        detail: `Landmark removed: ${landmark.role} "${landmark.label}"`,
      });
    }
  }

  // Added landmarks
  for (const [key, landmark] of toByKey) {
    if (!fromByKey.has(key)) {
      changes.push({
        type: "added",
        detail: `Landmark added: ${landmark.role} "${landmark.label}"`,
      });
    }
  }

  // Moved landmarks (same key, different bounds)
  for (const [key, toLandmark] of toByKey) {
    const fromLandmark = fromByKey.get(key);
    if (fromLandmark && !boundsEqual(fromLandmark.bounds, toLandmark.bounds)) {
      changes.push({
        type: "moved",
        detail: `Landmark moved: ${toLandmark.role} "${toLandmark.label}"`,
        from: fromLandmark.bounds,
        to: toLandmark.bounds,
      });
    }
  }

  return changes;
}

// ─── Heading diffing ─────────────────────────────────────────────────

function diffHeadings(fromHeadings: Heading[], toHeadings: Heading[]): DiffChange[] {
  const changes: DiffChange[] = [];
  const fromById = new Map(fromHeadings.map((heading) => [heading.id, heading]));
  const toById = new Map(toHeadings.map((heading) => [heading.id, heading]));

  for (const [headingId, heading] of fromById) {
    if (!toById.has(headingId)) {
      changes.push({
        type: "removed",
        element: headingId,
        detail: `Heading removed: h${heading.level} "${heading.text}"`,
      });
    }
  }

  for (const [headingId, heading] of toById) {
    if (!fromById.has(headingId)) {
      changes.push({
        type: "added",
        element: headingId,
        detail: `Heading added: h${heading.level} "${heading.text}"`,
      });
    } else {
      const fromHeading = fromById.get(headingId)!;
      if (fromHeading.text !== heading.text) {
        changes.push({
          type: "changed",
          element: headingId,
          property: "text",
          from: fromHeading.text,
          to: heading.text,
        });
      }
    }
  }

  return changes;
}

// ─── Interactive element diffing ─────────────────────────────────────

function diffInteractiveElements(
  fromElements: InteractiveElement[],
  toElements: InteractiveElement[],
): DiffChange[] {
  const changes: DiffChange[] = [];
  const fromById = new Map(fromElements.map((element) => [element.id, element]));
  const toById = new Map(toElements.map((element) => [element.id, element]));

  // Removed elements
  for (const [elementId, element] of fromById) {
    if (!toById.has(elementId)) {
      changes.push({
        type: "removed",
        element: elementId,
        detail: `${element.type} "${element.label}" removed`,
      });
    }
  }

  // Added elements
  for (const [elementId, element] of toById) {
    if (!fromById.has(elementId)) {
      changes.push({
        type: "added",
        element: elementId,
        detail: `${element.type} "${element.label}" added`,
      });
    }
  }

  // Changed/moved elements
  for (const [elementId, toElement] of toById) {
    const fromElement = fromById.get(elementId);
    if (!fromElement) continue;

    // Check bounds change (moved)
    if (
      fromElement.bounds &&
      toElement.bounds &&
      !boundsEqual(fromElement.bounds, toElement.bounds)
    ) {
      changes.push({
        type: "moved",
        element: elementId,
        from: fromElement.bounds,
        to: toElement.bounds,
      });
    }

    // Check state changes
    const stateChanges = diffElementState(fromElement.state, toElement.state);
    for (const stateChange of stateChanges) {
      changes.push({
        type: "changed",
        element: elementId,
        property: `state.${stateChange.property}`,
        from: stateChange.from,
        to: stateChange.to,
      });
    }

    // Check value change
    if (fromElement.value !== toElement.value) {
      changes.push({
        type: "changed",
        element: elementId,
        property: "value",
        from: fromElement.value,
        to: toElement.value,
      });
    }

    // Check label change
    if (fromElement.label !== toElement.label) {
      changes.push({
        type: "changed",
        element: elementId,
        property: "label",
        from: fromElement.label,
        to: toElement.label,
      });
    }
  }

  return changes;
}

// ─── Element state diffing ───────────────────────────────────────────

interface StatePropertyChange {
  property: string;
  from: unknown;
  to: unknown;
}

function diffElementState(
  fromState: ElementState,
  toState: ElementState,
): StatePropertyChange[] {
  const statePropertyChanges: StatePropertyChange[] = [];
  const stateProperties: (keyof ElementState)[] = [
    "enabled",
    "visible",
    "focused",
    "checked",
    "expanded",
    "selected",
    "required",
    "invalid",
  ];

  for (const property of stateProperties) {
    if (fromState[property] !== toState[property]) {
      statePropertyChanges.push({
        property,
        from: fromState[property],
        to: toState[property],
      });
    }
  }

  return statePropertyChanges;
}

// ─── Form diffing ────────────────────────────────────────────────────

function diffForms(
  fromForms: FormRepresentation[],
  toForms: FormRepresentation[],
): DiffChange[] {
  const changes: DiffChange[] = [];
  const fromById = new Map(fromForms.map((form) => [form.id, form]));
  const toById = new Map(toForms.map((form) => [form.id, form]));

  for (const [formId, form] of fromById) {
    if (!toById.has(formId)) {
      changes.push({
        type: "removed",
        element: formId,
        detail: `Form removed (${form.fields.length} fields)`,
      });
    }
  }

  for (const [formId, form] of toById) {
    if (!fromById.has(formId)) {
      changes.push({
        type: "added",
        element: formId,
        detail: `Form added (${form.fields.length} fields)`,
      });
    } else {
      const fromForm = fromById.get(formId)!;
      // Check field list changes
      const addedFields = form.fields.filter((field) => !fromForm.fields.includes(field));
      const removedFields = fromForm.fields.filter((field) => !form.fields.includes(field));

      if (addedFields.length > 0 || removedFields.length > 0) {
        changes.push({
          type: "changed",
          element: formId,
          property: "fields",
          from: fromForm.fields,
          to: form.fields,
        });
      }
    }
  }

  return changes;
}

// ─── Content diffing ─────────────────────────────────────────────────

function diffContent(
  fromRepresentation: PageRepresentation,
  toRepresentation: PageRepresentation,
): DiffChange[] {
  const changes: DiffChange[] = [];

  if (fromRepresentation.structure.content_summary !== toRepresentation.structure.content_summary) {
    changes.push({
      type: "changed",
      property: "content_summary",
      from: fromRepresentation.structure.content_summary,
      to: toRepresentation.structure.content_summary,
    });
  }

  if (fromRepresentation.url !== toRepresentation.url) {
    changes.push({
      type: "changed",
      property: "url",
      from: fromRepresentation.url,
      to: toRepresentation.url,
    });
  }

  if (fromRepresentation.title !== toRepresentation.title) {
    changes.push({
      type: "changed",
      property: "title",
      from: fromRepresentation.title,
      to: toRepresentation.title,
    });
  }

  return changes;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function boundsEqual(boundsA: Bounds, boundsB: Bounds): boolean {
  return (
    boundsA.x === boundsB.x &&
    boundsA.y === boundsB.y &&
    boundsA.w === boundsB.w &&
    boundsA.h === boundsB.h
  );
}

function buildSummary(changes: DiffChange[]): string {
  if (changes.length === 0) return "No changes detected.";

  const addedCount = changes.filter((change) => change.type === "added").length;
  const removedCount = changes.filter((change) => change.type === "removed").length;
  const movedCount = changes.filter((change) => change.type === "moved").length;
  const changedCount = changes.filter((change) => change.type === "changed").length;

  const parts: string[] = [];
  if (addedCount > 0) parts.push(`${addedCount} added`);
  if (removedCount > 0) parts.push(`${removedCount} removed`);
  if (movedCount > 0) parts.push(`${movedCount} moved`);
  if (changedCount > 0) parts.push(`${changedCount} changed`);

  return `${changes.length} changes: ${parts.join(", ")}.`;
}
