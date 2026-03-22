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
    // Resolve symlinks so assertions match realpath output from resolveOutputPath.
    // On macOS, /var is a symlink to /private/var — without this, paths won't match.
    tmpDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "charlotte-test-")));
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

    it("allows absolute paths within outputDir", async () => {
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

    it("falls back to allowedWorkspaceRoot when outputDir is not set", async () => {
      delete config.outputDir;
      config.allowedWorkspaceRoot = tmpDir;
      const result = await resolveOutputPath("file.json", config);
      expect(result).toBe(path.join(tmpDir, "file.json"));
    });

    it("rejects absolute paths outside outputDir", async () => {
      const outsidePath = path.join(os.tmpdir(), "outside-boundary", "evil.json");
      await expect(resolveOutputPath(outsidePath, config)).rejects.toThrow(
        /resolves outside the allowed directory/,
      );
    });

    it("rejects relative paths that traverse above outputDir", async () => {
      await expect(resolveOutputPath("../../etc/passwd", config)).rejects.toThrow(
        /resolves outside the allowed directory/,
      );
    });

    it("rejects symlink-based traversal", async () => {
      // Create a symlink inside outputDir that points outside
      const symlinkPath = path.join(tmpDir, "escape-link");
      await fs.symlink(os.tmpdir(), symlinkPath);

      await expect(resolveOutputPath("escape-link/evil.json", config)).rejects.toThrow(
        /resolves outside the allowed directory/,
      );
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
