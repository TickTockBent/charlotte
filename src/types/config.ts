export type AutoSnapshotMode = "every_action" | "observe_only" | "manual";

export interface CharlotteConfig {
  snapshotDepth: number;
  autoSnapshot: AutoSnapshotMode;
  /** Directory for persistent screenshot artifacts. Defaults to OS temp dir. */
  screenshotDir?: string;
}

export function createDefaultConfig(): CharlotteConfig {
  return {
    snapshotDepth: 50,
    autoSnapshot: "every_action",
  };
}
