# Charlotte benchmarks

This directory holds the instruments that produce Charlotte's published numbers, and
the archived results those numbers are quoted from. Everything the README and the
docs site claim about token cost traces back to a file in here.

Three things are measured, by three separate instruments:

| Instrument | Question it answers | Published results |
|:---|:---|:---|
| `run-benchmarks.ts` | How many characters does each server return per tool call on real sites? | [`results/raw/v0.8.0/summary.md`](results/raw/v0.8.0/summary.md) |
| `run-drift.ts` | Has Charlotte's orientation cost crept up across releases? | [`results/drift/2026-08-09/drift.md`](results/drift/2026-08-09/drift.md) |
| `run-tasks.ts` | What does a whole realistic agent task cost, end to end? | [`results/tasks/2026-08-09/tasks.md`](results/tasks/2026-08-09/tasks.md) |

If you arrived here from a link in the README or the docs site and just want the
numbers, start with one of the three result files above — they are written to be read
standalone, methodology included.

## Layout

```
benchmarks/
├── run-benchmarks.ts   # cross-server + profile comparison suites
├── run-drift.ts        # per-release orientation-cost drift
├── run-tasks.ts        # per-task token battery (Charlotte vs Playwright)
├── remote-report.ts    # Charlotte Remote §8 measurement instrument (not a comparison)
├── harness/            # shared MCP client, metrics, test runner, markdown reporter
├── tests/              # individual benchmark test definitions used by run-benchmarks.ts
├── configs/            # MCP server launch configs (charlotte profiles, playwright, chrome-devtools)
└── results/
    ├── raw/            # archived run-benchmarks.ts output, one dir per run label
    ├── drift/          # archived run-drift.ts output, one dir per run date
    └── tasks/          # archived run-tasks.ts output, one dir per run date
```

`.drift-cache/` also appears here after a drift run — one installed+built copy of every
released Charlotte version. It is gitignored and safe to delete (it will be rebuilt,
slowly, on the next run).

## Running them

```bash
# Cross-server comparison — Charlotte vs Playwright MCP vs Chrome DevTools MCP
npx tsx benchmarks/run-benchmarks.ts --suite comparison

# Charlotte profile overhead — full vs browse vs core
npx tsx benchmarks/run-benchmarks.ts --suite profiles

# Narrower runs
npx tsx benchmarks/run-benchmarks.ts --server charlotte --test 01

# Release drift — --run-date is required (see the same-day rule below)
npx tsx benchmarks/run-drift.ts --run-date YYYY-MM-DD

# Per-task battery — --run-date is required for the same reason
npx tsx benchmarks/run-tasks.ts --run-date YYYY-MM-DD
```

`run-benchmarks.ts` and `run-tasks.ts` need a built `dist/` (`npm run build`).
`run-drift.ts` builds each release into its own cache directory, so it doesn't use
your working `dist/` at all. The comparison suite hits real, live websites — expect
run-to-run wobble as those pages change, and expect it to take a few minutes.

`remote-report.ts` (`npm run report:remote`) is the odd one out: it measures Charlotte
Remote's HTTP overhead, cold start, crash recovery, and idle memory. It has no
assertions and no pass/fail thresholds — it prints numbers for a human to price
against the design targets.

## Ground rules

These are enforced by convention, not by code, and they are why the archived results
can be trusted against each other:

- **Same-day rule.** Every version or server in a single comparison must be measured
  under one run date, never merged across dates — live pages drift underneath you.
  This is why `run-drift.ts` and `run-tasks.ts` refuse to start without `--run-date`.
- **No handicapping.** Each server gets its own most-efficient reasonable call path.
  Where the paths differ (Playwright's `browser_navigate` returns a link, not a tree,
  so `browser_snapshot` is the comparison point), the reason is written down in the
  result file.
- **Everything the agent ingests counts.** Including snapshot files that the path
  requires reading. Tool-definition cost is reported once per server and never folded
  into per-task totals — it amortizes across a session, not a task.
- **Conservative ranges, not peaks.** Durable public claims are stated as ranges, and
  the losing results are published beside the winning ones.
- **Runs are archived, not overwritten.** Each run gets its own directory. Where a
  result needs context — host, resolved dependency versions, sandbox state — it gets a
  `PROVENANCE.md` next to it, as in [`results/raw/v0.8.0/`](results/raw/v0.8.0/PROVENANCE.md).
