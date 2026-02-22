# Charlotte Benchmark Suite

**Proving token efficiency, speed, and task completion against Playwright MCP and Chrome DevTools MCP.**

---

## Why These Benchmarks Matter

Playwright MCP's token bloat is not a theoretical concern — it's a documented pain point with open GitHub issues. Users report:

- `browser_navigate` returns the **full accessibility tree** automatically (~114K tokens per complex page)
- Context windows overflow after just a few tool calls, triggering 413 errors
- Teams have had to **ban all Playwright MCP tools** during automation phases to avoid context blowout
- Token consumption **6x'd** between Playwright MCP v0.0.30 and v0.0.32

Charlotte's detail levels, semantic decomposition, and structured representations were designed to solve exactly this. These benchmarks prove it with numbers.

---

## Comparison Targets

| Server | Install | Notes |
|--------|---------|-------|
| **Charlotte** | `npx @ticktockbent/charlotte` | Our MCP server |
| **Playwright MCP** | `npx @playwright/mcp@latest` | Microsoft's official MCP server — the dominant player |
| **Chrome DevTools MCP** | Google's CDP-based MCP server | Secondary comparison target |

---

## Measurement Methodology

### What We Measure

For every test, capture:

1. **Response size (chars)** — Total character count of each MCP tool response
2. **Response size (estimated tokens)** — chars / 4 as rough token estimate, or use tiktoken for accuracy
3. **Cumulative context consumed** — Running total of all tool responses across the full task
4. **Wall-clock time** — Start to task completion
5. **Number of tool calls** — Total MCP tool invocations to complete the task
6. **Task success** — Binary pass/fail with defined success criteria

### How We Measure

Build a lightweight MCP client harness that:

1. Spawns each MCP server as a subprocess over stdio
2. Sends identical task sequences (or equivalent tool calls where tool names differ)
3. Captures every tool response payload before passing it to any LLM
4. Logs timestamps, character counts, and token estimates per call
5. Records cumulative totals

**Two test modes:**

- **Deterministic (scripted):** Fixed tool call sequences, no LLM involved. Measures raw server response sizes and latency for identical operations. This is the primary benchmark — no variance, perfectly reproducible.
- **Agentic (LLM-driven):** Hand the same natural language task to an LLM with each MCP server attached. Measures real-world token consumption including the LLM's reasoning overhead. Run N=5 per server for confidence intervals.

---

## Test Suite

### Test 1: Simple Page Read — example.com

**Why:** Baseline. The simplest possible page. If there's already a size difference here, it compounds on real sites.

**Task:** Navigate to `https://example.com` and return the page structure.

**Charlotte calls:**
```
navigate({ url: "https://example.com" })
observe({ detail: "minimal" })
```

**Playwright MCP calls:**
```
browser_navigate({ url: "https://example.com" })
// Note: Playwright returns full a11y snapshot automatically with navigate
browser_snapshot()
```

**Success criteria:** Both servers identify the page title, the heading, and the single link.

**What to record:** Response size of navigate + observe/snapshot. This is the "what does the agent see for the simplest possible page" comparison.

---

### Test 2: Content-Heavy Page — Wikipedia Article

**Why:** This is where Playwright MCP explodes. Wikipedia articles have massive DOM trees. OpenBrowser's benchmarks showed Playwright returning 520K+ chars for a single Wikipedia navigate.

**Target:** `https://en.wikipedia.org/wiki/Artificial_intelligence`

**Charlotte calls:**
```
navigate({ url: "https://en.wikipedia.org/wiki/Artificial_intelligence" })
observe({ detail: "minimal" })
observe({ detail: "summary" })
observe({ detail: "full" })
```

**Playwright MCP calls:**
```
browser_navigate({ url: "https://en.wikipedia.org/wiki/Artificial_intelligence" })
browser_snapshot()
```

**Success criteria:** Both servers can identify the article title, table of contents structure, and sidebar elements.

**What to record:** Response sizes at each detail level for Charlotte vs Playwright's single snapshot. The three-level comparison is the key visual: show Charlotte minimal vs Playwright snapshot, then Charlotte summary vs Playwright snapshot. Even Charlotte's `full` should be significantly smaller than Playwright's raw a11y dump.

---

### Test 3: Interactive SPA — Dynamic Form

**Why:** Proves Charlotte handles modern interactive pages, not just static content. Also demonstrates stable element IDs vs positional indices.

**Target:** Use Charlotte's built-in sandbox (`tests/sandbox/`) or a public form like `https://httpbin.org/forms/post`.

**Charlotte calls:**
```
navigate({ url: "<target>" })
observe({ detail: "summary" })
type({ element_id: "inp-XXXX", text: "test@example.com" })
select({ element_id: "sel-XXXX", value: "option-2" })
observe({ detail: "minimal" })  // Re-observe after interaction
submit({ form_id: "frm-XXXX" })
```

