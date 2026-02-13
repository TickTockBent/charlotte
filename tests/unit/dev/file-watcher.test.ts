import { describe, it, expect, afterEach, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { FileWatcher } from "../../../src/dev/file-watcher.js";

// Use polling to avoid inotify watch limits in CI/dev environments
const POLLING_OPTIONS = { usePolling: true };

describe("FileWatcher", () => {
  let watcher: FileWatcher;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "charlotte-fw-test-"));
    watcher = new FileWatcher();
  });

  afterEach(async () => {
    if (watcher.isWatching()) {
      await watcher.stop();
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("starts watching a directory", async () => {
    await watcher.start({
      directoryPath: tempDir,
      onFilesChanged: () => {},
      ...POLLING_OPTIONS,
    });

    expect(watcher.isWatching()).toBe(true);
  });

  it("stops watching", async () => {
    await watcher.start({
      directoryPath: tempDir,
      onFilesChanged: () => {},
      ...POLLING_OPTIONS,
    });

    await watcher.stop();
    expect(watcher.isWatching()).toBe(false);
  });

  it("detects new file creation", async () => {
    const changedFilesPromise = new Promise<string[]>((resolve) => {
      watcher.start({
        directoryPath: tempDir,
        onFilesChanged: resolve,
        debounceMs: 50,
        ...POLLING_OPTIONS,
      });
    });

    // Wait for watcher to be ready and polling to start
    await new Promise((resolve) => setTimeout(resolve, 200));
    fs.writeFileSync(path.join(tempDir, "test.txt"), "hello");

    const changedFiles = await changedFilesPromise;
    expect(changedFiles).toContain("test.txt");
  }, 10000);

  it("detects file modifications", async () => {
    const testFilePath = path.join(tempDir, "existing.txt");
    fs.writeFileSync(testFilePath, "initial");

    const changedFilesPromise = new Promise<string[]>((resolve) => {
      watcher.start({
        directoryPath: tempDir,
        onFilesChanged: resolve,
        debounceMs: 50,
        ...POLLING_OPTIONS,
      });
    });

    // Wait for watcher to be ready and polling to start
    await new Promise((resolve) => setTimeout(resolve, 200));
    fs.writeFileSync(testFilePath, "modified");

    const changedFiles = await changedFilesPromise;
    expect(changedFiles).toContain("existing.txt");
  }, 10000);

  it("debounces rapid changes into a single callback", async () => {
    let callbackCount = 0;
    let lastChangedFiles: string[] = [];

    await watcher.start({
      directoryPath: tempDir,
      onFilesChanged: (files) => {
        callbackCount++;
        lastChangedFiles = files;
      },
      debounceMs: 200,
      ...POLLING_OPTIONS,
    });

    // Rapidly create multiple files
    fs.writeFileSync(path.join(tempDir, "file1.txt"), "a");
    fs.writeFileSync(path.join(tempDir, "file2.txt"), "b");
    fs.writeFileSync(path.join(tempDir, "file3.txt"), "c");

    // Wait for polling interval + debounce to fire
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Should have been called exactly once with all files
    expect(callbackCount).toBe(1);
    expect(lastChangedFiles).toHaveLength(3);
    expect(lastChangedFiles).toContain("file1.txt");
    expect(lastChangedFiles).toContain("file2.txt");
    expect(lastChangedFiles).toContain("file3.txt");
  }, 10000);

  it("reports relative file paths", async () => {
    const subDir = path.join(tempDir, "subdir");
    fs.mkdirSync(subDir);

    const changedFilesPromise = new Promise<string[]>((resolve) => {
      watcher.start({
        directoryPath: tempDir,
        onFilesChanged: resolve,
        debounceMs: 50,
        ...POLLING_OPTIONS,
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    fs.writeFileSync(path.join(subDir, "nested.txt"), "data");

    const changedFiles = await changedFilesPromise;
    expect(changedFiles).toContain(path.join("subdir", "nested.txt"));
  }, 10000);

  it("does not fire callback after stop", async () => {
    let callbackCalled = false;

    await watcher.start({
      directoryPath: tempDir,
      onFilesChanged: () => {
        callbackCalled = true;
      },
      debounceMs: 50,
      ...POLLING_OPTIONS,
    });

    await watcher.stop();

    // Create a file after stopping
    fs.writeFileSync(path.join(tempDir, "after-stop.txt"), "data");
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(callbackCalled).toBe(false);
  }, 10000);

  it("restarts when start is called while already watching", async () => {
    let firstCallbackCalled = false;
    let secondCallbackCalled = false;

    await watcher.start({
      directoryPath: tempDir,
      onFilesChanged: () => {
        firstCallbackCalled = true;
      },
      debounceMs: 50,
      ...POLLING_OPTIONS,
    });

    const secondTempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "charlotte-fw-test2-"),
    );
    try {
      await watcher.start({
        directoryPath: secondTempDir,
        onFilesChanged: () => {
          secondCallbackCalled = true;
        },
        debounceMs: 50,
        ...POLLING_OPTIONS,
      });

      // Write to original dir — should not trigger
      fs.writeFileSync(path.join(tempDir, "old.txt"), "data");
      // Write to new dir — should trigger
      fs.writeFileSync(path.join(secondTempDir, "new.txt"), "data");

      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(firstCallbackCalled).toBe(false);
      expect(secondCallbackCalled).toBe(true);
    } finally {
      fs.rmSync(secondTempDir, { recursive: true, force: true });
    }
  }, 10000);
});
