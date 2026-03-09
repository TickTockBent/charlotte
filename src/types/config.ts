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
  /** Whether to include iframe content in page representations. Default: false. */
  includeIframes: boolean;
  /** Maximum iframe nesting depth to traverse. Default: 3. */
  iframeDepth: number;
}

export function createDefaultConfig(): CharlotteConfig {
  return {
    snapshotDepth: 50,
    autoSnapshot: "every_action",
    dialogAutoDismiss: "none",
    allowedWorkspaceRoot: process.cwd(), // Default to cwd for universal safety
    includeIframes: false,
    iframeDepth: 3,
  };
}
