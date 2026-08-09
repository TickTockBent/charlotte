# Charlotte vs Playwright — per-task token battery

Run date: **2026-08-09**

Three scripted, realistic agent tasks run against Charlotte v0.8.0 (this repo's built dist/) and the repo's currently-installed Playwright MCP, same-day, same live pages.

## Servers

| Server | Version | Tool count | Tool-def tokens |
| --- | --- | --- | --- |
| Charlotte | 0.8.0 | 23 | 3,825 |
| Playwright MCP | 0.0.79 | 24 | 4,626 |

Tool-definition tokens are reported once per server here and are NEVER added into the per-task totals below — see honesty rules.

## Task battery (headline = run 1)

| Task | Charlotte | Playwright | Charlotte/Playwright ratio |
| --- | --- | --- | --- |
| **T1** orient-and-read | 7,812 tok / 2 calls | 12,601 tok / 2 calls | 1 : 1.6 |
| **T2** find-and-act | 421 tok / 3 calls | 13,022 tok / 3 calls | 1 : 30.9 |
| **T3** form-fill | 5,136 tok / 7 calls ⚠ (run2 6.7% diff) | 991 tok / 4 calls | 1 : 0.2 |

Cells marked ⚠ had a >5% token difference between run 1 and run 2 of that task/server pair.

## Task descriptions and exact call sequences

The sequence below IS the methodology — this is exactly what the code executes per task per server, not an approximation.

### T1: orient-and-read

Navigate to https://news.ycombinator.com/ and obtain the page's headlines.

**Charlotte:**
1. charlotte_navigate({ url })
1. charlotte_find({ type: "link" }) — obtain the headlines: on Hacker News, headline text lives on link-role elements, so this is the minimal single-call read (empirically smaller than observe(detail:"summary") on the same page, which returns the same element set plus extra structure/content_summary wrapper).

**Playwright:**
1. browser_navigate({ url })
1. browser_snapshot({}) — the inline accessibility tree; this is the only place page content appears (browser_navigate writes it to a file instead, see the observed-behavior note in tasks.md).

Run 1 / Run 2 detail:

| Server | Run | Tokens | Calls | Success | Note |
| --- | --- | --- | --- | --- | --- |
| Charlotte | run1 | 7,812 | 2 | yes | completed: navigate + find(type:link) |
| Charlotte | run2 | 7,812 | 2 | yes | completed: navigate + find(type:link) |
| Playwright | run1 | 12,601 | 2 | yes | completed: browser_navigate + browser_snapshot |
| Playwright | run2 | 12,911 | 2 | yes | completed: browser_navigate + browser_snapshot |

### T2: find-and-act

Navigate to https://news.ycombinator.com/, locate the "login" link, click it.

**Charlotte:**
1. charlotte_navigate({ url })
1. charlotte_find({ text: "login" }) — locate the login link specifically (targeted find, not a full link dump).
1. charlotte_click({ element_id }) — click the located element.

**Playwright:**
1. browser_navigate({ url })
1. browser_snapshot({}) — needed to obtain the login link's element ref before it can be clicked.
1. browser_click({ element, target: ref }) — click it.

Run 1 / Run 2 detail:

| Server | Run | Tokens | Calls | Success | Note |
| --- | --- | --- | --- | --- | --- |
| Charlotte | run1 | 421 | 3 | yes | completed: navigate + find(text:login) + click(element_id) |
| Charlotte | run2 | 421 | 3 | yes | completed: navigate + find(text:login) + click(element_id) |
| Playwright | run1 | 13,022 | 3 | yes | completed: browser_navigate + browser_snapshot + browser_click |
| Playwright | run2 | 13,022 | 3 | yes | completed: browser_navigate + browser_snapshot + browser_click |

### T3: form-fill

Navigate to https://www.selenium.dev/selenium/web/web-form.html, fill the text/password/textarea fields, pick a dropdown option, submit.

**Charlotte:**
1. charlotte_navigate({ url })
1. charlotte_observe({ detail: "summary" }) — discover all form field element_ids in one call.
1. charlotte_type × 3 — text input, password, textarea.
1. charlotte_select({ element_id, value: "Two" }) — native <select> dropdown; Charlotte exposes it as type="select" with an options[] array, and charlotte_select works on it directly (verified empirically).
1. charlotte_click(submit button "Submit") — NOT charlotte_submit: this form (like httpbin's) has no accessible name (no aria-label/title), so Chromium's accessibility tree never exposes it with role="form", and Charlotte only recognizes forms via that AX role. No form_id is available for this page either — see the finding in tasks.md. The submit button is clicked directly instead.

**Playwright:**
1. browser_navigate({ url })
1. browser_snapshot({}) — obtain refs for every field and the submit button in one call.
1. browser_fill_form({ fields: [text, password, textarea, select] }) — batched multi-field fill in a single tool call; the dropdown is exposed as role="combobox" in the ARIA snapshot and filled via type: "combobox" (verified empirically).
1. browser_click({ target: submit ref }) — submit.

Run 1 / Run 2 detail:

| Server | Run | Tokens | Calls | Success | Note |
| --- | --- | --- | --- | --- | --- |
| Charlotte | run1 | 5,136 | 7 | yes | completed: navigate + observe(summary) + type×3 + select + click(submit) |
| Charlotte | run2 | 4,790 | 7 | yes | completed: navigate + observe(summary) + type×3 + select + click(submit) |
| Playwright | run1 | 991 | 4 | yes | completed: browser_navigate + browser_snapshot + browser_fill_form + browser_click |
| Playwright | run2 | 952 | 4 | yes | completed: browser_navigate + browser_snapshot + browser_fill_form + browser_click |

## Honesty rules

- Each server gets its own most-efficient reasonable path for each task — no handicapping either side.
- Every response an agent would necessarily ingest counts toward the task total, including a file-written snapshot IF the path requires reading it for refs. In every sequence below, every ref needed for a follow-up action was already obtained from an explicit browser_snapshot call that's counted in the total — no sequence here ever needed a separate file read, verified empirically (see the observed-behavior note).
- Read-only/discovery calls (navigate, observe, find, snapshot) get one retry on transient failure. Mutating calls (click, type, fill_form) do not auto-retry, to avoid double-submitting an action against a live site on an ambiguous failure.
- Tool-definition cost is reported once per server, separately from every task, and is never folded into a task's response-token total — it amortizes across an entire session, not per task.
- Metric per task per server: total response tokens (sum of chars/4 across every call in the sequence) and tool-call count. The whole battery is run twice; headline = run 1; >5% run1-vs-run2 variance is flagged.

## Observed Playwright post-action behavior (0.0.79)

Empirically observed in this Playwright MCP version: browser_navigate, browser_click, and (by the same code path) browser_fill_form do NOT return the inline accessibility tree after acting — each returns a short '### Page' summary (URL, title, HTTP status, console error/warning counts) plus a '### Snapshot' section that only LINKS to a `.playwright-mcp/page-*.yml` file, not the tree itself. The full inline tree only ever appears in an explicit browser_snapshot response. None of T1/T2/T3's sequences needed to read that file: every ref a later step needed was already obtained from an earlier, explicit browser_snapshot call that's counted in the task total, so no hidden file-read cost was incurred or omitted here.

## Methodology notes

- **Same-day rule**: this battery is only comparable within one run date; a future rerun re-executes the whole battery from scratch rather than reusing old numbers.
- **Token heuristic**: tokens ≈ ceil(chars / 4), computed from each call's full serialized MCP response text.
- **Live-page caveat**: news.ycombinator.com and selenium.dev are live, uncontrolled services (though selenium.dev's web-form.html is purpose-built for automation testing and was observed to be stable — see the T3 target-swap note immediately below).
- **T3 target swap, kept for the honesty trail**: T3 originally targeted `https://httpbin.org/forms/post`, per the original task spec. httpbin.org was in a sustained outage/flapping state on the run date — 503s, 504 Gateway Timeouts, and 30-second navigation timeouts across roughly 40 minutes of testing, including two brief recoveries to HTTP 200 that reverted within about a minute. Both servers' T3 sequences failed identically against it (confirmed on two independent full-battery runs), which is itself informative — httpbin.org is not a reliable target for a battery meant to be re-run every release — but doesn't produce a usable T3 data point. T3 was swapped to Selenium's own hosted test form (`https://www.selenium.dev/selenium/web/web-form.html`), which stayed up throughout this run.
- **Charlotte form-representation finding**: both httpbin.org/forms/post AND selenium.dev/web-form.html's `<form>` elements have no accessible name (no aria-label/title), so Chromium never exposes either with role="form" in the accessibility tree — and Charlotte's form detection (src/renderer/interactive-extractor.ts) only recognizes AX nodes with role==="form". So although the form_id mechanism was worth re-checking on a new target (a labeled form elsewhere in the wild WOULD make it usable and, in that case, cheaper — one call instead of a discovery call plus a click), it turned out unusable on selenium.dev too. `charlotte_submit` remains untested by this battery; T3's Charlotte sequence clicks the submit button directly instead, like any other button, on both targets.
- **T3 flips the pattern seen in T1/T2**: Charlotte is far cheaper on read-oriented tasks (T1: 1.6x cheaper; T2: 31x cheaper) but ~5x MORE expensive than Playwright on this multi-step mutation task. Why: every Charlotte mutating call (charlotte_type, charlotte_select, charlotte_click) returns the FULL page representation by design (`Returns full page representation after typing/selecting/clicking` — see each tool's description), so a 5-mutation sequence pays for 5 full-page re-reads. Playwright's action calls (browser_fill_form, browser_click) return only a short page/status summary (see the observed-behavior note above) and batch 4 fields into one browser_fill_form call, so its whole mutation phase costs less than a single one of Charlotte's post-action representations. This is a genuine, task-shape-dependent result, not a methodology artifact — both sequences are each server's own efficient, idiomatic path.
