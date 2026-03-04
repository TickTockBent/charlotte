# Charlotte vs Playwright MCP — Complete Comparison

A head-to-head comparison of [Charlotte](https://github.com/TickTockBent/charlotte) and [Playwright MCP](https://github.com/anthropics/playwright-mcp) with real benchmark data from Wikipedia, GitHub, Hacker News, LinkedIn, and httpbin. If you're looking for a token-efficient browser MCP or evaluating a Playwright MCP alternative, this document covers response sizes, token costs, feature differences, and where each tool wins.

**Charlotte version tested:** v0.2.0 (response benchmarks), v0.4.0 (profile benchmarks)
**Playwright MCP version tested:** `@playwright/mcp@latest` as of February 2026
**Full benchmark methodology:** [charlotte-benchmark-report.md](./charlotte-benchmark-report.md)

---

## Table of Contents

- [Why Response Size Matters](#why-response-size-matters)
- [Navigate Response Size](#navigate-response-size)
- [Observation Response Size](#observation-response-size)
- [Detail Levels — Wikipedia Deep Dive](#detail-levels--wikipedia-deep-dive)
- [Token Cost per Page](#token-cost-per-page)
- [100-Page Session Cost](#100-page-session-cost)
- [LinkedIn — Real-World Application Page](#linkedin--real-world-application-page)
- [Tool Definition Overhead](#tool-definition-overhead)
- [Feature Comparison](#feature-comparison)
- [Charlotte-Only Capabilities](#charlotte-only-capabilities)
- [Playwright-Only Capabilities](#playwright-only-capabilities)
- [Where Each Tool Wins](#where-each-tool-wins)
- [Charlotte's Optimization Journey](#charlottes-optimization-journey)
- [Getting Started](#getting-started)

---

## Why Response Size Matters

Every character an MCP server returns enters the AI agent's context window as input tokens. Larger responses mean:

- **Higher cost** — input tokens are billed per API call
- **Less room for reasoning** — the model's context window fills with page data instead of task context
- **Shorter sessions** — agents hit context limits faster and lose conversation history

Playwright MCP returns the full accessibility snapshot on every call. Charlotte defaults to minimal detail and lets the agent request more when needed. This demand-driven approach is what makes Charlotte a more token-efficient browser MCP for cost-sensitive and high-volume workloads.

---

## Navigate Response Size

Characters returned when an agent first lands on a page. Charlotte defaults to minimal detail; Playwright returns the full accessibility tree.

| Page | Charlotte (minimal) | Playwright | Charlotte Advantage |
|:-----|--------------------:|-----------:|:--------------------|
| Wikipedia (AI article) | 7,667 | 1,040,636 | **99.3% smaller (136x)** |
| Hacker News | 336 | 61,230 | **99.5% smaller (182x)** |
| GitHub repo page | 3,185 | 80,297 | **96.0% smaller (25x)** |
| LinkedIn (logged out) | 3,404 | 24,712 | **86.2% smaller (7.3x)** |
| httpbin form | 364 | 2,255 | **83.9% smaller (6.2x)** |
| example.com | 612 | 817 | **25.1% smaller (1.3x)** |

The advantage scales with page complexity. Simple pages like example.com show modest improvement. Content-heavy pages like Wikipedia show a 136x reduction. Real-world application pages consistently fall in the 7–182x range.

---

## Observation Response Size

Characters returned when an agent explicitly requests full page detail. Charlotte at summary detail vs Playwright snapshot.

| Page | Charlotte (summary) | Playwright (snapshot) | Charlotte Advantage |
|:-----|--------------------:|----------------------:|:--------------------|
| Wikipedia (AI article) | 521,127 | 1,040,878 | **2x smaller** |
| Hacker News | 30,781 | 61,143 | **2x smaller** |
| GitHub repo page | 37,628 | 80,190 | **2.1x smaller** |
| LinkedIn (logged out) | 17,489 | 24,890 | **1.4x smaller** |
| example.com | 612 | 498 | comparable |

Even at summary detail (Charlotte's middle tier), responses are consistently smaller. Charlotte's full detail is still 20–30% smaller than Playwright's snapshot on most pages due to more compact serialization.

---

## Detail Levels — Wikipedia Deep Dive

Wikipedia's AI article is a stress test: thousands of links, deep heading structure, and massive content. Charlotte's three detail tiers let agents choose how much they pay for.

| Detail Level | Characters | Est. Tokens | vs Playwright Snapshot |
|:-------------|----------:|-----------:|:----------------------|
| Charlotte **minimal** | 7,667 | 1,917 | **136x smaller** |
| Charlotte **summary** | 521,127 | 130,282 | **2x smaller** |
| Charlotte **full** | 744,368 | 186,092 | **1.4x smaller** |
| Playwright snapshot | 1,040,878 | 260,220 | — |

A typical agent workflow — navigate, find a button, click it — uses Charlotte's minimal detail. The agent sees the page structure and landmarks in 7,667 characters, calls `find({ type: "link", text: "login" })` to get the specific element (~200 characters), and acts. Total cost: ~8,000 characters.

The equivalent Playwright workflow loads the full snapshot on navigation (1,040,636 characters), then loads it again to verify after an action. Total cost: ~2,081,000 characters.

---

## Token Cost per Page

Per-page input token cost for a navigate + observe workflow on Wikipedia.

Charlotte: navigate (minimal) + observe (minimal) = ~3,834 tokens
Playwright: navigate + snapshot = ~520,379 tokens

| Model | Input Price | Charlotte | Playwright | Playwright Costs... |
|:------|:------------|----------:|-----------:|:-------------------:|
| Claude Sonnet 4 | $3.00/M | $0.012 | $1.561 | **135x more** |
| Claude Opus 4 | $15.00/M | $0.058 | $7.806 | **135x more** |
| GPT-4o | $2.50/M | $0.010 | $1.301 | **135x more** |
| Gemini 2.5 Pro | $1.25/M | $0.005 | $0.650 | **135x more** |
| Claude Haiku 4 | $0.80/M | $0.003 | $0.416 | **135x more** |

---

## 100-Page Session Cost

Input token cost for 100 page navigations at Hacker News complexity (representative of a typical news/content site).

Charlotte: 100 × ~172 tokens = **17,200 input tokens**
Playwright: 100 × ~30,594 tokens = **3,059,400 input tokens**

| Model | Charlotte | Playwright | You Save |
|:------|----------:|-----------:|---------:|
| Claude Sonnet 4 | $0.05 | $9.18 | **$9.13** |
| Claude Opus 4 | $0.26 | $45.89 | **$45.63** |
| GPT-4o | $0.04 | $7.65 | **$7.61** |
| Gemini 2.5 Pro | $0.02 | $3.82 | **$3.80** |
| Claude Haiku 4 | $0.01 | $2.45 | **$2.43** |

### Context window impact

Playwright's Wikipedia navigate + snapshot consumes ~520,000 tokens — more than half of a 200K context window in a single page visit. Charlotte's minimal Wikipedia response uses ~1,900 tokens. An agent could navigate 100 pages before reaching the same context usage.

---

## LinkedIn — Real-World Application Page

LinkedIn's logged-out homepage has 105 interactive elements — representative of a real-world application page with heavy link density. Benchmarked March 2026.

### Navigate — first call cost

| Server | Response Chars | Response Tokens |
|:-------|---------------:|----------------:|
| Charlotte (minimal) | 3,404 | 851 |
| Playwright (navigate) | 24,712 | 6,178 |

Charlotte minimal is **7.3x smaller** than Playwright navigate.

### Observation at each detail level

| Server | Chars | Tokens | vs Playwright |
|:-------|------:|-------:|:-------------:|
| Charlotte minimal | 3,404 | 851 | **7.3x smaller** |
| Charlotte summary | 17,489 | 4,373 | **1.4x smaller** |
| Charlotte full | 20,167 | 5,042 | **1.2x smaller** |
| Playwright snapshot | 24,890 | 6,223 | — |

### Surgical search

Charlotte's `find` tool retrieves a specific element without re-reading the full page:

| Operation | Charlotte | Playwright |
|:----------|----------:|----------:|
| Find one link by text | 170 chars (43 tokens) | N/A (re-read full 24,890 char snapshot) |

### Session cost — 2 calls (navigate + observe)

| Server | Response Tokens | Definition Tokens | Total | vs Playwright |
|:-------|----------------:|------------------:|------:|:-------------:|
| Playwright MCP | 12,401 | 8,046 | **20,447** | — |
| Charlotte (full profile) | 5,222 | 14,374 | **19,596** | 4.2% less |
| Charlotte (browse profile) | 5,224 | 7,454 | **12,678** | **38.0% less** |
| Charlotte (core profile) | 5,222 | 3,354 | **8,576** | **58.1% less** |

### 100-page extrapolation at LinkedIn complexity

| Server | Total Tokens | Sonnet 4 Cost | Opus 4 Cost |
|:-------|-------------:|--------------:|------------:|
| Playwright MCP | 2,044,700 | $6.13 | $30.67 |
| Charlotte (full) | 1,959,600 | $5.88 | $29.39 |
| Charlotte (browse) | 1,267,800 | $3.80 | **$19.02** |
| Charlotte (core) | 857,600 | $2.57 | **$12.86** |

Charlotte browse saves **$11.65 on Opus 4** per 100 LinkedIn-complexity pages versus Playwright.

---

## Tool Definition Overhead

MCP tool definitions are sent as input tokens on every API call. More tools means higher per-call overhead — even when the agent doesn't use most of them. Charlotte v0.4.0 introduced tiered tool profiles to address this.

### Definition size per call

| Configuration | Tools | Definition Chars | Tokens/Call | vs Full |
|:--------------|------:|-----------------:|------------:|:-------:|
| Charlotte full | 40 | 25,152 | 7,187 | — |
| Charlotte browse (default) | 22 | 13,042 | 3,727 | **48% less** |
| Charlotte core | 7 | 5,868 | 1,677 | **77% less** |
| Playwright MCP | 22 | 14,080 | 4,023 | — |

Charlotte's browse profile (22 tools) has slightly smaller definitions than Playwright's 22 tools (13K vs 14K chars) while offering detail levels, structural diffs, semantic find, and other features Playwright doesn't have.

### How overhead dominates real sessions

In a 12-call form interaction session using Charlotte's full profile:

| Category | Tokens | Share |
|:---------|-------:|------:|
| Tool definitions (cumulative) | 86,244 | **95.1%** |
| Response content | 4,492 | 4.9% |

95% of tokens are tool definitions, not useful work. Tiered profiles directly address this.

### Browse session (5 sites, 20 calls)

| Profile | Response Tokens | Def. Tokens | Total Tokens | Savings vs Full |
|:--------|----------------:|------------:|-------------:|:---------------:|
| full | 53,585 | 143,740 | 197,325 | — |
| browse | 46,642 | 74,540 | 121,182 | **38.6%** |
| core | 53,414 | 33,540 | 86,954 | **55.9%** |

Sites visited: example.com, Hacker News, Wikipedia (MCP article), httpbin form, GitHub anthropic-cookbook.

### Interactive session (httpbin form, 12 calls)

| Profile | Response Tokens | Def. Tokens | Total Tokens | Savings vs Full |
|:--------|----------------:|------------:|-------------:|:---------------:|
| full | 4,492 | 86,244 | 90,736 | — |
| browse | 4,948 | 44,724 | 49,672 | **45.3%** |
| core | 4,948 | 20,124 | 25,072 | **72.4%** |

### 100-page session extrapolation (4 calls per page)

| Profile | Total Tokens | vs Full |
|:--------|-------------:|:-------:|
| full (40 tools) | ~3,088,800 | — |
| browse (22 tools) | ~1,704,800 | **saves ~1.4M tokens** |
| core (7 tools) | ~884,800 | **saves ~2.2M tokens** |

### Available profiles

| Profile | Tools | Best For |
|:--------|------:|:---------|
| **core** | 7 | High-volume browsing, maximum token savings |
| **browse** (default) | 22 | General browsing, form interaction, tab management |
| **interact** | 27 | Complex interactions, dialogs, JS execution |
| **develop** | 30 | Local dev server, CSS/JS injection, accessibility audits |
| **audit** | 13 | Site accessibility and performance auditing |
| **full** | 40 | No restrictions — every capability available |

Profiles are selected at startup (`--profile=browse`) and can be adjusted at runtime with the `charlotte:tools` meta-tool.

---

## Feature Comparison

Charlotte v0.4.0 (40 tools) vs Playwright MCP (~36 tools across 7 groups).

| Feature | Charlotte | Playwright MCP | Notes |
|:--------|:---------:|:--------------:|:------|
| Detail level control | **Yes** | No | 3 tiers: minimal, summary, full |
| Stable hash-based element IDs | **Yes** | No | Survives DOM mutations |
| Structural diff between snapshots | **Yes** | No | Compare page state between actions |
| Semantic find (text, role, type) | **Yes** | No | Search without re-reading full page |
| Form structure extraction | **Yes** | No | Grouped fields with labels and options |
| Accessibility / SEO audits | **Yes** | No | Built-in a11y analysis |
| Tiered tool profiles | **Yes** | No | Load only the tools you need |
| Element bounding boxes | **Yes** | No | Layout geometry per element |
| Network throttling (3G/4G/offline) | **Yes** | No | Simulate network conditions |
| Cookie management tools | **Yes** | No | get/set/clear cookies |
| Custom HTTP headers | **Yes** | No | Per-request header injection |
| Dev server with hot reload | **Yes** | No | Local static file server |
| Runtime CSS/JS injection | **Yes** | No | dev_inject tool |
| Runtime configuration | **Yes** | No | Adjust behavior mid-session |
| Async condition polling | Yes | Yes | wait_for |
| Console message retrieval | Yes | Yes | — |
| Network request monitoring | Yes | Yes | — |
| Dialog handling | Yes | Yes | — |
| Drag and drop | Yes | Yes | — |
| Tab management | Yes | Yes | — |
| JavaScript evaluation | Yes | Yes | — |
| Screenshot capture | Yes | Yes | — |
| File upload | No | **Yes** | Planned for future release |
| Coordinate-based interaction | No | **Yes** | Vision group (6 tools) |
| PDF generation | No | **Yes** | browser_pdf_save |
| Testing assertions | No | **Yes** | 5 verification tools |
| Multi-browser engines | No | **Yes** | Chrome, Firefox, WebKit |
| Trace recording | No | **Yes** | Playwright traces + video |
| Batch form fill | No | **Yes** | browser_fill_form |
| Run arbitrary Playwright code | No | **Yes** | browser_run_code |

---

## Charlotte-Only Capabilities

Features Charlotte provides that Playwright MCP does not.

| Feature | Description |
|:--------|:------------|
| `charlotte:diff` | Structural diff between page snapshots — see exactly what changed |
| `charlotte:find` | Search interactive elements by text, role, type, proximity, containment without re-reading the full page |
| Detail levels | 3 tiers (minimal / summary / full) — agents choose how much context to pay for |
| Stable element IDs | Hash-based IDs (e.g. `btn-a3f1`) that survive DOM mutations and re-renders |
| `charlotte:network` | Simulate 3G/4G/offline; block URL patterns |
| `charlotte:get_cookies` / `set_cookies` / `clear_cookies` | Dedicated cookie management |
| `charlotte:set_headers` | Custom HTTP headers per request |
| `charlotte:dev_serve` | Static file server with hot reload for local development |
| `charlotte:dev_audit` | Accessibility, performance, SEO, contrast, and broken link auditing |
| `charlotte:dev_inject` | Runtime CSS and JavaScript injection |
| `charlotte:configure` | Runtime adjustment of snapshot depth, auto-dismiss dialogs, and more |
| `charlotte:tools` | Meta-tool to list, enable, and disable tool groups mid-session |

---

## Playwright-Only Capabilities

Features Playwright MCP provides that Charlotte does not.

| Feature | Tool(s) | Impact |
|:--------|:--------|:-------|
| File upload | `browser_file_upload` | High — blocks file upload workflows |
| Coordinate interaction | 6 vision tools (`click_xy`, `move_xy`, etc.) | Medium — needed for canvas and non-accessible UIs |
| PDF generation | `browser_pdf_save` | Low-Medium |
| Testing assertions | 5 tools (`verify_element_visible`, etc.) | Medium |
| Multi-browser | Chrome, Firefox, WebKit | Medium |
| Trace recording | `browser_start_tracing`, `browser_stop_tracing` | Medium |
| Batch form fill | `browser_fill_form` | Medium |
| Run arbitrary code | `browser_run_code` | Medium |
| Video recording | Via tracing | Medium |
| Locator generation | `browser_generate_locator` | Low-Medium |

---

## Where Each Tool Wins

### Choose Charlotte when:

- **Token cost matters.** Long browsing sessions, high-volume pipelines, or expensive models (Opus 4) where every input token adds up. Charlotte saves 96–99% on content-heavy pages.
- **Agents need surgical precision.** Semantic find, detail levels, and structural diffs let agents request exactly the data they need instead of parsing a full page dump.
- **Accessibility is a priority.** Built-in a11y audits and form structure extraction help agents understand page semantics, not just raw DOM.
- **You want stable references.** Hash-based element IDs survive re-renders and DOM mutations. No more broken selectors when the page shifts.
- **Context window headroom.** Smaller responses leave more room for agent reasoning, tool results from other sources, and longer conversations.
- **You need to control tool overhead.** Tiered profiles let you load 7, 22, or 40 tools depending on the task — Playwright MCP loads all tools on every session.

### Choose Playwright MCP when:

- **You need file uploads.** Charlotte doesn't support this yet.
- **Cross-browser testing matters.** Playwright supports Chrome, Firefox, and WebKit. Charlotte runs Chromium only.
- **Vision-based interaction is required.** Playwright's vision group handles canvas elements and non-accessible UIs via coordinate-based tools.
- **You need trace recording.** Playwright can record browser traces and video for debugging.
- **Built-in test assertions.** Five verification tools for checking element visibility, text content, and values.

---

## Charlotte's Optimization Journey

Charlotte's response efficiency improved across three optimization phases.

### Total response size across 5 test pages (characters)

| Version | Total Characters | Reduction from v0.1.3 |
|:--------|----------------:|:---------------------:|
| v0.1.3 | 5,853,448 | — |
| v0.1.4 | 3,362,507 | 42% |
| v0.2.0 | 1,394,695 | **76%** |

### Per-page breakdown

| Page | v0.1.3 | v0.1.4 | v0.2.0 | Reduction |
|:-----|-------:|-------:|-------:|:---------:|
| example.com | 2,469 | 1,450 | 1,224 | 50% |
| Wikipedia AI | 5,332,154 | 3,068,635 | 1,280,829 | 76% |
| httpbin form | 26,848 | 15,224 | 7,165 | 73% |
| Hacker News | 223,818 | 127,276 | 61,479 | 73% |
| GitHub repo | 268,159 | 149,922 | 43,998 | 84% |

### Optimization phases

1. **v0.1.4 — Compact serialization.** Compact JSON formatting + empty field stripping. ~42% reduction.
2. **v0.2.0 — Demand-driven detail.** Interactive summary for minimal detail + default state stripping. ~62% further reduction (76% cumulative).
3. **v0.4.0 — Tiered tool profiles.** Load 7, 22, or 40 tools. 38–72% reduction in definition overhead per session.

---

## Getting Started

Charlotte is open-source, MIT-licensed, and published on npm.

```bash
npx @ticktockbent/charlotte@latest
```

Add to any MCP-compatible client (Claude Desktop, Claude Code, Cursor, Windsurf, Cline):

```json
{
  "mcpServers": {
    "charlotte": {
      "command": "npx",
      "args": ["@ticktockbent/charlotte@latest"]
    }
  }
}
```

Select a profile to control tool overhead:

```json
{
  "mcpServers": {
    "charlotte": {
      "command": "npx",
      "args": ["@ticktockbent/charlotte@latest", "--profile=browse"]
    }
  }
}
```

- [Charlotte on GitHub](https://github.com/TickTockBent/charlotte)
- [Charlotte on npm](https://www.npmjs.com/package/@ticktockbent/charlotte)
- [Full benchmark methodology](./charlotte-benchmark-report.md)
- [Profile benchmark report](./charlotte-profile-benchmark-report.md)
- [Charlotte website](https://charlotte-rose.vercel.app)
- [Charlotte vs Playwright — interactive comparison](https://charlotte-rose.vercel.app/vs-playwright/)
