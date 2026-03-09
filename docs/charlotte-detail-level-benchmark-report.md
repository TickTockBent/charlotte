# Charlotte Detail Level Benchmark Report

## Tree View — Response Token Analysis

**Charlotte v0.4.x** · March 2026

---

## Executive Summary

Charlotte's new `view: "tree"` and `view: "tree-labeled"` observation modes render pages as compact structural outlines instead of full JSON representations. Both skip the layout extraction, interactive extraction, and content extraction pipelines — producing a lightweight AX tree rendering in a fraction of the tokens.

Benchmarked against 6 real-world sites (Wikipedia, GitHub, Hacker News, LinkedIn, Stack Overflow, Amazon):

| Detail Level | Avg Response Chars | Avg Est. Tokens | vs Summary Savings |
|:-------------|-------------------:|----------------:|-------------------:|
| `tree` | 1,434 | 359 | **95%** |
| `tree-labeled` | 5,292 | 1,323 | **77%** |
| `minimal` | 2,569 | 643 | 91% |
| `summary` | 22,735 | 5,684 | — |
| `full` | 27,955 | 6,989 | — |

- **`tree`** is the cheapest observation mode — 95% smaller than `summary`, ideal for initial page orientation when the agent just needs to understand structure.
- **`tree-labeled`** includes interactive element labels (button names, link text, input labels) while still achieving 77% savings vs `summary`. The agent can plan interactions from the tree view without a follow-up call.
- Over a 6-site orientation workflow, `tree-labeled` saves **77% of observe response tokens** vs `summary` — 31,854 chars vs 137,996 chars.

---

## The Design

Five observation modes are now available, forming a cost/detail spectrum:

```
tree → tree-labeled → minimal → summary → full
cheapest                                  richest
```

| Mode | What it includes | Use case |
|:-----|:-----------------|:---------|
| `tree` | Landmark hierarchy, headings with text, element type markers, table/list summaries. Consecutive same-type elements collapsed (`link × 4`). | Page structure orientation. "What kind of page is this?" |
| `tree-labeled` | Same as tree, plus accessible names on interactive elements (`button "Submit"`, `link "Home"`, `input "Email"`). Labeled elements don't collapse. | Interaction planning. "What can I click/type?" |
| `minimal` | Landmarks, headings, interactive element counts per landmark (no individual elements). JSON format. | Compact status check between actions. |
| `summary` | Landmarks, headings, all interactive elements with IDs/bounds, content summaries, forms. JSON format. | Default observation — full element list with actionable IDs. |
| `full` | Everything in summary, plus full page text content. JSON format. | Content extraction, text analysis. |

### Key tradeoff: tree-labeled vs minimal

`tree-labeled` (avg 1,323 tokens) is larger than `minimal` (avg 643 tokens), but they serve different purposes:

- **`minimal`** gives counts: "navigation has 5 links". The agent knows elements exist but can't identify them.
- **`tree-labeled`** gives names: `link "Home"`, `link "About"`, `link "Contact"`. The agent can plan which element to target.

An agent using `minimal` for orientation typically needs a follow-up `find` call to get element details, which can cost 3,000–8,000+ tokens. An agent using `tree-labeled` may be able to skip that call entirely.

---

## Methodology

### Test Scenarios

| Test | What it does | Tool calls | Purpose |
|:-----|:-------------|:----------:|:--------|
| Detail Levels | Navigate to 6 sites, observe each with all 5 detail levels | 36 | Direct token cost comparison across levels |
| Tree Orientation | Navigate to 6 sites, compare tree-labeled → find vs summary → find workflows | 30 | Realistic workflow token savings |

### Target Sites

| Site | Character | Interactive Elements |
|:-----|:----------|:---------------------|
| Wikipedia (Main Page) | Content-dense, hundreds of links, deep landmark structure | ~266 |
| GitHub (anthropics org) | Modern SPA, dynamic content, moderate interaction | ~124 |
| Hacker News | Repetitive list structure, many links, minimal landmarks | ~228 |
| LinkedIn | Login wall / marketing page, moderate complexity | ~100 |
| Stack Overflow | Questions list, sidebar, complex navigation | ~197 |
| Amazon | Heavy JS, aggressive bot detection (partially blocked) | ~378 |

### Token Estimation

- Response tokens: `⌈chars ÷ 4⌉` (human-readable content / mixed format)
- Definition tokens: `⌈chars ÷ 3.5⌉` (schema-dense JSON)
- All tests run against Charlotte browse profile (23 tools, 15,520 definition chars)

---

## Results

### Per-Site Detail Level Comparison

| Site | tree | tree-labeled | minimal | summary | full |
|:-----|-----:|-------------:|--------:|--------:|-----:|
| Wikipedia | 1,948 | 8,230 | 3,070 | 38,414 | 48,371 |
| GitHub | 1,314 | 4,464 | 1,775 | 18,682 | 21,706 |
| Hacker News | 1,150 | 6,094 | 337 | 30,490 | 34,708 |
| LinkedIn | 1,205 | 3,857 | 3,405 | 17,490 | 20,004 |
| Stack Overflow | 2,951 | 9,067 | 4,041 | 32,568 | 42,160 |
| Amazon | 39 | 39 | 785 | 763 | 785 |
| **Avg (excl. Amazon)** | **1,714** | **6,342** | **2,526** | **27,529** | **33,390** |

