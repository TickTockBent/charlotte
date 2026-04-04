# Charlotte Benchmark Results

Generated: 2026-04-04T01:17:44.069Z

## Summary

| Test | Charlotte (browse) (chars) | Charlotte (core) (chars) | Charlotte (full) (chars) |
| :--- | ---: | ---: | ---: |
| Tool Definitions (overhead) | 259 | 259 | 259 |
| Browse Session (5 sites) | 187,195 | 186,510 | 187,194 |
| Interactive Session (form) | 19,788 | 19,788 | 19,334 |
| Runtime Toggle (meta-tool) | 2,771 | N/A | N/A |

## Tool Definition Overhead

| Profile | Tools | Definition Chars | Est. Def. Tokens |
| :--- | ---: | ---: | ---: |
| Charlotte (full) | 34 | 28,591 | 8,169 |
| Charlotte (browse) | 16 | 13,681 | 3,909 |
| Charlotte (core) | 7 | 7,519 | 2,149 |

### Headline Savings

- **Charlotte (browse)** saves **52%** tool definition overhead vs Charlotte (full) (3,909 vs 8,169 tokens per call)
- **Charlotte (core)** saves **74%** tool definition overhead vs Charlotte (full) (2,149 vs 8,169 tokens per call)

## Cumulative Token Cost by Test

### Tool Definitions (overhead)

| Profile | Calls | Response Tokens | Def. Tokens (cum.) | Total Tokens | Savings vs Full |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Charlotte (full) | 1 | 65 | 8,169 | 8,234 | — |
| Charlotte (browse) | 1 | 65 | 3,909 | 3,974 | 51.7% |
| Charlotte (core) | 1 | 65 | 2,149 | 2,214 | 73.1% |

### Browse Session (5 sites)

| Profile | Calls | Response Tokens | Def. Tokens (cum.) | Total Tokens | Savings vs Full |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Charlotte (full) | 20 | 46,809 | 163,380 | 210,189 | — |
| Charlotte (browse) | 20 | 46,810 | 78,180 | 124,990 | 40.5% |
| Charlotte (core) | 20 | 46,638 | 42,980 | 89,618 | 57.4% |

### Interactive Session (form)

| Profile | Calls | Response Tokens | Def. Tokens (cum.) | Total Tokens | Savings vs Full |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Charlotte (full) | 12 | 4,838 | 98,028 | 102,866 | — |
| Charlotte (browse) | 12 | 4,950 | 46,908 | 51,858 | 49.6% |
| Charlotte (core) | 12 | 4,950 | 25,788 | 30,738 | 70.1% |

## Tool Definitions (overhead)

### Charlotte (full)

- **Success:** Yes
- **Total chars:** 259
- **Estimated tokens:** 65
- **Wall time:** 814ms
- **Tool calls:** 1
- **Notes:** Tools: 34 (expected 34, match). Definition chars: 28,591. Est. definition tokens: 8,169

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 259 | 65 | 814 |

### Charlotte (browse)

- **Success:** Yes
- **Total chars:** 259
- **Estimated tokens:** 65
- **Wall time:** 705ms
- **Tool calls:** 1
- **Notes:** Tools: 16 (expected 16, match). Definition chars: 13,681. Est. definition tokens: 3,909

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 259 | 65 | 705 |

### Charlotte (core)

- **Success:** Yes
- **Total chars:** 259
- **Estimated tokens:** 65
- **Wall time:** 1093ms
- **Tool calls:** 1
- **Notes:** Tools: 7 (expected 7, match). Definition chars: 7,519. Est. definition tokens: 2,149

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 259 | 65 | 1093 |

## Browse Session (5 sites)

### Charlotte (full)

