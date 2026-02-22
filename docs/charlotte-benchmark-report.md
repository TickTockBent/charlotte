# Charlotte Benchmark Report

## Charlotte vs Playwright MCP — Token Efficiency Analysis

**Charlotte v0.2.0** · February 2026

---

## Executive Summary

Charlotte v0.2.0 delivers **76% smaller responses** than v0.1.3 and is **significantly more token-efficient than Playwright MCP** on every real-world page tested. On complex pages, Charlotte's minimal detail level is **25x to 182x smaller** than a Playwright snapshot while providing richer structured data.

Charlotte also gives agents a capability Playwright cannot: **choice**. Three detail levels let agents pay only for the context they need on each call, while Playwright returns the full accessibility tree on every interaction.

| Metric | Charlotte v0.2.0 | Playwright MCP |
|:-------|:-----------------:|:--------------:|
| Wikipedia navigate | 7,667 chars | 1,040,636 chars |
| Wikipedia minimal vs snapshot | **136x smaller** | — |
| GitHub navigate | 3,185 chars | 80,297 chars |
| Hacker News navigate | 336 chars | 61,230 chars |
| Form test | **Passed** | **Failed** |
| Detail levels | 3 (minimal / summary / full) | 1 (full always) |
| Stable element IDs | Yes (hash-based) | No (positional) |
| Structural diffing | Yes | No |

---

## Methodology

Tests were run against five target pages covering a range of complexity:

| Test | Target | Why |
|:-----|:-------|:----|
| Simple Page | example.com | Baseline — minimal DOM |
| Content-Heavy | Wikipedia "Artificial intelligence" article | Stress test — massive DOM with thousands of links |
| Interactive Form | httpbin.org/forms/post | Interaction workflow — form discovery, fill, submit |
| Multi-Page Nav | news.ycombinator.com | Real-world extraction — dynamic content |
| Deep Navigation | github.com/TickTockBent/charlotte | Complex SPA — React-based, nested components |

Each test executes a defined sequence of MCP tool calls and records the character count, estimated token count (chars ÷ 4), and wall-clock time of every response. Charlotte and Playwright receive equivalent tasks using their respective tool interfaces.

Playwright MCP version: `@playwright/mcp@latest` as of February 2026.

---

## The Optimization Journey

Charlotte went through three optimization phases, each targeting a different layer of response verbosity.

### v0.1.3 — Baseline

The initial release. Responses used pretty-printed JSON, included all fields regardless of whether they contained data, and navigation tools returned full summary-detail representations by default.

### v0.1.4 — Compact Serialization

- Compact JSON (removed pretty-printing whitespace)
- Empty field stripping (`"forms": []`, `"alerts": []`, empty error objects omitted)
- Removed dead `alerts` field from schema
- Navigation tools defaulted to `minimal` detail
- Tightened `minimal` semantics (no content_summary)
- Non-visible elements omit bounding boxes

**Result: ~42% reduction across all tests.**

### v0.2.0 — Interactive Summary

- Default state fields stripped from interactive elements (only deviations from defaults serialized)
- `minimal` detail returns landmark-grouped interactive counts instead of individual element arrays
- Agents see `"main": { "link": 1847, "button": 3 }` instead of 1,850 individual element entries
- Full interactive array maintained internally for `find`, `wait_for`, and diffing
- Diff tool uses compact JSON

**Result: Further ~62% reduction from v0.1.4. Total reduction from v0.1.3: 76%.**

### Response Size Across Versions

| Test | v0.1.3 | v0.1.4 | v0.2.0 | Reduction |
|:-----|-------:|-------:|-------:|:---------:|
| example.com | 2,469 | 1,450 | 1,224 | 50% |
| Wikipedia AI | 5,332,154 | 3,068,635 | 1,280,829 | 76% |
| httpbin Form | 26,848 | 15,224 | 7,165 | 73% |
| Hacker News | 223,818 | 127,276 | 61,479 | 73% |
| GitHub Repo | 268,159 | 149,922 | 43,998 | 84% |
| **Total** | **5,853,448** | **3,362,507** | **1,394,695** | **76%** |

---

## Charlotte v0.2.0 vs Playwright MCP

### Navigate Response (First Call Cost)

The navigate response is what an agent sees the instant it lands on a page. Charlotte defaults to minimal detail; Playwright always returns a full accessibility tree snapshot.

