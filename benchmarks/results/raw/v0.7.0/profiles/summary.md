# Charlotte Benchmark Results

Generated: 2026-06-09T23:17:10.677Z

## Summary

| Test | Charlotte (browse) (chars) | Charlotte (core) (chars) | Charlotte (full) (chars) |
| :--- | ---: | ---: | ---: |
| Tool Definitions (overhead) | 259 | 259 | 259 |
| Browse Session (5 sites) | 224,486 | 195,117 | 224,486 |
| Interactive Session (form) | 7,981 (FAIL) | 7,981 (FAIL) | 7,981 (FAIL) |
| Runtime Toggle (meta-tool) | 2,993 | N/A | N/A |

## Tool Definition Overhead

| Profile | Tools | Definition Chars | Est. Def. Tokens |
| :--- | ---: | ---: | ---: |
| Charlotte (full) | 43 | 32,539 | 9,297 |
| Charlotte (browse) | 23 | 16,747 | 4,785 |
| Charlotte (core) | 7 | 8,130 | 2,323 |

### Headline Savings

- **Charlotte (browse)** saves **49%** tool definition overhead vs Charlotte (full) (4,785 vs 9,297 tokens per call)
- **Charlotte (core)** saves **75%** tool definition overhead vs Charlotte (full) (2,323 vs 9,297 tokens per call)

## Cumulative Token Cost by Test

### Tool Definitions (overhead)

| Profile | Calls | Response Tokens | Def. Tokens (cum.) | Total Tokens | Savings vs Full |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Charlotte (full) | 1 | 65 | 9,297 | 9,362 | — |
| Charlotte (browse) | 1 | 65 | 4,785 | 4,850 | 48.2% |
| Charlotte (core) | 1 | 65 | 2,323 | 2,388 | 74.5% |

### Browse Session (5 sites)

| Profile | Calls | Response Tokens | Def. Tokens (cum.) | Total Tokens | Savings vs Full |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Charlotte (full) | 20 | 56,130 | 185,940 | 242,070 | — |
| Charlotte (browse) | 20 | 56,130 | 95,700 | 151,830 | 37.3% |
| Charlotte (core) | 20 | 48,788 | 46,460 | 95,248 | 60.7% |

### Interactive Session (form)

| Profile | Calls | Response Tokens | Def. Tokens (cum.) | Total Tokens | Savings vs Full |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Charlotte (full) | 12 | 1,997 | 111,564 | 113,561 | — |
| Charlotte (browse) | 12 | 1,997 | 57,420 | 59,417 | 47.7% |
| Charlotte (core) | 12 | 1,997 | 27,876 | 29,873 | 73.7% |

## Tool Definitions (overhead)

### Charlotte (full)

- **Success:** Yes
- **Total chars:** 259
- **Estimated tokens:** 65
- **Wall time:** 343ms
- **Tool calls:** 1
- **Notes:** Tools: 43 (expected 43, match). Definition chars: 32,539. Est. definition tokens: 9,297

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 259 | 65 | 343 |

### Charlotte (browse)

- **Success:** Yes
- **Total chars:** 259
- **Estimated tokens:** 65
- **Wall time:** 387ms
- **Tool calls:** 1
- **Notes:** Tools: 23 (expected 23, match). Definition chars: 16,747. Est. definition tokens: 4,785

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 259 | 65 | 387 |

### Charlotte (core)

- **Success:** Yes
- **Total chars:** 259
- **Estimated tokens:** 65
- **Wall time:** 384ms
- **Tool calls:** 1
- **Notes:** Tools: 7 (expected 7, match). Definition chars: 8,130. Est. definition tokens: 2,323

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 259 | 65 | 384 |

## Browse Session (5 sites)

### Charlotte (full)

