import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import { setupMcpHarness, parseToolJson, type McpHarness } from "../helpers/mcp-harness.js";
import { pollUntil } from "../helpers/poll.js";

const SANDBOX_DIR = path.resolve(import.meta.dirname, "../sandbox");

/**
 * Keystone end-to-end test (#195): one realistic agent journey driving the
 * offline sandbox site PURELY through `callTool` against the real MCP handlers
 * over the in-memory transport — navigate -> observe -> find -> click -> type
 * -> fill_form -> submit -> back -> diff. Every step asserts on the returned
 * representation: element IDs resolve across steps, the delta/diff reports the
 * interaction, and the errors array stays empty. This is the suite's broadest
 * single check that the handlers actually work end to end, not their mirrors.
 */
interface InteractiveEl {
  id: string;
  type: string;
  label: string;
}

interface PageRep {
  url: string;
  title: string;
  structure?: { landmarks?: unknown[]; headings?: unknown[] };
  interactive?: InteractiveEl[];
  interactive_summary?: { total: number };
  forms?: Array<{ id: string; fields: string[]; submit: string | null }>;
  errors?: { console: unknown[]; network: unknown[] };
  delta?: { changes: unknown[]; summary: string };
  snapshot_id: number;
}

describe("agent flow: end-to-end journey through the sandbox via real handlers", () => {
  let harness: McpHarness;
  let baseUrl: string;

  beforeAll(async () => {
    harness = await setupMcpHarness({ profile: "full", serveDirectory: SANDBOX_DIR });
    baseUrl = harness.fixtureServer!.url;
  });

  afterAll(async () => {
    await harness.teardown();
  });

  /**
   * Assert a representation carries no page-authored console/network errors.
   *
   * `errors` is stripped from the response when empty, so its absence means
   * clean. The browser auto-requests /favicon.ico, which the offline fixture
   * server 404s — that is environmental noise (not produced by the page or our
   * handlers), so it is filtered out before asserting emptiness.
   */
  function expectNoErrors(page: PageRep): void {
    if (!page.errors) return;
    const isFaviconNoise = (entry: unknown): boolean => {
      const text = (entry as { text?: string }).text ?? "";
      const url = (entry as { url?: string }).url ?? "";
      return /favicon\.ico/.test(url) || (/404/.test(text) && !url);
    };
    expect(page.errors.console.filter((e) => !isFaviconNoise(e))).toEqual([]);
    expect(page.errors.network.filter((e) => !isFaviconNoise(e))).toEqual([]);
  }

  async function findOne(criteria: Record<string, unknown>): Promise<InteractiveEl> {
    const matches = parseToolJson<InteractiveEl[]>(
      await harness.callTool("charlotte_find", criteria),
    );
    expect(matches.length).toBeGreaterThan(0);
    return matches[0];
  }

  async function evalValue<T>(expression: string): Promise<T> {
    return parseToolJson<{ value: T }>(await harness.callTool("charlotte_evaluate", { expression }))
      .value;
  }

  it("completes navigate → observe → find → click → type → fill_form → submit → back → diff", async () => {
    // ── 1. navigate to the sandbox home ────────────────────────────────
    const home = parseToolJson<PageRep>(
      await harness.callTool("charlotte_navigate", {
        url: `${baseUrl}/index.html`,
        detail: "summary",
      }),
    );
    expect(home.url).toContain("index.html");
    expect(home.title).toBe("Charlotte Test Sandbox");
    expect(home.structure!.landmarks!.length).toBeGreaterThan(0);
    expect(home.structure!.headings!.length).toBeGreaterThan(0);
    expectNoErrors(home);

    // ── 2. observe the home page (minimal) ─────────────────────────────
    const observed = parseToolJson<PageRep>(
      await harness.callTool("charlotte_observe", { detail: "minimal" }),
    );
    expect(observed.url).toContain("index.html");
    expect(observed.interactive_summary!.total).toBeGreaterThan(0);
    expectNoErrors(observed);

    // ── 3. find the Forms nav link and click it ────────────────────────
    const formsLink = await findOne({ text: "Forms", role: "link" });
    expect(formsLink.type).toBe("link");
    const afterClickLink = parseToolJson<PageRep>(
      await harness.callTool("charlotte_click", { element_id: formsLink.id }),
    );
    // The click navigates to forms.html; the returned representation reflects it.
    expect(afterClickLink.url).toContain("forms.html");
    expectNoErrors(afterClickLink);

    // ── 4. find the Full Name field and type into it ───────────────────
    const fullName = await findOne({ type: "text_input", text: "Full Name" });
    const afterType = parseToolJson<PageRep>(
      await harness.callTool("charlotte_type", {
        element_id: fullName.id,
        text: "Ada Lovelace",
        clear_first: true,
      }),
    );
    expect(afterType.url).toContain("forms.html");
    expect(await evalValue<string>("document.getElementById('full-name').value")).toBe(
      "Ada Lovelace",
    );
    expectNoErrors(afterType);

    // ── 5. fill multiple fields in one fill_form call ──────────────────
    // Element IDs discovered now must resolve in the fill_form handler — the
    // cross-step ID stability this asserts is the heart of #195.
    const email = await findOne({ type: "text_input", text: "Email" });
    const country = await findOne({ type: "select", text: "Country" });
    const fillResult = await harness.callTool("charlotte_fill_form", {
      fields: [
        { element_id: email.id, value: "ada@analytical.engine" },
        { element_id: country.id, value: "uk" },
      ],
    });
    expect(fillResult.isError).toBeFalsy();
    expect(await evalValue<string>("document.getElementById('email').value")).toBe(
      "ada@analytical.engine",
    );
    expect(await evalValue<string>("document.getElementById('country').value")).toBe("uk");

    // ── 6. submit the contact form ─────────────────────────────────────
    const observeForms = parseToolJson<PageRep>(
      await harness.callTool("charlotte_observe", { detail: "summary" }),
    );
    const contactForm = observeForms.forms!.find((f) => f.fields.includes(fullName.id));
    expect(contactForm).toBeDefined();
    const afterSubmit = parseToolJson<PageRep>(
      await harness.callTool("charlotte_submit", { form_id: contactForm!.id }),
    );
    expect(afterSubmit.url).toContain("forms.html");
    expectNoErrors(afterSubmit);
    // The form's submit handler reveals #form-output and writes the JSON payload.
    await pollUntil(
      async () =>
        (await evalValue<boolean>(
          "document.getElementById('form-output').classList.contains('visible')",
        )) === true,
      { message: "form output never became visible after submit" },
    );
    const submittedData = await evalValue<string>(
      "document.getElementById('form-data').textContent",
    );
    expect(submittedData).toContain("Ada Lovelace");
    expect(submittedData).toContain("ada@analytical.engine");

    // ── 7. navigate to the interactive page and exercise click + diff ──
    parseToolJson<PageRep>(
      await harness.callTool("charlotte_navigate", {
        url: `${baseUrl}/interactive.html`,
        detail: "summary",
      }),
    );
    const incrementButton = await findOne({ text: "Increment counter" });
    // Observe once to seed a pre-click snapshot for the diff comparison.
    await harness.callTool("charlotte_observe", { detail: "summary" });
    const afterIncrement = parseToolJson<PageRep>(
      await harness.callTool("charlotte_click", { element_id: incrementButton.id }),
    );
    // The click handler attaches a structural delta vs the pre-click snapshot.
    expect(afterIncrement.delta).toBeDefined();
    expect(afterIncrement.delta!.changes.length).toBeGreaterThan(0);
    expect(await evalValue<string>("document.getElementById('counter-value').textContent")).toBe(
      "1",
    );

    // charlotte_diff also reports the counter change against the prior snapshot.
    const diff = parseToolJson<{ changes: Array<{ detail?: string }>; summary: string }>(
      await harness.callTool("charlotte_diff", { scope: "all" }),
    );
    expect(diff.changes.length).toBeGreaterThan(0);

    // ── 8. navigate back and confirm history works (the #195 back/forward bug) ──
    const back = parseToolJson<PageRep>(await harness.callTool("charlotte_back", {}));
    expect(back).not.toBeNull();
    expect(back.url).toContain("forms.html");
    expectNoErrors(back);

    // ── 9. forward returns to the interactive page ─────────────────────
    const forward = parseToolJson<PageRep>(await harness.callTool("charlotte_forward", {}));
    expect(forward.url).toContain("interactive.html");
    expectNoErrors(forward);
  });
});
