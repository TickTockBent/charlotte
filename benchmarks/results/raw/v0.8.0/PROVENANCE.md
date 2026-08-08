# v0.8.0 benchmark provenance

**Run date:** 2026-08-08 (metrics pass, task #35)
**Host:** motherbrain (Ubuntu 24.04), sandbox off (`--no-sandbox`) for the harness.

## Resolved versions under test
- **Charlotte:** 0.8.0 (fresh `dist/` from `npm run build`)
- **@playwright/mcp:** 0.0.79 (installed `--no-save`; browser `chrome-for-testing`
  headless-shell 152.0.7977.8 via `npx @playwright/mcp install-browser`)
- **chrome-devtools-mcp:** 1.6.0 (via `npx chrome-devtools-mcp@latest`)

## Suites
- `comparison` → this dir (`v0.8.0/`), confirmed by a second identical run in
  `v0.8.0-run2/` (run-to-run variance ≈ 0; only HN's Playwright snapshot moved
  30 chars / 0.06% as one headline changed).
- `profiles` → `v0.8.0/profiles/`.

## Method notes / honesty guardrails
- Orientation cost = Charlotte's default `navigate` (minimal) first-call chars vs
  Playwright's `browser_snapshot` inline tree chars. In 0.0.79 `browser_navigate`
  writes the snapshot to a file and returns only a link; `browser_snapshot` still
  returns the full tree inline (the comparison point), so the methodology is
  preserved.
- Live pages drift; durable claims are expressed as conservative ranges, not the
  brittle per-run peak. See `../../../private-docs/remote/decisions.md` D24.
- First re-run's Playwright numbers were void (missing browser binary → every call
  errored); discarded and re-run after installing the browser. The *original*
  v0.7.0 comparison was valid and is untouched in `../v0.7.0/`.

## Cost-table model (vs-playwright + Benchmarks.tsx cost tabs)

Recomputed 2026-08-08 (D24 follow-up). The prior cost table was not reproducible
from any consistent model — it was ~2× inflated on Playwright and priced Opus at
~$5/1M instead of $15. Replaced with this clean model:

- **Metric:** input-token cost of the page *orientation* for a 100-page,
  Hacker-News-complexity session. Matches the headline char table.
- **Per-page orientation tokens** (harness estimate, chars/4, from the fresh
  v0.8.0 HN run): Charlotte `navigate` = **91**; Playwright `navigate`+`snapshot`
  = **12,748**. Tool-definition overhead is excluded here (shown separately in the
  profile section — no double count).
- **Prices (input, per 1M) — researched from vendor pricing pages 2026-08-08**
  (platform.claude.com/docs/en/about-claude/pricing, developers.openai.com/api/docs/pricing);
  current-generation rows, since Sonnet 4 / Opus 4 / Haiku 3.5 are retired and
  GPT-4o is two generations behind: **Claude Sonnet 5 $3 · Claude Opus 5 $5 ·
  GPT-5.6 Terra $2 · Claude Haiku 4.5 $1**. (Sonnet 5 has $2 intro pricing through
  2026-08-31; table uses the $3 standard rate that applies from 2026-09-01.)
- **Result** (Charlotte / Playwright / savings): Sonnet 5 $0.03/$3.82/$3.80 ·
  Opus 5 $0.05/$6.37/$6.33 · GPT-5.6 Terra $0.02/$2.55/$2.53 ·
  Haiku 4.5 $0.01/$1.27/$1.27.
  Ratio is a constant ~140× (price cancels), consistent with the char headline.

## Advantage-shrinkage attribution (same-day A/B, 2026-08-08)

To attribute the ratio drops (GitHub 23×→10.3×, Wikipedia 122×→51.4×, HN
178×→139×) between tool changes, our changes, and live-page drift, both sides
were A/B'd on the same pages within minutes:

- **Charlotte v0.7.0 (built from main) vs v0.8.0, same page:** byte-identical
  output except the new 23-char `session_id` envelope field. Charlotte's
  serialization did NOT change; all Charlotte-side growth is page-side.
- **Playwright MCP 0.0.75 vs 0.0.79, same pages:** 0.0.79's snapshot format is
  genuinely more compact — GitHub 46,472→38,971 (−16%), HN 61,746→50,818 (−18%),
  Wikipedia 1,172,902→1,137,916 (−3%).
- **Site drift (0.0.75 today vs 0.0.75 on 2026-08-01):** GitHub 81,835→46,472
  (−43% — GitHub slimmed its page markup); HN 59,996→61,746 (+3%, normal churn);
  Wikipedia 1,049,228→1,172,902 (+12% — new per-section markup).

Per-site attribution:
- **HN 178×→139×**: ~all Playwright-side format compaction (−18%) + Charlotte +8%
  page churn. Site stable.
- **GitHub 23×→10.3×**: GitHub's own page slimmed −43% + Playwright format −16%.
  Charlotte held (+6%).
- **Wikipedia 122×→51×**: Wikipedia added per-section ARIA regions (~75 `region`
  landmarks + citation growth to 3,854 interactive elements). This inflates
  Charlotte's structure-proportional orientation 2.6× while inflating Playwright's
  content-proportional dump only ~12%. Charlotte output per unit of page
  structure is unchanged.

Structural takeaway: Charlotte's orientation scales with page *structure*;
Playwright's snapshot scales with page *content*. Pages getting more structured
(Wikipedia) and competitors compacting their format (0.0.79) both narrow the
ratio without any Charlotte regression.

## Real-tokenizer sanity check on the cost table (2026-08-08)

The harness estimates tokens as chars/4. Verified against a real BPE
(`tiktoken` o200k_base) on live HN payloads fetched at check time:
- Playwright snapshot: chars/4 is near-exact (real/heuristic = 1.04×).
- Charlotte navigate: 1.22× (tiny structural-JSON payload tokenizes denser).
- Dollars at Sonnet-5 $3/1M, 100 pages: **real $0.03 vs $3.84** — published
  $0.03/$3.82 holds within $0.02. Real-tokenizer ratio ≈ 145× vs published
  ~140× (published is conservative).
- Caveat: Anthropic's tokenizer is not public; modern Claude models reportedly
  tokenize ~30% denser than chars/4. That scales BOTH columns equally (ratio
  invariant); absolute Claude-row dollars may run somewhat higher on both sides.