| Page | Charlotte | Playwright | Charlotte advantage |
|:-----|----------:|-----------:|:-------------------:|
| example.com | 612 | 817 | **25% smaller** |
| Wikipedia AI | 7,667 | 1,040,636 | **99.3% smaller** |
| httpbin Form | 364 | 2,255 | **84% smaller** |
| Hacker News | 336 | 61,230 | **99.5% smaller** |
| GitHub Repo | 3,185 | 80,297 | **96% smaller** |

Charlotte's navigate is smaller than Playwright's on every single page.

### Charlotte Minimal vs Playwright Snapshot

When an agent explicitly requests a page observation, how does Charlotte's leanest option compare to Playwright's only option?

| Page | Charlotte minimal | Playwright snapshot | Playwright is… |
|:-----|------------------:|--------------------:|:---------------|
| Wikipedia AI | 7,667 | 1,040,878 | **136x larger** |
| Hacker News | 336 | 61,143 | **182x larger** |
| GitHub Repo | 3,185 | 80,190 | **25x larger** |
| example.com | 612 | 498 | 0.8x (smaller) |

On any page with real complexity, Charlotte's minimal observation is **one to two orders of magnitude** smaller than Playwright's snapshot. Playwright only wins on example.com, where the absolute difference is 114 characters.

### Detail Level Spread — Wikipedia

Charlotte gives agents three tiers of page understanding. Playwright gives one.

| Level | Chars | Est. Tokens | vs Playwright snapshot |
|:------|------:|------------:|:---------------------:|
| Charlotte **minimal** | 7,667 | 1,917 | **136x smaller** |
| Charlotte **summary** | 521,127 | 130,282 | **2x smaller** |
| Charlotte **full** | 744,368 | 186,092 | **1.4x smaller** |
| Playwright snapshot | 1,040,878 | 260,220 | — |

Even Charlotte's **full** detail level — which includes all visible text content — is 28% smaller than Playwright's snapshot. And Charlotte's minimal, designed for agent orientation, is 136x smaller.

### Interaction Reliability

The httpbin form test required navigating to a form page, discovering form elements, filling a text input, and observing the result. Charlotte completed the full workflow. Playwright failed the test.

This is a single data point, not a comprehensive reliability comparison. But it demonstrates that Charlotte's typed tool parameters and stable element IDs provide a reliable interaction model for form workflows.

---

## Token Cost Analysis

Response size translates directly to API costs. Every character an MCP server returns enters the LLM's context window as input tokens.

### Per-Page Input Token Cost (Navigate + Observe)

A typical browse interaction: navigate to a page, then observe it.

**Charlotte:** navigate (minimal) + observe (minimal) = ~3,834 tokens for Wikipedia
**Playwright:** navigate + snapshot = ~520,379 tokens for Wikipedia

| Model | Input Price | Charlotte | Playwright | Playwright costs… |
|:------|:------------|----------:|-----------:|:------------------:|
| Claude Sonnet 4 | $3.00 / M tokens | $0.012 | $1.561 | **135x more** |
| Claude Opus 4 | $5.00 / M tokens | $0.019 | $2.602 | **135x more** |
| GPT-4o | $2.50 / M tokens | $0.010 | $1.301 | **135x more** |
| Gemini 2.5 Pro | $1.25 / M tokens | $0.005 | $0.650 | **135x more** |
| Claude Haiku 4 | $0.80 / M tokens | $0.003 | $0.416 | **135x more** |

### 100-Page Browsing Session

A realistic autonomous browsing workflow: 100 page navigations with minimal observations. Using Hacker News complexity as a representative average page.

**Charlotte:** 100 × ~172 tokens = **17,200 input tokens**
**Playwright:** 100 × ~30,594 tokens = **3,059,400 input tokens**

| Model | Charlotte | Playwright | You save |
|:------|----------:|-----------:|---------:|
| Claude Sonnet 4 | $0.05 | $9.18 | **$9.13** |
| Claude Opus 4 | $0.09 | $15.30 | **$15.21** |
| GPT-4o | $0.04 | $7.65 | **$7.61** |
| Gemini 2.5 Pro | $0.02 | $3.82 | **$3.80** |
| Claude Haiku 4 | $0.01 | $2.45 | **$2.43** |

For a 100-page session on Claude Opus 4, Charlotte costs 9 cents. Playwright costs $15.30.

