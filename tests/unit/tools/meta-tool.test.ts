import { describe, it, expect, beforeEach, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMetaTool, type ToolRegistry } from "../../../src/tools/meta-tool.js";
import { TOOL_GROUPS, ALL_GROUP_NAMES } from "../../../src/tools/tool-groups.js";

/**
 * Create a minimal mock registry where each tool has enable/disable/enabled.
 * The enable/disable methods are spied on so tests can verify they are NOT
 * called (the meta-tool should set .enabled directly and batch notifications).
 */
function createMockRegistry(): ToolRegistry {
  const registry: ToolRegistry = {};
  for (const group of ALL_GROUP_NAMES) {
    for (const toolName of TOOL_GROUPS[group]) {
      registry[toolName] = {
        enabled: true,
        enable: vi.fn(function (this: { enabled: boolean }) {
          this.enabled = true;
        }),
        disable: vi.fn(function (this: { enabled: boolean }) {
          this.enabled = false;
        }),
      } as unknown as RegisteredTool;
    }
  }
  return registry;
}

describe("meta-tool", () => {
  let server: McpServer;
  let registry: ToolRegistry;
  let metaTool: RegisteredTool;
  let sendToolListChangedSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    server = new McpServer(
      { name: "charlotte-test", version: "0.0.1" },
      { capabilities: { tools: {} } },
    );
    registry = createMockRegistry();
    metaTool = registerMetaTool(server, registry);
    sendToolListChangedSpy = vi.spyOn(server, "sendToolListChanged");
  });

  it("registers charlotte_tools tool", () => {
    expect(metaTool).toBeDefined();
    expect(metaTool.enabled).toBe(true);
  });

  describe("list action", () => {
    it("returns all groups with status", async () => {
      const result = await metaTool.handler({ action: "list" }, {} as any);
      const parsed = JSON.parse((result as any).content[0].text);
      expect(parsed.groups).toBeDefined();
      expect(Object.keys(parsed.groups)).toHaveLength(ALL_GROUP_NAMES.length);
      // All should be enabled initially
      for (const group of ALL_GROUP_NAMES) {
        expect(parsed.groups[group].enabled).toBe(true);
      }
    });

    it("defaults to list when no action provided", async () => {
      const result = await metaTool.handler({}, {} as any);
      const parsed = JSON.parse((result as any).content[0].text);
      expect(parsed.groups).toBeDefined();
    });
  });

  describe("enable action", () => {
    it("enables a disabled group", async () => {
      // First disable all interaction tools
      for (const tool of TOOL_GROUPS.interaction) {
        registry[tool].enabled = false;
      }

      const result = await metaTool.handler({ action: "enable", group: "interaction" }, {} as any);
      const parsed = JSON.parse((result as any).content[0].text);
      expect(parsed.action).toBe("enable");
      expect(parsed.group).toBe("interaction");
      expect(parsed.tools_enabled).toBe(TOOL_GROUPS.interaction.length);

      // Verify all interaction tools are now enabled
      for (const toolName of TOOL_GROUPS.interaction) {
        expect(registry[toolName].enabled).toBe(true);
      }
    });

    it("reports 0 tools enabled if group already enabled", async () => {
      const result = await metaTool.handler({ action: "enable", group: "navigation" }, {} as any);
      const parsed = JSON.parse((result as any).content[0].text);
      expect(parsed.tools_enabled).toBe(0);
    });
  });

  describe("disable action", () => {
    it("disables an enabled group", async () => {
      const result = await metaTool.handler({ action: "disable", group: "session" }, {} as any);
      const parsed = JSON.parse((result as any).content[0].text);
      expect(parsed.action).toBe("disable");
      expect(parsed.group).toBe("session");
      expect(parsed.tools_disabled).toBe(TOOL_GROUPS.session.length);

      // Verify all session tools are now disabled
      for (const toolName of TOOL_GROUPS.session) {
        expect(registry[toolName].enabled).toBe(false);
      }
    });

    it("reports 0 tools disabled if group already disabled", async () => {
      // First disable
      for (const tool of TOOL_GROUPS.monitoring) {
        registry[tool].enabled = false;
      }

      const result = await metaTool.handler({ action: "disable", group: "monitoring" }, {} as any);
      const parsed = JSON.parse((result as any).content[0].text);
      expect(parsed.tools_disabled).toBe(0);
    });
  });

  describe("group status reflects actual state", () => {
    it("shows group as disabled when all tools are disabled", async () => {
      for (const tool of TOOL_GROUPS.dev_mode) {
        registry[tool].enabled = false;
      }

      const result = await metaTool.handler({ action: "list" }, {} as any);
      const parsed = JSON.parse((result as any).content[0].text);
      expect(parsed.groups.dev_mode.enabled).toBe(false);
      // Other groups should still be enabled
      expect(parsed.groups.navigation.enabled).toBe(true);
    });
  });

  describe("tool list change notifications (#146)", () => {
    it("sends exactly one notification when enabling a group", async () => {
      for (const toolName of TOOL_GROUPS.session) {
        registry[toolName].enabled = false;
      }

      await metaTool.handler({ action: "enable", group: "session" }, {} as any);

      expect(sendToolListChangedSpy).toHaveBeenCalledTimes(1);
    });

    it("sends exactly one notification when disabling a group", async () => {
      await metaTool.handler({ action: "disable", group: "session" }, {} as any);

      expect(sendToolListChangedSpy).toHaveBeenCalledTimes(1);
    });

    it("sends no notification when enabling an already-enabled group", async () => {
      await metaTool.handler({ action: "enable", group: "navigation" }, {} as any);

      expect(sendToolListChangedSpy).not.toHaveBeenCalled();
    });

    it("sends no notification when disabling an already-disabled group", async () => {
      for (const toolName of TOOL_GROUPS.monitoring) {
        registry[toolName].enabled = false;
      }

      await metaTool.handler({ action: "disable", group: "monitoring" }, {} as any);

      expect(sendToolListChangedSpy).not.toHaveBeenCalled();
    });

    it("does not call individual tool enable/disable methods", async () => {
      for (const toolName of TOOL_GROUPS.session) {
        registry[toolName].enabled = false;
      }

      await metaTool.handler({ action: "enable", group: "session" }, {} as any);

      for (const toolName of TOOL_GROUPS.session) {
        const tool = registry[toolName] as unknown as { enable: ReturnType<typeof vi.fn>; disable: ReturnType<typeof vi.fn> };
        expect(tool.enable).not.toHaveBeenCalled();
        expect(tool.disable).not.toHaveBeenCalled();
      }
    });
  });
});
