export type AutoSnapshotMode = "every_action" | "observe_only" | "manual";
export type DialogAutoDismiss = "none" | "accept_alerts" | "accept_all" | "dismiss_all";
export type DeviceType = "mobile" | "tablet" | "desktop";

/** Default viewport dimensions for each device type. */
export const DEVICE_VIEWPORT_PRESETS: Record<DeviceType, { width: number; height: number }> = {
  /** Common Modern Laptop Effective Resolution */
  desktop: { width: 1440, height: 900 },
  /** iPhone 14 Pro Effective Resolution */
  mobile: { width: 393, height: 852 }, 
  /** Standard Tablet Resolution */
  tablet: { width: 768, height: 1024 }, 
};

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
  /** Whether to include iframe content in page representations. Default: false. */
  includeIframes: boolean;
  /** Maximum iframe nesting depth to traverse. Default: 3. */
  iframeDepth: number;
  /** Default viewport dimensions used at browser launch and as fallback. */
  defaultViewport: { width: number; height: number };
  /** Named device viewport presets for the charlotte_viewport tool. */
  deviceViewportPresets: Record<DeviceType, { width: number; height: number }>;
}

export function createDefaultConfig(): CharlotteConfig {
  return {
    snapshotDepth: 50,
    autoSnapshot: "every_action",
    dialogAutoDismiss: "none",
    allowedWorkspaceRoot: process.cwd(), // Default to cwd for universal safety
    includeIframes: false,
    iframeDepth: 3,
    defaultViewport: { ...DEVICE_VIEWPORT_PRESETS.desktop },
    deviceViewportPresets: {
      desktop: { ...DEVICE_VIEWPORT_PRESETS.desktop },
      mobile: { ...DEVICE_VIEWPORT_PRESETS.mobile },
      tablet: { ...DEVICE_VIEWPORT_PRESETS.tablet },
    },
  };
}