- **Success:** Yes
- **Total chars:** 224,486
- **Estimated tokens:** 56,130
- **Wall time:** 6266ms
- **Tool calls:** 20
- **Notes:** 5/5 sites returned meaningful content

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 388 | 97 | 2070 |
| 2 | charlotte_observe | 388 | 97 | 3 |
| 3 | charlotte_observe | 516 | 129 | 4 |
| 4 | charlotte_find | 171 | 43 | 3 |
| 5 | charlotte_navigate | 337 | 85 | 543 |
| 6 | charlotte_observe | 337 | 85 | 57 |
| 7 | charlotte_observe | 30,702 | 7,676 | 49 |
| 8 | charlotte_find | 30,280 | 7,570 | 50 |
| 9 | charlotte_navigate | 3,155 | 789 | 622 |
| 10 | charlotte_observe | 3,189 | 798 | 68 |
| 11 | charlotte_observe | 39,245 | 9,812 | 66 |
| 12 | charlotte_find | 33,822 | 8,456 | 66 |
| 13 | charlotte_navigate | 366 | 92 | 344 |
| 14 | charlotte_observe | 593 | 149 | 10 |
| 15 | charlotte_observe | 2,753 | 689 | 6 |
| 16 | charlotte_find | 41 | 11 | 6 |
| 17 | charlotte_navigate | 3,563 | 891 | 2033 |
| 18 | charlotte_observe | 3,563 | 891 | 135 |
| 19 | charlotte_observe | 38,411 | 9,603 | 65 |
| 20 | charlotte_find | 32,666 | 8,167 | 66 |

### Charlotte (browse)

- **Success:** Yes
- **Total chars:** 224,486
- **Estimated tokens:** 56,130
- **Wall time:** 5577ms
- **Tool calls:** 20
- **Notes:** 5/5 sites returned meaningful content

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 388 | 97 | 2074 |
| 2 | charlotte_observe | 388 | 97 | 6 |
| 3 | charlotte_observe | 516 | 129 | 6 |
| 4 | charlotte_find | 171 | 43 | 5 |
| 5 | charlotte_navigate | 337 | 85 | 480 |
| 6 | charlotte_observe | 337 | 85 | 54 |
| 7 | charlotte_observe | 30,702 | 7,676 | 50 |
| 8 | charlotte_find | 30,280 | 7,570 | 51 |
| 9 | charlotte_navigate | 3,155 | 789 | 654 |
| 10 | charlotte_observe | 3,189 | 798 | 130 |
| 11 | charlotte_observe | 39,245 | 9,812 | 90 |
| 12 | charlotte_find | 33,822 | 8,456 | 64 |
| 13 | charlotte_navigate | 366 | 92 | 92 |
| 14 | charlotte_observe | 593 | 149 | 12 |
| 15 | charlotte_observe | 2,753 | 689 | 8 |
| 16 | charlotte_find | 41 | 11 | 5 |
| 17 | charlotte_navigate | 3,563 | 891 | 1583 |
| 18 | charlotte_observe | 3,563 | 891 | 85 |
| 19 | charlotte_observe | 38,411 | 9,603 | 71 |
| 20 | charlotte_find | 32,666 | 8,167 | 58 |

### Charlotte (core)

- **Success:** Yes
- **Total chars:** 195,117
- **Estimated tokens:** 48,788
- **Wall time:** 5609ms
- **Tool calls:** 20
- **Notes:** 5/5 sites returned meaningful content

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 388 | 97 | 2189 |
| 2 | charlotte_observe | 388 | 97 | 4 |
| 3 | charlotte_observe | 516 | 129 | 4 |
| 4 | charlotte_find | 171 | 43 | 4 |
| 5 | charlotte_navigate | 337 | 85 | 480 |
| 6 | charlotte_observe | 337 | 85 | 55 |
| 7 | charlotte_observe | 30,702 | 7,676 | 51 |
| 8 | charlotte_find | 30,280 | 7,570 | 50 |
| 9 | charlotte_navigate | 3,154 | 789 | 612 |
| 10 | charlotte_observe | 3,189 | 798 | 66 |
| 11 | charlotte_observe | 39,245 | 9,812 | 69 |
| 12 | charlotte_find | 33,822 | 8,456 | 75 |
| 13 | charlotte_navigate | 366 | 92 | 205 |
| 14 | charlotte_observe | 593 | 149 | 14 |
| 15 | charlotte_observe | 2,753 | 689 | 6 |
| 16 | charlotte_find | 41 | 11 | 5 |
| 17 | charlotte_navigate | 3,560 | 890 | 1523 |
| 18 | charlotte_observe | 3,560 | 890 | 65 |
| 19 | charlotte_observe | 23,578 | 5,895 | 84 |
| 20 | charlotte_find | 18,137 | 4,535 | 48 |

