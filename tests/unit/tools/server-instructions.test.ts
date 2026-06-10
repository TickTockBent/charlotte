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

  it("treats a fully-enabled single group selection without partial markers", () => {
    const enabled = resolveGroups(["interaction"]);
    const instructions = buildServerInstructions(enabled, "Active groups: interaction.");

    // interaction is fully enabled, so it is neither disabled nor partial.
    expect(instructions).not.toContain("interaction (");
  });
});
