export type AutoSnapshotMode = "every_action" | "observe_only" | "manual";
export type DialogAutoDismiss = "none" | "accept_alerts" | "accept_all" | "dismiss_all";

export interface CharlotteConfig {
  /** Root directory boundary for dev_serve to prevent path traversal */
  allowedWorkspaceRoot?: string;
  snapshotDepth: number;
  autoSnapshot: AutoSnapshotMode;
  dialogAutoDismiss: DialogAutoDismiss;
  /** Directory for persistent screenshot artifacts. Defaults to OS temp dir. */
  screenshotDir?: string;
  /** Directory for large tool output files. When set, tools with output_file support write here. */
  outputDir?: string;
}

export function createDefaultConfig(): CharlotteConfig {
  return {
    snapshotDepth: 50,
    autoSnapshot: "every_action",
    dialogAutoDismiss: "none",
    allowedWorkspaceRoot: process.cwd(), // Default to cwd for universal safety
  };
}
