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

    it("contains all 41 tools across groups", () => {
      expect(ALL_TOOL_NAMES).toHaveLength(41);
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

    it("navigation group has 4 tools", () => {
      expect(TOOL_GROUPS.navigation).toHaveLength(4);
      expect(TOOL_GROUPS.navigation).toContain("charlotte:navigate");
      expect(TOOL_GROUPS.navigation).toContain("charlotte:back");
      expect(TOOL_GROUPS.navigation).toContain("charlotte:forward");
      expect(TOOL_GROUPS.navigation).toContain("charlotte:reload");
    });

    it("interaction group has 12 tools", () => {
      expect(TOOL_GROUPS.interaction).toHaveLength(12);
    });

    it("session group has 11 tools", () => {
      expect(TOOL_GROUPS.session).toHaveLength(11);
    });

    it("observation group has 7 tools", () => {
      expect(TOOL_GROUPS.observation).toHaveLength(7);
    });
  });

  describe("resolveProfile", () => {
    it("core profile has 6 tools", () => {
      const tools = resolveProfile("core");
      expect(tools.size).toBe(6);
      expect(tools.has("charlotte:navigate")).toBe(true);
      expect(tools.has("charlotte:observe")).toBe(true);
      expect(tools.has("charlotte:find")).toBe(true);
      expect(tools.has("charlotte:click")).toBe(true);
      expect(tools.has("charlotte:type")).toBe(true);
      expect(tools.has("charlotte:submit")).toBe(true);
    });

    it("browse profile includes navigation, observation, partial interaction, and tabs", () => {
      const tools = resolveProfile("browse");
      // Exact size: 4 nav + 7 obs + 7 interaction + 4 tabs = 22
      expect(tools.size).toBe(22);
      // Navigation (all 4)
      expect(tools.has("charlotte:navigate")).toBe(true);
      expect(tools.has("charlotte:back")).toBe(true);
      expect(tools.has("charlotte:forward")).toBe(true);
      expect(tools.has("charlotte:reload")).toBe(true);
      // Observation (all 7)
      expect(tools.has("charlotte:observe")).toBe(true);
      expect(tools.has("charlotte:find")).toBe(true);
      expect(tools.has("charlotte:screenshot")).toBe(true);
      expect(tools.has("charlotte:diff")).toBe(true);
      // Interaction (partial — 6)
      expect(tools.has("charlotte:click")).toBe(true);
      expect(tools.has("charlotte:type")).toBe(true);
      expect(tools.has("charlotte:scroll")).toBe(true);
      // Not in browse:
      expect(tools.has("charlotte:drag")).toBe(false);
      expect(tools.has("charlotte:hover")).toBe(false);
      expect(tools.has("charlotte:key")).toBe(false);
      expect(tools.has("charlotte:wait_for")).toBe(false);
      // Tabs are included
      expect(tools.has("charlotte:tabs")).toBe(true);
      expect(tools.has("charlotte:tab_open")).toBe(true);
      // Session management is not included
      expect(tools.has("charlotte:get_cookies")).toBe(false);
      expect(tools.has("charlotte:network")).toBe(false);
      // No dev_mode, dialog, evaluate, monitoring
      expect(tools.has("charlotte:dev_serve")).toBe(false);
      expect(tools.has("charlotte:dialog")).toBe(false);
      expect(tools.has("charlotte:evaluate")).toBe(false);
      expect(tools.has("charlotte:console")).toBe(false);
    });

    it("interact profile includes all interaction tools plus dialog and evaluate", () => {
      const tools = resolveProfile("interact");
      // Exact size: 4 nav + 7 obs + 12 interaction + 4 tabs + dialog + evaluate = 29
      expect(tools.size).toBe(29);
      expect(tools.has("charlotte:drag")).toBe(true);
      expect(tools.has("charlotte:hover")).toBe(true);
      expect(tools.has("charlotte:key")).toBe(true);
      expect(tools.has("charlotte:wait_for")).toBe(true);
      expect(tools.has("charlotte:dialog")).toBe(true);
      expect(tools.has("charlotte:evaluate")).toBe(true);
      // Not in interact:
      expect(tools.has("charlotte:dev_serve")).toBe(false);
      expect(tools.has("charlotte:dev_inject")).toBe(false);
      expect(tools.has("charlotte:dev_audit")).toBe(false);
      expect(tools.has("charlotte:get_cookies")).toBe(false);
      expect(tools.has("charlotte:network")).toBe(false);
      expect(tools.has("charlotte:console")).toBe(false);
      expect(tools.has("charlotte:configure")).toBe(false);
    });

    it("develop profile includes dev_mode tools", () => {
      const tools = resolveProfile("develop");
      // Exact size: interact (29) + 3 dev_mode = 32
      expect(tools.size).toBe(32);
      expect(tools.has("charlotte:dev_serve")).toBe(true);
      expect(tools.has("charlotte:dev_inject")).toBe(true);
      expect(tools.has("charlotte:dev_audit")).toBe(true);
      // Not in develop:
      expect(tools.has("charlotte:get_cookies")).toBe(false);
      expect(tools.has("charlotte:network")).toBe(false);
      expect(tools.has("charlotte:console")).toBe(false);
      expect(tools.has("charlotte:configure")).toBe(false);
      expect(tools.has("charlotte:set_headers")).toBe(false);
    });

    it("audit profile includes dev_audit and viewport but not full dev_mode or interaction", () => {
      const tools = resolveProfile("audit");
      // Exact size: 4 nav + 7 obs + dev_audit + viewport = 13
      expect(tools.size).toBe(13);
      expect(tools.has("charlotte:dev_audit")).toBe(true);
      expect(tools.has("charlotte:viewport")).toBe(true);
      // Not in audit:
      expect(tools.has("charlotte:dev_serve")).toBe(false);
      expect(tools.has("charlotte:dev_inject")).toBe(false);
      expect(tools.has("charlotte:click")).toBe(false);
      expect(tools.has("charlotte:type")).toBe(false);
      expect(tools.has("charlotte:dialog")).toBe(false);
      expect(tools.has("charlotte:evaluate")).toBe(false);
      expect(tools.has("charlotte:tabs")).toBe(false);
      expect(tools.has("charlotte:console")).toBe(false);
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
      expect(tools.size).toBe(4);
      expect(tools.has("charlotte:navigate")).toBe(true);
    });

    it("resolves multiple groups", () => {
      const tools = resolveGroups(["navigation", "observation"]);
      expect(tools.size).toBe(11); // 4 + 7
    });

    it("handles empty array", () => {
      const tools = resolveGroups([]);
      expect(tools.size).toBe(0);
    });
  });

  describe("getToolGroup", () => {
    it("returns correct group for a tool", () => {
      expect(getToolGroup("charlotte:navigate")).toBe("navigation");
      expect(getToolGroup("charlotte:click")).toBe("interaction");
      expect(getToolGroup("charlotte:get_cookies")).toBe("session");
      expect(getToolGroup("charlotte:dev_audit")).toBe("dev_mode");
    });

    it("returns undefined for unknown tool", () => {
      expect(getToolGroup("charlotte:nonexistent")).toBeUndefined();
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
