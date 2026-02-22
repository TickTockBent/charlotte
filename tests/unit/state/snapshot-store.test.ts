import { describe, it, expect } from "vitest";
import { SnapshotStore } from "../../../src/state/snapshot-store.js";
import type { PageRepresentation } from "../../../src/types/page-representation.js";

function createMockRepresentation(
  overrides?: Partial<PageRepresentation>,
): PageRepresentation {
  return {
    url: "https://example.com",
    title: "Test Page",
    viewport: { width: 1280, height: 720 },
    snapshot_id: 0,
    timestamp: "",
    structure: {
      landmarks: [],
      headings: [],
      content_summary: "",
    },
    interactive: [],
    forms: [],
    errors: { console: [], network: [] },
    ...overrides,
  };
}

describe("SnapshotStore", () => {
  it("starts empty", () => {
    const store = new SnapshotStore();
    expect(store.size).toBe(0);
    expect(store.getLatest()).toBeNull();
    expect(store.getPrevious()).toBeNull();
    expect(store.getOldestId()).toBeNull();
  });

  it("pushes snapshots with monotonic IDs", () => {
    const store = new SnapshotStore();
    const representationA = createMockRepresentation({ title: "Page A" });
    const representationB = createMockRepresentation({ title: "Page B" });

    const idA = store.push(representationA);
    const idB = store.push(representationB);

    expect(idA).toBe(1);
    expect(idB).toBe(2);
    expect(idB).toBeGreaterThan(idA);
    expect(store.size).toBe(2);
  });

  it("stamps snapshot_id and timestamp on the representation", () => {
    const store = new SnapshotStore();
    const representation = createMockRepresentation();

    const snapshotId = store.push(representation);

    expect(representation.snapshot_id).toBe(snapshotId);
    expect(representation.timestamp).toBeTruthy();
    expect(new Date(representation.timestamp).getTime()).not.toBeNaN();
  });

  it("retrieves snapshots by ID", () => {
    const store = new SnapshotStore();
    const representation = createMockRepresentation({ title: "Specific" });
    const snapshotId = store.push(representation);

    const retrieved = store.get(snapshotId);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(snapshotId);
    expect(retrieved!.representation.title).toBe("Specific");
  });

  it("returns null for non-existent snapshot ID", () => {
    const store = new SnapshotStore();
    expect(store.get(999)).toBeNull();
  });

  it("returns latest snapshot", () => {
    const store = new SnapshotStore();
    store.push(createMockRepresentation({ title: "First" }));
    store.push(createMockRepresentation({ title: "Second" }));
    store.push(createMockRepresentation({ title: "Third" }));

    const latest = store.getLatest();
    expect(latest).not.toBeNull();
    expect(latest!.representation.title).toBe("Third");
  });

  it("returns previous (second-most-recent) snapshot", () => {
    const store = new SnapshotStore();
    store.push(createMockRepresentation({ title: "First" }));
    store.push(createMockRepresentation({ title: "Second" }));
    store.push(createMockRepresentation({ title: "Third" }));

    const previous = store.getPrevious();
    expect(previous).not.toBeNull();
    expect(previous!.representation.title).toBe("Second");
  });

  it("returns null for getPrevious when only one snapshot exists", () => {
    const store = new SnapshotStore();
    store.push(createMockRepresentation());

    expect(store.getPrevious()).toBeNull();
  });

  it("evicts oldest snapshots when exceeding depth", () => {
    const store = new SnapshotStore(5);

    for (let i = 0; i < 8; i++) {
      store.push(createMockRepresentation({ title: `Page ${i}` }));
    }

    expect(store.size).toBe(5);
    // First 3 snapshots (IDs 1, 2, 3) should be evicted
    expect(store.get(1)).toBeNull();
    expect(store.get(2)).toBeNull();
    expect(store.get(3)).toBeNull();
    // IDs 4-8 should still be available
    expect(store.get(4)).not.toBeNull();
    expect(store.get(8)).not.toBeNull();
  });

  it("tracks oldest ID correctly after eviction", () => {
    const store = new SnapshotStore(5);

    for (let i = 0; i < 8; i++) {
      store.push(createMockRepresentation());
    }

    expect(store.getOldestId()).toBe(4);
  });

  it("tracks latest ID even after eviction", () => {
    const store = new SnapshotStore(5);

    for (let i = 0; i < 8; i++) {
      store.push(createMockRepresentation());
    }

    expect(store.getLatestId()).toBe(8);
  });

  it("clamps depth to min/max bounds", () => {
    const storeMin = new SnapshotStore(1); // Should clamp to 5
    for (let i = 0; i < 10; i++) {
      storeMin.push(createMockRepresentation());
    }
    expect(storeMin.size).toBe(5);

    const storeMax = new SnapshotStore(1000); // Should clamp to 500
    for (let i = 0; i < 510; i++) {
      storeMax.push(createMockRepresentation());
    }
    expect(storeMax.size).toBe(500);
  });

  it("resizes depth and evicts if necessary", () => {
    const store = new SnapshotStore(10);

    for (let i = 0; i < 10; i++) {
      store.push(createMockRepresentation());
    }
    expect(store.size).toBe(10);

    store.setDepth(5);
    expect(store.size).toBe(5);
    // Oldest 5 should be evicted
    expect(store.get(1)).toBeNull();
    expect(store.get(5)).toBeNull();
    expect(store.get(6)).not.toBeNull();
  });

  it("clears all snapshots and resets ID counter", () => {
    const store = new SnapshotStore();
    store.push(createMockRepresentation());
    store.push(createMockRepresentation());

    store.clear();

    expect(store.size).toBe(0);
    expect(store.getLatest()).toBeNull();
    expect(store.getOldestId()).toBeNull();

    // IDs restart at 1
    const newId = store.push(createMockRepresentation());
    expect(newId).toBe(1);
  });
});
