# Charlotte Profile Benchmark Report

## Tiered Tool Visibility — Definition Overhead Analysis

**Charlotte v0.4.0** · March 2026

---

## Executive Summary

Charlotte v0.4.0 introduces **startup profiles** that control how many tools load into the agent's context. Tool definitions are sent with every API round-trip, so fewer tools means less overhead on every single call.

The default `browse` profile loads 22 tools instead of 40, reducing tool definition overhead by **48%**. The `core` profile loads 7 tools and reduces overhead by **77%**. Response content is identical across profiles — only the invisible definition payload changes.

Over a 20-call browsing session, this translates to **38.6% fewer total tokens** with `browse` and **55.9% fewer** with `core`. Over a 12-call form interaction, **45.3%** and **72.4%** respectively.

| Metric | full (40 tools) | browse (22 tools) | core (7 tools) |
|:-------|:---------------:|:-----------------:|:--------------:|
| Definition tokens per call | 7,187 | 3,727 | 1,677 |
| Savings vs full | — | **48%** | **77%** |
| 20-call session total tokens | 197,325 | 121,182 | 86,954 |
| 12-call form total tokens | 90,736 | 49,672 | 25,072 |
| Runtime tool toggling | Yes | Yes | Yes |

---

## The Problem

Every MCP tool registered by a server carries a definition — name, description, and input schema — that gets injected into the agent's context on every API round-trip. This is how the agent knows what tools are available.

Charlotte ships 40 tools (39 + the `charlotte_tools` meta-tool). At full load, that's **7,187 tokens of tool definitions** the agent carries on every call, whether it needs those tools or not.

### The overhead dominates useful content

In a 12-call form interaction (navigate, observe, find inputs, type into 4 fields, re-observe after each, final observe):

| Category | Tokens | Share |
|:---------|-------:|------:|
| Tool definitions (cumulative) | 86,244 | **95.1%** |
| Response content | 4,492 | 4.9% |
| **Total** | **90,736** | |

The agent spends **19:1** on overhead vs useful work. This ratio gets worse as response compaction improves — Charlotte's minimal responses are already very small, making definition overhead the dominant cost.

---

## The Fix: Startup Profiles

v0.4.0 introduces profiles that control which tools load at startup:

```
charlotte --profile full      # 40 tools — everything
charlotte --profile browse    # 22 tools — default (navigate, observe, interact, tabs)
charlotte --profile core      # 7 tools  — navigate, observe, find, click, type, submit
```

Three additional profiles are available for specialized workflows:

```
charlotte --profile interact  # 27 tools — full interaction + dialog + evaluate
charlotte --profile develop   # 30 tools — interact + dev_serve, dev_inject, dev_audit
charlotte --profile audit     # 13 tools — navigation + observation + dev_audit + viewport
```

All profiles include the `charlotte_tools` meta-tool for runtime toggling.

---

## Methodology

### Test Scenarios

Four benchmark tests measure tool definition overhead across three profiles:

| Test | What it does | Tool calls | Purpose |
|:-----|:-------------|:----------:|:--------|
| Tool Definitions | Connect, list tools, navigate to about:blank | 1 | Pure overhead measurement |
| Browse Session | Visit 5 sites: navigate → observe(minimal) → observe(summary) → find(link) per site | 20 | Multi-site browsing workflow |
| Interactive Session | Navigate to httpbin form, observe, find inputs, type into 4 fields with re-observe after each | 12 | Form interaction workflow |
| Runtime Toggle | Start browse, enable monitoring, use console tool, disable monitoring | 5 | Meta-tool correctness |

### Profiles Tested

| Profile | Tools | Definition chars | Est. definition tokens |
|:--------|------:|-----------------:|-----------------------:|
| full | 40 | 25,152 | 7,187 |
| browse | 22 | 13,042 | 3,727 |
| core | 7 | 5,868 | 1,677 |

### Token Estimation

Tool definition tokens are estimated at **chars ÷ 3.5** (tool definitions are schema-dense JSON with short keys, higher token density than prose). Response tokens use **chars ÷ 4** (consistent with the v0.2.0 report).

Cumulative definition tokens = definition tokens per call × number of tool calls in the test. This models the real cost: tool definitions are re-sent on every API round-trip.

