import type { PageRepresentation } from "./page-representation.js";

export interface Snapshot {
  id: number;
  timestamp: string;
  representation: PageRepresentation;
}

export type DiffChangeType = "added" | "removed" | "moved" | "changed";

export interface DiffChange {
  type: DiffChangeType;
  element?: string;
  detail?: string;
  property?: string;
  from?: unknown;
  to?: unknown;
}

export interface SnapshotDiff {
  from_snapshot: number;
  to_snapshot: number;
  changes: DiffChange[];
  summary: string;
}
