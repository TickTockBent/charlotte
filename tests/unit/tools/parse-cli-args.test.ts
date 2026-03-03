import { describe, it, expect } from "vitest";
import { parseCliArgs } from "../../../src/cli.js";

describe("parseCliArgs", () => {
  it("returns empty object when no arguments given (defaults to browse)", () => {
    const result = parseCliArgs([]);
    expect(result).toEqual({});
  });

  describe("--profile", () => {
    it("parses --profile=browse", () => {
      const result = parseCliArgs(["--profile=browse"]);
      expect(result).toEqual({ profile: "browse" });
    });

    it("parses --profile=full", () => {
      const result = parseCliArgs(["--profile=full"]);
      expect(result).toEqual({ profile: "full" });
    });

    it("parses --profile=core", () => {
      const result = parseCliArgs(["--profile=core"]);
      expect(result).toEqual({ profile: "core" });
    });

    it("parses --profile=interact", () => {
      const result = parseCliArgs(["--profile=interact"]);
      expect(result).toEqual({ profile: "interact" });
    });

    it("parses --profile=develop", () => {
      const result = parseCliArgs(["--profile=develop"]);
      expect(result).toEqual({ profile: "develop" });
    });

    it("parses --profile=audit", () => {
      const result = parseCliArgs(["--profile=audit"]);
      expect(result).toEqual({ profile: "audit" });
    });

    it("throws on invalid profile", () => {
      expect(() => parseCliArgs(["--profile=invalid"])).toThrow(
        "Invalid profile: invalid",
      );
    });
  });

  describe("--tools", () => {
    it("parses single group", () => {
      const result = parseCliArgs(["--tools=navigation"]);
      expect(result).toEqual({ toolGroups: ["navigation"] });
    });

    it("parses multiple groups", () => {
      const result = parseCliArgs(["--tools=navigation,observation"]);
      expect(result).toEqual({ toolGroups: ["navigation", "observation"] });
    });

    it("parses all groups", () => {
      const result = parseCliArgs([
        "--tools=navigation,observation,interaction,session,dev_mode,dialog,evaluate,monitoring",
      ]);
      expect(result.toolGroups).toHaveLength(8);
    });

    it("throws on invalid group", () => {
      expect(() => parseCliArgs(["--tools=invalid"])).toThrow(
        "Invalid tool group: invalid",
      );
    });

    it("throws on trailing comma (empty group name)", () => {
      expect(() => parseCliArgs(["--tools=navigation,"])).toThrow(
        "Invalid tool group: ",
      );
    });
  });

  describe("precedence", () => {
    it("--profile takes precedence over --tools", () => {
      const result = parseCliArgs([
        "--profile=core",
        "--tools=navigation,observation",
      ]);
      expect(result).toEqual({ profile: "core" });
      expect(result.toolGroups).toBeUndefined();
    });
  });

  it("ignores unrecognized arguments", () => {
    const result = parseCliArgs(["--foo=bar", "--verbose"]);
    expect(result).toEqual({});
  });
});
