# Charlotte Benchmark Results

Generated: 2026-02-22T14:37:54.305Z

## Summary

| Test | Charlotte (chars) |
| :--- | ---: |
| Simple Page (example.com) | 1,450 |
| Content-Heavy (Wikipedia AI) | 3,068,635 |
| Interactive Form (httpbin) | 15,224 |
| Multi-Page Nav (Hacker News) | 127,276 |
| Deep Navigation (GitHub Repo) | 149,922 |

## Simple Page (example.com)

### Charlotte

- **Success:** Yes
- **Total chars:** 1,450
- **Estimated tokens:** 364
- **Wall time:** 1636ms
- **Tool calls:** 2
- **Notes:** Title found: true, Heading found: true

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte:navigate | 725 | 182 | 1633 |
| 2 | charlotte:observe | 725 | 182 | 3 |

## Content-Heavy (Wikipedia AI)

### Charlotte

- **Success:** Yes
- **Total chars:** 3,068,635
- **Estimated tokens:** 767,160
- **Wall time:** 6501ms
- **Tool calls:** 4
- **Notes:** Minimal: 711011 chars; Summary: 711686 chars; Full: 934927 chars; Title found: true

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte:navigate | 711,011 | 177,753 | 3640 |
| 2 | charlotte:observe | 711,011 | 177,753 | 982 |
| 3 | charlotte:observe | 711,686 | 177,922 | 949 |
| 4 | charlotte:observe | 934,927 | 233,732 | 930 |

## Interactive Form (httpbin)

### Charlotte

- **Success:** Yes
- **Total chars:** 15,224
- **Estimated tokens:** 3,808
- **Wall time:** 1725ms
- **Tool calls:** 5
- **Notes:** Found 4 inputs, 0 forms. Filled: true, Submitted: false

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte:navigate | 3,470 | 868 | 1673 |
| 2 | charlotte:observe | 3,535 | 884 | 7 |
| 3 | charlotte:find | 869 | 218 | 6 |
| 4 | charlotte:type | 3,867 | 967 | 33 |
| 5 | charlotte:observe | 3,483 | 871 | 6 |

## Multi-Page Nav (Hacker News)

### Charlotte

- **Success:** Yes
- **Total chars:** 127,276
- **Estimated tokens:** 31,820
- **Wall time:** 2014ms
- **Tool calls:** 3
- **Notes:** Summary: 42605 chars; Find: 42135 chars

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte:navigate | 42,536 | 10,634 | 1876 |
| 2 | charlotte:observe | 42,605 | 10,652 | 77 |
| 3 | charlotte:find | 42,135 | 10,534 | 61 |

## Deep Navigation (GitHub Repo)

### Charlotte

- **Success:** Yes
- **Total chars:** 149,922
- **Estimated tokens:** 37,481
- **Wall time:** 7399ms
- **Tool calls:** 3
- **Notes:** Summary: 50180 chars; Minimal: 49871 chars

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte:navigate | 49,871 | 12,468 | 7242 |
| 2 | charlotte:observe | 50,180 | 12,545 | 83 |
| 3 | charlotte:observe | 49,871 | 12,468 | 74 |

## Headline Numbers

