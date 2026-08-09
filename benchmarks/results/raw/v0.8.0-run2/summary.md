# Charlotte Benchmark Results

Generated: 2026-08-08T21:57:12.228Z

## Summary

| Test | Charlotte (chars) | Chrome DevTools MCP (chars) | Playwright MCP (chars) |
| :--- | ---: | ---: | ---: |
| Simple Page (example.com) | 830 | 570 | 733 |
| Content-Heavy (Wikipedia AI) | 859,297 | 1,319,923 | 1,138,284 |
| Interactive Form (httpbin) | 7,849 | 3,274 (FAIL) | 4,078 (FAIL) |
| Multi-Page Nav (Hacker News) | 62,919 | 42,487 | 50,959 |
| Deep Navigation (GitHub Repo) | 30,908 | 76,497 | 39,553 |

## Tool Definition Overhead

| Profile | Tools | Definition Chars | Est. Def. Tokens |
| :--- | ---: | ---: | ---: |
| Charlotte | 23 | 15,299 | 4,372 |
| Playwright MCP | 24 | 18,502 | 5,287 |
| Chrome DevTools MCP | 29 | 22,608 | 6,460 |

### Headline Savings

- **Playwright MCP** saves **-21%** tool definition overhead vs Charlotte (5,287 vs 4,372 tokens per call)
- **Chrome DevTools MCP** saves **-48%** tool definition overhead vs Charlotte (6,460 vs 4,372 tokens per call)

## Cumulative Token Cost by Test

### Simple Page (example.com)

| Profile | Calls | Response Tokens | Def. Tokens (cum.) | Total Tokens | Savings vs Full |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Charlotte | 2 | 208 | 8,744 | 8,952 | — |
| Playwright MCP | 2 | 184 | 10,574 | 10,758 | -20.2% |
| Chrome DevTools MCP | 2 | 143 | 12,920 | 13,063 | -45.9% |

### Content-Heavy (Wikipedia AI)

| Profile | Calls | Response Tokens | Def. Tokens (cum.) | Total Tokens | Savings vs Full |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Charlotte | 4 | 214,826 | 17,488 | 232,314 | — |
| Playwright MCP | 2 | 284,571 | 10,574 | 295,145 | -27.0% |
| Chrome DevTools MCP | 2 | 329,981 | 12,920 | 342,901 | -47.6% |

### Interactive Form (httpbin)

| Profile | Calls | Response Tokens | Def. Tokens (cum.) | Total Tokens | Savings vs Full |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Charlotte | 5 | 1,964 | 21,860 | 23,824 | — |
| Playwright MCP | 3 | 1,020 | 15,861 | 16,881 | 29.1% |
| Chrome DevTools MCP | 4 | 820 | 25,840 | 26,660 | -11.9% |

### Multi-Page Nav (Hacker News)

| Profile | Calls | Response Tokens | Def. Tokens (cum.) | Total Tokens | Savings vs Full |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Charlotte | 3 | 15,731 | 13,116 | 28,847 | — |
| Playwright MCP | 2 | 12,740 | 10,574 | 23,314 | 19.2% |
| Chrome DevTools MCP | 2 | 10,622 | 12,920 | 23,542 | 18.4% |

### Deep Navigation (GitHub Repo)

| Profile | Calls | Response Tokens | Def. Tokens (cum.) | Total Tokens | Savings vs Full |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Charlotte | 3 | 7,728 | 13,116 | 20,844 | — |
| Playwright MCP | 2 | 9,889 | 10,574 | 20,463 | 1.8% |
| Chrome DevTools MCP | 2 | 19,125 | 12,920 | 32,045 | -53.7% |

## Simple Page (example.com)

### Charlotte

- **Success:** Yes
- **Total chars:** 830
- **Estimated tokens:** 208
- **Wall time:** 2241ms
- **Tool calls:** 2
- **Notes:** Title found: true, Heading found: true

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 415 | 104 | 2228 |
| 2 | charlotte_observe | 415 | 104 | 14 |

### Playwright MCP

- **Success:** Yes
- **Total chars:** 733
- **Estimated tokens:** 184
- **Wall time:** 347ms
- **Tool calls:** 2
- **Notes:** Title found: true

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | browser_navigate | 268 | 67 | 342 |
| 2 | browser_snapshot | 465 | 117 | 5 |

### Chrome DevTools MCP

- **Success:** Yes
- **Total chars:** 570
- **Estimated tokens:** 143
- **Wall time:** 504ms
- **Tool calls:** 2
- **Notes:** Title found: true

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | navigate_page | 148 | 37 | 496 |
| 2 | take_snapshot | 422 | 106 | 8 |

## Content-Heavy (Wikipedia AI)

### Charlotte

- **Success:** Yes
- **Total chars:** 859,297
- **Estimated tokens:** 214,826
- **Wall time:** 7570ms
- **Tool calls:** 4
- **Notes:** Minimal: 22134 chars; Summary: 294142 chars; Full: 520887 chars; Title found: true

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 22,134 | 5,534 | 4180 |
| 2 | charlotte_observe | 22,134 | 5,534 | 1146 |
| 3 | charlotte_observe | 294,142 | 73,536 | 1107 |
| 4 | charlotte_observe | 520,887 | 130,222 | 1137 |

### Playwright MCP

