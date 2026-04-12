import { describe, it, expect } from "vitest";
import { parseCliArgs } from "../../../src/cli.js";

describe("parseCliArgs", () => {
  it("returns defaults when no arguments given (defaults to browse)", () => {
    const result = parseCliArgs([]);
    expect(result).toEqual({ headless: true });
  });

  describe("--profile", () => {
    it("parses --profile=browse", () => {
      const result = parseCliArgs(["--profile=browse"]);
      expect(result).toEqual({ profile: "browse", headless: true });
    });

    it("parses --profile=full", () => {
      const result = parseCliArgs(["--profile=full"]);
      expect(result).toEqual({ profile: "full", headless: true });
    });

    it("parses --profile=core", () => {
      const result = parseCliArgs(["--profile=core"]);
      expect(result).toEqual({ profile: "core", headless: true });
    });

    it("parses --profile=interact", () => {
      const result = parseCliArgs(["--profile=interact"]);
      expect(result).toEqual({ profile: "interact", headless: true });
    });

    it("parses --profile=develop", () => {
      const result = parseCliArgs(["--profile=develop"]);
      expect(result).toEqual({ profile: "develop", headless: true });
    });

    it("parses --profile=audit", () => {
      const result = parseCliArgs(["--profile=audit"]);
      expect(result).toEqual({ profile: "audit", headless: true });
    });

    it("parses space-separated --profile full", () => {
      const result = parseCliArgs(["--profile", "full"]);
      expect(result).toEqual({ profile: "full", headless: true });
    });

    it("parses space-separated --profile core with --no-headless", () => {
      const result = parseCliArgs(["--profile", "core", "--no-headless"]);
      expect(result).toEqual({ profile: "core", headless: false });
    });

    it("throws on invalid profile (space-separated)", () => {
      expect(() => parseCliArgs(["--profile", "invalid"])).toThrow("Invalid profile: invalid");
    });
  });

  describe("--tools", () => {
    it("parses single group", () => {
      const result = parseCliArgs(["--tools=navigation"]);
      expect(result).toEqual({ toolGroups: ["navigation"], headless: true });
    });

    it("parses multiple groups", () => {
      const result = parseCliArgs(["--tools=navigation,observation"]);
      expect(result).toEqual({ toolGroups: ["navigation", "observation"], headless: true });
    });

    it("parses all groups", () => {
      const result = parseCliArgs([
        "--tools=navigation,observation,interaction,session,dev_mode,dialog,evaluate,monitoring",
      ]);
      expect(result.toolGroups).toHaveLength(8);
    });

    it("throws on invalid group", () => {
      expect(() => parseCliArgs(["--tools=invalid"])).toThrow("Invalid tool group: invalid");
    });

    it("throws on trailing comma (empty group name)", () => {
      expect(() => parseCliArgs(["--tools=navigation,"])).toThrow("Invalid tool group: ");
    });

    it("parses space-separated --tools", () => {
      const result = parseCliArgs(["--tools", "navigation,observation"]);
      expect(result).toEqual({ toolGroups: ["navigation", "observation"], headless: true });
    });
  });

  describe("precedence", () => {
    it("--profile takes precedence over --tools", () => {
      const result = parseCliArgs(["--profile=core", "--tools=navigation,observation"]);
      expect(result).toEqual({ profile: "core", headless: true });
      expect(result.toolGroups).toBeUndefined();
    });
  });

  describe("--output-dir", () => {
    it("parses space-separated --output-dir", () => {
      const result = parseCliArgs(["--output-dir", "/tmp/out"]);
      expect(result).toEqual({ outputDir: "/tmp/out", headless: true });
    });
  });

  it("ignores unrecognized arguments", () => {
    const result = parseCliArgs(["--foo=bar", "--verbose"]);
    expect(result).toEqual({ headless: true });
  });

  describe("--cdp-endpoint", () => {
    it("parses --cdp-endpoint with HTTP URL", () => {
      const result = parseCliArgs(["--cdp-endpoint", "http://localhost:9222"]);
      expect(result).toEqual({ cdpEndpoint: "http://localhost:9222", headless: true });
    });

    it("parses --cdp-endpoint with WebSocket URL", () => {
      const result = parseCliArgs(["--cdp-endpoint", "ws://localhost:9222/devtools/browser/abc"]);
      expect(result).toEqual({
        cdpEndpoint: "ws://localhost:9222/devtools/browser/abc",
        headless: true,
      });
    });

    it("parses --cdp-endpoint=value syntax", () => {
      const result = parseCliArgs(["--cdp-endpoint=http://localhost:9222"]);
      expect(result).toEqual({ cdpEndpoint: "http://localhost:9222", headless: true });
    });

    it("combines --cdp-endpoint with --profile", () => {
      const result = parseCliArgs(["--cdp-endpoint", "http://localhost:9222", "--profile=full"]);
      expect(result.cdpEndpoint).toBe("http://localhost:9222");
      expect(result.profile).toBe("full");
    });

    it("combines --cdp-endpoint with --no-headless (headless ignored but parsed)", () => {
      const result = parseCliArgs(["--cdp-endpoint", "http://localhost:9222", "--no-headless"]);
      expect(result.cdpEndpoint).toBe("http://localhost:9222");
      expect(result.headless).toBe(false);
    });
  });
});
