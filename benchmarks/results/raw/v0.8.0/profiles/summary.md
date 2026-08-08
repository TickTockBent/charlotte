# Charlotte Benchmark Results

Generated: 2026-08-08T21:53:28.829Z

## Summary

| Test | Charlotte (browse) (chars) | Charlotte (core) (chars) | Charlotte (full) (chars) |
| :--- | ---: | ---: | ---: |
| Tool Definitions (overhead) | 286 | 286 | 286 |
| Browse Session (5 sites) | 209,518 | 209,518 | 198,023 |
| Interactive Session (form) | 19,990 | 19,990 | 19,990 |
| Runtime Toggle (meta-tool) | 3,128 | N/A | N/A |

## Tool Definition Overhead

| Profile | Tools | Definition Chars | Est. Def. Tokens |
| :--- | ---: | ---: | ---: |
| Charlotte (full) | 43 | 29,750 | 8,500 |
| Charlotte (browse) | 23 | 15,299 | 4,372 |
| Charlotte (core) | 7 | 7,648 | 2,186 |

### Headline Savings

- **Charlotte (browse)** saves **49%** tool definition overhead vs Charlotte (full) (4,372 vs 8,500 tokens per call)
- **Charlotte (core)** saves **74%** tool definition overhead vs Charlotte (full) (2,186 vs 8,500 tokens per call)

## Cumulative Token Cost by Test

### Tool Definitions (overhead)

| Profile | Calls | Response Tokens | Def. Tokens (cum.) | Total Tokens | Savings vs Full |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Charlotte (full) | 1 | 72 | 8,500 | 8,572 | — |
| Charlotte (browse) | 1 | 72 | 4,372 | 4,444 | 48.2% |
| Charlotte (core) | 1 | 72 | 2,186 | 2,258 | 73.7% |

### Browse Session (5 sites)

| Profile | Calls | Response Tokens | Def. Tokens (cum.) | Total Tokens | Savings vs Full |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Charlotte (full) | 20 | 49,513 | 170,000 | 219,513 | — |
| Charlotte (browse) | 20 | 52,386 | 87,440 | 139,826 | 36.3% |
| Charlotte (core) | 20 | 52,386 | 43,720 | 96,106 | 56.2% |

### Interactive Session (form)

| Profile | Calls | Response Tokens | Def. Tokens (cum.) | Total Tokens | Savings vs Full |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Charlotte (full) | 12 | 5,000 | 102,000 | 107,000 | — |
| Charlotte (browse) | 12 | 5,000 | 52,464 | 57,464 | 46.3% |
| Charlotte (core) | 12 | 5,000 | 26,232 | 31,232 | 70.8% |

## Tool Definitions (overhead)

### Charlotte (full)

- **Success:** Yes
- **Total chars:** 286
- **Estimated tokens:** 72
- **Wall time:** 347ms
- **Tool calls:** 1
- **Notes:** Tools: 43 (expected 43, match). Definition chars: 29,750. Est. definition tokens: 8,500

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 286 | 72 | 347 |

### Charlotte (browse)

- **Success:** Yes
- **Total chars:** 286
- **Estimated tokens:** 72
- **Wall time:** 433ms
- **Tool calls:** 1
- **Notes:** Tools: 23 (expected 23, match). Definition chars: 15,299. Est. definition tokens: 4,372

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 286 | 72 | 433 |

### Charlotte (core)

- **Success:** Yes
- **Total chars:** 286
- **Estimated tokens:** 72
- **Wall time:** 373ms
- **Tool calls:** 1
- **Notes:** Tools: 7 (expected 7, match). Definition chars: 7,648. Est. definition tokens: 2,186

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 286 | 72 | 373 |

## Browse Session (5 sites)

### Charlotte (full)

