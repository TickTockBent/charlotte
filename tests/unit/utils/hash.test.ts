import { describe, it, expect } from "vitest";
import { hashToHex, HASH_HEX_LENGTH } from "../../../src/utils/hash.js";

describe("hashToHex", () => {
  it("returns a 6-character hex string", () => {
    expect(HASH_HEX_LENGTH).toBe(6);
    const result = hashToHex("test input");
    expect(result).toMatch(/^[0-9a-f]{6}$/);
  });

  it("returns consistent results for the same input", () => {
    const firstResult = hashToHex("some-element|button|Click Me|main||0");
    const secondResult = hashToHex("some-element|button|Click Me|main||0");
    expect(firstResult).toBe(secondResult);
  });

  it("returns different results for different inputs", () => {
    const resultA = hashToHex("button|button|Submit|main||0");
    const resultB = hashToHex("button|button|Cancel|main||0");
    expect(resultA).not.toBe(resultB);
  });

  it("salting the disambiguator changes the hash", () => {
    const base = hashToHex("button|button|Submit|main||0");
    const salted = hashToHex("button|button|Submit|main||0#2");
    expect(salted).not.toBe(base);
  });

  it("handles empty string", () => {
    const result = hashToHex("");
    expect(result).toMatch(/^[0-9a-f]{6}$/);
  });

  it("handles unicode input", () => {
    const result = hashToHex("button|button|Envoyer 📧|main||0");
    expect(result).toMatch(/^[0-9a-f]{6}$/);
  });
});
