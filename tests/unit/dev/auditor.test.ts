import { describe, it, expect } from "vitest";
import {
  relativeLuminance,
  contrastRatio,
  parseRgbColor,
  isPrivateOrInternalIp,
  isInternalUrl,
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
      expect(parseRgbColor("rgba(100, 200, 50, 0.5)")).toEqual([100, 200, 50]);
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

  describe("isPrivateOrInternalIp (SSRF filter)", () => {
    it("identifies loopback addresses", () => {
      expect(isPrivateOrInternalIp("127.0.0.1")).toBe(true);
      expect(isPrivateOrInternalIp("127.255.255.255")).toBe(true);
    });

    it("identifies IPv6 loopback", () => {
      expect(isPrivateOrInternalIp("::1")).toBe(true);
    });

    it("identifies private Class A (10.x.x.x)", () => {
      expect(isPrivateOrInternalIp("10.0.0.1")).toBe(true);
      expect(isPrivateOrInternalIp("10.255.255.255")).toBe(true);
    });

    it("identifies private Class B (172.16-31.x.x)", () => {
      expect(isPrivateOrInternalIp("172.16.0.1")).toBe(true);
      expect(isPrivateOrInternalIp("172.31.255.255")).toBe(true);
      // Just outside Class B range
      expect(isPrivateOrInternalIp("172.15.255.255")).toBe(false);
      expect(isPrivateOrInternalIp("172.32.0.0")).toBe(false);
    });

    it("identifies private Class C (192.168.x.x)", () => {
      expect(isPrivateOrInternalIp("192.168.1.1")).toBe(true);
      // Outside Class C range
      expect(isPrivateOrInternalIp("192.169.1.1")).toBe(false);
    });

    it("identifies link-local / IMDS (169.254.x.x)", () => {
      expect(isPrivateOrInternalIp("169.254.169.254")).toBe(true);
      expect(isPrivateOrInternalIp("169.254.0.1")).toBe(true);
    });

    it("allows public IP addresses", () => {
      expect(isPrivateOrInternalIp("8.8.8.8")).toBe(false);
      expect(isPrivateOrInternalIp("1.1.1.1")).toBe(false);
      expect(isPrivateOrInternalIp("93.184.216.34")).toBe(false);
    });

    it("returns false for invalid IP strings (not an IPv4 address)", () => {
      expect(isPrivateOrInternalIp("not-an-ip")).toBe(false);
      expect(isPrivateOrInternalIp("")).toBe(false);
    });
  });

  describe("isInternalUrl (SSRF filter)", () => {
    it("identifies localhost URLs", async () => {
      expect(await isInternalUrl("http://localhost/api")).toBe(true);
      expect(await isInternalUrl("http://localhost:8080/")).toBe(true);
    });

    it("identifies URLs with loopback IP", async () => {
      expect(await isInternalUrl("http://127.0.0.1/")).toBe(true);
      expect(await isInternalUrl("http://127.0.0.1:9200/")).toBe(true);
    });

    it("identifies AWS IMDS URL", async () => {
      expect(await isInternalUrl("http://169.254.169.254/latest/meta-data")).toBe(true);
    });

    it("identifies private network URLs", async () => {
      expect(await isInternalUrl("http://192.168.1.1/admin")).toBe(true);
      expect(await isInternalUrl("http://10.0.0.1/")).toBe(true);
    });

    it("allows public URLs", async () => {
      expect(await isInternalUrl("https://example.com/")).toBe(false);
      expect(await isInternalUrl("https://8.8.8.8/")).toBe(false);
    });

    it("returns false for malformed URLs", async () => {
      expect(await isInternalUrl("not a url")).toBe(false);
      expect(await isInternalUrl("")).toBe(false);
    });
  });
});
