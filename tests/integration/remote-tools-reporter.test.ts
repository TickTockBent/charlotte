/**
 * Integration test for the read-only `charlotte_tools` reporter over HTTP
 * (D3, "no-dev-tools" scenario coverage).
 *
 * Over stdio the meta-tool mutates a per-connection tool registry. Over HTTP
 * the tool set is fixed at startup (stateless — no per-connection registry to
 * mutate — see `src/transports/http.ts`), so `registerMetaToolReporter`
 * (`src/tools/meta-tool.ts`) is wired in instead: it reports the exposed
 * group/tool inventory but refuses+steers any enable/disable attempt to the
 * `http.profile` config knob, and never mutates anything.
 *
 * This closes the same real-client gap `tests/integration/meta-tool.test.ts`
 * closes for stdio: a mock-registry unit test never proves the SAME connected
 * client sees the surface it expects, or that a refused mutation attempt
 * leaves that surface unchanged.
 */
import { describe, it, expect, afterEach } from "vitest";
import { setupHttpHarness, type HttpHarness } from "../helpers/http-harness.js";
import { parseToolJson } from "../helpers/mcp-harness.js";

const DEV_TOOLS = ["charlotte_dev_serve", "charlotte_dev_inject", "charlotte_dev_audit"];

interface GroupStatus {
  enabled: boolean;
  enabled_count: number;
  total_count: number;
}

interface ReporterListPayload {
  read_only: boolean;
  groups: Record<string, GroupStatus>;
}

interface ReporterRefusalPayload {
  read_only: boolean;
  error: string;
  requested_action: string;
  group?: string;
}

describe("HTTP charlotte_tools reporter (D3, read-only)", () => {
  let harness: HttpHarness | undefined;

  afterEach(async () => {
    await harness?.teardown();
    harness = undefined;
  });

  it("is present and excludes dev tools on the default (browse) surface", async () => {
    harness = await setupHttpHarness({ profile: "browse" });

    const { tools } = await harness.client.listTools();
    const names = tools.map((t) => t.name);

    expect(names).toContain("charlotte_tools");
    for (const devTool of DEV_TOOLS) {
      expect(names).not.toContain(devTool);
    }
  });

  it("list reports read-only status and the browse profile's dev_mode as unexposed", async () => {
    harness = await setupHttpHarness({ profile: "browse" });

    const parsed = parseToolJson<ReporterListPayload>(await harness.callTool("charlotte_tools"));

    expect(parsed.read_only).toBe(true);
    expect(parsed.groups.navigation.enabled).toBe(true);
    expect(parsed.groups.dev_mode.enabled).toBe(false);
    expect(parsed.groups.dev_mode.enabled_count).toBe(0);
  });

  it("refuses+steers an enable attempt and leaves the exposed surface unchanged", async () => {
    harness = await setupHttpHarness({ profile: "browse" });

    const result = await harness.callTool("charlotte_tools", {
      action: "enable",
      group: "dev_mode",
    });
    expect(result.isError).toBe(true);
    const parsed = parseToolJson<ReporterRefusalPayload>(result);
    expect(parsed.error).toContain("http.profile");

    // The surface is unchanged — no per-connection registry was mutated.
    const { tools } = await harness.client.listTools();
    const names = tools.map((t) => t.name);
    for (const devTool of DEV_TOOLS) {
      expect(names).not.toContain(devTool);
    }
  });

  it("a full profile exposes dev tools and the reporter reflects dev_mode as enabled", async () => {
    harness = await setupHttpHarness({ profile: "full" });

    const { tools } = await harness.client.listTools();
    const names = tools.map((t) => t.name);
    for (const devTool of DEV_TOOLS) {
      expect(names).toContain(devTool);
    }

    const parsed = parseToolJson<ReporterListPayload>(await harness.callTool("charlotte_tools"));
    expect(parsed.groups.dev_mode.enabled).toBe(true);
  });
});
