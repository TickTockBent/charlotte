export type AutoSnapshotMode = "every_action" | "observe_only" | "manual";

export interface CharlotteConfig {
  snapshotDepth: number;
  autoSnapshot: AutoSnapshotMode;
}

export function createDefaultConfig(): CharlotteConfig {
  return {
    snapshotDepth: 50,
    autoSnapshot: "every_action",
  };
}
