export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Landmark {
  role: string;
  label: string;
  bounds: Bounds;
}

export interface Heading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  id: string;
}

export interface ElementState {
  enabled?: boolean;
  visible?: boolean;
  focused?: boolean;
  checked?: boolean;
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
}

export interface FormRepresentation {
  id: string;
  action?: string;
  method?: string;
  fields: string[];
  submit: string | null;
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
  reload_event?: ReloadEvent;
  delta?: import("./snapshot.js").SnapshotDiff;
}
