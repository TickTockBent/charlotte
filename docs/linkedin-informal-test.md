# LinkedIn.com — Charlotte vs Playwright MCP

**Informal test** · March 2026 · LinkedIn logged-out homepage (105 interactive elements)

---

## Tool Definitions

| Server | Tools | Definition Chars | Definition Tokens |
|:-------|------:|-----------------:|------------------:|
| Charlotte (core) | 7 | 5,868 | 1,677 |
| Charlotte (browse) | 22 | 13,042 | 3,727 |
| Charlotte (full) | 40 | 25,152 | 7,187 |
| Playwright MCP | 22 | 14,080 | 4,023 |

Charlotte browse and Playwright carry roughly the same number of tools (22 each), but Charlotte's definitions are slightly smaller (13K vs 14K chars).

---

## Navigate — First Call Cost

What the agent sees the instant it lands on the page.

| Server | Response Chars | Response Tokens |
|:-------|---------------:|----------------:|
| Charlotte (minimal) | 3,404 | 851 |
| Playwright (navigate) | 24,712 | 6,178 |

Charlotte's minimal navigate is **7.3x smaller** than Playwright's navigate. Playwright returns a full accessibility snapshot on every navigation; Charlotte returns a compact orientation with landmarks, headings, and interactive element counts.

---

## Page Observation

| Server | Response Chars | Response Tokens | vs Playwright |
|:-------|---------------:|----------------:|:-------------:|
| Charlotte (minimal) | 3,404 | 851 | **7.3x smaller** |
| Charlotte (summary) | 17,489 | 4,373 | **1.4x smaller** |
| Charlotte (full) | 20,167 | 5,042 | **1.2x smaller** |
| Playwright (snapshot) | 24,890 | 6,223 | — |

Even Charlotte's **full** detail level (all text content + all interactive elements) is 20% smaller than Playwright's snapshot. Charlotte's summary is 30% smaller. And Charlotte's minimal — what agents actually use for orientation — is **7.3x smaller**.

---

## Surgical Search

Charlotte offers `find` for targeted element lookup. Playwright has no equivalent — agents must parse the full snapshot.

| Operation | Charlotte | Playwright |
|:----------|----------:|----------:|
| Find one link by text | 170 chars (43 tokens) | N/A (re-read full snapshot) |

---

## Session Cost — Navigate + Observe

A typical 2-call interaction: navigate to the page, then observe it.

| Server | Calls | Response Tokens | Def. Tokens (cumulative) | Total Tokens | vs Playwright |
|:-------|------:|----------------:|-------------------------:|-------------:|:-------------:|
| Playwright MCP | 2 | 12,401 | 8,046 | **20,447** | — |
| Charlotte (full) | 2 | 5,222 | 14,374 | **19,596** | 4.2% less |
| Charlotte (browse) | 2 | 5,224 | 7,454 | **12,678** | **38.0% less** |
| Charlotte (core) | 2 | 5,222 | 3,354 | **8,576** | **58.1% less** |

Charlotte browse saves **38%** vs Playwright for an equivalent navigate+observe on LinkedIn. With the core profile, savings reach **58%**.

---

## 4-Call Session — Navigate + Summary + Full + Find

Charlotte's full workflow: orient, then drill deeper, then find a specific element.

| Profile | Calls | Response Tokens | Def. Tokens (cumulative) | Total Tokens |
|:--------|------:|----------------:|-------------------------:|-------------:|
| Charlotte (full) | 4 | 10,301 | 28,748 | 39,049 |
| Charlotte (browse) | 4 | 10,309 | 14,908 | **25,217** |
| Charlotte (core) | 4 | 10,301 | 6,708 | **17,009** |

For context, Playwright can't do this 4-step workflow — it has no detail levels and no `find`. An agent using Playwright would re-read the full 24K-char snapshot each time.

---

## 100-Page Extrapolation

Using 2 calls per page (navigate + observe), LinkedIn-level complexity:

| Server | Total Tokens | Cost (Sonnet 4, $3/M) | Cost (Opus 4, $15/M) |
|:-------|-------------:|-----------------------:|----------------------:|
| Playwright MCP | 2,044,700 | $6.13 | $30.67 |
| Charlotte (full) | 1,959,600 | $5.88 | $29.39 |
| Charlotte (browse) | 1,267,800 | $3.80 | $19.02 |
| Charlotte (core) | 857,600 | $2.57 | $12.86 |

Over 100 pages, Charlotte browse saves **$11.65 on Opus 4** vs Playwright. Core saves **$17.81**.

---

## Key Takeaway

LinkedIn is a moderately complex page (105 interactive elements, heavy link density). Even here, Charlotte browse delivers **38% fewer tokens** than Playwright for equivalent work. The advantage comes from two places: **smaller responses** (7.3x at minimal detail) and **slightly smaller definitions** (13K vs 14K chars). On more complex pages like Wikipedia (1,847 links), the gap widens to **136x**.