**Playwright MCP calls:**
```
browser_navigate({ url: "<target>" })
browser_snapshot()
browser_type({ element: "textbox \"Email\"", ref: "s1eXX", text: "test@example.com" })
browser_select_option({ element: "combobox", ref: "s1eXX", values: ["option-2"] })
browser_snapshot()  // Must re-snapshot to see state
browser_click({ element: "button \"Submit\"", ref: "s1eXX" })
```

**Success criteria:** Form submitted successfully, confirmation page/response observed.

**What to record:** Cumulative token cost across the full form-fill workflow. Charlotte's mid-task `observe({ detail: "minimal" })` should be dramatically cheaper than Playwright's full re-snapshot.

---

### Test 4: Multi-Page Navigation — Hacker News Top 5

**Why:** Tests cumulative cost across multiple page loads. Every navigation in Playwright returns a full snapshot. Charlotte lets the agent choose what it needs per page.

**Target:** `https://news.ycombinator.com`

**Task:** Extract the titles of the top 5 stories.

**Charlotte calls:**
```
navigate({ url: "https://news.ycombinator.com" })
observe({ detail: "summary" })
find({ type: "link", text: "<first story>" })
// Agent extracts titles from the summary observation
```

**Playwright MCP calls:**
```
browser_navigate({ url: "https://news.ycombinator.com" })
browser_snapshot()
// Agent must parse the massive snapshot to find story titles
```

**Success criteria:** Correct extraction of 5 story titles.

**What to record:** Total chars consumed. Charlotte should be able to get what it needs from a single summary observation. Playwright returns the entire page's accessibility tree including every link, comment count, score, and footer element.

---

### Test 5: Element Stability Across DOM Mutations

**Why:** This test has no Playwright equivalent — it demonstrates Charlotte's unique stable element IDs. It's not a token benchmark; it's a correctness/reliability benchmark.

**Target:** A page with dynamic content (sandbox page with setTimeout-added elements, or a live page with lazy loading).

**Charlotte calls:**
```
navigate({ url: "<target>" })
observe({ detail: "minimal" })
// Record element IDs
wait_for({ condition: "element", selector: ".lazy-content", timeout: 5000 })
observe({ detail: "minimal" })
// Verify same elements retain same IDs
```

**Playwright MCP calls:**
```
browser_navigate({ url: "<target>" })
browser_snapshot()
// Record element refs
browser_wait({ time: 5 })
browser_snapshot()
// Show that refs have changed
```

**Success criteria:** Charlotte's hash-based IDs for unchanged elements survive the DOM mutation. Playwright's positional indices shift.

**What to record:** ID stability matrix — which elements kept their IDs, which didn't, and why. This is a qualitative comparison, presented as a table.

---

### Test 6: Structural Diff Detection

**Why:** Another Charlotte-unique capability. No equivalent in Playwright or Chrome DevTools MCP. Demonstrates value for monitoring, testing, and audit workflows.

**Target:** Any page where interaction causes a state change (e.g., toggle, accordion, form validation error).

**Charlotte calls:**
```
navigate({ url: "<target>" })
observe({ detail: "summary" })  // snapshot_id: 1
click({ element_id: "btn-XXXX" })  // Trigger state change
diff({ snapshot_id: 1 })  // What changed?
```

**Playwright MCP equivalent:** None. Agent must take two full snapshots and diff them manually in the LLM context, consuming 2x the full snapshot token cost.

**What to record:** Charlotte's diff response size vs the cost of two Playwright snapshots. The diff should be a tiny fraction of a full observation since it only reports what changed.

---

### Test 7: Development Audit — Accessibility + Performance

**Why:** Shows Charlotte's dev_audit capabilities that have no Playwright MCP equivalent. Positions Charlotte as a development companion, not just a browsing tool.

**Target:** Charlotte's sandbox site or a public site with known a11y issues.

**Charlotte calls:**
```
dev_serve({ path: "./test-site", watch: true })
observe({ detail: "full" })
dev_audit({ checks: ["a11y", "contrast", "seo"] })
```

**Playwright MCP equivalent:** None. Agent would need to use `browser_evaluate` to inject and run axe-core or similar, which requires the LLM to write the injection code, dramatically increasing token cost and complexity.

**What to record:** Audit result quality and token cost of Charlotte's built-in audit vs the cost of replicating it through Playwright's evaluate tool.

---

### Test 8: Deep Navigation — GitHub Repo Exploration

**Why:** Real-world multi-step navigation with complex modern UI. GitHub is React-based with dynamic content loading, nested components, and complex a11y trees.

**Target:** `https://github.com/TickTockBent/charlotte` (or any well-known repo)

**Task:** Navigate to the repo, find the latest commit message, and check the license type.

**Charlotte calls:**
```
navigate({ url: "https://github.com/TickTockBent/charlotte" })
observe({ detail: "summary" })
find({ type: "link", text: "LICENSE" })
click({ element_id: "lnk-XXXX" })
observe({ detail: "minimal" })
```

