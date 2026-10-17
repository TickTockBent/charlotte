import { describe, it, expect } from "vitest";
import { isTruncatedEntry } from "../../../src/core/interaction-helpers.js";

/** No maxlength attribute: `HTMLInputElement.maxLength` reports -1. */
const NO_MAX_LENGTH = -1;

describe("isTruncatedEntry (#293)", () => {
  it("flags a value cut short after the first keystrokes", () => {
    // The CI failure on #292: "Jane" typed, "J" landed.
    expect(isTruncatedEntry("Jane", "J", NO_MAX_LENGTH)).toBe(true);
    expect(isTruncatedEntry("jane@example.com", "jane@ex", NO_MAX_LENGTH)).toBe(true);
  });

  it("flags a field left empty when text was typed", () => {
    expect(isTruncatedEntry("Doe", "", NO_MAX_LENGTH)).toBe(true);
  });

  it("passes an exact match", () => {
    expect(isTruncatedEntry("Jane", "Jane", NO_MAX_LENGTH)).toBe(false);
  });

  it("passes empty text typed into an empty field", () => {
    expect(isTruncatedEntry("", "", NO_MAX_LENGTH)).toBe(false);
  });

  it("passes a value the field's own maxlength cut short", () => {
    expect(isTruncatedEntry("abcdef", "abc", 3)).toBe(false);
  });

  it("still flags a value shorter than the field's maxlength", () => {
    expect(isTruncatedEntry("abcdef", "ab", 3)).toBe(true);
  });

  it("passes values the page reshaped rather than truncated", () => {
    // Input mask inserting separators.
    expect(isTruncatedEntry("5550100", "555-0100", NO_MAX_LENGTH)).toBe(false);
    // Case transform.
    expect(isTruncatedEntry("Jane", "JANE", NO_MAX_LENGTH)).toBe(false);
    // Typeahead completion.
    expect(isTruncatedEntry("Ja", "Jane Austen", NO_MAX_LENGTH)).toBe(false);
    // Filter dropping a character mid-string.
    expect(isTruncatedEntry("555-0100", "5550100", NO_MAX_LENGTH)).toBe(false);
  });

  it("ignores what native fields drop on their own (line breaks, surrounding whitespace)", () => {
    // <input> never holds line breaks.
    expect(isTruncatedEntry("line1\nline2", "line1line2", NO_MAX_LENGTH)).toBe(false);
    // type=email trims surrounding whitespace.
    expect(isTruncatedEntry(" a@b.co ", "a@b.co", NO_MAX_LENGTH)).toBe(false);
    // Puppeteer types "\r" as Enter, so a textarea gets an extra newline.
    expect(isTruncatedEntry("x\r\ny", "x\n\ny", NO_MAX_LENGTH)).toBe(false);
  });
});