*Values are response chars. Amazon partially blocked by bot detection — excluded from averages.*

### Token Estimates (excluding Amazon)

| Detail Level | Avg Chars | Avg Tokens | vs Summary | vs Full |
|:-------------|----------:|-----------:|-----------:|--------:|
| `tree` | 1,714 | 429 | **94% cheaper** | **95% cheaper** |
| `tree-labeled` | 6,342 | 1,586 | **77% cheaper** | **81% cheaper** |
| `minimal` | 2,526 | 632 | **91% cheaper** | **92% cheaper** |
| `summary` | 27,529 | 6,883 | — | 18% cheaper |
| `full` | 33,390 | 8,348 | — | — |

### Tree Orientation Workflow — Per-Site Savings

When used as the orientation step in a browse workflow (observe → find), `tree-labeled` vs `summary`:

| Site | tree-labeled | summary | Savings |
|:-----|-------------:|--------:|--------:|
| Wikipedia | 8,230 | 38,414 | **79%** |
| GitHub | 4,464 | 18,682 | **76%** |
| Hacker News | 6,094 | 30,489 | **80%** |
| LinkedIn | 3,857 | 17,489 | **78%** |
| Stack Overflow | 9,170 | 32,673 | **72%** |
| Amazon | 39 | 249 | **84%** |
| **Total** | **31,854** | **137,996** | **77%** |

---

## Extrapolated Savings

### 20-Site Browsing Session

Agent workflow per site: navigate → observe (orientation) → find → click. 80 tool calls total.

| Orientation Mode | Observe Tokens (20 sites) | Definition Overhead (80 calls) | Total Session | vs Summary |
|:-----------------|:-------------------------:|:------------------------------:|:-------------:|:----------:|
| `tree` | ~8,600 | 354,800 | 363,400 | **6% cheaper** |
| `tree-labeled` | ~31,700 | 354,800 | 386,500 | — |
| `summary` | ~137,700 | 354,800 | 492,500 | — |

At scale, definition overhead dominates — but the observe step savings are still significant. On a per-observe basis, `tree` saves ~6,500 tokens and `tree-labeled` saves ~5,300 tokens per call vs `summary`.

### Cost Impact Per Observation Call

| Level | Tokens per call | API cost per call (@ $3/MTok) | API cost per call (@ $15/MTok) |
|:------|:---------:|:------:|:-------:|
| `tree` | ~429 | $0.0013 | $0.0064 |
| `tree-labeled` | ~1,586 | $0.0048 | $0.0238 |
| `minimal` | ~632 | $0.0019 | $0.0095 |
| `summary` | ~6,883 | $0.0207 | $0.1032 |
| `full` | ~8,348 | $0.0250 | $0.1252 |

---

## When to Use Each Level

| Scenario | Recommended Level | Why |
|:---------|:------------------|:----|
| First visit to unknown page | `tree` | Cheapest orientation — see landmarks, headings, element types |
| Planning which element to interact with | `tree-labeled` | See element names without full JSON overhead |
| Quick status check between actions | `minimal` | Compact JSON with counts, confirms state changes |
| Need element IDs for interaction | `summary` | Full element list with actionable hash IDs |
| Extracting page text content | `full` | Complete text dump |

---

## Detailed Results

*Raw benchmark data archived in `benchmarks/results/raw/detail-levels-v1/`.*

### Test 20: Detail Levels (6 sites × 5 levels)

36 tool calls (6 navigate + 30 observe). All 5 sites returned content at all levels (Amazon partially blocked).

**Per-call breakdown (Wikipedia):**

| # | Tool | Args | Chars | Est. Tokens | Time (ms) |
|--:|:-----|:-----|------:|------------:|----------:|
| 1 | charlotte:navigate | url: wikipedia.org | 3,070 | 768 | 2,023 |
| 2 | charlotte:observe | view: tree | 1,948 | 487 | 45 |
| 3 | charlotte:observe | view: tree-labeled | 8,230 | 2,058 | 40 |
| 4 | charlotte:observe | detail: minimal | 3,070 | 768 | 70 |
| 5 | charlotte:observe | detail: summary | 38,414 | 9,604 | 74 |
| 6 | charlotte:observe | detail: full | 48,371 | 12,093 | 74 |

Tree view renders in ~40ms — comparable to or faster than structured modes — because it skips layout extraction, interactive extraction, and content extraction entirely.

### Test 21: Tree Orientation Workflow (6 sites)

30 tool calls (6 navigate + 12 observe + 12 find). Demonstrates **77% observe token savings** when using `tree-labeled` instead of `summary` for page orientation.
