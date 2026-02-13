import { describe, it, expect } from "vitest";
import {
  relativeLuminance,
  contrastRatio,
  parseRgbColor,
} from "../../../src/dev/auditor.js";

describe("Auditor utilities", () => {
  describe("relativeLuminance", () => {
    it("returns 0 for black", () => {
      expect(relativeLuminance(0, 0, 0)).toBe(0);
    });

    it("returns 1 for white", () => {
      expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 4);
    });

    it("returns correct luminance for mid-gray", () => {
      const luminance = relativeLuminance(128, 128, 128);
      expect(luminance).toBeGreaterThan(0.2);
      expect(luminance).toBeLessThan(0.3);
    });
  });

  describe("contrastRatio", () => {
    it("returns 21:1 for black on white", () => {
      const ratio = contrastRatio([0, 0, 0], [255, 255, 255]);
      expect(ratio).toBeCloseTo(21, 0);
    });

    it("returns 1:1 for same colors", () => {
      const ratio = contrastRatio([128, 128, 128], [128, 128, 128]);
      expect(ratio).toBeCloseTo(1, 1);
    });

    it("order does not matter (lighter/darker auto-detected)", () => {
      const ratioA = contrastRatio([0, 0, 0], [255, 255, 255]);
      const ratioB = contrastRatio([255, 255, 255], [0, 0, 0]);
      expect(ratioA).toBeCloseTo(ratioB, 4);
    });

    it("detects low contrast", () => {
      // Light gray on white
      const ratio = contrastRatio([204, 204, 204], [255, 255, 255]);
      expect(ratio).toBeLessThan(4.5); // Fails WCAG AA for normal text
    });

    it("detects sufficient contrast", () => {
      // Dark gray on white
      const ratio = contrastRatio([51, 51, 51], [255, 255, 255]);
      expect(ratio).toBeGreaterThan(4.5); // Passes WCAG AA
    });
  });

  describe("parseRgbColor", () => {
    it("parses rgb() format", () => {
      expect(parseRgbColor("rgb(255, 0, 128)")).toEqual([255, 0, 128]);
    });

    it("parses rgba() format", () => {
      expect(parseRgbColor("rgba(100, 200, 50, 0.5)")).toEqual([
        100, 200, 50,
      ]);
    });

    it("parses without spaces", () => {
      expect(parseRgbColor("rgb(10,20,30)")).toEqual([10, 20, 30]);
    });

    it("returns null for hex colors", () => {
      expect(parseRgbColor("#ff0000")).toBeNull();
    });

    it("returns null for named colors", () => {
      expect(parseRgbColor("red")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parseRgbColor("")).toBeNull();
    });
  });
});
