# Changelog

All notable changes to Charlotte will be documented in this file.

## [Unreleased]

### Added

- **`charlotte:console`** — Retrieve console messages from the active page at all severity levels (log, info, warn, error, debug) with timestamps. Supports level filtering and buffer clearing. Closes GAP-21 from the Playwright MCP gap analysis.
- **`charlotte:requests`** — Retrieve network request history from the active page with method, status, resource type, and timestamps. Supports filtering by URL pattern, resource type, and minimum status code. Closes GAP-22 from the Playwright MCP gap analysis.

### Changed

- PageManager now captures all console messages and all network responses (not just errors). Ring buffers capped at 1000 entries each. Backward-compatible: `getConsoleErrors()` and `getNetworkErrors()` still return only errors for `PageRepresentation.errors`.

## [0.3.0] - 2026-02-24

### Added

- **`charlotte:dialog`** — Accept or dismiss JavaScript dialogs (`alert`, `confirm`, `prompt`, `beforeunload`). Dialogs are captured by PageManager and surfaced as `pending_dialog` in every tool response while blocking. Response includes `dialog_handled` metadata confirming what was resolved. Closes GAP-03 from the Playwright MCP gap analysis.
- **Dialog-aware action racing** — Interaction tools (`click`, `submit`) now race the action against dialog detection. Clicks that trigger dialogs return immediately with `pending_dialog` instead of hanging for 30s.
- **`dialog_auto_dismiss` configuration** — New parameter on `charlotte:configure` to auto-handle dialogs without explicit tool calls. Options: `"none"` (default, queue for manual handling), `"accept_alerts"`, `"accept_all"`, `"dismiss_all"`.
- **Dialog-blocking stub responses** — When a dialog is open, `renderActivePage` returns a minimal stub representation (since `page.title()` hangs while dialogs are blocking). The stub includes `pending_dialog` so agents always know a dialog needs handling.

### Changed

- `PageManager` now accepts `CharlotteConfig` in its constructor for dialog auto-dismiss configuration.
- Config initialization moved before `PageManager` creation in `src/index.ts`.

## [0.2.0] - 2026-02-22

### Changed

- **Compact response format** — Responses are now dramatically smaller, reducing context window consumption by 50-99% depending on the page. Charlotte's `navigate` returns 336 characters for Hacker News vs Playwright MCP's 61,230.
- **Interactive summary for minimal detail** — Navigation tools now return interactive element counts grouped by landmark region instead of listing every element individually. Wikipedia's minimal response dropped from 711K to 7.7K characters.
- **Default state stripping** — Interactive elements no longer include redundant default state fields (`enabled: true`, `visible: true`, `focused: false`). Only non-default values are serialized.
- **Compact JSON serialization** — All tool responses use compact JSON with empty fields stripped.
- **Navigation defaults to minimal** — `navigate`, `back`, `forward`, and `reload` now return minimal detail by default. Pass `detail: "summary"` or `detail: "full"` for more context.
- **Updated tool descriptions** — `navigate` and `observe` descriptions now guide agents through the minimal-then-find workflow.

### Removed

- Removed unused `alerts` field from page representation.

## [0.1.3] - 2026-02-22

### Added

- Benchmark suite for comparing Charlotte against Playwright MCP across real websites.

## [0.1.2] - 2026-02-22

### Changed

- Added `mcpName` field for MCP registry publishing.

## [0.1.1] - 2026-02-22

### Added

- **`get_cookies`** — Retrieve cookies for the active page with optional URL filtering. Returns cookie name, value, domain, path, and security flags.
- **`clear_cookies`** — Clear cookies from the browser with optional name filtering. Supports clearing all cookies or specific cookies by name.

### Fixed

- Session integration tests now use HTTP URLs for cookie operations (CDP requires http/https for `Network.deleteCookies`).

## [0.1.0] - 2026-02-13

Initial release. All six implementation phases complete.

### Tools

**Navigation**: `navigate`, `back`, `forward`, `reload`

**Observation**: `observe` (minimal/summary/full detail levels, CSS selector scoping, computed styles), `find` (text, role, type, spatial near/within filters), `screenshot` (PNG/JPEG/WebP, element or full page), `diff` (structural comparison against snapshots)

**Interaction**: `click` (left/right/double), `type` (with clear_first, press_enter), `select`, `toggle`, `submit`, `scroll` (page/container, directional), `hover`, `key` (with modifiers), `wait_for` (element state, text, selector, JS expression)

**Session**: `tabs`, `tab_open`, `tab_switch`, `tab_close`, `set_cookies`, `set_headers`, `viewport` (mobile/tablet/desktop presets), `network` (3G/4G/offline throttling, URL blocking), `configure` (snapshot depth, auto-snapshot mode)

**Development**: `dev_serve` (static server + file watching with auto-reload), `dev_inject` (CSS/JS injection with delta), `dev_audit` (a11y, performance, SEO, contrast, broken links)

**Utilities**: `evaluate` (JS execution with timeout and promise awaiting)

### Architecture

- Renderer pipeline: accessibility tree + layout geometry + interactive element extraction
- Hash-based element IDs stable across re-renders
- Snapshot store with ring buffer and structural diffing
- Chromium crash recovery with automatic relaunch
- Dev mode reload events surfaced through existing tool responses (zero integration overhead)

### Testing

222 tests across 19 test files (unit + integration).