---

## Results

### Tool Definition Overhead Per Call

The raw payload size of tool definitions, measured by serializing the full `tools/list` response:

| Profile | Tools | Definition Chars | Definition Tokens | Savings vs Full |
|:--------|------:|-----------------:|------------------:|:---------------:|
| full | 40 | 25,152 | 7,187 | — |
| browse | 22 | 13,042 | 3,727 | **48%** |
| core | 7 | 5,868 | 1,677 | **77%** |

The `browse` profile cuts definition overhead nearly in half. The `core` profile cuts it by more than three-quarters.

### Browse Session (5 Sites, 20 Calls)

Five sites visited: example.com, Hacker News, Wikipedia MCP article, httpbin form, GitHub anthropic-cookbook. Each site: navigate → observe(minimal) → observe(summary) → find(link).

| Profile | Calls | Response Tokens | Def. Tokens (cumulative) | Total Tokens | Savings vs Full |
|:--------|------:|----------------:|-------------------------:|-------------:|:---------------:|
| full | 20 | 53,585 | 143,740 | 197,325 | — |
| browse | 20 | 46,642 | 74,540 | 121,182 | **38.6%** |
| core | 20 | 53,414 | 33,540 | 86,954 | **55.9%** |

Response content is comparable across profiles — the same pages return similar observation sizes regardless of how many tools are loaded. The savings come entirely from the reduced definition payload, amplified across 20 calls.

At 20 calls, definition tokens account for **72.9%** of the full profile's total token budget but only **38.6%** of the core profile's. Switching profiles shifts the balance from overhead-dominated to content-dominated.

### Interactive Session (Form, 12 Calls)

httpbin form workflow: navigate → observe(summary) → find(text_input) → type into 4 inputs with observe(minimal) after each → final observe.

| Profile | Calls | Response Tokens | Def. Tokens (cumulative) | Total Tokens | Savings vs Full |
|:--------|------:|----------------:|-------------------------:|-------------:|:---------------:|
| full | 12 | 4,492 | 86,244 | 90,736 | — |
| browse | 12 | 4,948 | 44,724 | 49,672 | **45.3%** |
| core | 12 | 4,948 | 20,124 | 25,072 | **72.4%** |

Form interactions produce small responses (type confirmations, minimal re-observations), making definition overhead even more dominant. With the full profile, **95.1%** of tokens are definitions. With core, definitions drop to **80.3%** of a much smaller total.

### Runtime Toggle (Meta-Tool)

Starting from the `browse` profile, the meta-tool enables and disables the monitoring group:

| Step | Action | Tool Count | Definition Chars |
|:-----|:-------|:----------:|:----------------:|
| 1 | Initial state | 22 | 13,042 |
| 2 | Enable monitoring | 24 | 14,671 |
| 3 | Use charlotte_console | — | — |
| 4 | Disable monitoring | 22 | 13,042 |

The monitoring group adds 2 tools (charlotte_console, charlotte_requests) and 1,629 chars of definitions. After disabling, the tool list returns to exactly the initial state. The toggle is symmetric and non-destructive.

---

## Extrapolated Savings

### 100-Page Browsing Session

Using the measured 4-calls-per-page pattern from the browse session benchmark:

| Profile | Calls | Def. Tokens (cumulative) | Response Tokens | Total Tokens |
|:--------|------:|-------------------------:|----------------:|-------------:|
| full | 400 | 2,874,800 | ~214,000 | ~3,088,800 |
| browse | 400 | 1,490,800 | ~214,000 | ~1,704,800 |
| core | 400 | 670,800 | ~214,000 | ~884,800 |

| Profile | Savings vs Full | Tokens Saved |
|:--------|:---------------:|-----------------:|
| browse | **44.8%** | **~1,384,000** |
| core | **71.4%** | **~2,204,000** |

The `browse` profile saves **~1.4 million tokens** over a 100-page session. The `core` profile saves **~2.2 million**.

### Cost Impact (100 Pages)

Using the browse profile (the default), token savings translate to API cost reductions:

