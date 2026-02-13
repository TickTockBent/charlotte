import { describe, it, expect } from "vitest";
import { hashToHex4 } from "../../../src/utils/hash.js";

describe("hashToHex4", () => {
  it("returns a 4-character hex string", () => {
    const result = hashToHex4("test input");
    expect(result).toMatch(/^[0-9a-f]{4}$/);
  });

  it("returns consistent results for the same input", () => {
    const firstResult = hashToHex4("some-element|button|Click Me|main||0");
    const secondResult = hashToHex4("some-element|button|Click Me|main||0");
    expect(firstResult).toBe(secondResult);
  });

  it("returns different results for different inputs", () => {
    const resultA = hashToHex4("button|button|Submit|main||0");
    const resultB = hashToHex4("button|button|Cancel|main||0");
    expect(resultA).not.toBe(resultB);
  });

  it("handles empty string", () => {
    const result = hashToHex4("");
    expect(result).toMatch(/^[0-9a-f]{4}$/);
  });

  it("handles unicode input", () => {
    const result = hashToHex4("button|button|Envoyer 📧|main||0");
    expect(result).toMatch(/^[0-9a-f]{4}$/);
  });
});
