export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Landmark {
  id: string;
  role: string;
  label: string;
  bounds: Bounds;
  /** Source frame URL. Omitted for main frame. */
  frame?: string;
}

export interface Heading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  id: string;
  /** Source frame URL. Omitted for main frame. */
  frame?: string;
}

export interface ElementState {
  enabled?: boolean;
  visible?: boolean;
  focused?: boolean;
  /** `"mixed"` for tri-state (indeterminate) checkboxes. */
  checked?: boolean | "mixed";
  expanded?: boolean;
  selected?: boolean;
  required?: boolean;
  invalid?: boolean;
}

export type InteractiveElementType =
  | "button"
  | "link"
  | "text_input"
  | "select"
  | "checkbox"
  | "radio"
  | "toggle"
  | "textarea"
  | "file_input"
  | "range"
  | "date_input"
  | "color_input";

export interface InteractiveElement {
  id: string;
  type: InteractiveElementType;
  label: string;
  bounds: Bounds | null;
  state: ElementState;
  href?: string;
  placeholder?: string;
  value?: string;
  options?: string[];
  /** Source frame URL. Omitted for main frame. */
  frame?: string;
}

export interface FormRepresentation {
  id: string;
  action?: string;
  method?: string;
  fields: string[];
  submit: string | null;
  /** Source frame URL. Omitted for main frame. */
  frame?: string;
}

export interface PageStructure {
  landmarks: Landmark[];
  headings: Heading[];
  content_summary?: string;
  full_content?: string;
}

export interface InteractiveSummary {
  total: number;
  /** Counts of interactive element types grouped by containing landmark.
   *  Keys match structure.landmarks format: "role (label)" or just "role".
   *  "(page root)" for elements not inside any landmark. */
  by_landmark: Record<string, Record<string, number>>;
}

export interface ReloadEvent {
  trigger: "file_change";
  files_changed: string[];
  timestamp: string;
}

export interface PendingDialog {
  type: "alert" | "confirm" | "prompt" | "beforeunload";
  message: string;
  default_value?: string; // Only present for "prompt" dialogs
  timestamp: string; // ISO 8601
}

export interface IframeInfo {
  frame_id: string;
  url: string;
  bounds: Bounds | null;
}

/**
 * Describes any output caps that fired while building this representation
 * (issue #188). Present only when something was truncated so a clean page
 * never carries the field.
 */
export interface TruncationInfo {
  /** Set when the interactive element list was capped. */
  interactive?: {
    /** Total interactive elements found before truncation. */
    total: number;
    /** Number actually included in `interactive`. */
    returned: number;
  };
  /** Set when `full_content` text was truncated. */
  full_content?: {
    /** Original character count. */
    total_chars: number;
    /** Character count actually included. */
    returned_chars: number;
  };
  /** Human-readable suggestion for getting the full data. */
  suggestion: string;
}

export interface PageRepresentation {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  snapshot_id: number;
  timestamp: string;
  structure: PageStructure;
  interactive: InteractiveElement[];
  forms: FormRepresentation[];
  errors: {
    console: Array<{ level: string; text: string }>;
    network: Array<{ url: string; status: number; statusText: string }>;
  };
  interactive_summary?: InteractiveSummary;
  iframes?: IframeInfo[];
  reload_event?: ReloadEvent;
  pending_dialog?: PendingDialog;
  /** Tab IDs of pages opened by popups or target="_blank" links since the last tool call. */
  opened_tabs?: string[];
  delta?: import("./snapshot.js").SnapshotDiff;
  /** Present only when an output cap fired during render (issue #188). */
  truncation?: TruncationInfo;
}
