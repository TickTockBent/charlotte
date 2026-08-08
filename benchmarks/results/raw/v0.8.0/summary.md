# Charlotte Benchmark Results

Generated: 2026-08-08T21:51:25.656Z

## Summary

| Test | Charlotte (chars) | Chrome DevTools MCP (chars) | Playwright MCP (chars) |
| :--- | ---: | ---: | ---: |
| Simple Page (example.com) | 830 | 570 | 733 |
| Content-Heavy (Wikipedia AI) | 859,297 | 1,319,923 | 1,138,284 |
| Interactive Form (httpbin) | 7,849 | 3,274 (FAIL) | 4,078 (FAIL) |
| Multi-Page Nav (Hacker News) | 62,935 | 42,524 | 50,989 |
| Deep Navigation (GitHub Repo) | 31,004 | 76,497 | 39,553 |

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
| Charlotte | 3 | 15,735 | 13,116 | 28,851 | — |
| Playwright MCP | 2 | 12,748 | 10,574 | 23,322 | 19.2% |
| Chrome DevTools MCP | 2 | 10,632 | 12,920 | 23,552 | 18.4% |

### Deep Navigation (GitHub Repo)

| Profile | Calls | Response Tokens | Def. Tokens (cum.) | Total Tokens | Savings vs Full |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Charlotte | 3 | 7,752 | 13,116 | 20,868 | — |
| Playwright MCP | 2 | 9,889 | 10,574 | 20,463 | 1.9% |
| Chrome DevTools MCP | 2 | 19,125 | 12,920 | 32,045 | -53.6% |

## Simple Page (example.com)

### Charlotte

- **Success:** Yes
- **Total chars:** 830
- **Estimated tokens:** 208
- **Wall time:** 2198ms
- **Tool calls:** 2
- **Notes:** Title found: true, Heading found: true

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 415 | 104 | 2184 |
| 2 | charlotte_observe | 415 | 104 | 14 |

### Playwright MCP

- **Success:** Yes
- **Total chars:** 733
- **Estimated tokens:** 184
- **Wall time:** 354ms
- **Tool calls:** 2
- **Notes:** Title found: true

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | browser_navigate | 268 | 67 | 348 |
| 2 | browser_snapshot | 465 | 117 | 5 |

### Chrome DevTools MCP

- **Success:** Yes
- **Total chars:** 570
- **Estimated tokens:** 143
- **Wall time:** 1027ms
- **Tool calls:** 2
- **Notes:** Title found: true

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | navigate_page | 148 | 37 | 1015 |
| 2 | take_snapshot | 422 | 106 | 12 |

## Content-Heavy (Wikipedia AI)

### Charlotte

- **Success:** Yes
- **Total chars:** 859,297
- **Estimated tokens:** 214,826
- **Wall time:** 7599ms
- **Tool calls:** 4
- **Notes:** Minimal: 22134 chars; Summary: 294142 chars; Full: 520887 chars; Title found: true

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 22,134 | 5,534 | 4131 |
| 2 | charlotte_observe | 22,134 | 5,534 | 1179 |
| 3 | charlotte_observe | 294,142 | 73,536 | 1131 |
| 4 | charlotte_observe | 520,887 | 130,222 | 1157 |

### Playwright MCP

- **Success:** Yes
- **Total chars:** 1,138,284
- **Estimated tokens:** 284,571
- **Wall time:** 2263ms
- **Tool calls:** 2
- **Notes:** Snapshot: 1137928 chars; Title found: true

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | browser_navigate | 356 | 89 | 1733 |
| 2 | browser_snapshot | 1,137,928 | 284,482 | 530 |

### Chrome DevTools MCP

- **Success:** Yes
- **Total chars:** 1,319,923
- **Estimated tokens:** 329,981
- **Wall time:** 2538ms
- **Tool calls:** 2
- **Notes:** Snapshot: 1319687 chars; Title found: true

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | navigate_page | 236 | 59 | 1189 |
| 2 | take_snapshot | 1,319,687 | 329,922 | 1349 |

## Interactive Form (httpbin)

### Charlotte

