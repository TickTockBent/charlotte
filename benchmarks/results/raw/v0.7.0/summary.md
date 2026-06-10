# Charlotte Benchmark Results

Generated: 2026-06-09T23:14:43.038Z

## Summary

| Test | Charlotte (chars) | Playwright MCP (chars) |
| :--- | ---: | ---: |
| Simple Page (example.com) | 776 | 733 |
| Content-Heavy (Wikipedia AI) | 797,221 | 1,049,584 |
| Interactive Form (httpbin) | 4,860 (FAIL) | 4,234 (FAIL) |
| Multi-Page Nav (Hacker News) | 61,319 | 60,279 |
| Deep Navigation (GitHub Repo) | 45,531 | 82,280 |

## Tool Definition Overhead

| Profile | Tools | Definition Chars | Est. Def. Tokens |
| :--- | ---: | ---: | ---: |
| Charlotte | 23 | 16,747 | 4,785 |
| Playwright MCP | 23 | 17,084 | 4,882 |

### Headline Savings

- **Playwright MCP** saves **-2%** tool definition overhead vs Charlotte (4,882 vs 4,785 tokens per call)

## Cumulative Token Cost by Test

### Simple Page (example.com)

| Profile | Calls | Response Tokens | Def. Tokens (cum.) | Total Tokens | Savings vs Full |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Charlotte | 2 | 194 | 9,570 | 9,764 | — |
| Playwright MCP | 2 | 184 | 9,764 | 9,948 | -1.9% |

### Content-Heavy (Wikipedia AI)

| Profile | Calls | Response Tokens | Def. Tokens (cum.) | Total Tokens | Savings vs Full |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Charlotte | 4 | 199,306 | 19,140 | 218,446 | — |
| Playwright MCP | 2 | 262,396 | 9,764 | 272,160 | -24.6% |

### Interactive Form (httpbin)

| Profile | Calls | Response Tokens | Def. Tokens (cum.) | Total Tokens | Savings vs Full |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Charlotte | 5 | 1,216 | 23,925 | 25,141 | — |
| Playwright MCP | 3 | 1,060 | 14,646 | 15,706 | 37.5% |

### Multi-Page Nav (Hacker News)

| Profile | Calls | Response Tokens | Def. Tokens (cum.) | Total Tokens | Savings vs Full |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Charlotte | 3 | 15,331 | 14,355 | 29,686 | — |
| Playwright MCP | 2 | 15,070 | 9,764 | 24,834 | 16.3% |

### Deep Navigation (GitHub Repo)

| Profile | Calls | Response Tokens | Def. Tokens (cum.) | Total Tokens | Savings vs Full |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Charlotte | 3 | 11,384 | 14,355 | 25,739 | — |
| Playwright MCP | 2 | 20,571 | 9,764 | 30,335 | -17.9% |

## Simple Page (example.com)

### Charlotte

- **Success:** Yes
- **Total chars:** 776
- **Estimated tokens:** 194
- **Wall time:** 1554ms
- **Tool calls:** 2
- **Notes:** Title found: true, Heading found: true

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 388 | 97 | 1541 |
| 2 | charlotte_observe | 388 | 97 | 13 |

### Playwright MCP

- **Success:** Yes
- **Total chars:** 733
- **Estimated tokens:** 184
- **Wall time:** 512ms
- **Tool calls:** 2
- **Notes:** Title found: true

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | browser_navigate | 268 | 67 | 502 |
| 2 | browser_snapshot | 465 | 117 | 10 |

## Content-Heavy (Wikipedia AI)

### Charlotte

- **Success:** Yes
- **Total chars:** 797,221
- **Estimated tokens:** 199,306
- **Wall time:** 7004ms
- **Tool calls:** 4
- **Notes:** Minimal: 8571 chars; Summary: 279744 chars; Full: 500335 chars; Title found: true

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 8,571 | 2,143 | 4023 |
| 2 | charlotte_observe | 8,571 | 2,143 | 1027 |
| 3 | charlotte_observe | 279,744 | 69,936 | 977 |
| 4 | charlotte_observe | 500,335 | 125,084 | 977 |

