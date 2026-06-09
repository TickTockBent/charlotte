import { describe, it, expect } from "vitest";
import { parseCliInputs } from "../../../src/cli.js";

describe("parseCliInputs (issues #19, #184)", () => {
  it("returns empty inputs for no args (everything falls through to defaults)", () => {
    const { cli, configPath } = parseCliInputs([]);
    expect(cli).toEqual({});
    expect(configPath).toBeUndefined();
  });

  it("captures --config path", () => {
    expect(parseCliInputs(["--config", "my.json"]).configPath).toBe("my.json");
    expect(parseCliInputs(["--config=my.json"]).configPath).toBe("my.json");
  });

  it("only sets headless when --no-headless is explicitly passed", () => {
    expect(parseCliInputs([]).cli.headless).toBeUndefined();
    expect(parseCliInputs(["--no-headless"]).cli.headless).toBe(false);
  });

  it("only sets noSandbox when --no-sandbox is explicitly passed", () => {
    expect(parseCliInputs([]).cli.noSandbox).toBeUndefined();
    expect(parseCliInputs(["--no-sandbox"]).cli.noSandbox).toBe(true);
  });

  it("captures profile", () => {
    expect(parseCliInputs(["--profile=full"]).cli.profile).toBe("full");
  });

  it("captures tool groups", () => {
    expect(parseCliInputs(["--tools=navigation,observation"]).cli.toolGroups).toEqual([
      "navigation",
      "observation",
    ]);
  });

  it("throws on invalid profile", () => {
    expect(() => parseCliInputs(["--profile=bogus"])).toThrow("Invalid profile");
  });

  it("throws on invalid cdp endpoint", () => {
    expect(() => parseCliInputs(["--cdp-endpoint=banana"])).toThrow("Invalid --cdp-endpoint");
  });

  it("captures output-dir and cdp-endpoint", () => {
    const { cli } = parseCliInputs([
      "--output-dir",
      "/tmp/o",
      "--cdp-endpoint",
      "http://localhost:9222",
    ]);
    expect(cli.outputDir).toBe("/tmp/o");
    expect(cli.cdpEndpoint).toBe("http://localhost:9222");
  });
});
