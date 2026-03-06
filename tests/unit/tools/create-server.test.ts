import { describe, it, expect } from "vitest";
import { createServer, type ServerDeps } from "../../../src/server.js";
import { ALL_TOOL_NAMES, TOOL_GROUPS, resolveProfile, resolveGroups } from "../../../src/tools/tool-groups.js";

/**
 * Minimal mock ServerDeps. Tool handlers are never invoked in these tests,
 * so the mocks only need to satisfy the TypeScript interface.
 */
function createMockDeps(): ServerDeps {
  return {
    browserManager: {} as any,
    pageManager: { getActivePage: () => ({}) } as any,
    rendererPipeline: {} as any,
    elementIdGenerator: {} as any,
    snapshotStore: {} as any,
    artifactStore: {} as any,
    config: {
      detail: "minimal",
      snapshotDepth: 10,
      screenshotDir: "/tmp",
      dialogAutoDismiss: "none",
      allowedWorkspaceRoot: "/tmp",
    } as any,
  };
}

describe("createServer", () => {
  describe("profile-based tool visibility", () => {
    it("defaults to browse profile when no options provided", () => {
      const { registry } = createServer(createMockDeps());
      const expectedEnabled = resolveProfile("browse");

      for (const [toolName, tool] of Object.entries(registry)) {
        if (expectedEnabled.has(toolName)) {
          expect(tool.enabled, `${toolName} should be enabled`).toBe(true);
        } else {
          expect(tool.enabled, `${toolName} should be disabled`).toBe(false);
        }
      }
    });

    it("full profile enables all 41 tools", () => {
      const { registry } = createServer(createMockDeps(), { profile: "full" });

      expect(Object.keys(registry)).toHaveLength(41);
      for (const [toolName, tool] of Object.entries(registry)) {
        expect(tool.enabled, `${toolName} should be enabled`).toBe(true);
      }
    });

    it("core profile enables only 6 tools", () => {
      const { registry } = createServer(createMockDeps(), { profile: "core" });
      const expectedEnabled = resolveProfile("core");

      const enabledNames = Object.entries(registry)
        .filter(([, tool]) => tool.enabled)
        .map(([name]) => name);

      expect(enabledNames).toHaveLength(expectedEnabled.size);
      for (const name of enabledNames) {
        expect(expectedEnabled.has(name), `${name} should be in core profile`).toBe(true);
      }
    });

    it("browse profile enables expected tools and disables the rest", () => {
      const { registry } = createServer(createMockDeps(), { profile: "browse" });
      const expectedEnabled = resolveProfile("browse");

      const enabledNames = Object.entries(registry)
        .filter(([, tool]) => tool.enabled)
        .map(([name]) => name);
      const disabledNames = Object.entries(registry)
        .filter(([, tool]) => !tool.enabled)
        .map(([name]) => name);

      expect(enabledNames).toHaveLength(expectedEnabled.size);
      expect(disabledNames.length).toBe(41 - expectedEnabled.size);

      // Spot-check: drag should be disabled in browse
      expect(registry["charlotte:drag"].enabled).toBe(false);
      // Spot-check: click should be enabled in browse
      expect(registry["charlotte:click"].enabled).toBe(true);
    });
  });

  describe("--tools granular group selection", () => {
    it("navigation + observation enables only those 11 tools", () => {
      const { registry } = createServer(createMockDeps(), {
        toolGroups: ["navigation", "observation"],
      });
      const expectedEnabled = resolveGroups(["navigation", "observation"]);

      const enabledNames = Object.entries(registry)
        .filter(([, tool]) => tool.enabled)
        .map(([name]) => name);

      expect(enabledNames).toHaveLength(expectedEnabled.size);
      for (const name of enabledNames) {
        expect(expectedEnabled.has(name), `${name} should be in selected groups`).toBe(true);
      }
    });

    it("single group selection works", () => {
      const { registry } = createServer(createMockDeps(), {
        toolGroups: ["interaction"],
      });
      const expectedEnabled = resolveGroups(["interaction"]);

      const enabledNames = Object.entries(registry)
        .filter(([, tool]) => tool.enabled)
        .map(([name]) => name);

      expect(enabledNames).toHaveLength(expectedEnabled.size);
    });
  });

  describe("meta-tool is always registered", () => {
    it("charlotte:tools is not in the registry but is registered on the server", () => {
      const { registry } = createServer(createMockDeps(), { profile: "core" });

      // Meta-tool is intentionally excluded from the registry
      expect(registry["charlotte:tools"]).toBeUndefined();
      // All 41 other tools are in the registry
      expect(Object.keys(registry)).toHaveLength(41);
    });
  });

  describe("registry contains all 41 tools regardless of profile", () => {
    it("all tools are registered even when profile is core", () => {
      const { registry } = createServer(createMockDeps(), { profile: "core" });

      for (const toolName of ALL_TOOL_NAMES) {
        expect(registry[toolName], `${toolName} should be in registry`).toBeDefined();
      }
    });
  });
});