### Playwright MCP

- **Success:** Yes
- **Total chars:** 1,049,584
- **Estimated tokens:** 262,396
- **Wall time:** 2327ms
- **Tool calls:** 2
- **Notes:** Snapshot: 1049228 chars; Title found: true

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | browser_navigate | 356 | 89 | 1706 |
| 2 | browser_snapshot | 1,049,228 | 262,307 | 620 |

## Interactive Form (httpbin)

### Charlotte

- **Success:** No
- **Total chars:** 4,860
- **Estimated tokens:** 1,216
- **Wall time:** 2334ms
- **Tool calls:** 5
- **Notes:** Found 4 inputs, 0 forms. Filled: false, Submitted: false

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 592 | 148 | 2293 |
| 2 | charlotte_observe | 2,752 | 688 | 10 |
| 3 | charlotte_find | 673 | 169 | 11 |
| 4 | charlotte_type | 251 | 63 | 12 |
| 5 | charlotte_observe | 592 | 148 | 9 |

### Playwright MCP

- **Success:** No
- **Total chars:** 4,234
- **Estimated tokens:** 1,060
- **Wall time:** 492ms
- **Tool calls:** 3
- **Notes:** Found 0 refs. Filled: false

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | browser_navigate | 384 | 96 | 478 |
| 2 | browser_snapshot | 1,925 | 482 | 7 |
| 3 | browser_snapshot | 1,925 | 482 | 6 |

## Multi-Page Nav (Hacker News)

### Charlotte

- **Success:** Yes
- **Total chars:** 61,319
- **Estimated tokens:** 15,331
- **Wall time:** 2399ms
- **Tool calls:** 3
- **Notes:** Summary: 30702 chars; Find: 30280 chars

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 337 | 85 | 2297 |
| 2 | charlotte_observe | 30,702 | 7,676 | 53 |
| 3 | charlotte_find | 30,280 | 7,570 | 48 |

### Playwright MCP

- **Success:** Yes
- **Total chars:** 60,279
- **Estimated tokens:** 15,070
- **Wall time:** 805ms
- **Tool calls:** 2
- **Notes:** Snapshot: 59996 chars

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | browser_navigate | 283 | 71 | 761 |
| 2 | browser_snapshot | 59,996 | 14,999 | 45 |

## Deep Navigation (GitHub Repo)

### Charlotte

- **Success:** Yes
- **Total chars:** 45,531
- **Estimated tokens:** 11,384
- **Wall time:** 11149ms
- **Tool calls:** 3
- **Notes:** Summary: 38410 chars; Minimal: 3562 chars

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 3,559 | 890 | 10986 |
| 2 | charlotte_observe | 38,410 | 9,603 | 93 |
| 3 | charlotte_observe | 3,562 | 891 | 70 |

### Playwright MCP

- **Success:** Yes
- **Total chars:** 82,280
- **Estimated tokens:** 20,571
- **Wall time:** 1670ms
- **Tool calls:** 2
- **Notes:** Snapshot: 81835 chars

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | browser_navigate | 445 | 112 | 1507 |
| 2 | browser_snapshot | 81,835 | 20,459 | 163 |

## Headline Numbers

- **Simple Page (example.com):** Charlotte uses **0.9x fewer** characters than Playwright MCP (776 vs 733)
- **Content-Heavy (Wikipedia AI):** Charlotte uses **1.3x fewer** characters than Playwright MCP (797,221 vs 1,049,584)
- **Interactive Form (httpbin):** Charlotte uses **0.9x fewer** characters than Playwright MCP (4,860 vs 4,234)
- **Multi-Page Nav (Hacker News):** Charlotte uses **1.0x fewer** characters than Playwright MCP (61,319 vs 60,279)
- **Deep Navigation (GitHub Repo):** Charlotte uses **1.8x fewer** characters than Playwright MCP (45,531 vs 82,280)