- **Success:** Yes
- **Total chars:** 198,023
- **Estimated tokens:** 49,513
- **Wall time:** 6026ms
- **Tool calls:** 20
- **Notes:** 5/5 sites returned meaningful content

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 415 | 104 | 2415 |
| 2 | charlotte_observe | 415 | 104 | 14 |
| 3 | charlotte_observe | 543 | 136 | 10 |
| 4 | charlotte_find | 213 | 54 | 8 |
| 5 | charlotte_navigate | 364 | 91 | 530 |
| 6 | charlotte_observe | 364 | 91 | 53 |
| 7 | charlotte_observe | 31,489 | 7,873 | 65 |
| 8 | charlotte_find | 31,082 | 7,771 | 48 |
| 9 | charlotte_navigate | 4,467 | 1,117 | 618 |
| 10 | charlotte_observe | 4,501 | 1,126 | 86 |
| 11 | charlotte_observe | 39,285 | 9,822 | 69 |
| 12 | charlotte_find | 32,554 | 8,139 | 69 |
| 13 | charlotte_navigate | 393 | 99 | 71 |
| 14 | charlotte_observe | 393 | 99 | 5 |
| 15 | charlotte_observe | 2,780 | 695 | 6 |
| 16 | charlotte_find | 83 | 21 | 5 |
| 17 | charlotte_navigate | 3,779 | 945 | 1522 |
| 18 | charlotte_observe | 3,779 | 945 | 163 |
| 19 | charlotte_observe | 23,448 | 5,862 | 138 |
| 20 | charlotte_find | 17,676 | 4,419 | 131 |

### Charlotte (browse)

- **Success:** Yes
- **Total chars:** 209,518
- **Estimated tokens:** 52,386
- **Wall time:** 5401ms
- **Tool calls:** 20
- **Notes:** 5/5 sites returned meaningful content

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 415 | 104 | 2267 |
| 2 | charlotte_observe | 415 | 104 | 11 |
| 3 | charlotte_observe | 543 | 136 | 9 |
| 4 | charlotte_find | 213 | 54 | 8 |
| 5 | charlotte_navigate | 364 | 91 | 484 |
| 6 | charlotte_observe | 364 | 91 | 52 |
| 7 | charlotte_observe | 31,489 | 7,873 | 65 |
| 8 | charlotte_find | 31,082 | 7,771 | 46 |
| 9 | charlotte_navigate | 4,467 | 1,117 | 700 |
| 10 | charlotte_observe | 4,501 | 1,126 | 76 |
| 11 | charlotte_observe | 39,285 | 9,822 | 66 |
| 12 | charlotte_find | 32,554 | 8,139 | 70 |
| 13 | charlotte_navigate | 393 | 99 | 75 |
| 14 | charlotte_observe | 620 | 155 | 7 |
| 15 | charlotte_observe | 2,780 | 695 | 5 |
| 16 | charlotte_find | 83 | 21 | 5 |
| 17 | charlotte_navigate | 3,779 | 945 | 1007 |
| 18 | charlotte_observe | 3,779 | 945 | 173 |
| 19 | charlotte_observe | 23,448 | 5,862 | 193 |
| 20 | charlotte_find | 28,944 | 7,236 | 82 |

### Charlotte (core)

- **Success:** Yes
- **Total chars:** 209,518
- **Estimated tokens:** 52,386
- **Wall time:** 5182ms
- **Tool calls:** 20
- **Notes:** 5/5 sites returned meaningful content

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 415 | 104 | 2148 |
| 2 | charlotte_observe | 415 | 104 | 11 |
| 3 | charlotte_observe | 543 | 136 | 7 |
| 4 | charlotte_find | 213 | 54 | 6 |
| 5 | charlotte_navigate | 364 | 91 | 511 |
| 6 | charlotte_observe | 364 | 91 | 53 |
| 7 | charlotte_observe | 31,489 | 7,873 | 66 |
| 8 | charlotte_find | 31,082 | 7,771 | 46 |
| 9 | charlotte_navigate | 4,467 | 1,117 | 641 |
| 10 | charlotte_observe | 4,501 | 1,126 | 74 |
| 11 | charlotte_observe | 39,285 | 9,822 | 66 |
| 12 | charlotte_find | 32,554 | 8,139 | 81 |
| 13 | charlotte_navigate | 393 | 99 | 78 |
| 14 | charlotte_observe | 620 | 155 | 6 |
| 15 | charlotte_observe | 2,780 | 695 | 6 |
| 16 | charlotte_find | 83 | 21 | 5 |
| 17 | charlotte_navigate | 3,779 | 945 | 929 |
| 18 | charlotte_observe | 3,779 | 945 | 168 |
| 19 | charlotte_observe | 23,448 | 5,862 | 180 |
| 20 | charlotte_find | 28,944 | 7,236 | 100 |

