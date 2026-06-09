# Charlotte Benchmark Results

Generated: 2026-06-09T23:20:58.927Z

## Summary

| Test | Charlotte (chars) |
| :--- | ---: |
| Interactive Form (httpbin) | 7,699 |

## Tool Definition Overhead

| Profile | Tools | Definition Chars | Est. Def. Tokens |
| :--- | ---: | ---: | ---: |
| Charlotte | 23 | 16,747 | 4,785 |

## Cumulative Token Cost by Test

### Interactive Form (httpbin)

| Profile | Calls | Response Tokens | Def. Tokens (cum.) | Total Tokens | Savings vs Full |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Charlotte | 5 | 1,926 | 23,925 | 25,851 | — |

## Interactive Form (httpbin)

### Charlotte

- **Success:** Yes
- **Total chars:** 7,699
- **Estimated tokens:** 1,926
- **Wall time:** 2227ms
- **Tool calls:** 5
- **Notes:** Found 4 inputs, 0 forms. Filled: true, Submitted: false

| # | Tool | Chars | Est. Tokens | Time (ms) |
| ---: | :--- | ---: | ---: | ---: |
| 1 | charlotte_navigate | 592 | 148 | 1647 |
| 2 | charlotte_observe | 2,752 | 688 | 7 |
| 3 | charlotte_find | 673 | 169 | 7 |
| 4 | charlotte_type | 3,090 | 773 | 557 |
| 5 | charlotte_observe | 592 | 148 | 9 |
