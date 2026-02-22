# Charlotte Benchmark Results — minimal-testing-2

Phase 2 optimizations: interactive summary for minimal, state stripping, compact diff JSON.

Generated: 2026-02-22

## Summary

| Test | Charlotte (chars) |
| :--- | ---: |
| Simple Page (example.com) | 1,224 |
| Content-Heavy (Wikipedia AI) | 1,280,829 |
| Interactive Form (httpbin) | 7,165 |
| Multi-Page Nav (Hacker News) | 61,479 |
| Deep Navigation (GitHub Repo) | 43,998 |

## Comparison to previous versions

| Test | v0.1.3 | Phase 1 | Phase 2 | Total reduction |
|:---|---:|---:|---:|---:|
| Simple Page | 2,469 | 1,450 | 1,224 | 50% |
| Wikipedia (navigate) | — | 711,011 | 7,667 | 99% |
| Wikipedia (summary) | — | 711,686 | 521,127 | 27% |
| Interactive Form | 27,008 | 15,224 | 7,165 | 73% |
| HN (navigate) | — | 42,536 | 336 | 99% |
| GitHub (navigate) | — | 49,871 | 3,185 | 94% |
| GitHub (summary) | — | 50,180 | 37,628 | 25% |

## Key per-call numbers

| Test | Tool | Chars |
|:---|:---|---:|
| Simple Page | navigate | 612 |
| Simple Page | observe | 612 |
| Wikipedia | navigate (minimal) | 7,667 |
| Wikipedia | observe (summary) | 521,127 |
| Wikipedia | observe (full) | 744,368 |
| httpbin | navigate (minimal) | 364 |
| httpbin | observe (summary) | 2,492 |
| HN | navigate (minimal) | 336 |
| HN | observe (summary) | 30,781 |
| GitHub | navigate (minimal) | 3,185 |
| GitHub | observe (summary) | 37,628 |
