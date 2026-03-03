# Tiered Tool Visibility: Informal Benchmarks

Measured 2026-03-03 against `claude/implement-tiered-tools-nkVzf` branch.

## Tool Definition Token Cost

Tool definitions (name, description, input schema) are serialized into `tools/list` and injected into the agent's context. These are measured as JSON character count / 3.5 chars-per-token.

| Profile | Tools Enabled | Definition Chars | Est. Tokens |
|---------|--------------|-----------------|-------------|
| `full` (old default) | 39 | 14,760 | ~4,217 |
| `browse` (new default) | 21 | 7,701 | ~2,200 |
| `core` | 6 | — | ~600* |
| **Saved (browse vs full)** | **18 fewer** | **7,059** | **~2,017** |

*Core estimated from ratio; not directly measured.

**Reduction: 47.8%** of tool definition overhead eliminated by switching from `full` to `browse`.

## Per-Session Savings Estimate

Tool definitions are included in every API round-trip (each tool call and response). A typical browsing session involves multiple tool calls per page visited.

### Assumptions for a 100-page browsing session

| Activity | Tool Calls per Page | Rationale |
|----------|-------------------|-----------|
| Navigate | 1 | One `navigate` call |
| Observe/Find | 2 | Initial observe + one find for specific elements |
| Interact (click, type, etc.) | 2 | Average light interaction per page |
| Meta/Other | 0.5 | Occasional screenshots, back/forward, diff |
| **Total per page** | **~5.5** | |

For 100 pages: **~550 tool calls**

| Metric | Full Profile | Browse Profile | Savings |
|--------|-------------|---------------|---------|
| Tokens per call (tool defs) | ~4,217 | ~2,200 | ~2,017 |
| Calls per session (100 pages) | 550 | 550 | — |
| **Total tool def tokens** | **~2,319,350** | **~1,210,000** | **~1,109,350** |

**Estimated savings over a 100-page session: ~1.1M tokens (~47.8% reduction in tool definition overhead).**

### Context window impact

Beyond raw token cost, tool definitions compete with conversation content for context window space. At ~4.2k tokens, full tool definitions consume roughly 2% of a 200k context window. At ~2.2k tokens (browse), this drops to ~1.1%. While small per-call, the cumulative effect matters in long sessions where context compression kicks in earlier.

## Live Test Results

Validated end-to-end with the following test sequence:

| Step | Tool | Target | Result |
|------|------|--------|--------|
| 1 | `charlotte:tools list` | — | Correct browse profile state: 21 enabled, 18 disabled |
| 2 | `charlotte:navigate` | example.com | Clean minimal response |
| 3 | `charlotte:navigate` | Wikipedia AI article | 3,683 elements, compact response |
| 4 | `charlotte:navigate` | httpbin.org/forms/post | Form with 16 elements |
| 5 | `charlotte:find` | text inputs | 4 elements found with actionable IDs |
| 6 | `charlotte:type` | Customer name field | Value set, delta captured |
| 7 | `charlotte:toggle` | Bacon checkbox | Checked, state change in delta |
| 8 | `charlotte:navigate` | GitHub anthropic-cookbook | 129 elements, complex SPA |
| 9 | `charlotte:tools enable dev_mode` | — | 3 tools activated at runtime |
| 10 | `charlotte:dev_audit` | GitHub page | Ran successfully (1 SEO finding) |
| 11 | `charlotte:tools disable dev_mode` | — | 3 tools deactivated |
| 12 | `charlotte:tools list` | — | State consistent: dev_mode back to 0/3 |

All browse-profile tools worked correctly. Runtime enable/disable cycle completed with `list_changed` notification picked up by Claude Code immediately.

## Notes

- Token estimates use 3.5 chars/token ratio for JSON schema content. Actual tokenization varies by model.
- The `charlotte:tools` meta-tool adds ~200 tokens of overhead (always present regardless of profile). Net savings account for this.
- These are informal measurements. Rigorous benchmarks with actual tokenizer counts and multi-run averages are planned.
- The analysis doc estimated 60% savings based on a higher baseline (7-9k tokens). Actual tool definitions are more compact at ~4.2k for full, yielding ~48% savings.
