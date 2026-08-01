/**
 * Golden-fixture capture + normalization utilities (Slice 0, Step 1).
 *
 * Charlotte Remote's core-extraction refactor (docs/remote/slice-0.md) must be
 * byte-identical in behavior. These goldens are the I1 instrument: a fixed
 * scenario script run through the real MCP handlers (via `mcp-harness.ts`),
 * with only genuinely volatile fields normalized away, committed to
 * `tests/fixtures/golden/`, and diffed against a fresh capture in
 * `tests/integration/golden.test.ts`.
 *
 * Normalization is an explicit allowlist, not a blanket scrub:
 *   - {@link TIMESTAMP_KEYS} — ISO-8601 timestamp fields, replaced with `"{{TS}}"`.
 *     Enumerated by inspecting real tool output: `PageRepresentation.timestamp`
 *     is the only timestamp-shaped key that appears in the scenarios below
 *     (stamped fresh by `SnapshotStore.push`/`renderer-pipeline` on every
 *     render). `ReloadEvent.timestamp` / `PendingDialog.timestamp` exist in the
 *     types but never appear in these scenarios (no dev-mode reload, no
 *     dialog) — included anyway since they share the exact key name.
 *   - {@link DURATION_KEYS} — wall-clock duration fields, replaced with
 *     `"{{DUR}}"`. None appear in navigate/observe/find/click output today —
 *     render duration is logged to stderr (`renderer-pipeline.ts` `logger.debug`)
 *     but never serialized into a tool result. Kept as a named, empty allowlist
 *     (not removed) so a future duration field added to the response shape is
 *     an explicit, reviewed addition to this list rather than silent golden
 *     churn.
 *   - {@link PATH_KEYS} — host filesystem paths (e.g. `output_file`, artifact
 *     paths), replaced with `"{{PATH}}"`. Not exercised by these scenarios
 *     (no `output_file` / screenshot calls), kept for forward compatibility.
 *   - The fixture-server origin (`harness.fixtureServer.url`, a random port)
 *     is replaced with `"{{BASE}}"` wherever it appears inside a string value
 *     (URLs, hrefs, network error entries, etc.).
 *
 * Explicitly NOT normalized: `snapshot_id` (sequence-deterministic — a real
 * regression in ordering should fail the test) and element IDs (hash-based,
 * the entire point of the I1 invariant — must stay exact).
 */
import type { McpHarness } from "./mcp-harness.js";
import { parseToolJson } from "./mcp-harness.js";

/** Keys whose string values are ISO-8601 timestamps, normalized to `"{{TS}}"`. */
const TIMESTAMP_KEYS = new Set<string>(["timestamp"]);

/**
 * Keys whose numeric values are wall-clock durations, normalized to `"{{DUR}}"`.
 * Empty today (see module docstring) — no duration-shaped key has been observed
 * in any navigate/observe/find/click tool result.
 */
const DURATION_KEYS = new Set<string>([]);

/** Keys whose string values are host filesystem paths, normalized to `"{{PATH}}"`. */
const PATH_KEYS = new Set<string>(["output_file"]);

/**
 * Deep-walk a parsed tool-result JSON value, replacing only the allowlisted
 * volatile fields. Does not mutate the input.
 */
export function normalizeToolResult(value: unknown, baseUrl: string): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeToolResult(entry, baseUrl));
  }

  if (value !== null && typeof value === "object") {
    const normalized: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
      if (TIMESTAMP_KEYS.has(key) && typeof entryValue === "string") {
        normalized[key] = "{{TS}}";
      } else if (DURATION_KEYS.has(key) && typeof entryValue === "number") {
        normalized[key] = "{{DUR}}";
      } else if (PATH_KEYS.has(key) && typeof entryValue === "string") {
        normalized[key] = "{{PATH}}";
      } else {
        normalized[key] = normalizeToolResult(entryValue, baseUrl);
      }
    }
    return normalized;
  }

  if (typeof value === "string" && baseUrl.length > 0) {
    return value.split(baseUrl).join("{{BASE}}");
  }

  return value;
}

/**
 * Fixed scenario order for the golden set. Kept in one place so the refresh
 * script and the comparison test can never drift from each other — both call
 * {@link captureGoldenScenarios} directly.
 *
 * Main-frame-only fixture pages by design (per slice-0.md): iframe element IDs
 * hash the per-launch CDP frameId, a GUID that is legitimately unstable across
 * browser launches, so iframe pages stay out of the golden set.
 */
const SCENARIO_PAGES: Array<{ file: string; findQuery: Record<string, unknown> }> = [
  // Matches the "Create New Project" button (id="create-btn").
  { file: "simple.html", findQuery: { text: "Create New Project" } },
  // Matches the "First Name" text input (id="first-name").
  { file: "form.html", findQuery: { type: "text_input", text: "First Name" } },
  // plain-form.html has exactly one input (id="q-input") — a bare type filter
  // is sufficient and matches the fixture's single-field intent.
  { file: "plain-form.html", findQuery: { type: "text_input" } },
  // Matches the "Click Me" button (id="click-btn"), also used below as the
  // stable element for the interaction.click scenario.
  { file: "interaction.html", findQuery: { text: "Click Me" } },
];

/** Shape we need from the navigate result to pick a stable element to click. */
interface NavigateResultShape {
  interactive?: Array<{ id: string; label: string }>;
}

/**
 * Run the fixed golden scenario script against a live harness and return the
 * normalized result for every scenario, keyed by scenario name
 * (`"<page>.navigate"`, `"<page>.observe"`, `"<page>.find"`,
 * `"interaction.click"`).
 *
 * Requires a harness created with `serveDirectory: tests/fixtures/pages`.
 */
export async function captureGoldenScenarios(
  harness: McpHarness,
): Promise<Record<string, unknown>> {
  const baseUrl = harness.fixtureServer?.url;
  if (!baseUrl) {
    throw new Error(
      "captureGoldenScenarios requires a harness set up with serveDirectory: tests/fixtures/pages",
    );
  }

  const scenarios: Record<string, unknown> = {};
  let clickElementId: string | undefined;

  for (const { file, findQuery } of SCENARIO_PAGES) {
    const navigateResult = parseToolJson<NavigateResultShape>(
      await harness.callTool("charlotte_navigate", {
        url: `${baseUrl}/${file}`,
        detail: "full",
      }),
    );
    scenarios[`${file}.navigate`] = normalizeToolResult(navigateResult, baseUrl);

    const observeResult = parseToolJson(
      await harness.callTool("charlotte_observe", { detail: "summary" }),
    );
    scenarios[`${file}.observe`] = normalizeToolResult(observeResult, baseUrl);

    const findResult = parseToolJson(await harness.callTool("charlotte_find", findQuery));
    scenarios[`${file}.find`] = normalizeToolResult(findResult, baseUrl);

    if (file === "interaction.html") {
      const clickButton = navigateResult.interactive?.find((el) => el.label === "Click Me");
      if (!clickButton) {
        throw new Error(
          "captureGoldenScenarios: could not find the 'Click Me' button in interaction.html's navigate output",
        );
      }
      clickElementId = clickButton.id;
    }
  }

  if (!clickElementId) {
    // Unreachable given SCENARIO_PAGES includes interaction.html, but keeps
    // TypeScript honest and fails loudly if the scenario list ever changes.
    throw new Error("captureGoldenScenarios: no click element ID captured from interaction.html");
  }

  const clickResult = parseToolJson(
    await harness.callTool("charlotte_click", { element_id: clickElementId }),
  );
  scenarios["interaction.click"] = normalizeToolResult(clickResult, baseUrl);

  return scenarios;
}
