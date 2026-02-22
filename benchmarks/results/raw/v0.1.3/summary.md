# Charlotte Benchmark Results — v0.1.3

Charlotte v0.1.3 vs Playwright MCP (latest)
Generated: 2026-02-22T14:21:21.069Z

## Summary

| Test | Charlotte (chars) | Playwright MCP (chars) |
| :--- | ---: | ---: |
| Simple Page (example.com) | 2,469 | 1,315 |
| Content-Heavy (Wikipedia AI) | 5,332,154 | 2,081,624 |
| Multi-Page Nav (Hacker News) | 223,812 | 122,349 |
| Deep Navigation (GitHub Repo) | 268,159 | 160,487 |

## Simple Page (example.com)

### Charlotte

- **Success:** Yes
- **Total chars:** 2,469
- **Estimated tokens:** 618
- **Wall time:** 1628ms
- **Tool calls:** 2
- **Notes:** Title found: true, Heading found: true

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte:navigate | 1,254 | 314 | 1625 |
| 2 | charlotte:observe | 1,215 | 304 | 3 |

### Playwright MCP

- **Success:** Yes
- **Total chars:** 1,315
- **Estimated tokens:** 330
- **Wall time:** 417ms
- **Tool calls:** 2
- **Notes:** Title found: true

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | browser_navigate | 817 | 205 | 412 |
| 2 | browser_snapshot | 498 | 125 | 5 |

## Content-Heavy (Wikipedia AI)

### Charlotte

- **Success:** Yes
- **Total chars:** 5,332,154
- **Estimated tokens:** 1,333,041
- **Wall time:** 6855ms
- **Tool calls:** 4
- **Notes:** Minimal: 1276739 chars; Summary: 1277389 chars; Full: 1500637 chars; Title found: true

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte:navigate | 1,277,389 | 319,348 | 3897 |
| 2 | charlotte:observe | 1,276,739 | 319,185 | 1027 |
| 3 | charlotte:observe | 1,277,389 | 319,348 | 963 |
| 4 | charlotte:observe | 1,500,637 | 375,160 | 969 |

### Playwright MCP

- **Success:** Yes
- **Total chars:** 2,081,624
- **Estimated tokens:** 520,406
- **Wall time:** 2169ms
- **Tool calls:** 2
- **Notes:** Snapshot: 1040988 chars; Title found: true

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | browser_navigate | 1,040,636 | 260,159 | 1563 |
| 2 | browser_snapshot | 1,040,988 | 260,247 | 606 |

## Multi-Page Nav (Hacker News)

### Charlotte

- **Success:** Yes
- **Total chars:** 223,812
- **Estimated tokens:** 55,955
- **Wall time:** 2132ms
- **Tool calls:** 3
- **Notes:** Summary: 77329 chars; Find: 69154 chars

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte:navigate | 77,329 | 19,333 | 1997 |
| 2 | charlotte:observe | 77,329 | 19,333 | 74 |
| 3 | charlotte:find | 69,154 | 17,289 | 60 |

### Playwright MCP

- **Success:** Yes
- **Total chars:** 122,349
- **Estimated tokens:** 30,588
- **Wall time:** 660ms
- **Tool calls:** 2
- **Notes:** Snapshot: 61131 chars

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | browser_navigate | 61,218 | 15,305 | 605 |
| 2 | browser_snapshot | 61,131 | 15,283 | 56 |

## Deep Navigation (GitHub Repo)

### Charlotte

- **Success:** Yes
- **Total chars:** 268,159
- **Estimated tokens:** 67,042
- **Wall time:** 8213ms
- **Tool calls:** 3
- **Notes:** Summary: 89481 chars; Minimal: 89197 chars

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte:navigate | 89,481 | 22,371 | 8041 |
| 2 | charlotte:observe | 89,481 | 22,371 | 91 |
| 3 | charlotte:observe | 89,197 | 22,300 | 80 |

### Playwright MCP

- **Success:** Yes
- **Total chars:** 160,487
- **Estimated tokens:** 40,123
- **Wall time:** 2051ms
- **Tool calls:** 2
- **Notes:** Snapshot: 80190 chars

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | browser_navigate | 80,297 | 20,075 | 1980 |
| 2 | browser_snapshot | 80,190 | 20,048 | 71 |

## Headline Numbers

- **Simple Page (example.com):** Charlotte uses **0.5x fewer** characters than Playwright MCP (2,469 vs 1,315)
- **Content-Heavy (Wikipedia AI):** Charlotte uses **0.4x fewer** characters than Playwright MCP (5,332,154 vs 2,081,624)
- **Multi-Page Nav (Hacker News):** Charlotte uses **0.5x fewer** characters than Playwright MCP (223,812 vs 122,349)
- **Deep Navigation (GitHub Repo):** Charlotte uses **0.6x fewer** characters than Playwright MCP (268,159 vs 160,487)