- **Success:** Yes
- **Total chars:** 7,849
- **Estimated tokens:** 1,964
- **Wall time:** 3382ms
- **Tool calls:** 5
- **Notes:** Found 4 inputs, 0 forms. Filled: true, Submitted: false

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 619 | 155 | 2764 |
| 2 | charlotte_observe | 2,779 | 695 | 7 |
| 3 | charlotte_find | 715 | 179 | 6 |
| 4 | charlotte_type | 3,117 | 780 | 579 |
| 5 | charlotte_observe | 619 | 155 | 25 |

### Playwright MCP

- **Success:** No
- **Total chars:** 4,078
- **Estimated tokens:** 1,020
- **Wall time:** 451ms
- **Tool calls:** 3
- **Notes:** Found 0 refs. Filled: false

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | browser_navigate | 384 | 96 | 434 |
| 2 | browser_snapshot | 1,847 | 462 | 7 |
| 3 | browser_snapshot | 1,847 | 462 | 10 |

### Chrome DevTools MCP

- **Success:** No
- **Total chars:** 3,274
- **Estimated tokens:** 820
- **Wall time:** 707ms
- **Tool calls:** 4
- **Notes:** Fill succeeded: false

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | navigate_page | 152 | 38 | 661 |
| 2 | take_snapshot | 1,405 | 352 | 28 |
| 3 | fill | 312 | 78 | 3 |
| 4 | take_snapshot | 1,405 | 352 | 15 |

## Multi-Page Nav (Hacker News)

### Charlotte

- **Success:** Yes
- **Total chars:** 62,935
- **Estimated tokens:** 15,735
- **Wall time:** 9245ms
- **Tool calls:** 3
- **Notes:** Summary: 31489 chars; Find: 31082 chars

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 364 | 91 | 9109 |
| 2 | charlotte_observe | 31,489 | 7,873 | 56 |
| 3 | charlotte_find | 31,082 | 7,771 | 80 |

### Playwright MCP

- **Success:** Yes
- **Total chars:** 50,989
- **Estimated tokens:** 12,748
- **Wall time:** 753ms
- **Tool calls:** 2
- **Notes:** Snapshot: 50706 chars

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | browser_navigate | 283 | 71 | 715 |
| 2 | browser_snapshot | 50,706 | 12,677 | 38 |

### Chrome DevTools MCP

- **Success:** Yes
- **Total chars:** 42,524
- **Estimated tokens:** 10,632
- **Wall time:** 981ms
- **Tool calls:** 2
- **Notes:** Snapshot: 42361 chars

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | navigate_page | 163 | 41 | 794 |
| 2 | take_snapshot | 42,361 | 10,591 | 187 |

## Deep Navigation (GitHub Repo)

### Charlotte

- **Success:** Yes
- **Total chars:** 31,004
- **Estimated tokens:** 7,752
- **Wall time:** 3519ms
- **Tool calls:** 3
- **Notes:** Summary: 23447 chars; Minimal: 3779 chars

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 3,778 | 945 | 3273 |
| 2 | charlotte_observe | 23,447 | 5,862 | 84 |
| 3 | charlotte_observe | 3,779 | 945 | 162 |

### Playwright MCP

- **Success:** Yes
- **Total chars:** 39,553
- **Estimated tokens:** 9,889
- **Wall time:** 1348ms
- **Tool calls:** 2
- **Notes:** Snapshot: 38983 chars

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | browser_navigate | 570 | 143 | 1282 |
| 2 | browser_snapshot | 38,983 | 9,746 | 65 |

### Chrome DevTools MCP

- **Success:** Yes
- **Total chars:** 76,497
- **Estimated tokens:** 19,125
- **Wall time:** 2374ms
- **Tool calls:** 2
- **Notes:** Snapshot: 76258 chars

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | navigate_page | 239 | 60 | 2253 |
| 2 | take_snapshot | 76,258 | 19,065 | 121 |

## Headline Numbers

- **Simple Page (example.com):** Charlotte uses **0.9x fewer** characters than Playwright MCP (830 vs 733)
- **Content-Heavy (Wikipedia AI):** Charlotte uses **1.3x fewer** characters than Playwright MCP (859,297 vs 1,138,284)
- **Interactive Form (httpbin):** Charlotte uses **0.5x fewer** characters than Playwright MCP (7,849 vs 4,078)
- **Multi-Page Nav (Hacker News):** Charlotte uses **0.8x fewer** characters than Playwright MCP (62,935 vs 50,989)
- **Deep Navigation (GitHub Repo):** Charlotte uses **1.3x fewer** characters than Playwright MCP (31,004 vs 39,553)
