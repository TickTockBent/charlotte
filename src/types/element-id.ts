export const TYPE_PREFIX_MAP: Record<string, string> = {
  button: "btn",
  text_input: "inp",
  link: "lnk",
  select: "sel",
  checkbox: "chk",
  radio: "rad",
  toggle: "tog",
  textarea: "inp",
  file_input: "inp",
  range: "inp",
  date_input: "inp",
  color_input: "inp",
  static_text: "txt",
  form: "frm",
  region: "rgn",
  heading: "hdg",
};

export interface DOMPathSignature {
  nearestLandmarkRole: string | null;
  nearestLandmarkLabel: string | null;
  nearestLabelledContainer: string | null;
  siblingIndex: number;
}
