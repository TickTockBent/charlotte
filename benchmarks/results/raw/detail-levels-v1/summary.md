# Charlotte Benchmark Results

Generated: 2026-03-09T13:50:39.179Z

## Summary

| Test | Charlotte (browse) (chars) |
| :--- | ---: |
| Detail Levels (6 sites × 5 levels) | 373,282 |
| Tree Orientation Workflow (6 sites) | 424,583 |

## Tool Definition Overhead

| Profile | Tools | Definition Chars | Est. Def. Tokens |
| :--- | ---: | ---: | ---: |
| Charlotte (browse) | 23 | 15,520 | 4,435 |

## Cumulative Token Cost by Test

### Detail Levels (6 sites × 5 levels)

| Profile | Calls | Response Tokens | Def. Tokens (cum.) | Total Tokens | Savings vs Full |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Charlotte (browse) | 36 | 93,335 | 159,660 | 252,995 | — |

### Tree Orientation Workflow (6 sites)

| Profile | Calls | Response Tokens | Def. Tokens (cum.) | Total Tokens | Savings vs Full |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Charlotte (browse) | 30 | 106,159 | 133,050 | 239,209 | — |

## Detail Levels (6 sites × 5 levels)

### Charlotte (browse)

- **Success:** Yes
- **Total chars:** 373,282
- **Estimated tokens:** 93,335
- **Wall time:** 22844ms
- **Tool calls:** 36
- **Notes:** Wikipedia: tree=1,948, tree-labeled=8,230, minimal=3,070, summary=38,414, full=48,371
GitHub: tree=1,314, tree-labeled=4,464, minimal=1,775, summary=18,682, full=21,706
Hacker News: tree=1,150, tree-labeled=6,094, minimal=337, summary=30,490, full=34,708
LinkedIn: tree=1,205, tree-labeled=3,857, minimal=3,405, summary=17,490, full=20,004
Stack Overflow: tree=2,951, tree-labeled=9,067, minimal=4,041, summary=32,568, full=42,160
Amazon: tree=39, tree-labeled=39, minimal=785, summary=763, full=785

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 3,070 | 768 | 2023 |
| 2 | charlotte_observe | 1,948 | 487 | 45 |
| 3 | charlotte_observe | 8,230 | 2,058 | 40 |
| 4 | charlotte_observe | 3,070 | 768 | 70 |
| 5 | charlotte_observe | 38,414 | 9,604 | 74 |
| 6 | charlotte_observe | 48,371 | 12,093 | 74 |
| 7 | charlotte_navigate | 1,775 | 444 | 1449 |
| 8 | charlotte_observe | 1,314 | 329 | 22 |
| 9 | charlotte_observe | 4,464 | 1,116 | 18 |
| 10 | charlotte_observe | 1,775 | 444 | 39 |
| 11 | charlotte_observe | 18,682 | 4,671 | 34 |
| 12 | charlotte_observe | 21,706 | 5,427 | 38 |
| 13 | charlotte_navigate | 336 | 84 | 11663 |
| 14 | charlotte_observe | 1,150 | 288 | 40 |
| 15 | charlotte_observe | 6,094 | 1,524 | 35 |
| 16 | charlotte_observe | 337 | 85 | 105 |
| 17 | charlotte_observe | 30,490 | 7,623 | 72 |
| 18 | charlotte_observe | 34,708 | 8,677 | 50 |
| 19 | charlotte_navigate | 3,405 | 852 | 1028 |
| 20 | charlotte_observe | 1,205 | 302 | 26 |
| 21 | charlotte_observe | 3,857 | 965 | 13 |
| 22 | charlotte_observe | 3,405 | 852 | 60 |
| 23 | charlotte_observe | 17,490 | 4,373 | 52 |
| 24 | charlotte_observe | 20,004 | 5,001 | 28 |
| 25 | charlotte_navigate | 3,999 | 1,000 | 1229 |
| 26 | charlotte_observe | 2,951 | 738 | 58 |
| 27 | charlotte_observe | 9,067 | 2,267 | 63 |
| 28 | charlotte_observe | 4,041 | 1,011 | 76 |
| 29 | charlotte_observe | 32,568 | 8,142 | 87 |
| 30 | charlotte_observe | 42,160 | 10,540 | 90 |
| 31 | charlotte_navigate | 785 | 197 | 4127 |
| 32 | charlotte_observe | 39 | 10 | 2 |
| 33 | charlotte_observe | 39 | 10 | 2 |
| 34 | charlotte_observe | 785 | 197 | 1 |
| 35 | charlotte_observe | 763 | 191 | 5 |
| 36 | charlotte_observe | 785 | 197 | 2 |

## Tree Orientation Workflow (6 sites)

### Charlotte (browse)

- **Success:** Yes
- **Total chars:** 424,583
- **Estimated tokens:** 106,159
- **Wall time:** 22536ms
- **Tool calls:** 30
- **Notes:** Wikipedia: tree-labeled=8,230, summary=38,414 (79% savings)
GitHub: tree-labeled=4,464, summary=18,682 (76% savings)
Hacker News: tree-labeled=6,094, summary=30,489 (80% savings)
LinkedIn: tree-labeled=3,857, summary=17,489 (78% savings)
Stack Overflow: tree-labeled=9,170, summary=32,673 (72% savings)
Amazon: tree-labeled=39, summary=249 (84% savings)

Overall observe savings: tree-labeled=31,854 vs summary=137,996 chars (77% savings)

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 3,070 | 768 | 2325 |
| 2 | charlotte_observe | 8,230 | 2,058 | 46 |
| 3 | charlotte_find | 34,906 | 8,727 | 73 |
| 4 | charlotte_observe | 38,414 | 9,604 | 70 |
| 5 | charlotte_find | 34,906 | 8,727 | 71 |
| 6 | charlotte_navigate | 1,839 | 460 | 955 |
| 7 | charlotte_observe | 4,464 | 1,116 | 22 |
| 8 | charlotte_find | 15,771 | 3,943 | 32 |
| 9 | charlotte_observe | 18,682 | 4,671 | 34 |
| 10 | charlotte_find | 15,771 | 3,943 | 34 |
| 11 | charlotte_navigate | 336 | 84 | 12851 |
| 12 | charlotte_observe | 6,094 | 1,524 | 51 |
| 13 | charlotte_find | 30,070 | 7,518 | 55 |
| 14 | charlotte_observe | 30,489 | 7,623 | 61 |
| 15 | charlotte_find | 30,070 | 7,518 | 59 |
| 16 | charlotte_navigate | 3,404 | 851 | 920 |
| 17 | charlotte_observe | 3,857 | 965 | 54 |
| 18 | charlotte_find | 13,262 | 3,316 | 133 |
| 19 | charlotte_observe | 17,489 | 4,373 | 37 |
| 20 | charlotte_find | 13,262 | 3,316 | 37 |
| 21 | charlotte_navigate | 4,003 | 1,001 | 1148 |
| 22 | charlotte_observe | 9,170 | 2,293 | 59 |
| 23 | charlotte_find | 26,855 | 6,714 | 92 |
| 24 | charlotte_observe | 32,673 | 8,169 | 90 |
| 25 | charlotte_find | 26,855 | 6,714 | 84 |
| 26 | charlotte_navigate | 271 | 68 | 3134 |
| 27 | charlotte_observe | 39 | 10 | 1 |
| 28 | charlotte_find | 41 | 11 | 2 |
| 29 | charlotte_observe | 249 | 63 | 1 |
| 30 | charlotte_find | 41 | 11 | 5 |
