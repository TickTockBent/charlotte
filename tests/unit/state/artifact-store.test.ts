import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ArtifactStore } from "../../../src/state/artifact-store.js";

let testDir: string;

async function createTestDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "charlotte-test-artifacts-"));
}

describe("ArtifactStore", () => {
  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("initializes with empty state", async () => {
    const store = new ArtifactStore(testDir);
    await store.initialize();

    expect(store.count).toBe(0);
    expect(store.list()).toEqual([]);
  });

  it("saves a screenshot artifact to disk", async () => {
    const store = new ArtifactStore(testDir);
    await store.initialize();

    const imageData = Buffer.from("fake-png-data");
    const artifact = await store.save(imageData, {
      format: "png",
      url: "https://example.com",
      title: "Test Page",
    });

    expect(artifact.id).toMatch(/^ss-\d{14}-[0-9a-f]{6}$/);
    expect(artifact.filename).toMatch(/\.png$/);
    expect(artifact.format).toBe("png");
    expect(artifact.mimeType).toBe("image/png");
    expect(artifact.size).toBe(imageData.length);
    expect(artifact.url).toBe("https://example.com");
    expect(artifact.title).toBe("Test Page");
    expect(artifact.timestamp).toBeTruthy();

    // File should exist on disk
    const fileContents = await fs.readFile(artifact.path);
    expect(fileContents.toString()).toBe("fake-png-data");
  });

  it("saves jpeg with .jpg extension", async () => {
    const store = new ArtifactStore(testDir);
    await store.initialize();

    const artifact = await store.save(Buffer.from("fake-jpeg"), {
      format: "jpeg",
      url: "https://example.com",
      title: "Test",
    });

    expect(artifact.filename).toMatch(/\.jpg$/);
    expect(artifact.format).toBe("jpeg");
    expect(artifact.mimeType).toBe("image/jpeg");
  });

  it("saves webp with .webp extension", async () => {
    const store = new ArtifactStore(testDir);
    await store.initialize();

    const artifact = await store.save(Buffer.from("fake-webp"), {
      format: "webp",
      url: "https://example.com",
      title: "Test",
    });

    expect(artifact.filename).toMatch(/\.webp$/);
  });

  it("stores optional selector metadata", async () => {
    const store = new ArtifactStore(testDir);
    await store.initialize();

    const artifact = await store.save(Buffer.from("data"), {
      format: "png",
      selector: "#main-content",
      url: "https://example.com",
      title: "Test",
    });

    expect(artifact.selector).toBe("#main-content");
  });

  it("retrieves artifact by ID", async () => {
    const store = new ArtifactStore(testDir);
    await store.initialize();

    const artifact = await store.save(Buffer.from("data"), {
      format: "png",
      url: "https://example.com",
      title: "Test",
    });

    const retrieved = store.get(artifact.id);
    expect(retrieved).not.toBeUndefined();
    expect(retrieved!.id).toBe(artifact.id);
    expect(retrieved!.url).toBe("https://example.com");
  });

  it("returns undefined for non-existent ID", async () => {
    const store = new ArtifactStore(testDir);
    await store.initialize();

    expect(store.get("ss-nonexistent-000000")).toBeUndefined();
  });

  it("lists artifacts newest first", async () => {
    const store = new ArtifactStore(testDir);
    await store.initialize();

    const a1 = await store.save(Buffer.from("1"), {
      format: "png",
      url: "https://example.com/1",
      title: "First",
    });

    // Small delay to ensure distinct timestamps
    await new Promise((r) => setTimeout(r, 10));

    const a2 = await store.save(Buffer.from("2"), {
      format: "png",
      url: "https://example.com/2",
      title: "Second",
    });

    const list = store.list();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(a2.id);
    expect(list[1].id).toBe(a1.id);
  });

  it("reads file data for an artifact", async () => {
    const store = new ArtifactStore(testDir);
    await store.initialize();

    const originalData = Buffer.from("test-image-data-12345");
    const artifact = await store.save(originalData, {
      format: "png",
      url: "https://example.com",
      title: "Test",
    });

    const fileData = await store.readFile(artifact.id);
    expect(fileData).not.toBeNull();
    expect(fileData!.toString()).toBe("test-image-data-12345");
  });

  it("returns null when reading non-existent artifact", async () => {
    const store = new ArtifactStore(testDir);
    await store.initialize();

    const result = await store.readFile("ss-nonexistent-000000");
    expect(result).toBeNull();
  });

  it("handles missing file gracefully on readFile", async () => {
    const store = new ArtifactStore(testDir);
    await store.initialize();

    const artifact = await store.save(Buffer.from("data"), {
      format: "png",
      url: "https://example.com",
      title: "Test",
    });

    // Delete the file externally
    await fs.unlink(artifact.path);

    const result = await store.readFile(artifact.id);
    expect(result).toBeNull();
    // Artifact should be cleaned from the index
    expect(store.get(artifact.id)).toBeUndefined();
    expect(store.count).toBe(0);
  });

  it("deletes an artifact", async () => {
    const store = new ArtifactStore(testDir);
    await store.initialize();

    const artifact = await store.save(Buffer.from("data"), {
      format: "png",
      url: "https://example.com",
      title: "Test",
    });

    expect(store.count).toBe(1);

    const deleted = await store.delete(artifact.id);
    expect(deleted).toBe(true);
    expect(store.count).toBe(0);
    expect(store.get(artifact.id)).toBeUndefined();

    // File should be gone from disk
    await expect(fs.access(artifact.path)).rejects.toThrow();
  });

  it("returns false when deleting non-existent artifact", async () => {
    const store = new ArtifactStore(testDir);
    await store.initialize();

    const deleted = await store.delete("ss-nonexistent-000000");
    expect(deleted).toBe(false);
  });

  it("persists and loads index across instances", async () => {
    // Save artifacts in first store instance
    const store1 = new ArtifactStore(testDir);
    await store1.initialize();

    await store1.save(Buffer.from("data1"), {
      format: "png",
      selector: ".hero",
      url: "https://example.com/page1",
      title: "Page One",
    });
    await store1.save(Buffer.from("data2"), {
      format: "jpeg",
      url: "https://example.com/page2",
      title: "Page Two",
    });

    // Create second instance pointing at same directory
    const store2 = new ArtifactStore(testDir);
    await store2.initialize();

    expect(store2.count).toBe(2);
    const list = store2.list();
    expect(list).toHaveLength(2);
    expect(list.some((a) => a.title === "Page One" && a.selector === ".hero")).toBe(true);
    expect(list.some((a) => a.title === "Page Two" && a.format === "jpeg")).toBe(true);
  });

  it("skips missing files when loading index", async () => {
    const store1 = new ArtifactStore(testDir);
    await store1.initialize();

    const artifact = await store1.save(Buffer.from("data"), {
      format: "png",
      url: "https://example.com",
      title: "Test",
    });

    // Delete the file but leave the index
    await fs.unlink(artifact.path);

    // New instance should skip the missing entry
    const store2 = new ArtifactStore(testDir);
    await store2.initialize();

    expect(store2.count).toBe(0);
  });

  it("changes screenshot directory at runtime", async () => {
    const store = new ArtifactStore(testDir);
    await store.initialize();

    await store.save(Buffer.from("data"), {
      format: "png",
      url: "https://example.com",
      title: "Before",
    });
    expect(store.count).toBe(1);

    // Switch to new directory
    const newDir = await createTestDir();
    try {
      await store.setScreenshotDir(newDir);

      // Old artifacts should be cleared from in-memory index
      expect(store.count).toBe(0);
      expect(store.screenshotDir).toBe(newDir);

      // Can save to new directory
      const artifact = await store.save(Buffer.from("new-data"), {
        format: "png",
        url: "https://example.com",
        title: "After",
      });

      expect(artifact.path.startsWith(newDir)).toBe(true);
      expect(store.count).toBe(1);
    } finally {
      await fs.rm(newDir, { recursive: true, force: true });
    }
  });

  it("creates screenshot directory if it does not exist", async () => {
    const nestedDir = path.join(testDir, "deeply", "nested", "screenshots");
    const store = new ArtifactStore(nestedDir);
    await store.initialize();

    // Directory should have been created
    const stat = await fs.stat(nestedDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it("exposes screenshotDir property", async () => {
    const store = new ArtifactStore(testDir);
    expect(store.screenshotDir).toBe(testDir);
  });
});