- **Success:** Yes
- **Total chars:** 187,194
- **Estimated tokens:** 46,809
- **Wall time:** 5208ms
- **Tool calls:** 20
- **Notes:** 5/5 sites returned meaningful content

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 613 | 154 | 1160 |
| 2 | charlotte_observe | 613 | 154 | 12 |
| 3 | charlotte_observe | 739 | 185 | 8 |
| 4 | charlotte_find | 169 | 43 | 5 |
| 5 | charlotte_navigate | 337 | 85 | 499 |
| 6 | charlotte_observe | 337 | 85 | 89 |
| 7 | charlotte_observe | 30,377 | 7,595 | 78 |
| 8 | charlotte_find | 29,957 | 7,490 | 55 |
| 9 | charlotte_navigate | 3,108 | 777 | 661 |
| 10 | charlotte_observe | 3,155 | 789 | 68 |
| 11 | charlotte_observe | 36,550 | 9,138 | 80 |
| 12 | charlotte_find | 30,922 | 7,731 | 64 |
| 13 | charlotte_navigate | 366 | 92 | 220 |
| 14 | charlotte_observe | 366 | 92 | 13 |
| 15 | charlotte_observe | 2,494 | 624 | 27 |
| 16 | charlotte_find | 41 | 11 | 21 |
| 17 | charlotte_navigate | 3,713 | 929 | 1976 |
| 18 | charlotte_observe | 3,713 | 929 | 62 |
| 19 | charlotte_observe | 22,596 | 5,649 | 58 |
| 20 | charlotte_find | 17,028 | 4,257 | 51 |

### Charlotte (browse)

- **Success:** Yes
- **Total chars:** 187,195
- **Estimated tokens:** 46,810
- **Wall time:** 6522ms
- **Tool calls:** 20
- **Notes:** 5/5 sites returned meaningful content

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 613 | 154 | 3291 |
| 2 | charlotte_observe | 613 | 154 | 10 |
| 3 | charlotte_observe | 739 | 185 | 12 |
| 4 | charlotte_find | 169 | 43 | 4 |
| 5 | charlotte_navigate | 337 | 85 | 411 |
| 6 | charlotte_observe | 337 | 85 | 56 |
| 7 | charlotte_observe | 30,377 | 7,595 | 65 |
| 8 | charlotte_find | 29,957 | 7,490 | 41 |
| 9 | charlotte_navigate | 3,109 | 778 | 683 |
| 10 | charlotte_observe | 3,155 | 789 | 60 |
| 11 | charlotte_observe | 36,550 | 9,138 | 59 |
| 12 | charlotte_find | 30,922 | 7,731 | 54 |
| 13 | charlotte_navigate | 366 | 92 | 220 |
| 14 | charlotte_observe | 366 | 92 | 7 |
| 15 | charlotte_observe | 2,494 | 624 | 6 |
| 16 | charlotte_find | 41 | 11 | 8 |
| 17 | charlotte_navigate | 3,713 | 929 | 1405 |
| 18 | charlotte_observe | 3,713 | 929 | 45 |
| 19 | charlotte_observe | 22,596 | 5,649 | 43 |
| 20 | charlotte_find | 17,028 | 4,257 | 43 |

### Charlotte (core)

- **Success:** Yes
- **Total chars:** 186,510
- **Estimated tokens:** 46,638
- **Wall time:** 4646ms
- **Tool calls:** 20
- **Notes:** 5/5 sites returned meaningful content

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 613 | 154 | 1124 |
| 2 | charlotte_observe | 613 | 154 | 12 |
| 3 | charlotte_observe | 739 | 185 | 4 |
| 4 | charlotte_find | 169 | 43 | 3 |
| 5 | charlotte_navigate | 337 | 85 | 451 |
| 6 | charlotte_observe | 337 | 85 | 183 |
| 7 | charlotte_observe | 30,375 | 7,594 | 50 |
| 8 | charlotte_find | 29,955 | 7,489 | 43 |
| 9 | charlotte_navigate | 3,109 | 778 | 711 |
| 10 | charlotte_observe | 3,155 | 789 | 78 |
| 11 | charlotte_observe | 36,550 | 9,138 | 59 |
| 12 | charlotte_find | 30,922 | 7,731 | 62 |
| 13 | charlotte_navigate | 366 | 92 | 225 |
| 14 | charlotte_observe | 366 | 92 | 10 |
| 15 | charlotte_observe | 2,494 | 624 | 21 |
| 16 | charlotte_find | 41 | 11 | 25 |
| 17 | charlotte_navigate | 3,486 | 872 | 1359 |
| 18 | charlotte_observe | 3,486 | 872 | 116 |
| 19 | charlotte_observe | 22,369 | 5,593 | 47 |
| 20 | charlotte_find | 17,028 | 4,257 | 61 |

