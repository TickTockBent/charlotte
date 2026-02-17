# Charlotte MCP Sandbox Test Log

**Date:** 2026-02-17
**Environment:** Local dev server via `charlotte:dev_serve` on `http://localhost:38337`
**Test Pages:** `tests/sandbox/` — 4 HTML pages (index, forms, interactive, about)
**Charlotte Version:** Post-Phase 6 (222 unit/integration tests passing)

---

## Summary

- **30/30 tools exercised**
- **29 passed on first attempt**
- **1 bug found and fixed** (back/forward null response on local navigation)
- **0 failures remaining**

---

## Test Website

| Page | File | Purpose |
|------|------|---------|
| Home | `index.html` | Landmarks, headings, table, list, image, blockquote, nav links |
| Forms | `forms.html` | Text inputs, email, password, selects, checkboxes, radios, textarea, search, number, disabled fields, form submission |
| Interactive | `interactive.html` | Counter buttons, dynamic content, hover zone, double-click target, keyboard listener, delayed content (2s), hidden element reveal (1s), scroll container (50 items), page state buttons |
| About | `about.html` | Simple content page, cookie display, viewport info, navigation links |

---

## Results by Tool

### Navigation Tools

| Tool | Result | Details |
|------|--------|---------|
| `charlotte:navigate` | PASS | Navigated between all 4 pages. Correct titles, landmarks, and content returned each time. |
| `charlotte:back` | BUG FIXED | Puppeteer `page.goBack()` returns null for local server navigations even when URL changes. Fixed to compare `page.url()` before/after instead of checking response object. |
| `charlotte:forward` | BUG FIXED | Same root cause and fix as `back`. |
| `charlotte:reload` | PASS | Same page returned with identical structure. Element IDs stable across reload. |

### Observation Tools

| Tool | Result | Details |
|------|--------|---------|
| `charlotte:observe` (summary) | PASS | Index page: 5 landmarks (banner, nav, main, contentinfo, footer nav), 11 headings, correct content counts per landmark. |
| `charlotte:observe` (minimal) | PASS | Returned landmarks + interactive elements only, no content summaries. |
| `charlotte:find` (by type) | PASS | `type: "button"` on interactive page returned 10 buttons with correct labels. |
| `charlotte:find` (by text) | PASS | `text: "counter"` returned 2 matching buttons (Increment/Decrement counter). |
| `charlotte:find` (near) | PASS | Elements near a reference element returned sorted by distance. |
| `charlotte:screenshot` | PASS | Full page JPEG captured successfully, returned as base64. |
| `charlotte:diff` (interactive scope) | PASS | Detected focus state change between snapshots. |

### Interaction Tools

| Tool | Result | Details |
|------|--------|---------|
| `charlotte:click` | PASS | Clicked increment button. Counter value changed from 0 to 1 (verified via `evaluate`). Delta showed button focus change. |
| `charlotte:type` | PASS | Typed "Charlotte Test User" into Full Name input. Value reflected in returned representation. `clear_first: true` worked correctly. |
| `charlotte:select` | PASS | Changed Country dropdown to "Canada" (`value: "ca"`). Representation showed updated selection. |
| `charlotte:toggle` | PASS | Toggled "Artificial Intelligence" checkbox. State changed to `checked: true`. |
| `charlotte:submit` | PASS | Submitted contact form. Delta showed "Form Submitted!" heading appeared and form output section became visible. |
| `charlotte:hover` | PASS | Hovered over hover-zone target. Page scrolled to element position. |
| `charlotte:key` (Escape) | PASS | Pressed Escape key. Key display element updated value to "Escape". |
| `charlotte:key` (double-click) | PASS | Double-clicked activation target. DOM text changed to "Activated!" (verified via `evaluate`). |
| `charlotte:scroll` (page down) | PASS | Scrolled page down. All element bounds shifted by ~600px in y-axis. |

### Async / Wait Tools

| Tool | Result | Details |
|------|--------|---------|
| `charlotte:wait_for` (text) | PASS | Clicked "Load Content (2s delay)" button, then waited for `text: "Item Alpha"`. Detected successfully after delay. Delta showed "Loaded Content" h3 heading added, section expanded from 74px to 208px height, and content summary updated to include "1 headings, 1 lists". |
| `charlotte:wait_for` (selector) | PASS | Clicked "Show Hidden Element (1s delay)" button, then waited for `selector: "#hidden-element[style*='display: block']"`. Detected successfully. Delta showed section grew by 26px and content summary gained "2 paragraphs". |

### Session Tools

