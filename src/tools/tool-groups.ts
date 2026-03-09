/**
 * Tool group and profile definitions for tiered tool visibility.
 *
 * Groups map logical categories to tool names.
 * Profiles map named presets to sets of tool names.
 */

// ─── Group definitions ───

export const TOOL_GROUPS = {
  navigation: ["charlotte:navigate", "charlotte:back", "charlotte:forward", "charlotte:reload"],
  observation: [
    "charlotte:observe",
    "charlotte:find",
    "charlotte:screenshot",
    "charlotte:screenshots",
    "charlotte:screenshot_get",
    "charlotte:screenshot_delete",
    "charlotte:diff",
  ],
  interaction: [
    "charlotte:click",
    "charlotte:click_at",
    "charlotte:type",
    "charlotte:select",
    "charlotte:toggle",
    "charlotte:submit",
    "charlotte:scroll",
    "charlotte:hover",
    "charlotte:drag",
    "charlotte:key",
    "charlotte:wait_for",
    "charlotte:upload",
  ],
  session: [
    "charlotte:get_cookies",
    "charlotte:clear_cookies",
    "charlotte:set_cookies",
    "charlotte:set_headers",
    "charlotte:configure",
    "charlotte:tabs",
    "charlotte:tab_open",
    "charlotte:tab_switch",
    "charlotte:tab_close",
    "charlotte:viewport",
    "charlotte:network",
  ],
  dev_mode: ["charlotte:dev_serve", "charlotte:dev_inject", "charlotte:dev_audit"],
  dialog: ["charlotte:dialog"],
  evaluate: ["charlotte:evaluate"],
  monitoring: ["charlotte:console", "charlotte:requests"],
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
    "charlotte:navigate",
    "charlotte:observe",
    "charlotte:find",
    "charlotte:click",
    "charlotte:type",
    "charlotte:submit",
  ],

  browse: [
    // navigation (all)
    "charlotte:navigate",
    "charlotte:back",
    "charlotte:forward",
    "charlotte:reload",
    // observation (all)
    "charlotte:observe",
    "charlotte:find",
    "charlotte:screenshot",
    "charlotte:screenshots",
    "charlotte:screenshot_get",
    "charlotte:screenshot_delete",
    "charlotte:diff",
    // interaction (partial — click, click_at, type, select, toggle, submit, scroll)
    "charlotte:click",
    "charlotte:click_at",
    "charlotte:type",
    "charlotte:select",
    "charlotte:toggle",
    "charlotte:submit",
    "charlotte:scroll",
    // session (tabs only)
    "charlotte:tabs",
    "charlotte:tab_open",
    "charlotte:tab_switch",
    "charlotte:tab_close",
  ],

  interact: [
    // navigation (all)
    "charlotte:navigate",
    "charlotte:back",
    "charlotte:forward",
    "charlotte:reload",
    // observation (all)
    "charlotte:observe",
    "charlotte:find",
    "charlotte:screenshot",
    "charlotte:screenshots",
    "charlotte:screenshot_get",
    "charlotte:screenshot_delete",
    "charlotte:diff",
    // interaction (all)
    "charlotte:click",
    "charlotte:click_at",
    "charlotte:type",
    "charlotte:select",
    "charlotte:toggle",
    "charlotte:submit",
    "charlotte:scroll",
    "charlotte:hover",
    "charlotte:drag",
    "charlotte:key",
    "charlotte:wait_for",
    "charlotte:upload",
    // session (tabs — inherited from browse)
    "charlotte:tabs",
    "charlotte:tab_open",
    "charlotte:tab_switch",
    "charlotte:tab_close",
    // dialog
    "charlotte:dialog",
    // evaluate
    "charlotte:evaluate",
  ],

  develop: [
    // navigation (all)
    "charlotte:navigate",
    "charlotte:back",
    "charlotte:forward",
    "charlotte:reload",
    // observation (all)
    "charlotte:observe",
    "charlotte:find",
    "charlotte:screenshot",
    "charlotte:screenshots",
    "charlotte:screenshot_get",
    "charlotte:screenshot_delete",
    "charlotte:diff",
    // interaction (all)
    "charlotte:click",
    "charlotte:click_at",
    "charlotte:type",
    "charlotte:select",
    "charlotte:toggle",
    "charlotte:submit",
    "charlotte:scroll",
    "charlotte:hover",
    "charlotte:drag",
    "charlotte:key",
    "charlotte:wait_for",
    "charlotte:upload",
    // session (tabs — inherited from browse)
    "charlotte:tabs",
    "charlotte:tab_open",
    "charlotte:tab_switch",
    "charlotte:tab_close",
    // dev_mode (all)
    "charlotte:dev_serve",
    "charlotte:dev_inject",
    "charlotte:dev_audit",
    // dialog
    "charlotte:dialog",
    // evaluate
    "charlotte:evaluate",
  ],

  audit: [
    // navigation (all)
    "charlotte:navigate",
    "charlotte:back",
    "charlotte:forward",
    "charlotte:reload",
    // observation (observe, find, screenshot, diff)
    "charlotte:observe",
    "charlotte:find",
    "charlotte:screenshot",
    "charlotte:screenshots",
    "charlotte:screenshot_get",
    "charlotte:screenshot_delete",
    "charlotte:diff",
    // dev_mode (dev_audit only)
    "charlotte:dev_audit",
    // session (viewport only)
    "charlotte:viewport",
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
  navigation: "Page navigation (navigate, back, forward, reload)",
  observation: "Page inspection (observe, find, screenshot, diff)",
  interaction:
    "DOM interaction (click, click_at, type, select, toggle, submit, scroll, hover, drag, key/sequences, wait_for, upload)",
  session: "Session management (cookies, headers, configure, tabs, viewport, network)",
  dev_mode: "Development tools (dev_serve, dev_inject, dev_audit)",
  dialog: "JavaScript dialog handling",
  evaluate: "JavaScript evaluation in page context",
  monitoring: "Console and network request monitoring",
};