**Playwright MCP calls:**
```
browser_navigate({ url: "https://github.com/TickTockBent/charlotte" })
// Full a11y tree for a GitHub repo page — this will be enormous
browser_snapshot()
browser_click({ element: "link \"LICENSE\"", ref: "sXeXXX" })
browser_snapshot()
```

**Success criteria:** License type correctly identified.

**What to record:** Per-page snapshot sizes. GitHub's complex UI should produce massive Playwright snapshots vs Charlotte's structured summary.

---

## Presentation Format

### Primary Metrics Table

```
| Metric                    | Charlotte (minimal) | Charlotte (summary) | Charlotte (full) | Playwright MCP | Chrome DevTools MCP |
|---------------------------|--------------------:|--------------------:|-----------------:|---------------:|--------------------:|
| example.com response      |          XXX chars  |          XXX chars  |       XXX chars  |    XXX chars   |          XXX chars  |
| Wikipedia response        |          XXX chars  |          XXX chars  |       XXX chars  |    XXX chars   |          XXX chars  |
| GitHub repo response      |          XXX chars  |          XXX chars  |       XXX chars  |    XXX chars   |          XXX chars  |
| Form workflow (cumulative)|          XXX chars  |          XXX chars  |       XXX chars  |    XXX chars   |          XXX chars  |
| HN extraction (cumulative)|          XXX chars  |          XXX chars  |       XXX chars  |    XXX chars   |          XXX chars  |
```

### Key Headline Numbers to Extract

These are the shareable stats for README, social media, and the site:

- **"Charlotte returns Xn fewer characters than Playwright MCP for the same page"** — Use the Wikipedia test for the biggest number
- **"Charlotte's minimal observation uses X tokens. Playwright's snapshot uses Y."** — Raw comparison
- **"A 5-step form workflow consumes X total tokens with Charlotte vs Y with Playwright"** — Cumulative workflow comparison
- **"Charlotte's diff detected the state change in X chars. Reproducing this in Playwright would cost Y chars (two full snapshots)."** — Unique capability framing

### Charts for README / Site

1. **Bar chart:** Response size by page complexity (example.com → Wikipedia → GitHub) with Charlotte detail levels stacked vs Playwright single bar
2. **Line chart:** Cumulative token consumption across multi-step tasks (form fill, multi-page nav) — Charlotte line stays flat, Playwright line climbs steeply
3. **Feature comparison matrix:** Checkmarks for capabilities (detail levels, stable IDs, structural diff, dev audit, domain allowlisting) across the three servers

---

## Implementation Notes

### Test Harness Architecture

```
benchmarks/
  harness/
    mcp-client.ts          # Lightweight MCP stdio client
    metrics.ts             # Response size, timing, token estimation
    reporter.ts            # JSON + markdown output
  tests/
    01-simple-page.ts      # example.com
    02-content-heavy.ts    # Wikipedia
    03-interactive-form.ts # Form workflow
    04-multi-page.ts       # Hacker News
    05-element-stability.ts # DOM mutation test
    06-structural-diff.ts  # Diff capability
    07-dev-audit.ts        # Audit capability
    08-deep-navigation.ts  # GitHub repo
  configs/
    charlotte.json         # MCP config for Charlotte
    playwright.json        # MCP config for Playwright
    chrome-devtools.json   # MCP config for Chrome DevTools
  results/
    raw/                   # JSON results per run
    summary.md             # Generated comparison tables
    charts/                # Generated chart images
  run-benchmarks.ts        # Orchestrator
  README.md                # How to reproduce
```

### Fairness Principles

- **Same pages, same tasks.** Never cherry-pick pages that favor Charlotte.
- **Best-case for competitors.** If Playwright has a `--snapshot-mode` or `includeSnapshot: false` option, test with it enabled and note it separately. Beat them at their best, not their worst.
- **Reproducible.** Pin server versions, publish exact configs, use stable public pages or committed fixture HTML.
- **Honest about tradeoffs.** If Playwright's full snapshot contains information Charlotte's minimal observation doesn't, say so. The argument is that agents rarely need all that information, not that it's useless.
- **Run multiple times.** N=5 minimum for any timing measurements. Report mean ± std.

### What NOT to Test

- Don't compare LLM reasoning quality — that's the client's job, not the server's.
- Don't test Charlotte features that are genuinely unique (dev_serve, dev_inject) as "benchmarks" — present those as feature comparisons, not speed comparisons.
- Don't test against OpenBrowser — it's architecturally too different (embedded agent vs MCP server) for a fair comparison.

---

## Suggested Rollout

1. **Build the harness** — MCP client that can spawn and communicate with any server
2. **Run deterministic tests first** — Get the raw numbers without LLM variance
3. **Generate comparison tables and charts** — Automated from results JSON
4. **Add to repo** — `benchmarks/` directory with full reproducibility instructions
5. **Update README** — Add a "Performance" section with headline numbers and a link to full results
6. **Update charlotte-rose.vercel.app** — Add a comparison section to the site
7. **Social media** — Lead with the single most impressive number (probably the Wikipedia comparison)
