import { describe, it, expect } from "vitest";
import { coercedBoolean } from "../../../src/tools/tool-helpers.js";

describe("coercedBoolean", () => {
  it("accepts native true", () => {
    expect(coercedBoolean.parse(true)).toBe(true);
  });

  it("accepts native false", () => {
    expect(coercedBoolean.parse(false)).toBe(false);
  });

  it('coerces string "true" to true', () => {
    expect(coercedBoolean.parse("true")).toBe(true);
  });

  it('coerces string "false" to false', () => {
    expect(coercedBoolean.parse("false")).toBe(false);
  });

  it("rejects other strings", () => {
    expect(() => coercedBoolean.parse("yes")).toThrow();
    expect(() => coercedBoolean.parse("1")).toThrow();
    expect(() => coercedBoolean.parse("")).toThrow();
  });

  it("rejects numbers", () => {
    expect(() => coercedBoolean.parse(1)).toThrow();
    expect(() => coercedBoolean.parse(0)).toThrow();
  });

  it("works with .optional()", () => {
    const optionalSchema = coercedBoolean.optional();
    expect(optionalSchema.parse(undefined)).toBeUndefined();
    expect(optionalSchema.parse(true)).toBe(true);
    expect(optionalSchema.parse("true")).toBe(true);
  });
});