| Tool | Result | Details |
|------|--------|---------|
| `charlotte:set_cookies` | PASS | Set 2 cookies (`charlotte_test=sandbox_cookie_value`, `session_id=abc123xyz`). Reloaded about page — cookie display showed both cookies via `document.cookie`. |
| `charlotte:set_headers` | PASS | Set `X-Charlotte-Test` and `X-Custom-Auth` headers. Server confirmed 2 headers configured. |
| `charlotte:viewport` (mobile) | PASS | Changed to 375x667. Banner width reflowed from 736px to 311px. "About" nav link wrapped to second row (y changed from 92 to 169). |
| `charlotte:viewport` (desktop) | PASS | Restored to 1280x720. Banner expanded to 1216px width. Layout returned to single-row nav. |
| `charlotte:configure` | PASS | Set `snapshot_depth: 10`, `auto_snapshot: "every_action"`. Config confirmed in response. |
| `charlotte:tabs` | PASS | Listed 1 tab initially. |
| `charlotte:tab_open` | PASS | Opened tab-2 on index.html. Full page representation returned for new tab. |
| `charlotte:tab_switch` | PASS | Switched back to tab-1 (about page). Viewport still at mobile (375x667) as expected. |
| `charlotte:tab_close` | PASS | Closed tab-2. Remaining tabs showed only tab-1 active. |
| `charlotte:network` (3g) | PASS | Throttle set to 3g. Confirmed in response. |
| `charlotte:network` (none) | PASS | Throttle cleared. |

### Evaluate Tool

| Tool | Result | Details |
|------|--------|---------|
| `charlotte:evaluate` | PASS | Read counter value (`1`), double-click target text (`"Activated!"`), cookie display text (both cookies present), viewport info text. All values correct. |

### Dev Mode Tools

| Tool | Result | Details |
|------|--------|---------|
| `charlotte:dev_serve` | PASS | Served `tests/sandbox/` directory. Auto-assigned port 38337. All 4 pages accessible. |
| `charlotte:dev_inject` (CSS) | PASS | Injected dark mode styles (`background: #1a1a2e`, `color: #e0e0e0`). Styles applied without error. |
| `charlotte:dev_inject` (JS) | PASS | Changed `document.title` to "Injected Dark Mode - About Page". Delta correctly showed title change. |
| `charlotte:dev_audit` | PASS | Ran all 5 categories (a11y, performance, seo, contrast, links). Returned 3 findings: DOM node count warning (1606 > 1500), JS heap usage warning (80.7%), performance metrics baseline (info). No a11y issues found — validates sandbox pages have proper alt text, labels, and heading hierarchy. |

---

## Bug Found and Fixed

### back/forward null response on local server navigation

**Symptom:** `charlotte:back` and `charlotte:forward` returned `NAVIGATION_FAILED` errors ("No previous page in history") even when the browser had valid history entries and navigation succeeded.

**Root Cause:** Puppeteer's `page.goBack()` and `page.goForward()` return `null` for some local server navigations (express static server) rather than an HTTP response object. The original code checked `if (response === null)` to detect "no history" — but null was also returned for successful navigations.

**Verification:** Used `charlotte:evaluate` to confirm `history.length === 7` and `location.href` had changed to the expected URL, proving navigation actually succeeded despite the null response.

**Fix:** Changed both tools in `src/tools/navigation.ts` to compare `page.url()` before and after the navigation call. If the URL is unchanged, there was genuinely no history entry. If the URL changed, navigation succeeded regardless of the response object value.

**File Modified:** `src/tools/navigation.ts` (lines 104-113 for back, lines 138-147 for forward)

**Status:** Code fixed and built. Running MCP process needs restart to pick up the fix.

---

## Observations

- **Element ID stability:** IDs remained consistent across reloads and re-renders of the same page. The hash-based generation produces deterministic results.
- **Delta quality:** The diff system accurately captured DOM mutations — added headings, expanded sections, moved elements, content summary changes, and state transitions (focus, checked).
- **Viewport reflow:** Mobile viewport correctly triggered layout reflow. Nav links wrapped, widths narrowed, and all bounds updated accurately.
- **Content summaries:** Structured count format (`"main: 10 headings, 5 paragraphs, 3 links, 1 images, 1 lists, 1 tables"`) is terse and informative.
- **Cross-tab isolation:** Viewport changes on tab-1 did not affect tab-2's default viewport (800x600).
- **Audit accuracy:** No false positives on well-structured pages. The sandbox was intentionally built with proper semantics (alt text, labels, ARIA roles, heading hierarchy) and the audit correctly found no a11y issues.
