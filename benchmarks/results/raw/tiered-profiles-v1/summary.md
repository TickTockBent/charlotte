# Charlotte Benchmark Results

Generated: 2026-03-03T14:14:58.664Z

## Summary

| Test | Charlotte (browse) (chars) | Charlotte (core) (chars) | Charlotte (full) (chars) |
| :--- | ---: | ---: | ---: |
| Tool Definitions (overhead) | 258 | 258 | 258 |

## Tool Definition Overhead

| Profile | Tools | Definition Chars | Est. Def. Tokens |
| :--- | ---: | ---: | ---: |
| Charlotte (full) | 40 | 25,152 | 7,187 |
| Charlotte (browse) | 22 | 13,042 | 3,727 |
| Charlotte (core) | 7 | 5,868 | 1,677 |

### Headline Savings

- **Charlotte (browse)** saves **48%** tool definition overhead vs Charlotte (full) (3,727 vs 7,187 tokens per call)
- **Charlotte (core)** saves **77%** tool definition overhead vs Charlotte (full) (1,677 vs 7,187 tokens per call)

## Cumulative Token Cost by Test

### Tool Definitions (overhead)

| Profile | Calls | Response Tokens | Def. Tokens (cum.) | Total Tokens | Savings vs Full |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Charlotte (full) | 1 | 65 | 7,187 | 7,252 | — |
| Charlotte (browse) | 1 | 65 | 3,727 | 3,792 | 47.7% |
| Charlotte (core) | 1 | 65 | 1,677 | 1,742 | 76.0% |

## Tool Definitions (overhead)

### Charlotte (full)

- **Success:** Yes
- **Total chars:** 258
- **Estimated tokens:** 65
- **Wall time:** 63ms
- **Tool calls:** 1
- **Notes:** Tools: 40 (expected 40, match). Definition chars: 25,152. Est. definition tokens: 7,187

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 258 | 65 | 63 |

### Charlotte (browse)

- **Success:** Yes
- **Total chars:** 258
- **Estimated tokens:** 65
- **Wall time:** 54ms
- **Tool calls:** 1
- **Notes:** Tools: 22 (expected 22, match). Definition chars: 13,042. Est. definition tokens: 3,727

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 258 | 65 | 54 |

### Charlotte (core)

- **Success:** Yes
- **Total chars:** 258
- **Estimated tokens:** 65
- **Wall time:** 27ms
- **Tool calls:** 1
- **Notes:** Tools: 7 (expected 7, match). Definition chars: 5,868. Est. definition tokens: 1,677

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 258 | 65 | 27 |