## Interactive Session (form)

### Charlotte (full)

- **Success:** Yes
- **Total chars:** 19,334
- **Estimated tokens:** 4,838
- **Wall time:** 2834ms
- **Tool calls:** 12
- **Notes:** Found 4 inputs, filled 4, submitted: false

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 365 | 92 | 2650 |
| 2 | charlotte_observe | 2,493 | 624 | 10 |
| 3 | charlotte_find | 665 | 167 | 9 |
| 4 | charlotte_type | 3,044 | 761 | 51 |
| 5 | charlotte_observe | 592 | 148 | 6 |
| 6 | charlotte_type | 3,255 | 814 | 25 |
| 7 | charlotte_observe | 592 | 148 | 8 |
| 8 | charlotte_type | 3,278 | 820 | 39 |
| 9 | charlotte_observe | 592 | 148 | 6 |
| 10 | charlotte_type | 3,272 | 818 | 17 |
| 11 | charlotte_observe | 593 | 149 | 6 |
| 12 | charlotte_observe | 593 | 149 | 7 |

### Charlotte (browse)

- **Success:** Yes
- **Total chars:** 19,788
- **Estimated tokens:** 4,950
- **Wall time:** 1196ms
- **Tool calls:** 12
- **Notes:** Found 4 inputs, filled 4, submitted: false

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 592 | 148 | 1018 |
| 2 | charlotte_observe | 2,720 | 680 | 17 |
| 3 | charlotte_find | 665 | 167 | 16 |
| 4 | charlotte_type | 3,044 | 761 | 40 |
| 5 | charlotte_observe | 592 | 148 | 6 |
| 6 | charlotte_type | 3,255 | 814 | 23 |
| 7 | charlotte_observe | 592 | 148 | 6 |
| 8 | charlotte_type | 3,278 | 820 | 33 |
| 9 | charlotte_observe | 592 | 148 | 6 |
| 10 | charlotte_type | 3,272 | 818 | 17 |
| 11 | charlotte_observe | 593 | 149 | 6 |
| 12 | charlotte_observe | 593 | 149 | 6 |

### Charlotte (core)

- **Success:** Yes
- **Total chars:** 19,788
- **Estimated tokens:** 4,950
- **Wall time:** 1172ms
- **Tool calls:** 12
- **Notes:** Found 4 inputs, filled 4, submitted: false

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 592 | 148 | 993 |
| 2 | charlotte_observe | 2,720 | 680 | 15 |
| 3 | charlotte_find | 665 | 167 | 9 |
| 4 | charlotte_type | 3,044 | 761 | 42 |
| 5 | charlotte_observe | 592 | 148 | 7 |
| 6 | charlotte_type | 3,255 | 814 | 26 |
| 7 | charlotte_observe | 592 | 148 | 7 |
| 8 | charlotte_type | 3,278 | 820 | 33 |
| 9 | charlotte_observe | 592 | 148 | 6 |
| 10 | charlotte_type | 3,272 | 818 | 19 |
| 11 | charlotte_observe | 593 | 149 | 7 |
| 12 | charlotte_observe | 593 | 149 | 8 |

## Runtime Toggle (meta-tool)

### Charlotte (browse)

- **Success:** Yes
- **Total chars:** 2,771
- **Estimated tokens:** 694
- **Wall time:** 670ms
- **Tool calls:** 5
- **Notes:** Initial: 16 tools. After enable: 18 tools (grew: true). Console tool worked: true. After disable: 16 tools (restored: true). Initial def chars: 13,681. Expanded def chars: 15,798. Contracted def chars: 13,681

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_tools | 2,078 | 520 | 3 |
| 2 | charlotte_tools | 164 | 41 | 2 |
| 3 | charlotte_navigate | 259 | 65 | 663 |
| 4 | charlotte_console | 104 | 26 | 2 |
| 5 | charlotte_tools | 166 | 42 | 1 |
