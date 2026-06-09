import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  loadConfigFile,
  parseConfigContent,
  readEnvInputs,
  ConfigError,
  DEFAULT_CONFIG_FILENAME,
} from "../../../src/config/load-config.js";

describe("parseConfigContent (issue #19)", () => {
  it("parses a valid config", () => {
    const result = parseConfigContent(
      JSON.stringify({ browser: { headless: false }, snapshot: { depth: 10 } }),
      "test.json",
    );
    expect(result.browser?.headless).toBe(false);
    expect(result.snapshot?.depth).toBe(10);
  });

  it("accepts an empty object", () => {
    expect(parseConfigContent("{}", "test.json")).toEqual({});
  });

  it("throws ConfigError on malformed JSON", () => {
    expect(() => parseConfigContent("{ not json", "test.json")).toThrow(ConfigError);
  });

  it("throws ConfigError on unknown top-level key (strict)", () => {
    expect(() => parseConfigContent(JSON.stringify({ bogus: true }), "test.json")).toThrow(
      /Invalid config file/,
    );
  });

  it("throws ConfigError on unknown nested key (strict)", () => {
    expect(() =>
      parseConfigContent(JSON.stringify({ browser: { headles: true } }), "test.json"),
    ).toThrow(/Invalid config file/);
  });

  it("throws ConfigError on invalid enum value", () => {
    expect(() =>
      parseConfigContent(JSON.stringify({ tools: { profile: "nope" } }), "test.json"),
    ).toThrow(/Invalid config file/);
  });

  it("throws ConfigError on wrong type", () => {
    expect(() =>
      parseConfigContent(JSON.stringify({ snapshot: { depth: "ten" } }), "test.json"),
    ).toThrow(/Invalid config file/);
  });

  it("rejects non-positive snapshot depth", () => {
    expect(() =>
      parseConfigContent(JSON.stringify({ snapshot: { depth: 0 } }), "test.json"),
    ).toThrow(/Invalid config file/);
  });
});

describe("loadConfigFile (issue #19)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "charlotte-config-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty config when no explicit path and no default file", () => {
    expect(loadConfigFile(undefined, tmpDir)).toEqual({});
  });

  it("loads the default charlotte.config.json from cwd when present", () => {
    writeFileSync(
      path.join(tmpDir, DEFAULT_CONFIG_FILENAME),
      JSON.stringify({ browser: { noSandbox: true } }),
    );
    const result = loadConfigFile(undefined, tmpDir);
    expect(result.browser?.noSandbox).toBe(true);
  });

  it("loads an explicit --config path", () => {
    const custom = path.join(tmpDir, "my.json");
    writeFileSync(custom, JSON.stringify({ tools: { profile: "full" } }));
    const result = loadConfigFile(custom, tmpDir);
    expect(result.tools?.profile).toBe("full");
  });

  it("throws when an explicit --config path does not exist", () => {
    expect(() => loadConfigFile(path.join(tmpDir, "missing.json"), tmpDir)).toThrow(ConfigError);
    expect(() => loadConfigFile(path.join(tmpDir, "missing.json"), tmpDir)).toThrow(/not found/);
  });

  it("throws on invalid content in an explicit file", () => {
    const custom = path.join(tmpDir, "bad.json");
    writeFileSync(custom, JSON.stringify({ unknownKey: 1 }));
    expect(() => loadConfigFile(custom, tmpDir)).toThrow(ConfigError);
  });
});

describe("readEnvInputs (issues #19, #184)", () => {
  it("returns empty inputs for empty env", () => {
    expect(readEnvInputs({})).toEqual({
      noSandbox: undefined,
      outputDir: undefined,
      cdpEndpoint: undefined,
    });
  });

  it("parses CHARLOTTE_NO_SANDBOX=1 as true", () => {
    expect(readEnvInputs({ CHARLOTTE_NO_SANDBOX: "1" }).noSandbox).toBe(true);
  });

  it("parses CHARLOTTE_NO_SANDBOX=true (case-insensitive) as true", () => {
    expect(readEnvInputs({ CHARLOTTE_NO_SANDBOX: "TRUE" }).noSandbox).toBe(true);
  });

  it("parses CHARLOTTE_NO_SANDBOX=0 as false", () => {
    expect(readEnvInputs({ CHARLOTTE_NO_SANDBOX: "0" }).noSandbox).toBe(false);
  });

  it("throws on an unrecognized CHARLOTTE_NO_SANDBOX value", () => {
    expect(() => readEnvInputs({ CHARLOTTE_NO_SANDBOX: "maybe" })).toThrow(ConfigError);
  });

  it("reads CHARLOTTE_OUTPUT_DIR and CHARLOTTE_CDP_ENDPOINT", () => {
    const result = readEnvInputs({
      CHARLOTTE_OUTPUT_DIR: "/tmp/out",
      CHARLOTTE_CDP_ENDPOINT: "http://localhost:9222",
    });
    expect(result.outputDir).toBe("/tmp/out");
    expect(result.cdpEndpoint).toBe("http://localhost:9222");
  });
});
