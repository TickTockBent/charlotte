import { describe, it, expect, beforeEach, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/server";
import type { RegisteredTool } from "@modelcontextprotocol/server";
import {
  registerMetaTool,
  registerMetaToolReporter,
  type ToolRegistry,
} from "../../../src/tools/meta-tool.js";
import { TOOL_GROUPS, ALL_GROUP_NAMES, resolveProfile } from "../../../src/tools/tool-groups.js";

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

/**
 * SDK v2 types the bare `RegisteredTool["handler"]` for the no-inputSchema
 * registration form, whose callback receives the request context as its only
 * argument. charlotte_tools is registered WITH a schema, so its real callback
 * is `(args, ctx)`; these tests invoke it directly (no client, no transport)
 * through this locally-typed view of the same function.
 */
type MetaToolWithArgsHandler = Omit<RegisteredTool, "handler"> & {
  handler: (
    args: { action?: string; group?: string },
    ctx: unknown,
  ) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
};

describe("meta-tool", () => {
  let server: McpServer;
  let registry: ToolRegistry;
  let metaTool: MetaToolWithArgsHandler;
  let sendToolListChangedSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    server = new McpServer(
      { name: "charlotte-test", version: "0.0.1" },
      { capabilities: { tools: {} } },
    );
    registry = createMockRegistry();
    metaTool = registerMetaTool(server, registry) as unknown as MetaToolWithArgsHandler;
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

    it("sends one notification when enabling a partially-disabled group", async () => {
      const sessionTools = TOOL_GROUPS.session;
      // Disable only the first half of the group
      const disabledTools = sessionTools.slice(0, Math.floor(sessionTools.length / 2));
      for (const toolName of disabledTools) {
        registry[toolName].enabled = false;
      }

      const result = await metaTool.handler({ action: "enable", group: "session" }, {} as any);
      const parsed = JSON.parse((result as any).content[0].text);

      // Only the previously-disabled tools should count as enabled
      expect(parsed.tools_enabled).toBe(disabledTools.length);
      // Exactly one notification for the batch
      expect(sendToolListChangedSpy).toHaveBeenCalledTimes(1);
      // All tools in the group should now be enabled
      for (const toolName of sessionTools) {
        expect(registry[toolName].enabled).toBe(true);
      }
    });

    it("sends one notification when disabling a partially-enabled group", async () => {
      const sessionTools = TOOL_GROUPS.session;
      // Disable the second half so only the first half is still enabled
      const alreadyDisabled = sessionTools.slice(Math.floor(sessionTools.length / 2));
      for (const toolName of alreadyDisabled) {
        registry[toolName].enabled = false;
      }
      const stillEnabledCount = sessionTools.length - alreadyDisabled.length;

      const result = await metaTool.handler({ action: "disable", group: "session" }, {} as any);
      const parsed = JSON.parse((result as any).content[0].text);

      // Only the previously-enabled tools should count as disabled
      expect(parsed.tools_disabled).toBe(stillEnabledCount);
      // Exactly one notification for the batch
      expect(sendToolListChangedSpy).toHaveBeenCalledTimes(1);
      // All tools in the group should now be disabled
      for (const toolName of sessionTools) {
        expect(registry[toolName].enabled).toBe(false);
      }
    });

    it("does not call individual tool enable/disable methods", async () => {
      for (const toolName of TOOL_GROUPS.session) {
        registry[toolName].enabled = false;
      }

      await metaTool.handler({ action: "enable", group: "session" }, {} as any);

      for (const toolName of TOOL_GROUPS.session) {
        const tool = registry[toolName] as unknown as {
          enable: ReturnType<typeof vi.fn>;
          disable: ReturnType<typeof vi.fn>;
        };
        expect(tool.enable).not.toHaveBeenCalled();
        expect(tool.disable).not.toHaveBeenCalled();
      }
    });
  });
});

/**
 * Build a registry whose `.enabled` flags mirror what a fixed HTTP-mode
 * profile would expose — the same `resolveProfile()` set `http.ts` filters
 * `charlotteTools` through via `selectTools()` — so `getGroupStatus` reports
 * exactly what a "browse" profile server would.
 */
function createProfileRegistry(profile: Parameters<typeof resolveProfile>[0]): ToolRegistry {
  const enabledToolNames = resolveProfile(profile);
  const registry: ToolRegistry = {};
  for (const group of ALL_GROUP_NAMES) {
    for (const toolName of TOOL_GROUPS[group]) {
      registry[toolName] = {
        enabled: enabledToolNames.has(toolName),
      } as unknown as RegisteredTool;
    }
  }
  return registry;
}

describe("registerMetaToolReporter", () => {
  let server: McpServer;
  let registry: ToolRegistry;
  let reporterTool: MetaToolWithArgsHandler;

  beforeEach(() => {
    server = new McpServer(
      { name: "charlotte-test", version: "0.0.1" },
      { capabilities: { tools: {} } },
    );
    registry = createProfileRegistry("browse");
    reporterTool = registerMetaToolReporter(server, registry) as unknown as MetaToolWithArgsHandler;
  });

  it("list: reports read-only status and the browse profile's group inventory", async () => {
    const result = await reporterTool.handler({}, {} as any);
    const parsed = JSON.parse((result as any).content[0].text);

    expect(parsed.read_only).toBe(true);
    expect(parsed.groups.navigation.enabled).toBe(true);
    expect(parsed.groups.dev_mode.enabled).toBe(false);
    expect(parsed.groups.dev_mode.enabled_count).toBe(0);
    expect(parsed.groups.dev_mode.total_count).toBe(3);
  });

  it("enable: refuses and steers to http.profile, echoing the requested action and group", async () => {
    const result = await reporterTool.handler(
      { action: "enable", group: "dev_mode" },
      {} as any,
    );

    expect((result as any).isError).toBe(true);
    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed.read_only).toBe(true);
    expect(parsed.error).toContain("http.profile");
    expect(parsed.requested_action).toBe("enable");
    expect(parsed.group).toBe("dev_mode");
  });

  it("disable (no group): refuses, mentions the fixed tool set, and omits the group key", async () => {
    const result = await reporterTool.handler({ action: "disable" }, {} as any);

    expect((result as any).isError).toBe(true);
    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed.error).toMatch(/fixed/i);
    expect(parsed).not.toHaveProperty("group");
  });

  it("never mutates the registry: a list after a refused enable still shows dev_mode disabled", async () => {
    await reporterTool.handler({ action: "enable", group: "dev_mode" }, {} as any);

    const result = await reporterTool.handler({ action: "list" }, {} as any);
    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed.groups.dev_mode.enabled).toBe(false);
    expect(parsed.groups.dev_mode.enabled_count).toBe(0);
  });
});
