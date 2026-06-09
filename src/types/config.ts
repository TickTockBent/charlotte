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

/**
 * Upper bounds on rendered tool output (issue #188).
 *
 * Without these, a pathological page (100k links, infinite-scroll feed, a giant
 * document body) produces a multi-MB tool response that can blow the MCP
 * client's context window. Each cap degrades gracefully rather than failing:
 * arrays/text are truncated with an explicit marker, and the caller is steered
 * toward `output_file` or a narrower detail level.
 */
export interface OutputLimits {
  /** Max interactive elements serialized before the list is truncated. */
  maxInteractiveElements: number;
  /** Max characters of `full_content` text before truncation. */
  maxFullContentChars: number;
  /** Total byte ceiling for a formatted page response before degrading. */
  maxResponseBytes: number;
  /** Byte ceiling for a charlotte_evaluate result before truncation. */
  maxEvaluateBytes: number;
}

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
  /** Output-size caps that bound tool response size (issue #188). */
  limits: OutputLimits;
}

/** Built-in defaults for {@link OutputLimits}. */
export const DEFAULT_OUTPUT_LIMITS: OutputLimits = {
  // ~2000 elements is far beyond any usable page yet still bounds the worst case.
  maxInteractiveElements: 2000,
  // ~200k chars (~50k tokens) of page text before truncating full_content.
  maxFullContentChars: 200_000,
  // ~1 MB serialized response. Above this we degrade to a summary + suggestion.
  maxResponseBytes: 1_000_000,
  // ~256 KB for an evaluate result before truncating + suggesting output_file.
  maxEvaluateBytes: 256_000,
};

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
    limits: { ...DEFAULT_OUTPUT_LIMITS },
  };
}
