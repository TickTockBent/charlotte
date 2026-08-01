import { describe, it, expect } from "vitest";
import { buildServerInstructions } from "../../../src/server.js";
import { resolveProfile, resolveGroups } from "../../../src/tools/tool-groups.js";

describe("buildServerInstructions (#204 partial-group discoverability)", () => {
  it("lists partially-enabled groups with enabled count and the tools to enable for", () => {
    // browse enables 7 of 13 interaction tools (no drag/key/fill_form/upload/wait_for/hover).
    const enabled = resolveProfile("browse");
    const instructions = buildServerInstructions(enabled, "Active profile: browse.");

    expect(instructions).toContain("Partially-enabled groups");
    expect(instructions).toContain("interaction (7/13 enabled");
    // The hidden tools are named so the agent knows what enabling unlocks.
    expect(instructions).toContain("fill_form");
    expect(instructions).toContain("drag");
    expect(instructions).toContain("key");
    expect(instructions).toContain("hover");
  });

  it("still lists fully-disabled groups", () => {
    const enabled = resolveProfile("browse");
    const instructions = buildServerInstructions(enabled, "Active profile: browse.");

    // dialog and evaluate are fully disabled under browse.
    expect(instructions).toContain("Additional tool groups available");
    expect(instructions).toContain("dialog:");
    expect(instructions).toContain("evaluate:");
  });

  it("does not flag a group as partial when it is fully enabled", () => {
    // full profile enables every tool — no partial or disabled groups.
    const enabled = resolveProfile("full");
    const instructions = buildServerInstructions(enabled, "Active profile: full.");

    expect(instructions).not.toContain("Partially-enabled groups");
    expect(instructions).not.toContain("Additional tool groups available");
    expect(instructions).not.toContain("Call charlotte_tools");
  });

  it("drops the charlotte_tools call-to-action when the meta-tool is absent (HTTP mode)", () => {
    const enabled = resolveProfile("browse");
    const instructions = buildServerInstructions(enabled, "Active profile: browse.", {
      metaToolAvailable: false,
    });

    // The group inventory is still served — an agent should know what this
    // deployment does not expose — but nothing tells it to call a tool that
    // is not registered.
    expect(instructions).not.toContain("charlotte_tools");
    expect(instructions).toContain("Tool groups not exposed by this server:");
    expect(instructions).toContain("interaction (7/13 exposed — not exposed:");
    expect(instructions).toContain("fill_form");
    expect(instructions).toContain(
      "The tool set is fixed for this server; change the server config (http.profile) to expose more.",
    );
  });

  it("keeps the stdio wording by default", () => {
    const enabled = resolveProfile("browse");
    expect(buildServerInstructions(enabled, "Active profile: browse.")).toBe(
      buildServerInstructions(enabled, "Active profile: browse.", { metaToolAvailable: true }),
    );
  });

  it("treats a fully-enabled single group selection without partial markers", () => {
    const enabled = resolveGroups(["interaction"]);
    const instructions = buildServerInstructions(enabled, "Active groups: interaction.");

    // interaction is fully enabled, so it is neither disabled nor partial.
    expect(instructions).not.toContain("interaction (");
  });
});