## Interactive Session (form)

### Charlotte (full)

- **Success:** No
- **Total chars:** 7,981
- **Estimated tokens:** 1,997
- **Wall time:** 2413ms
- **Tool calls:** 12
- **Notes:** Found 4 inputs, filled 0, submitted: false

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 592 | 148 | 2328 |
| 2 | charlotte_observe | 2,752 | 688 | 12 |
| 3 | charlotte_find | 673 | 169 | 11 |
| 4 | charlotte_type | 251 | 63 | 9 |
| 5 | charlotte_observe | 592 | 148 | 8 |
| 6 | charlotte_type | 251 | 63 | 7 |
| 7 | charlotte_observe | 592 | 148 | 7 |
| 8 | charlotte_type | 251 | 63 | 6 |
| 9 | charlotte_observe | 592 | 148 | 6 |
| 10 | charlotte_type | 251 | 63 | 6 |
| 11 | charlotte_observe | 592 | 148 | 6 |
| 12 | charlotte_observe | 592 | 148 | 6 |

### Charlotte (browse)

- **Success:** No
- **Total chars:** 7,981
- **Estimated tokens:** 1,997
- **Wall time:** 2235ms
- **Tool calls:** 12
- **Notes:** Found 4 inputs, filled 0, submitted: false

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 592 | 148 | 2164 |
| 2 | charlotte_observe | 2,752 | 688 | 8 |
| 3 | charlotte_find | 673 | 169 | 9 |
| 4 | charlotte_type | 251 | 63 | 8 |
| 5 | charlotte_observe | 592 | 148 | 7 |
| 6 | charlotte_type | 251 | 63 | 6 |
| 7 | charlotte_observe | 592 | 148 | 6 |
| 8 | charlotte_type | 251 | 63 | 5 |
| 9 | charlotte_observe | 592 | 148 | 6 |
| 10 | charlotte_type | 251 | 63 | 5 |
| 11 | charlotte_observe | 592 | 148 | 5 |
| 12 | charlotte_observe | 592 | 148 | 6 |

### Charlotte (core)

- **Success:** No
- **Total chars:** 7,981
- **Estimated tokens:** 1,997
- **Wall time:** 2430ms
- **Tool calls:** 12
- **Notes:** Found 4 inputs, filled 0, submitted: false

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 592 | 148 | 2306 |
| 2 | charlotte_observe | 2,752 | 688 | 25 |
| 3 | charlotte_find | 673 | 169 | 12 |
| 4 | charlotte_type | 251 | 63 | 15 |
| 5 | charlotte_observe | 592 | 148 | 8 |
| 6 | charlotte_type | 251 | 63 | 9 |
| 7 | charlotte_observe | 592 | 148 | 9 |
| 8 | charlotte_type | 251 | 63 | 9 |
| 9 | charlotte_observe | 592 | 148 | 10 |
| 10 | charlotte_type | 251 | 63 | 9 |
| 11 | charlotte_observe | 592 | 148 | 9 |
| 12 | charlotte_observe | 592 | 148 | 9 |

## Runtime Toggle (meta-tool)

### Charlotte (browse)

- **Success:** Yes
- **Total chars:** 2,993
- **Estimated tokens:** 749
- **Wall time:** 482ms
- **Tool calls:** 5
- **Notes:** Initial: 23 tools. After enable: 25 tools (grew: true). Console tool worked: true. After disable: 23 tools (restored: true). Initial def chars: 16,747. Expanded def chars: 18,864. Contracted def chars: 16,747

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_tools | 2,300 | 575 | 2 |
| 2 | charlotte_tools | 164 | 41 | 2 |
| 3 | charlotte_navigate | 259 | 65 | 476 |
| 4 | charlotte_console | 104 | 26 | 1 |
| 5 | charlotte_tools | 166 | 42 | 1 |
