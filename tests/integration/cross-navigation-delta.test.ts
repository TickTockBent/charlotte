/**
 * End-to-end guard for finding G3 / decision D11.
 *
 * G3: an interaction tool (charlotte_click) that causes a cross-document
 * navigation used to emit a structural `delta` listing every element of the
 * old page as "removed" and every element of the new page as "added" —
 * hundreds of changes of pure noise, the single biggest token cost seen in
 * the live gate.
 *
 * D11 fixed this in src/state/differ.ts: when renderAfterAction
 * (src/core/tool-helpers.ts) detects the click crossed documents
 * (isCrossDocumentNavigation), the delta collapses to buildNavigationDiff's
 * compact navigation summary instead of the full element-level diff.
 *
 * D11 shipped with unit coverage of isCrossDocumentNavigation/
 * buildNavigationDiff in isolation only. This test is the missing
 * integration guard: it drives a real charlotte_click through the MCP
 * harness against a served fixture pair and asserts the actual tool
 * response's `delta` field is the collapsed form — the only test that would
 * catch a future refactor silently breaking the renderAfterAction
 * cross-navigation branch.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import { setupMcpHarness, parseToolJson, type McpHarness } from "../helpers/mcp-harness.js";
import type { SnapshotDiff } from "../../src/types/snapshot.js";

const FIXTURES = path.resolve(import.meta.dirname, "../fixtures/pages");

interface ClickResponse {
  url: string;
  title: string;
  snapshot_id: number;
  delta?: SnapshotDiff;
}

interface FindResponse {
  elements: Array<{ id: string }>;
}

describe("cross-document navigation delta collapse (G3 / D11)", () => {
  let harness: McpHarness;

  beforeAll(async () => {
    harness = await setupMcpHarness({ profile: "full", serveDirectory: FIXTURES });
  });

  afterAll(async () => {
    await harness.teardown();
  });

  it("collapses the delta to a navigation summary when a click crosses documents", async () => {
    const pageAUrl = `${harness.fixtureServer!.url}/cross-nav-a.html`;

    const navResult = await harness.callTool("charlotte_navigate", { url: pageAUrl });
    expect(navResult.isError).toBeFalsy();

    // Find the link by its visible text, then click it — this triggers a real
    // cross-document navigation from cross-nav-a.html to cross-nav-b.html.
    const found = parseToolJson<FindResponse>(
      await harness.callTool("charlotte_find", { text: "Go to page B" }),
    );
    expect(found.elements.length).toBeGreaterThan(0);
    const linkId = found.elements[0].id;

    const clickResult = await harness.callTool("charlotte_click", { element_id: linkId });
    expect(clickResult.isError).toBeFalsy();

    const clicked = parseToolJson<ClickResponse>(clickResult);
    expect(clicked.url).toContain("cross-nav-b.html");
    expect(clicked.title).toBe("Cross Navigation Page B");

    // The delta must be present and must be the COLLAPSED navigation form,
    // not an element-level diff of two unrelated pages.
    expect(clicked.delta).toBeDefined();
    const delta = clicked.delta!;

    expect(delta.summary).toContain("page replaced; element-level diff omitted");
    expect(delta.summary).toContain(
      `Navigation: ${pageAUrl} → ${harness.fixtureServer!.url}/cross-nav-b.html`,
    );

    // Exactly the url (+ title) changed entries — no element add/remove noise.
    const urlChange = delta.changes.find((change) => change.property === "url");
    expect(urlChange).toBeDefined();
    expect(urlChange!.type).toBe("changed");
    expect(urlChange!.from).toBe(pageAUrl);
    expect(urlChange!.to).toBe(`${harness.fixtureServer!.url}/cross-nav-b.html`);

    const addedOrRemoved = delta.changes.filter(
      (change) => change.type === "added" || change.type === "removed",
    );
    expect(addedOrRemoved).toHaveLength(0);

    // Small, bounded change count (url + title), NOT the dozens/hundreds an
    // un-collapsed element-level diff of these two fixtures would produce
    // (cross-nav-a.html alone has 3 headings, 3 sections, 9 list items, a
    // link, a button, and a text input — well over a dozen elements).
    expect(delta.changes.length).toBeLessThanOrEqual(3);
  });

  it("negative control: a same-page interaction still yields a real element-level delta", async () => {
    const interactionUrl = `${harness.fixtureServer!.url}/interaction.html`;
    await harness.callTool("charlotte_navigate", { url: interactionUrl });

    const found = parseToolJson<FindResponse>(
      await harness.callTool("charlotte_find", { text: "Click Me" }),
    );
    expect(found.elements.length).toBeGreaterThan(0);

    const clickResult = await harness.callTool("charlotte_click", {
      element_id: found.elements[0].id,
    });
    expect(clickResult.isError).toBeFalsy();

    const clicked = parseToolJson<ClickResponse>(clickResult);
    // No navigation happened — same document.
    expect(clicked.url).toContain("interaction.html");
    expect(clicked.delta).toBeDefined();

    const delta = clicked.delta!;
    // This must NOT look like the collapsed navigation form — it discriminates
    // the positive-case assertions above from "any delta will do".
    expect(delta.summary).not.toContain("page replaced; element-level diff omitted");
    expect(delta.summary).not.toContain("Navigation:");
    // And it must carry real content: the click mutates #result's text, which
    // shows up as a content_summary change at the default "summary" detail.
    expect(delta.changes.length).toBeGreaterThan(0);
  });
});