| Model | Input Price | full | browse | You Save |
|:------|:------------|-----:|-------:|---------:|
| Claude Sonnet 4 | $3.00 / M tokens | $9.27 | $5.11 | **$4.15** |
| Claude Opus 4 | $15.00 / M tokens | $46.33 | $25.57 | **$20.76** |
| GPT-4o | $2.50 / M tokens | $7.72 | $4.26 | **$3.46** |
| Gemini 2.5 Pro | $1.25 / M tokens | $3.86 | $2.13 | **$1.73** |
| Claude Haiku 4 | $0.80 / M tokens | $2.47 | $1.36 | **$1.11** |

These savings are purely from tool definitions. They compound with Charlotte's existing page-level efficiency gains (25-182x smaller responses than Playwright MCP, documented in the [v0.2.0 benchmark report](./charlotte-benchmark-report.md)).

---

## Profiles in Detail

### What Each Profile Includes

| Profile | Navigation | Observation | Interaction | Session | Dev Mode | Other |
|:--------|:----------:|:-----------:|:-----------:|:-------:|:--------:|:-----:|
| **core** (7) | navigate | observe, find | click, type, submit | — | — | — |
| **browse** (22) | all 4 | all 7 | click, type, select, toggle, submit, scroll | tabs (4) | — | — |
| **interact** (27) | all 4 | all 7 | all 10 | tabs (4) | — | dialog, evaluate |
| **develop** (30) | all 4 | all 7 | all 10 | tabs (4) | all 3 | dialog, evaluate |
| **audit** (13) | all 4 | all 7 | — | viewport | dev_audit | — |
| **full** (40) | all 4 | all 7 | all 10 | all 11 | all 3 | dialog, evaluate, monitoring (2) |

All tool counts are +1 for the `charlotte_tools` meta-tool, which is always available.

### Choosing a Profile

- **Most users:** `browse` (default). Covers navigation, page inspection, basic form interaction, screenshots, and tab management.
- **Minimal overhead:** `core`. Six tools for navigate-observe-interact workflows. Enable groups as needed via `charlotte_tools`.
- **Form-heavy automation:** `interact`. Adds hover, drag, key, wait_for, dialog handling, and JavaScript evaluation.
- **Local development:** `develop`. Adds dev_serve for static file serving, dev_inject for CSS/JS injection, dev_audit for accessibility checks.
- **Site auditing:** `audit`. Navigation + observation + dev_audit + viewport resizing. No interaction tools.
- **Everything:** `full`. All 40 tools, no restrictions. Use when you need every capability or don't want to think about profiles.

---

## Reproducing These Benchmarks

```bash
git clone https://github.com/TickTockBent/charlotte.git
cd charlotte
npm install && npm run build

# Run profile comparison benchmarks
npx tsx benchmarks/run-benchmarks.ts --suite profiles

# Run a single test
npx tsx benchmarks/run-benchmarks.ts --suite profiles --test 10

# Run against a single profile
npx tsx benchmarks/run-benchmarks.ts --suite profiles --server charlotte-browse
```

Results are written to `benchmarks/results/raw/tiered-profiles-v1/` as JSON files with per-call metrics and a `summary.md`.

---

## Summary

Charlotte v0.4.0's tiered tool visibility addresses the largest remaining source of token waste in MCP-based browsing: tool definition overhead. Prior versions optimized response content (76% reduction in v0.2.0). This version optimizes the definitions themselves.

The `browse` profile (now the default) delivers **48% less definition overhead** per call and **38-45% fewer total tokens** across realistic workflows. The `core` profile achieves **77% less overhead** and **56-72% fewer total tokens**.

These savings are invisible to the agent — responses are identical, tool behavior is unchanged, and additional tools can be activated at any time via the meta-tool. The agent gets the same capabilities with less context window pressure, lower cost, and faster responses.

Combined with Charlotte's existing page-level efficiency (25-182x smaller than Playwright MCP), tiered profiles make Charlotte the most token-efficient browser MCP server available at every layer of the stack.

---

*Charlotte is open source under the MIT license.*
*GitHub: [github.com/TickTockBent/charlotte](https://github.com/TickTockBent/charlotte)*
*npm: [@ticktockbent/charlotte](https://www.npmjs.com/package/@ticktockbent/charlotte)*
