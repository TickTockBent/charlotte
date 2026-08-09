# Charlotte release drift — orientation cost on live pages

Run date: **2026-08-09**

Measures navigate-response size (orientation cost) and tool-definition size across every Charlotte release, against the same live pages, run same-day.

## Version × page (navigate tokens, headline = run 1)

| Version | Hacker News | Wikipedia | GitHub | Tool-def tokens | Tool count | Puppeteer / Chromium |
| --- | --- | --- | --- | --- | --- | --- |
| v0.2.0 | 84 | 597 | 561 ⚠ (run2 23.4% diff) | 4,808 | 32 | 24.43.1 / 148.0.7778.97 |
| v0.3.0 | 84 | 597 | 430 | 5,412 | 36 | 24.43.1 / 148.0.7778.97 |
| v0.4.2 | 84 | 642 ⚠ (run2 6.4% diff) | 460 | 3,616 | 23 | 24.43.1 / 148.0.7778.97 |
| v0.5.1 | 84 | 642 ⚠ (run2 6.4% diff) | 460 | 3,887 | 23 | 24.43.1 / 148.0.7778.97 |
| v0.6.3 | 85 | 690 | 503 | 3,979 | 23 | 24.43.1 / 148.0.7778.97 |
| v0.7.0 | 85 | 701 | 511 | 4,187 | 23 | 24.37.3 / 145.0.7632.67 |
| v0.8.0 | 91 | 707 | 518 | 3,825 | 23 | 24.37.3 / 145.0.7632.67 |
| playwright 0.0.79 | 12,540 | 15,849 | 8,270 | 4,626 | 24 | — (baseline; own bundled browser, not tracked per-row) |

Cells marked ⚠ had a >5% difference between run 1 and run 2 (same session, fresh navigate both times).
The `playwright 0.0.79` row is a same-day baseline, not a Charlotte release — see the methodology notes below for how its orientation cost is measured.

## Orientation cost by page (ASCII chart, navigate tokens, run 1; playwright row = browser_snapshot tokens)

### Hacker News

```
v0.2.0              84
v0.3.0              84
v0.4.2              84
v0.5.1              84
v0.6.3              85
v0.7.0              85
v0.8.0              91
playwright 0.0.79  ████████████████████████████████████████ 12,540
```

### Wikipedia

```
v0.2.0             ██ 597
v0.3.0             ██ 597
v0.4.2             ██ 642
v0.5.1             ██ 642
v0.6.3             ██ 690
v0.7.0             ██ 701
v0.8.0             ██ 707
playwright 0.0.79  ████████████████████████████████████████ 15,849
```

### GitHub

```
v0.2.0             ███ 561
v0.3.0             ██ 430
v0.4.2             ██ 460
v0.5.1             ██ 460
v0.6.3             ██ 503
v0.7.0             ██ 511
v0.8.0             ███ 518
playwright 0.0.79  ████████████████████████████████████████ 8,270
```

## Tool-definition size (ASCII chart, def tokens)

```
v0.2.0             ████████████████████████████████████ 4,808 tokens (32 tools)
v0.3.0             ████████████████████████████████████████ 5,412 tokens (36 tools)
v0.4.2             ███████████████████████████ 3,616 tokens (23 tools)
v0.5.1             █████████████████████████████ 3,887 tokens (23 tools)
v0.6.3             █████████████████████████████ 3,979 tokens (23 tools)
v0.7.0             ███████████████████████████████ 4,187 tokens (23 tools)
v0.8.0             ████████████████████████████ 3,825 tokens (23 tools)
playwright 0.0.79  ██████████████████████████████████ 4,626 tokens (24 tools)
```

## Methodology notes

- **Same-day rule**: rows are only comparable within one run date. This report is a single run on 2026-08-09 against live pages; each future release re-runs all versions from scratch rather than reusing old numbers, since Hacker News/Wikipedia/GitHub page content changes day to day.
- **Token heuristic**: tokens ≈ ceil(chars / 4), computed from the full serialized MCP response text.
- **Live-page caveat**: these are live, uncontrolled pages. Front-page HN stories, the Wikipedia "Main Page" featured content, and github.com/anthropics's pinned repos all change over time — drift numbers include real content drift, not just Charlotte's own changes.
- **Per-version Chromium caveat**: this is NOT a clean "as-shipped" reconstruction of each release. The npm-installed rows (v0.2.0–v0.6.3) declared puppeteer as a loose semver range, so `npm install` resolved each of them to whatever puppeteer/Chromium build was current on the day this cache was set up — in this run, all five floated to the same puppeteer/Chromium pair, distinct from what a user installing those versions at their original release date would have gotten. Only v0.7.0 and v0.8.0 lockfile-pin an exact puppeteer version (via `npm ci`), so those two rows are the only ones that reflect a specific, reproducible Chromium build. In practice this makes the chart closer to measuring "Charlotte's code changes on top of a mostly Chromium-controlled AX tree" than true per-release drift — see the `Puppeteer / Chromium` column above (sourced from puppeteerVersion/chromeBuildId per row in drift.json) to see exactly which rows share a browser build and group/exclude them accordingly.
- **Playwright baseline methodology**: the `playwright 0.0.79` row is measured same-day, in the same run, against the same three pages — not pulled from a prior benchmark. Its orientation cost is `browser_snapshot`'s inline accessibility tree, not `browser_navigate`'s response: in this Playwright MCP version, `browser_navigate` writes the snapshot to a `.playwright-mcp/page-*.yml` file on disk and returns only a short page/status summary, so the tree an agent actually has to read to orient only appears in the follow-up `browser_snapshot` call. Both `browser_navigate` and `browser_snapshot` response sizes are recorded per run in drift.json; only the snapshot figure is charted/tabled here, matching the metrics-pass convention.
- Run on an Ubuntu 24.04 host (AppArmor userns restriction on Chrome sandboxing); all versions launched with --no-sandbox unless noted otherwise in argsUsed.
