import { describe, it, expect } from "vitest";
import {
  resolveProfile,
  resolveGroups,
  ALL_TOOL_NAMES,
  type ToolProfile,
} from "../../../src/tools/tool-groups.js";

describe("server profile integration", () => {
  describe("profile resolution consistency", () => {
    const allProfiles: ToolProfile[] = ["core", "browse", "interact", "develop", "audit", "full"];

    for (const profile of allProfiles) {
      it(`${profile} profile resolves to valid tool names`, () => {
        const tools = resolveProfile(profile);
        for (const tool of tools) {
          expect(ALL_TOOL_NAMES).toContain(tool);
        }
      });
    }

    it("profiles are ordered by size: core < browse < interact < develop", () => {
      const core = resolveProfile("core");
      const browse = resolveProfile("browse");
      const interact = resolveProfile("interact");
      const develop = resolveProfile("develop");
      const full = resolveProfile("full");

      expect(core.size).toBeLessThan(browse.size);
      expect(browse.size).toBeLessThan(interact.size);
      expect(interact.size).toBeLessThan(develop.size);
      expect(develop.size).toBeLessThanOrEqual(full.size);
    });

    it("core is a subset of browse", () => {
      const core = resolveProfile("core");
      const browse = resolveProfile("browse");
      for (const tool of core) {
        expect(browse.has(tool)).toBe(true);
      }
    });

    it("browse is a subset of interact", () => {
      const browse = resolveProfile("browse");
      const interact = resolveProfile("interact");
      for (const tool of browse) {
        expect(interact.has(tool)).toBe(true);
      }
    });

    it("interact is a subset of develop", () => {
      const interact = resolveProfile("interact");
      const develop = resolveProfile("develop");
      for (const tool of interact) {
        expect(develop.has(tool)).toBe(true);
      }
    });
  });

  describe("granular group selection", () => {
    it("navigation + observation gives 11 tools", () => {
      const tools = resolveGroups(["navigation", "observation"]);
      expect(tools.size).toBe(11);
    });

    it("all groups together equals full profile", () => {
      const allGroups = resolveGroups([
        "navigation",
        "observation",
        "interaction",
        "session",
        "dev_mode",
        "dialog",
        "evaluate",
        "monitoring",
      ]);
      const full = resolveProfile("full");
      expect(allGroups.size).toBe(full.size);
      for (const tool of full) {
        expect(allGroups.has(tool)).toBe(true);
      }
    });
  });
});
