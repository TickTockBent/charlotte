import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  resolveOutputPath,
  writeOutputFile,
  writeBinaryOutputFile,
} from "../../../src/tools/tool-helpers.js";
import type { CharlotteConfig } from "../../../src/types/config.js";
import { createDefaultConfig } from "../../../src/types/config.js";
import { parseCliArgs } from "../../../src/cli.js";

describe("file output helpers", () => {
  let tmpDir: string;
  let config: CharlotteConfig;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "charlotte-test-"));
    config = createDefaultConfig();
    config.outputDir = tmpDir;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("resolveOutputPath", () => {
    it("resolves relative paths against outputDir", async () => {
      const result = await resolveOutputPath("page.json", config);
      expect(result).toBe(path.join(tmpDir, "page.json"));
    });

    it("preserves absolute paths", async () => {
      const absPath = path.join(tmpDir, "subdir", "absolute.json");
      const result = await resolveOutputPath(absPath, config);
      expect(result).toBe(absPath);
    });

    it("creates parent directories for nested relative paths", async () => {
      const result = await resolveOutputPath("sub/dir/file.json", config);
      expect(result).toBe(path.join(tmpDir, "sub", "dir", "file.json"));

      // Parent dir should exist
      const stat = await fs.stat(path.join(tmpDir, "sub", "dir"));
      expect(stat.isDirectory()).toBe(true);
    });

    it("falls back to cwd when outputDir is not set", async () => {
      delete config.outputDir;
      const result = await resolveOutputPath("file.json", config);
      expect(result).toBe(path.resolve(process.cwd(), "file.json"));
    });
  });

  describe("writeOutputFile", () => {
    it("writes text content and returns path + size", async () => {
      const filePath = path.join(tmpDir, "output.json");
      const content = JSON.stringify({ hello: "world" });

      const result = await writeOutputFile(filePath, content);
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.output_file).toBe(filePath);
      expect(parsed.size).toBe(Buffer.byteLength(content, "utf-8"));

      // Verify file on disk
      const onDisk = await fs.readFile(filePath, "utf-8");
      expect(onDisk).toBe(content);
    });
  });

  describe("writeBinaryOutputFile", () => {
    it("writes binary content and returns path + size", async () => {
      const filePath = path.join(tmpDir, "screenshot.png");
      const data = Buffer.from("fake-png-data");

      const result = await writeBinaryOutputFile(filePath, data);
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.output_file).toBe(filePath);
      expect(parsed.size).toBe(data.length);

      // Verify file on disk
      const onDisk = await fs.readFile(filePath);
      expect(onDisk.equals(data)).toBe(true);
    });
  });
});

describe("parseCliArgs --output-dir", () => {

  it("parses --output-dir with no other args", () => {
    const result = parseCliArgs(["--output-dir=/tmp/output"]);
    expect(result.outputDir).toBe("/tmp/output");
  });

  it("combines with --profile", () => {
    const result = parseCliArgs(["--profile=browse", "--output-dir=/tmp/output"]);
    expect(result.profile).toBe("browse");
    expect(result.outputDir).toBe("/tmp/output");
  });

  it("combines with --tools", () => {
    const result = parseCliArgs(["--tools=navigation", "--output-dir=/tmp/output"]);
    expect(result.toolGroups).toEqual(["navigation"]);
    expect(result.outputDir).toBe("/tmp/output");
  });

  it("returns undefined outputDir when not specified", () => {
    const result = parseCliArgs([]);
    expect(result.outputDir).toBeUndefined();
  });
});
