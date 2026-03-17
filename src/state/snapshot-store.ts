import type { PageRepresentation } from "../types/page-representation.js";
import type { Snapshot } from "../types/snapshot.js";

const DEFAULT_DEPTH = 50;
const MIN_DEPTH = 5;
const MAX_DEPTH = 500;

/**
 * Ring-buffer store for page snapshots. Snapshots have monotonically
 * increasing integer IDs and are evicted oldest-first when the buffer
 * reaches its configured depth.
 *
 * A secondary Map index provides O(1) lookup by snapshot ID alongside
 * the ring buffer used for ordered access (latest, previous, oldest).
 */
export class SnapshotStore {
  private buffer: Snapshot[] = [];
  private index: Map<number, Snapshot> = new Map();
  private nextSnapshotId = 1;
  private maxDepth: number;

  constructor(depth: number = DEFAULT_DEPTH) {
    this.maxDepth = Math.max(MIN_DEPTH, Math.min(MAX_DEPTH, depth));
  }

  /**
   * Push a new snapshot from a PageRepresentation. Returns the assigned
   * snapshot ID (also stamped onto the representation).
   */
  push(representation: PageRepresentation): number {
    const snapshotId = this.nextSnapshotId++;
    const timestamp = new Date().toISOString();

    // Stamp the snapshot_id onto the representation so callers see it
    representation.snapshot_id = snapshotId;
    representation.timestamp = timestamp;

    const snapshot: Snapshot = {
      id: snapshotId,
      timestamp,
      representation,
    };

    this.buffer.push(snapshot);
    this.index.set(snapshotId, snapshot);

    // Evict oldest if over capacity
    while (this.buffer.length > this.maxDepth) {
      const evicted = this.buffer.shift();
      if (evicted !== undefined) {
        this.index.delete(evicted.id);
      }
    }

    return snapshotId;
  }

  /**
   * Retrieve a snapshot by its ID. Returns null if evicted or never existed.
   */
  get(snapshotId: number): Snapshot | null {
    return this.index.get(snapshotId) ?? null;
  }

  /**
   * Get the most recent snapshot, or null if the store is empty.
   */
  getLatest(): Snapshot | null {
    if (this.buffer.length === 0) return null;
    return this.buffer[this.buffer.length - 1];
  }

  /**
   * Get the second-most-recent snapshot (the one before latest), or null.
   */
  getPrevious(): Snapshot | null {
    if (this.buffer.length < 2) return null;
    return this.buffer[this.buffer.length - 2];
  }

  /**
   * Get the oldest snapshot ID still in the buffer, or null if empty.
   */
  getOldestId(): number | null {
    if (this.buffer.length === 0) return null;
    return this.buffer[0].id;
  }

  /**
   * Get the latest snapshot ID that has been assigned (even if evicted).
   */
  getLatestId(): number {
    return this.nextSnapshotId - 1;
  }

  /**
   * Current number of snapshots in the buffer.
   */
  get size(): number {
    return this.buffer.length;
  }

  /**
   * Resize the ring buffer. Evicts oldest snapshots if the new depth
   * is smaller than the current size.
   */
  setDepth(newDepth: number): void {
    this.maxDepth = Math.max(MIN_DEPTH, Math.min(MAX_DEPTH, newDepth));
    while (this.buffer.length > this.maxDepth) {
      const evicted = this.buffer.shift();
      if (evicted !== undefined) {
        this.index.delete(evicted.id);
      }
    }
  }

  /**
   * Clear all snapshots and reset the ID counter.
   */
  clear(): void {
    this.buffer = [];
    this.index.clear();
    this.nextSnapshotId = 1;
  }
}