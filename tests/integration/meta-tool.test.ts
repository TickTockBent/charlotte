/**
 * Integration test for the charlotte_tools meta-tool exercised through a real
 * MCP client (#195).
 *
 * The meta-tool's unit tests (tests/unit/tools/meta-tool.test.ts) drive its
 * handler directly against a mock registry. They never prove that toggling a
 * group through `callTool` actually changes what the SAME connected client can
 * call. This test closes that gap end-to-end:
 *
 *   1. tools/list via the client — a disabled group's tools are absent.
 *   2. callTool("charlotte_tools", { action: "list" }) — response shape matches
 *      the unit-test expectations (a `groups` map keyed by group name with an
 *      `enabled` boolean each).
 *   3. enable the disabled group via the meta-tool, then confirm one of its
 *      tools is now both listed AND callable through the same client.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupMcpHarness, parseToolJson, type McpHarness } from "../helpers/mcp-harness.js";
import { TOOL_GROUPS, ALL_GROUP_NAMES } from "../../src/tools/tool-groups.js";

describe("charlotte_tools meta-tool (via MCP client)", () => {
  let harness: McpHarness;

  beforeAll(async () => {
    // The "core" profile excludes the monitoring group (charlotte_console,
    // charlotte_requests), so it starts disabled and we can enable it at runtime.
    harness = await setupMcpHarness({ profile: "core" });
  });

  afterAll(async () => {
    await harness.teardown();
  });

  const MONITORING_TOOL = TOOL_GROUPS.monitoring[0]; // charlotte_console

  it("omits a disabled group's tools from tools/list", async () => {
    const { tools } = await harness.client.listTools();
    const names = tools.map((t) => t.name);
    // The meta-tool is always available.
    expect(names).toContain("charlotte_tools");
    // Monitoring tools are not in the core profile → absent from the list.
    expect(names).not.toContain(MONITORING_TOOL);
  });

  it("callTool(charlotte_tools, {action:list}) returns the documented shape", async () => {
    const parsed = parseToolJson<{
      groups: Record<string, { enabled: boolean }>;
    }>(await harness.callTool("charlotte_tools", { action: "list" }));

    // Same shape the unit tests assert: a groups map keyed by every group name.
    expect(parsed.groups).toBeDefined();
    expect(Object.keys(parsed.groups).sort()).toEqual([...ALL_GROUP_NAMES].sort());
    // monitoring is entirely outside the core profile → reported disabled.
    expect(parsed.groups.monitoring.enabled).toBe(false);
    // Every group carries a boolean `enabled` flag (matches the unit tests).
    for (const group of ALL_GROUP_NAMES) {
      expect(typeof parsed.groups[group].enabled).toBe("boolean");
    }
  });

  it("a disabled tool is not callable before its group is enabled", async () => {
    const result = await harness.callTool(MONITORING_TOOL, {});
    // Calling a disabled/unknown tool surfaces an error through the same client.
    expect(result.isError).toBe(true);
  });

  it("enabling the group via the meta-tool makes its tool listed and callable", async () => {
    const enableResult = parseToolJson<{
      action: string;
      group: string;
      tools_enabled: number;
    }>(await harness.callTool("charlotte_tools", { action: "enable", group: "monitoring" }));
    expect(enableResult.action).toBe("enable");
    expect(enableResult.group).toBe("monitoring");
    expect(enableResult.tools_enabled).toBe(TOOL_GROUPS.monitoring.length);

    // Now the tool appears in tools/list for the SAME client.
    const { tools } = await harness.client.listTools();
    expect(tools.map((t) => t.name)).toContain(MONITORING_TOOL);

    // And it is actually callable now (charlotte_console returns the console log
    // buffer for the active page — succeeds against the harness's real browser).
    const consoleResult = await harness.callTool(MONITORING_TOOL, {});
    expect(consoleResult.isError).toBeFalsy();
  });
});