## Interactive Session (form)

### Charlotte (full)

- **Success:** Yes
- **Total chars:** 19,990
- **Estimated tokens:** 5,000
- **Wall time:** 4884ms
- **Tool calls:** 12
- **Notes:** Found 4 inputs, filled 4, submitted: false

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 619 | 155 | 2452 |
| 2 | charlotte_observe | 2,779 | 695 | 15 |
| 3 | charlotte_find | 715 | 179 | 9 |
| 4 | charlotte_type | 3,107 | 777 | 580 |
| 5 | charlotte_observe | 619 | 155 | 23 |
| 6 | charlotte_type | 3,211 | 803 | 577 |
| 7 | charlotte_observe | 619 | 155 | 24 |
| 8 | charlotte_type | 3,234 | 809 | 571 |
| 9 | charlotte_observe | 619 | 155 | 10 |
| 10 | charlotte_type | 3,228 | 807 | 575 |
| 11 | charlotte_observe | 620 | 155 | 24 |
| 12 | charlotte_observe | 620 | 155 | 23 |

### Charlotte (browse)

- **Success:** Yes
- **Total chars:** 19,990
- **Estimated tokens:** 5,000
- **Wall time:** 4514ms
- **Tool calls:** 12
- **Notes:** Found 4 inputs, filled 4, submitted: false

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 619 | 155 | 2089 |
| 2 | charlotte_observe | 2,779 | 695 | 12 |
| 3 | charlotte_find | 715 | 179 | 10 |
| 4 | charlotte_type | 3,107 | 777 | 579 |
| 5 | charlotte_observe | 619 | 155 | 23 |
| 6 | charlotte_type | 3,211 | 803 | 574 |
| 7 | charlotte_observe | 619 | 155 | 12 |
| 8 | charlotte_type | 3,234 | 809 | 579 |
| 9 | charlotte_observe | 619 | 155 | 20 |
| 10 | charlotte_type | 3,228 | 807 | 574 |
| 11 | charlotte_observe | 620 | 155 | 24 |
| 12 | charlotte_observe | 620 | 155 | 18 |

### Charlotte (core)

- **Success:** Yes
- **Total chars:** 19,990
- **Estimated tokens:** 5,000
- **Wall time:** 4974ms
- **Tool calls:** 12
- **Notes:** Found 4 inputs, filled 4, submitted: false

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 619 | 155 | 2575 |
| 2 | charlotte_observe | 2,779 | 695 | 14 |
| 3 | charlotte_find | 715 | 179 | 10 |
| 4 | charlotte_type | 3,107 | 777 | 574 |
| 5 | charlotte_observe | 619 | 155 | 10 |
| 6 | charlotte_type | 3,211 | 803 | 578 |
| 7 | charlotte_observe | 619 | 155 | 21 |
| 8 | charlotte_type | 3,234 | 809 | 574 |
| 9 | charlotte_observe | 619 | 155 | 23 |
| 10 | charlotte_type | 3,228 | 807 | 576 |
| 11 | charlotte_observe | 620 | 155 | 10 |
| 12 | charlotte_observe | 620 | 155 | 8 |

## Runtime Toggle (meta-tool)

### Charlotte (browse)

- **Success:** Yes
- **Total chars:** 3,128
- **Estimated tokens:** 784
- **Wall time:** 307ms
- **Tool calls:** 5
- **Notes:** Initial: 23 tools. After enable: 25 tools (grew: true). Console tool worked: true. After disable: 23 tools (restored: true). Initial def chars: 15,299. Expanded def chars: 17,288. Contracted def chars: 15,299

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_tools | 2,327 | 582 | 7 |
| 2 | charlotte_tools | 191 | 48 | 3 |
| 3 | charlotte_navigate | 286 | 72 | 295 |
| 4 | charlotte_console | 131 | 33 | 1 |
| 5 | charlotte_tools | 193 | 49 | 1 |
