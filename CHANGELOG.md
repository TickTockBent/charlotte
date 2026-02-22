# Changelog

All notable changes to Charlotte will be documented in this file.

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
