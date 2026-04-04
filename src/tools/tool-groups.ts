/**
 * Tool group and profile definitions for tiered tool visibility.
 *
 * Groups map logical categories to tool names.
 * Profiles map named presets to sets of tool names.
 */

// ─── Group definitions ───

export const TOOL_GROUPS = {
  navigation: ["charlotte_navigate", "charlotte_history"],
  observation: [
    "charlotte_observe",
    "charlotte_find",
    "charlotte_screenshot",
    "charlotte_screenshot_manage",
    "charlotte_diff",
  ],
  interaction: [
    "charlotte_click",
    "charlotte_click_at",
    "charlotte_type",
    "charlotte_select",
    "charlotte_toggle",
    "charlotte_submit",
    "charlotte_scroll",
    "charlotte_hover",
    "charlotte_drag",
    "charlotte_key",
    "charlotte_wait_for",
    "charlotte_upload",
    "charlotte_fill_form",
  ],
  session: [
    "charlotte_cookies",
    "charlotte_set_headers",
    "charlotte_configure",
    "charlotte_tab",
    "charlotte_viewport",
    "charlotte_network",
  ],
  dev_mode: ["charlotte_dev_serve", "charlotte_dev_inject", "charlotte_dev_audit"],
  dialog: ["charlotte_dialog"],
  evaluate: ["charlotte_evaluate"],
  monitoring: ["charlotte_console", "charlotte_requests"],
} as const;

export type ToolGroupName = keyof typeof TOOL_GROUPS;

export const ALL_GROUP_NAMES = Object.keys(TOOL_GROUPS) as ToolGroupName[];

/** Every tool name across all groups. */
export const ALL_TOOL_NAMES: string[] = Object.values(TOOL_GROUPS).flat();

// ─── Profile definitions ───

export type ToolProfile = "core" | "browse" | "interact" | "develop" | "audit" | "full";

/**
 * Profiles map to explicit tool name lists. Some profiles include partial
 * groups (e.g. browse includes scroll but not drag), so we define them as
 * flat tool lists rather than group references.
 */
export const PROFILE_TOOLS: Record<ToolProfile, string[]> = {
  core: [
    "charlotte_navigate",
    "charlotte_observe",
    "charlotte_find",
    "charlotte_click",
    "charlotte_type",
    "charlotte_submit",
  ],

  browse: [
    // navigation (all)
    "charlotte_navigate",
    "charlotte_history",
    // observation (all)
    "charlotte_observe",
    "charlotte_find",
    "charlotte_screenshot",
    "charlotte_screenshot_manage",
    "charlotte_diff",
    // interaction (partial — click, click_at, type, select, toggle, submit, scroll)
    "charlotte_click",
    "charlotte_click_at",
    "charlotte_type",
    "charlotte_select",
    "charlotte_toggle",
    "charlotte_submit",
    "charlotte_scroll",
    // session (tabs only)
    "charlotte_tab",
  ],

  interact: [
    // navigation (all)
    "charlotte_navigate",
    "charlotte_history",
    // observation (all)
    "charlotte_observe",
    "charlotte_find",
    "charlotte_screenshot",
    "charlotte_screenshot_manage",
    "charlotte_diff",
    // interaction (all)
    "charlotte_click",
    "charlotte_click_at",
    "charlotte_type",
    "charlotte_select",
    "charlotte_toggle",
    "charlotte_submit",
    "charlotte_scroll",
    "charlotte_hover",
    "charlotte_drag",
    "charlotte_key",
    "charlotte_wait_for",
    "charlotte_upload",
    "charlotte_fill_form",
    // session (tabs)
    "charlotte_tab",
    // dialog
    "charlotte_dialog",
    // evaluate
    "charlotte_evaluate",
  ],

  develop: [
    // navigation (all)
    "charlotte_navigate",
    "charlotte_history",
    // observation (all)
    "charlotte_observe",
    "charlotte_find",
    "charlotte_screenshot",
    "charlotte_screenshot_manage",
    "charlotte_diff",
    // interaction (all)
    "charlotte_click",
    "charlotte_click_at",
    "charlotte_type",
    "charlotte_select",
    "charlotte_toggle",
    "charlotte_submit",
    "charlotte_scroll",
    "charlotte_hover",
    "charlotte_drag",
    "charlotte_key",
    "charlotte_wait_for",
    "charlotte_upload",
    "charlotte_fill_form",
    // session (tabs)
    "charlotte_tab",
    // dev_mode (all)
    "charlotte_dev_serve",
    "charlotte_dev_inject",
    "charlotte_dev_audit",
    // dialog
    "charlotte_dialog",
    // evaluate
    "charlotte_evaluate",
  ],

  audit: [
    // navigation (all)
    "charlotte_navigate",
    "charlotte_history",
    // observation (observe, find, screenshot, diff)
    "charlotte_observe",
    "charlotte_find",
    "charlotte_screenshot",
    "charlotte_screenshot_manage",
    "charlotte_diff",
    // dev_mode (dev_audit only)
    "charlotte_dev_audit",
    // session (viewport only)
    "charlotte_viewport",
  ],

  full: ALL_TOOL_NAMES,
};

/**
 * Resolve a profile name to the set of tool names it includes.
 */
export function resolveProfile(profile: ToolProfile): Set<string> {
  return new Set(PROFILE_TOOLS[profile]);
}

/**
 * Resolve an array of group names to the set of tool names.
 */
export function resolveGroups(groupNames: ToolGroupName[]): Set<string> {
  const tools = new Set<string>();
  for (const name of groupNames) {
    const group = TOOL_GROUPS[name];
    if (group) {
      for (const tool of group) {
        tools.add(tool);
      }
    }
  }
  return tools;
}

/**
 * Determine which group a tool name belongs to.
 */
export function getToolGroup(toolName: string): ToolGroupName | undefined {
  for (const [group, tools] of Object.entries(TOOL_GROUPS)) {
    if ((tools as readonly string[]).includes(toolName)) {
      return group as ToolGroupName;
    }
  }
  return undefined;
}

/** Description hints for each group, used in the meta-tool and server instructions. */
export const GROUP_DESCRIPTIONS: Record<ToolGroupName, string> = {
  navigation: "Page navigation (navigate, history back/forward/reload)",
  observation: "Page inspection (observe, find, screenshot, diff)",
  interaction:
    "DOM interaction (click, click_at, type, select, toggle, submit, scroll, hover, drag, key/sequences, wait_for, upload, fill_form)",
  session: "Session management (cookies, headers, configure, tab, viewport, network)",
  dev_mode: "Development tools (dev_serve, dev_inject, dev_audit)",
  dialog: "JavaScript dialog handling",
  evaluate: "JavaScript evaluation in page context",
  monitoring: "Console and network request monitoring",
};
