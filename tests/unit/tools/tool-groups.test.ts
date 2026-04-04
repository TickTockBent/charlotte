import { describe, it, expect } from "vitest";
import {
  TOOL_GROUPS,
  ALL_GROUP_NAMES,
  ALL_TOOL_NAMES,
  PROFILE_TOOLS,
  resolveProfile,
  resolveGroups,
  getToolGroup,
  GROUP_DESCRIPTIONS,
  type ToolProfile,
} from "../../../src/tools/tool-groups.js";

describe("tool-groups", () => {
  describe("TOOL_GROUPS", () => {
    it("has all 8 groups", () => {
      expect(ALL_GROUP_NAMES).toHaveLength(8);
      expect(ALL_GROUP_NAMES).toEqual(
        expect.arrayContaining([
          "navigation",
          "observation",
          "interaction",
          "session",
          "dev_mode",
          "dialog",
          "evaluate",
          "monitoring",
        ]),
      );
    });

    it("contains all 33 tools across groups", () => {
      expect(ALL_TOOL_NAMES).toHaveLength(33);
    });

    it("has no duplicate tool names across groups", () => {
      const seen = new Set<string>();
      for (const group of ALL_GROUP_NAMES) {
        for (const tool of TOOL_GROUPS[group]) {
          expect(seen.has(tool)).toBe(false);
          seen.add(tool);
        }
      }
    });

    it("navigation group has 2 tools", () => {
      expect(TOOL_GROUPS.navigation).toHaveLength(2);
      expect(TOOL_GROUPS.navigation).toContain("charlotte_navigate");
      expect(TOOL_GROUPS.navigation).toContain("charlotte_history");
    });

    it("interaction group has 13 tools", () => {
      expect(TOOL_GROUPS.interaction).toHaveLength(13);
    });

    it("session group has 6 tools", () => {
      expect(TOOL_GROUPS.session).toHaveLength(6);
    });

    it("observation group has 5 tools", () => {
      expect(TOOL_GROUPS.observation).toHaveLength(5);
    });
  });

  describe("resolveProfile", () => {
    it("core profile has 6 tools", () => {
      const tools = resolveProfile("core");
      expect(tools.size).toBe(6);
      expect(tools.has("charlotte_navigate")).toBe(true);
      expect(tools.has("charlotte_observe")).toBe(true);
      expect(tools.has("charlotte_find")).toBe(true);
      expect(tools.has("charlotte_click")).toBe(true);
      expect(tools.has("charlotte_type")).toBe(true);
      expect(tools.has("charlotte_submit")).toBe(true);
    });

    it("browse profile includes navigation, observation, partial interaction, and tabs", () => {
      const tools = resolveProfile("browse");
      // 2 nav + 5 obs + 7 interaction + 1 tab = 15
      expect(tools.size).toBe(15);
      // Navigation
      expect(tools.has("charlotte_navigate")).toBe(true);
      expect(tools.has("charlotte_history")).toBe(true);
      // Observation
      expect(tools.has("charlotte_observe")).toBe(true);
      expect(tools.has("charlotte_find")).toBe(true);
      expect(tools.has("charlotte_screenshot")).toBe(true);
      expect(tools.has("charlotte_diff")).toBe(true);
      // Interaction (partial)
      expect(tools.has("charlotte_click")).toBe(true);
      expect(tools.has("charlotte_type")).toBe(true);
      expect(tools.has("charlotte_scroll")).toBe(true);
      // Not in browse:
      expect(tools.has("charlotte_drag")).toBe(false);
      expect(tools.has("charlotte_hover")).toBe(false);
      expect(tools.has("charlotte_key")).toBe(false);
      expect(tools.has("charlotte_wait_for")).toBe(false);
      // Tabs are included
      expect(tools.has("charlotte_tab")).toBe(true);
      // Session management is not included
      expect(tools.has("charlotte_cookies")).toBe(false);
      expect(tools.has("charlotte_network")).toBe(false);
      // No dev_mode, dialog, evaluate, monitoring
      expect(tools.has("charlotte_dev_serve")).toBe(false);
      expect(tools.has("charlotte_dialog")).toBe(false);
      expect(tools.has("charlotte_evaluate")).toBe(false);
      expect(tools.has("charlotte_console")).toBe(false);
    });

    it("interact profile includes all interaction tools plus dialog and evaluate", () => {
      const tools = resolveProfile("interact");
      // 2 nav + 5 obs + 13 interaction + 1 tab + dialog + evaluate = 23
      expect(tools.size).toBe(23);
      expect(tools.has("charlotte_drag")).toBe(true);
      expect(tools.has("charlotte_hover")).toBe(true);
      expect(tools.has("charlotte_key")).toBe(true);
      expect(tools.has("charlotte_wait_for")).toBe(true);
      expect(tools.has("charlotte_dialog")).toBe(true);
      expect(tools.has("charlotte_evaluate")).toBe(true);
      // Not in interact:
      expect(tools.has("charlotte_dev_serve")).toBe(false);
      expect(tools.has("charlotte_dev_inject")).toBe(false);
      expect(tools.has("charlotte_dev_audit")).toBe(false);
      expect(tools.has("charlotte_cookies")).toBe(false);
      expect(tools.has("charlotte_network")).toBe(false);
      expect(tools.has("charlotte_console")).toBe(false);
      expect(tools.has("charlotte_configure")).toBe(false);
    });

    it("develop profile includes dev_mode tools", () => {
      const tools = resolveProfile("develop");
      // interact (23) + 3 dev_mode = 26
      expect(tools.size).toBe(26);
      expect(tools.has("charlotte_dev_serve")).toBe(true);
      expect(tools.has("charlotte_dev_inject")).toBe(true);
      expect(tools.has("charlotte_dev_audit")).toBe(true);
      // Not in develop:
      expect(tools.has("charlotte_cookies")).toBe(false);
      expect(tools.has("charlotte_network")).toBe(false);
      expect(tools.has("charlotte_console")).toBe(false);
      expect(tools.has("charlotte_configure")).toBe(false);
      expect(tools.has("charlotte_set_headers")).toBe(false);
    });

    it("audit profile includes dev_audit and viewport but not full dev_mode or interaction", () => {
      const tools = resolveProfile("audit");
      // 2 nav + 5 obs + dev_audit + viewport = 9
      expect(tools.size).toBe(9);
      expect(tools.has("charlotte_dev_audit")).toBe(true);
      expect(tools.has("charlotte_viewport")).toBe(true);
      // Not in audit:
      expect(tools.has("charlotte_dev_serve")).toBe(false);
      expect(tools.has("charlotte_dev_inject")).toBe(false);
      expect(tools.has("charlotte_click")).toBe(false);
      expect(tools.has("charlotte_type")).toBe(false);
      expect(tools.has("charlotte_dialog")).toBe(false);
      expect(tools.has("charlotte_evaluate")).toBe(false);
      expect(tools.has("charlotte_tab")).toBe(false);
      expect(tools.has("charlotte_console")).toBe(false);
    });

    it("full profile includes all tools", () => {
      const tools = resolveProfile("full");
      expect(tools.size).toBe(ALL_TOOL_NAMES.length);
      for (const toolName of ALL_TOOL_NAMES) {
        expect(tools.has(toolName)).toBe(true);
      }
    });
  });

  describe("resolveGroups", () => {
    it("resolves single group", () => {
      const tools = resolveGroups(["navigation"]);
      expect(tools.size).toBe(2);
      expect(tools.has("charlotte_navigate")).toBe(true);
    });

    it("resolves multiple groups", () => {
      const tools = resolveGroups(["navigation", "observation"]);
      expect(tools.size).toBe(7); // 2 + 5
    });

    it("handles empty array", () => {
      const tools = resolveGroups([]);
      expect(tools.size).toBe(0);
    });
  });

  describe("getToolGroup", () => {
    it("returns correct group for a tool", () => {
      expect(getToolGroup("charlotte_navigate")).toBe("navigation");
      expect(getToolGroup("charlotte_click")).toBe("interaction");
      expect(getToolGroup("charlotte_cookies")).toBe("session");
      expect(getToolGroup("charlotte_dev_audit")).toBe("dev_mode");
    });

    it("returns undefined for unknown tool", () => {
      expect(getToolGroup("charlotte_nonexistent")).toBeUndefined();
    });
  });

  describe("PROFILE_TOOLS", () => {
    const allToolNameSet = new Set(ALL_TOOL_NAMES);
    const profileNames = Object.keys(PROFILE_TOOLS) as ToolProfile[];

    it.each(profileNames)("%s profile contains only valid tool names", (profile) => {
      for (const toolName of PROFILE_TOOLS[profile]) {
        expect(allToolNameSet.has(toolName)).toBe(true);
      }
    });

    it.each(profileNames)("%s profile has no duplicate entries", (profile) => {
      const unique = new Set(PROFILE_TOOLS[profile]);
      expect(unique.size).toBe(PROFILE_TOOLS[profile].length);
    });
  });

  describe("GROUP_DESCRIPTIONS", () => {
    it("has descriptions for all groups", () => {
      for (const group of ALL_GROUP_NAMES) {
        expect(GROUP_DESCRIPTIONS[group]).toBeDefined();
        expect(typeof GROUP_DESCRIPTIONS[group]).toBe("string");
        expect(GROUP_DESCRIPTIONS[group].length).toBeGreaterThan(0);
      }
    });
  });
});