- **Success:** Yes
- **Total chars:** 1,138,284
- **Estimated tokens:** 284,571
- **Wall time:** 2275ms
- **Tool calls:** 2
- **Notes:** Snapshot: 1137928 chars; Title found: true

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | browser_navigate | 356 | 89 | 1745 |
| 2 | browser_snapshot | 1,137,928 | 284,482 | 529 |

### Chrome DevTools MCP

- **Success:** Yes
- **Total chars:** 1,319,923
- **Estimated tokens:** 329,981
- **Wall time:** 2478ms
- **Tool calls:** 2
- **Notes:** Snapshot: 1319687 chars; Title found: true

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | navigate_page | 236 | 59 | 1141 |
| 2 | take_snapshot | 1,319,687 | 329,922 | 1337 |

## Interactive Form (httpbin)

### Charlotte

- **Success:** Yes
- **Total chars:** 7,849
- **Estimated tokens:** 1,964
- **Wall time:** 2762ms
- **Tool calls:** 5
- **Notes:** Found 4 inputs, 0 forms. Filled: true, Submitted: false

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 619 | 155 | 2143 |
| 2 | charlotte_observe | 2,779 | 695 | 9 |
| 3 | charlotte_find | 715 | 179 | 7 |
| 4 | charlotte_type | 3,117 | 780 | 580 |
| 5 | charlotte_observe | 619 | 155 | 23 |

### Playwright MCP

- **Success:** No
- **Total chars:** 4,078
- **Estimated tokens:** 1,020
- **Wall time:** 680ms
- **Tool calls:** 3
- **Notes:** Found 0 refs. Filled: false

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | browser_navigate | 384 | 96 | 633 |
| 2 | browser_snapshot | 1,847 | 462 | 23 |
| 3 | browser_snapshot | 1,847 | 462 | 24 |

### Chrome DevTools MCP

- **Success:** No
- **Total chars:** 3,274
- **Estimated tokens:** 820
- **Wall time:** 627ms
- **Tool calls:** 4
- **Notes:** Fill succeeded: false

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | navigate_page | 152 | 38 | 606 |
| 2 | take_snapshot | 1,405 | 352 | 13 |
| 3 | fill | 312 | 78 | 1 |
| 4 | take_snapshot | 1,405 | 352 | 6 |

## Multi-Page Nav (Hacker News)

### Charlotte

- **Success:** Yes
- **Total chars:** 62,919
- **Estimated tokens:** 15,731
- **Wall time:** 2558ms
- **Tool calls:** 3
- **Notes:** Summary: 31481 chars; Find: 31074 chars

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 364 | 91 | 2437 |
| 2 | charlotte_observe | 31,481 | 7,871 | 55 |
| 3 | charlotte_find | 31,074 | 7,769 | 66 |

### Playwright MCP

- **Success:** Yes
- **Total chars:** 50,959
- **Estimated tokens:** 12,740
- **Wall time:** 666ms
- **Tool calls:** 2
- **Notes:** Snapshot: 50676 chars

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | browser_navigate | 283 | 71 | 630 |
| 2 | browser_snapshot | 50,676 | 12,669 | 36 |

### Chrome DevTools MCP

- **Success:** Yes
- **Total chars:** 42,487
- **Estimated tokens:** 10,622
- **Wall time:** 860ms
- **Tool calls:** 2
- **Notes:** Snapshot: 42324 chars

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | navigate_page | 163 | 41 | 780 |
| 2 | take_snapshot | 42,324 | 10,581 | 80 |

## Deep Navigation (GitHub Repo)

### Charlotte

- **Success:** Yes
- **Total chars:** 30,908
- **Estimated tokens:** 7,728
- **Wall time:** 4188ms
- **Tool calls:** 3
- **Notes:** Summary: 23447 chars; Minimal: 3683 chars

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 3,778 | 945 | 3506 |
| 2 | charlotte_observe | 23,447 | 5,862 | 605 |
| 3 | charlotte_observe | 3,683 | 921 | 77 |

### Playwright MCP

- **Success:** Yes
- **Total chars:** 39,553
- **Estimated tokens:** 9,889
- **Wall time:** 1289ms
- **Tool calls:** 2
- **Notes:** Snapshot: 38983 chars

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | browser_navigate | 570 | 143 | 1222 |
| 2 | browser_snapshot | 38,983 | 9,746 | 67 |

### Chrome DevTools MCP

- **Success:** Yes
- **Total chars:** 76,497
- **Estimated tokens:** 19,125
- **Wall time:** 2198ms
- **Tool calls:** 2
- **Notes:** Snapshot: 76258 chars

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | navigate_page | 239 | 60 | 2012 |
| 2 | take_snapshot | 76,258 | 19,065 | 187 |

## Headline Numbers

- **Simple Page (example.com):** Charlotte uses **0.9x fewer** characters than Playwright MCP (830 vs 733)
- **Content-Heavy (Wikipedia AI):** Charlotte uses **1.3x fewer** characters than Playwright MCP (859,297 vs 1,138,284)
- **Interactive Form (httpbin):** Charlotte uses **0.5x fewer** characters than Playwright MCP (7,849 vs 4,078)
- **Multi-Page Nav (Hacker News):** Charlotte uses **0.8x fewer** characters than Playwright MCP (62,919 vs 50,959)
- **Deep Navigation (GitHub Repo):** Charlotte uses **1.3x fewer** characters than Playwright MCP (30,908 vs 39,553)