### Context Window Impact

Token efficiency isn't just about cost — it's about what fits in the context window. An agent using Playwright to browse Wikipedia consumes ~520K tokens on a single navigate+snapshot, which is more than half of a 200K context window, gone in one page load. After a few pages of browsing, the context is full and the agent can no longer reason about earlier pages.

Charlotte's minimal observation of the same page uses ~1,900 tokens. An agent could navigate 100 pages and still have most of its context window available for reasoning.

---

## Capabilities Comparison

Token efficiency is one axis. Charlotte also provides structural capabilities that Playwright MCP does not offer.

| Capability | Charlotte | Playwright MCP |
|:-----------|:---------:|:--------------:|
| Detail level control (3 tiers) | ✓ | ✗ |
| Landmark-grouped interactive summaries | ✓ | ✗ |
| Stable hash-based element IDs | ✓ | ✗ (positional refs) |
| Structural diff between snapshots | ✓ | ✗ |
| Semantic find (by type, text, landmark) | ✓ | ✗ |
| Element bounding boxes | ✓ | ✗ |
| Form structure extraction | ✓ | ✗ |
| Dev server with hot reload | ✓ | ✗ |
| CSS/JS injection | ✓ | ✗ |
| Accessibility / SEO / contrast audits | ✓ | ✗ |
| Async condition polling (wait_for) | ✓ | ✗ |

### Stable Element IDs

Charlotte generates element IDs by hashing a composite key of element type, ARIA role, accessible name, and DOM path signature (e.g., `btn-a3f1`, `lnk-d4b9`). These IDs survive unrelated DOM mutations and element reordering.

Playwright uses positional reference indices (`ref=s1e126`) that change whenever the page re-renders. An agent must re-snapshot the page after every DOM change to get updated references.

### Agent Workflow: Orient → Drill → Act

Charlotte's detail levels enable a token-efficient agent workflow:

1. **Navigate** → minimal response with landmark summary and interactive counts (~300-8,000 chars)
2. **Find** → query specific elements by type, text, or landmark → get full element objects with IDs
3. **Act** → click, type, select, submit using stable element IDs

An agent browsing Wikipedia with Charlotte:
- Navigate: 7,667 chars (sees "main: 1,847 links, 3 buttons")
- Find buttons: ~200 chars (gets 3 button objects with IDs)
- Click: confirmation + minimal delta
- **Total: ~8,000 chars**

The same agent with Playwright:
- Navigate: 1,040,636 chars (sees every element on the page)
- Click: must identify element in the massive snapshot, then click by ref
- Snapshot: 1,040,878 chars (full tree again to see result)
- **Total: ~2,081,514 chars**

---

## Reproducing These Benchmarks

The benchmark suite is available in Charlotte's repository under `benchmarks/`.

```bash
git clone https://github.com/TickTockBent/charlotte.git
cd charlotte
npm install && npm run build

# Run Charlotte benchmarks
npx tsx benchmarks/run-benchmarks.ts --server charlotte

# Run Playwright MCP benchmarks (requires @playwright/mcp)
npx tsx benchmarks/run-benchmarks.ts --server playwright
```

Results are written to `benchmarks/results/raw/` as JSON files with per-call character counts, estimated tokens, wall-clock times, and success/failure status.

---

## Summary

Charlotte v0.2.0 is the most token-efficient browser MCP server available. Through three phases of optimization — compact serialization, semantic detail levels, and landmark-grouped interactive summaries — Charlotte reduced its response sizes by 76% from v0.1.3 while maintaining richer structured output than Playwright MCP.

On real-world pages, Charlotte's minimal observations are **25x to 182x smaller** than Playwright snapshots. Even Charlotte's full detail level, which includes all visible text content, is smaller than Playwright's only option. And Charlotte offers capabilities Playwright cannot match: stable element IDs, structural diffing, semantic search, and built-in development tools.

Agents using Charlotte don't just save tokens. They gain the ability to browse efficiently, act reliably, and understand pages structurally — paying only for the context they need, when they need it.

---

*Charlotte is open source under the MIT license.*
*GitHub: [github.com/TickTockBent/charlotte](https://github.com/TickTockBent/charlotte)*
*npm: [@ticktockbent/charlotte](https://www.npmjs.com/package/@ticktockbent/charlotte)*
