# Charlotte vs Playwright MCP — Gap Analysis

**Date**: 2026-02-24
**Charlotte Version**: 0.2.0 (32 tools)
**Playwright MCP Version**: Latest (`@playwright/mcp`, ~36 tools across 7 capability groups)

---

## Executive Summary

Charlotte and Playwright MCP are both MCP servers for browser automation, but they take
different approaches. Charlotte focuses on **token efficiency** through tiered detail levels
and semantic element IDs, while Playwright MCP offers **broader browser control** through
capability-gated tool groups (core, vision, pdf, testing, tracing).

This analysis identifies **43 functional gaps** where Playwright MCP provides capabilities
that Charlotte currently lacks, organized into 10 categories. It also documents **12 areas
where Charlotte has capabilities Playwright MCP does not**, for completeness.

---

## Table of Contents

1. [Tool Inventory Comparison](#1-tool-inventory-comparison)
2. [Gap Category 1: Interaction Gaps](#2-interaction-gaps)
3. [Gap Category 2: Vision / Coordinate-Based Interaction](#3-vision--coordinate-based-interaction)
4. [Gap Category 3: Output & Export](#4-output--export)
5. [Gap Category 4: Testing & Verification](#5-testing--verification)
6. [Gap Category 5: Tracing & Recording](#6-tracing--recording)
7. [Gap Category 6: Monitoring & Observation](#7-monitoring--observation)
8. [Gap Category 7: Code Execution](#8-code-execution)
9. [Gap Category 8: Browser & Session Management](#9-browser--session-management)
10. [Gap Category 9: Transport & Connectivity](#10-transport--connectivity)
11. [Gap Category 10: Configuration & Security](#11-configuration--security)
12. [Charlotte Advantages (Features Playwright MCP Lacks)](#12-charlotte-advantages)
13. [Prioritized Implementation Recommendations](#13-prioritized-implementation-recommendations)
14. [Full Gap Reference Table](#14-full-gap-reference-table)

---

## 1. Tool Inventory Comparison

### Charlotte Tools (32)

| Category | Tools |
|----------|-------|
| Navigation (4) | `navigate`, `back`, `forward`, `reload` |
| Observation (4) | `observe`, `find`, `screenshot`, `diff` |
| Interaction (9) | `click`, `type`, `select`, `toggle`, `submit`, `scroll`, `hover`, `key`, `wait_for` |
| Session (10) | `tabs`, `tab_open`, `tab_switch`, `tab_close`, `viewport`, `network`, `get_cookies`, `set_cookies`, `clear_cookies`, `set_headers`, `configure` |
| Dev Mode (3) | `dev_serve`, `dev_inject`, `dev_audit` |
| Utility (1) | `evaluate` |

### Playwright MCP Tools (~36)

| Group | Tools |
|-------|-------|
| core (20) | `browser_navigate`, `browser_navigate_back`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_hover`, `browser_drag`, `browser_select_option`, `browser_fill_form`, `browser_press_key`, `browser_file_upload`, `browser_handle_dialog`, `browser_evaluate`, `browser_run_code`, `browser_wait_for`, `browser_take_screenshot`, `browser_console_messages`, `browser_network_requests`, `browser_resize`, `browser_close` |
| core-tabs (1) | `browser_tabs` (list/create/close/select) |
| core-install (1) | `browser_install` |
| vision (6) | `browser_mouse_click_xy`, `browser_mouse_move_xy`, `browser_mouse_drag_xy`, `browser_mouse_down`, `browser_mouse_up`, `browser_mouse_wheel` |
| pdf (1) | `browser_pdf_save` |
| testing (5) | `browser_verify_element_visible`, `browser_verify_text_visible`, `browser_verify_list_visible`, `browser_verify_value`, `browser_generate_locator` |
| tracing (2) | `browser_start_tracing`, `browser_stop_tracing` |

---

## 2. Interaction Gaps

### GAP-01: Drag and Drop

| Attribute | Detail |
|-----------|--------|
| **Playwright Tool** | `browser_drag` (snapshot mode), `browser_mouse_drag_xy` (vision mode) |
| **Charlotte Status** | Not implemented |
| **Impact** | High — blocks automation of drag-sortable lists, kanban boards, sliders, file drop zones |
| **Parameters (Playwright)** | `startElement`, `startRef`, `endElement`, `endRef` |
| **Suggested Tool Name** | `charlotte:drag` |
| **Implementation Notes** | Puppeteer supports drag via `page.mouse.move()`, `page.mouse.down()`, `page.mouse.up()` sequences. Could also use CDP `Input.dispatchDragEvent`. |

### GAP-02: File Upload

| Attribute | Detail |
|-----------|--------|
| **Playwright Tool** | `browser_file_upload` |
| **Charlotte Status** | Not implemented. `file_input` is listed as an interactive element type but no tool handles it |
| **Impact** | High — blocks automation of any file upload workflow |
| **Parameters (Playwright)** | `paths` (array of file paths) |
| **Suggested Tool Name** | `charlotte:upload` |
| **Implementation Notes** | Puppeteer supports `elementHandle.uploadFile(paths)`. Charlotte already identifies `file_input` elements. |

### GAP-03: Dialog Handling (alert / confirm / prompt)

| Attribute | Detail |
|-----------|--------|
| **Playwright Tool** | `browser_handle_dialog` |
| **Charlotte Status** | Not implemented |
| **Impact** | High — JavaScript dialogs block all page interaction until dismissed. Unhandled dialogs will stall automation |
| **Parameters (Playwright)** | `accept` (boolean), `promptText` (string, optional) |
| **Suggested Tool Name** | `charlotte:dialog` |
| **Implementation Notes** | Puppeteer emits a `'dialog'` event on Page. Charlotte could auto-queue dialogs and expose a tool to accept/dismiss them. Consider also auto-dismissing with a configurable default. |

### GAP-04: Batch Form Fill

| Attribute | Detail |
|-----------|--------|
| **Playwright Tool** | `browser_fill_form` |
| **Charlotte Status** | Not implemented — requires sequential `charlotte:type` calls for each field |
| **Impact** | Medium — multi-field forms require N tool calls instead of 1, increasing token usage and latency |
| **Parameters (Playwright)** | `fields` (array of `{ref, value}`) |
| **Suggested Tool Name** | `charlotte:fill_form` |
| **Implementation Notes** | Straightforward to implement by iterating over fields internally. Should resolve each element_id, clear, and type. Could extend to also handle selects and checkboxes. |

### GAP-05: Slow / Character-by-Character Typing

| Attribute | Detail |
|-----------|--------|
| **Playwright Tool** | `browser_type` with `slowly: true` parameter |
| **Charlotte Status** | Not implemented — `charlotte:type` fills the entire value at once |
| **Impact** | Medium — some sites have key-by-key event handlers (autocomplete, search-as-you-type, input validation) that won't fire with bulk fill |
| **Parameters (Playwright)** | `slowly` (boolean) on `browser_type` |
| **Suggested Change** | Add `slowly` or `character_delay` parameter to `charlotte:type` |
| **Implementation Notes** | Puppeteer's `page.keyboard.type(text, {delay})` supports this natively. |

### GAP-06: Click with Modifier Keys

| Attribute | Detail |
|-----------|--------|
| **Playwright Tool** | `browser_click` with `modifiers` parameter (`["Control", "Shift", "Alt", "Meta"]`) |
| **Charlotte Status** | Partial — `charlotte:click` has `click_type` (left/right/double) but no modifier key support |
| **Impact** | Medium — blocks Ctrl+Click (open in new tab), Shift+Click (range select), etc. |
| **Parameters (Playwright)** | `modifiers` (array of modifier key names) |
| **Suggested Change** | Add `modifiers` parameter to `charlotte:click` |
| **Implementation Notes** | Puppeteer's `page.mouse.click()` doesn't directly accept modifiers, but holding keys via `page.keyboard.down('Control')` before click achieves this. |

---

## 3. Vision / Coordinate-Based Interaction

Charlotte operates exclusively in semantic/accessibility mode. Playwright MCP's entire `vision` capability group (6 tools) has no Charlotte equivalent.

### GAP-07: Coordinate-Based Click (`browser_mouse_click_xy`)

| Attribute | Detail |
|-----------|--------|
| **Impact** | Medium — needed for canvas elements, custom widgets, and elements not in the accessibility tree |
| **Suggested Tool Name** | `charlotte:click_xy` |

### GAP-08: Coordinate-Based Mouse Move (`browser_mouse_move_xy`)

| Attribute | Detail |
|-----------|--------|
| **Impact** | Medium — needed for hover effects at specific positions, canvas interaction |
| **Suggested Tool Name** | `charlotte:mouse_move` |

### GAP-09: Coordinate-Based Drag (`browser_mouse_drag_xy`)

| Attribute | Detail |
|-----------|--------|
| **Impact** | Medium — needed for canvas drawing, map interactions, visual editors |
| **Suggested Tool Name** | `charlotte:drag_xy` |

### GAP-10: Mouse Button Down / Up (`browser_mouse_down` / `browser_mouse_up`)

| Attribute | Detail |
|-----------|--------|
| **Impact** | Low — advanced use case for long-press, custom drag behaviors |
| **Suggested Tool Name** | `charlotte:mouse_down`, `charlotte:mouse_up` |

### GAP-11: Mouse Wheel (`browser_mouse_wheel`)

| Attribute | Detail |
|-----------|--------|
| **Impact** | Low — Charlotte's semantic `scroll` covers most cases; pixel-level wheel control needed for map zoom, canvas scroll |
| **Parameters (Playwright)** | `deltaX`, `deltaY` (numbers) |
| **Suggested Tool Name** | `charlotte:mouse_wheel` |

> **Note**: The entire vision group could be implemented as an optional capability behind a
> `--caps=vision` flag, mirroring Playwright MCP's approach. This aligns with Charlotte's
> philosophy of minimalism — most agents don't need coordinate-based interaction.

---

## 4. Output & Export

### GAP-12: PDF Generation

| Attribute | Detail |
|-----------|--------|
| **Playwright Tool** | `browser_pdf_save` |
| **Charlotte Status** | Not implemented |
| **Impact** | Low-Medium — useful for saving receipts, reports, invoices during automation |
| **Parameters (Playwright)** | `filename` (string, optional) |
| **Suggested Tool Name** | `charlotte:pdf` |
| **Implementation Notes** | Puppeteer supports `page.pdf()` natively. Chromium-only limitation applies to both. |

### GAP-13: Save Outputs to Files

| Attribute | Detail |
|-----------|--------|
| **Playwright Feature** | `filename` parameter on `browser_snapshot`, `browser_take_screenshot`, `browser_console_messages`, `browser_network_requests` |
| **Charlotte Status** | All data returned inline in tool responses only |
| **Impact** | Medium — file output reduces token consumption for large responses, enables post-session analysis |
| **Suggested Change** | Add optional `filename` / `save_to` parameter on `screenshot`, `observe`, and future monitoring tools |
| **Implementation Notes** | Charlotte's roadmap already mentions "Screenshot Artifacts". |

---

## 5. Testing & Verification

Playwright MCP's entire `testing` capability group (5 tools) has no Charlotte equivalent.

### GAP-14: Verify Element Visible (`browser_verify_element_visible`)

| Attribute | Detail |
|-----------|--------|
| **Parameters** | `role` (ARIA role), `accessibleName` (string) |
| **Impact** | Medium — enables assertion-driven automation without manual page inspection |
| **Suggested Tool Name** | `charlotte:verify_element` |

### GAP-15: Verify Text Visible (`browser_verify_text_visible`)

| Attribute | Detail |
|-----------|--------|
| **Parameters** | `text` (string) |
| **Impact** | Medium — simple boolean check vs parsing full observe output |
| **Suggested Tool Name** | `charlotte:verify_text` |

### GAP-16: Verify List Contents (`browser_verify_list_visible`)

| Attribute | Detail |
|-----------|--------|
| **Parameters** | `element`, `ref`, `items` (array) |
| **Impact** | Low — specialized use case |
| **Suggested Tool Name** | `charlotte:verify_list` |

### GAP-17: Verify Form Value (`browser_verify_value`)

| Attribute | Detail |
|-----------|--------|
| **Parameters** | `type`, `element`, `ref`, `value` |
| **Impact** | Medium — critical for form fill verification without full page re-observation |
| **Suggested Tool Name** | `charlotte:verify_value` |

### GAP-18: Generate Locator (`browser_generate_locator`)

| Attribute | Detail |
|-----------|--------|
| **Parameters** | `element`, `ref` |
| **Impact** | Low-Medium — useful when generating test code; Charlotte's element IDs aren't Playwright locators |
| **Suggested Tool Name** | `charlotte:locator` |
| **Implementation Notes** | Would generate a CSS or XPath selector for a given element_id. Useful for test code generation workflows. |

---

## 6. Tracing & Recording

### GAP-19: Playwright Trace Recording

| Attribute | Detail |
|-----------|--------|
| **Playwright Tools** | `browser_start_tracing`, `browser_stop_tracing` |
| **Charlotte Status** | Not implemented |
| **Impact** | Medium — traces capture actions, network, console, DOM snapshots, and screenshots in a `.zip` viewable in Playwright Trace Viewer |
| **Suggested Tool Names** | `charlotte:trace_start`, `charlotte:trace_stop` |
| **Implementation Notes** | Puppeteer supports Chrome DevTools Protocol tracing via `page.tracing.start()` / `page.tracing.stop()`. The output is a Chrome trace JSON, not a Playwright trace format. Charlotte could produce its own trace format or use CDP tracing. |

### GAP-20: Session Video Recording

| Attribute | Detail |
|-----------|--------|
| **Playwright Feature** | `--save-video` CLI flag with resolution specification |
| **Charlotte Status** | Not implemented (listed on roadmap) |
| **Impact** | Medium — valuable for debugging and review of automated sessions |
| **Implementation Notes** | Puppeteer doesn't have built-in video recording. Options include: screencast via CDP `Page.startScreencast`, or using ffmpeg to assemble screenshots. Already acknowledged on Charlotte's roadmap. |

---

## 7. Monitoring & Observation

### GAP-21: Dedicated Console Message Retrieval

| Attribute | Detail |
|-----------|--------|
| **Playwright Tool** | `browser_console_messages` with `level` filter and `filename` save |
| **Charlotte Status** | Partial — captures console errors in PageRepresentation `errors.console` array, but no dedicated tool, no level filtering, no file export |
| **Impact** | Medium — agents debugging JS errors need filtered console access |
| **Suggested Tool Name** | `charlotte:console` |
| **Implementation Notes** | Charlotte already listens to console events in PageManager. Needs: (1) capture all levels (not just errors), (2) expose as a dedicated tool, (3) add level filtering. |

### GAP-22: Dedicated Network Request Monitoring

| Attribute | Detail |
|-----------|--------|
| **Playwright Tool** | `browser_network_requests` with `includeStatic` filter and `filename` save |
| **Charlotte Status** | Partial — captures network errors in PageRepresentation `errors.network` array, but no tool for viewing all requests |
| **Impact** | Medium — agents debugging API failures need visibility into all requests, not just errors |
| **Suggested Tool Name** | `charlotte:requests` |
| **Implementation Notes** | Puppeteer's `page.on('request')` and `page.on('response')` events can capture full request/response data. Charlotte's `network` tool currently only configures throttling/blocking. |

---

## 8. Code Execution

### GAP-23: Execute Raw Puppeteer Code

| Attribute | Detail |
|-----------|--------|
| **Playwright Tool** | `browser_run_code` — executes raw Playwright code with full access to the `page` object |
| **Charlotte Status** | Not implemented — `charlotte:evaluate` executes JS in the **page context** (browser sandbox), not in the Node.js/Puppeteer context |
| **Impact** | Medium — `browser_run_code` is Playwright MCP's escape hatch for any unsupported operation (network interception, multi-page coordination, complex scripting). Charlotte has no equivalent escape hatch for Puppeteer-level operations |
| **Suggested Tool Name** | `charlotte:run_code` |
| **Security Considerations** | High risk — allows arbitrary Node.js code execution. Should be gated behind a capability flag. |

---

## 9. Browser & Session Management

### GAP-24: Explicit Browser Close

| Attribute | Detail |
|-----------|--------|
| **Playwright Tool** | `browser_close` |
| **Charlotte Status** | Not implemented — browser lifecycle is managed automatically |
| **Impact** | Low — Charlotte's auto-managed lifecycle is sufficient for most cases |
| **Suggested Tool Name** | `charlotte:close` |

### GAP-25: Browser Installation

| Attribute | Detail |
|-----------|--------|
| **Playwright Tool** | `browser_install` |
| **Charlotte Status** | Not implemented — relies on Puppeteer's bundled Chromium |
| **Impact** | Low — Puppeteer auto-downloads Chromium. Only relevant in constrained environments |

### GAP-26: Multiple Browser Engines

| Attribute | Detail |
|-----------|--------|
| **Playwright Feature** | Supports `chromium`, `firefox`, `webkit`, `msedge` via `--browser` flag |
| **Charlotte Status** | Chromium only (Puppeteer) |
| **Impact** | Medium — cross-browser testing is a common requirement |
| **Implementation Notes** | Significant effort — would require replacing or augmenting Puppeteer with Playwright as the automation engine, or supporting `puppeteer-firefox`. |

### GAP-27: Full Device Emulation

| Attribute | Detail |
|-----------|--------|
| **Playwright Feature** | `--device "iPhone 15"` — sets viewport, user agent, device scale factor, touch support from Playwright's device registry |
| **Charlotte Status** | Partial — `charlotte:viewport` has `device` presets (`mobile`/`tablet`/`desktop`) that set dimensions only, not user agent or touch emulation |
| **Impact** | Medium — accurate mobile testing requires full device emulation |
| **Suggested Change** | Extend `charlotte:viewport` to accept device names and configure UA, touch, DPR via CDP `Emulation.setDeviceMetricsOverride` and `Network.setUserAgentOverride` |

### GAP-28: Proxy Configuration

| Attribute | Detail |
|-----------|--------|
| **Playwright Feature** | `--proxy-server`, `--proxy-bypass` |
| **Charlotte Status** | Not implemented |
| **Impact** | Medium — required for corporate environments, testing through proxies |
| **Suggested Change** | Add `--proxy-server` and `--proxy-bypass` CLI arguments to BrowserManager launch options |

### GAP-29: Storage State Loading

| Attribute | Detail |
|-----------|--------|
| **Playwright Feature** | `--storage-state` to load cookies, localStorage, sessionStorage from a JSON file |
| **Charlotte Status** | Partial — `set_cookies` can set cookies individually, but no bulk load from file and no localStorage/sessionStorage support |
| **Impact** | Medium — pre-authenticated sessions require loading full storage state |
| **Suggested Change** | Add `--storage-state` CLI arg or a `charlotte:load_state` tool |

### GAP-30: Custom User Agent

| Attribute | Detail |
|-----------|--------|
| **Playwright Feature** | `--user-agent` CLI argument |
| **Charlotte Status** | Not implemented |
| **Impact** | Low-Medium — needed for testing mobile views, avoiding bot detection |
| **Suggested Change** | Add `--user-agent` CLI argument or parameter on `charlotte:configure` |

### GAP-31: Browser Permission Granting

| Attribute | Detail |
|-----------|--------|
| **Playwright Feature** | `--grant-permissions` (geolocation, clipboard-read, clipboard-write, etc.) |
| **Charlotte Status** | Not implemented |
| **Impact** | Low — niche use case for location-aware or clipboard-dependent apps |
| **Implementation Notes** | Puppeteer supports `browserContext.overridePermissions(origin, permissions)`. |

### GAP-32: Persistent Init Scripts

| Attribute | Detail |
|-----------|--------|
| **Playwright Feature** | `--init-script` (JS file injected on every page load), `--init-page` (TS page initialization) |
| **Charlotte Status** | Partial — `charlotte:dev_inject` injects CSS/JS but only once, not persistently across navigations |
| **Impact** | Medium — useful for injecting polyfills, analytics blockers, or auth tokens on every page load |
| **Suggested Change** | Add `--init-script` CLI argument that injects via `page.evaluateOnNewDocument()` |

### GAP-33: Connect to Existing Browser

| Attribute | Detail |
|-----------|--------|
| **Playwright Feature** | `--extension` mode to connect to existing Chrome/Edge, `--cdp-endpoint` to connect via DevTools Protocol |
| **Charlotte Status** | Not implemented — always launches a new browser instance |
| **Impact** | Medium — connecting to a user's existing browser enables working with logged-in sessions, extensions, etc. |
| **Suggested Change** | Add `--cdp-endpoint` CLI argument to BrowserManager to connect via `puppeteer.connect()` |

### GAP-34: Forward Navigation

| Attribute | Detail |
|-----------|--------|
| **Playwright MCP** | Does not have a dedicated `browser_navigate_forward` — forward is via `browser_press_key` with "Alt+ArrowRight" |
| **Charlotte Status** | Charlotte has `charlotte:forward` as a dedicated tool |
| **Note** | This is NOT a gap for Charlotte — Charlotte actually has a cleaner API here. Listed for completeness only. |

---

## 10. Transport & Connectivity

### GAP-35: SSE (Server-Sent Events) Transport

| Attribute | Detail |
|-----------|--------|
| **Playwright Feature** | `--port` flag enables SSE at `GET /sse`, `POST /messages?sessionId=<id>` |
| **Charlotte Status** | Stdio only |
| **Impact** | Medium — SSE enables web-based MCP clients, multi-client scenarios, and remote access |
| **Implementation Notes** | MCP SDK supports SSE transport. Would require adding an HTTP server mode. |

### GAP-36: Streamable HTTP Transport

| Attribute | Detail |
|-----------|--------|
| **Playwright Feature** | MCP 2025-03-26 spec compliant: `GET /mcp`, `POST /mcp?sessionId=<id>` |
| **Charlotte Status** | Not implemented |
| **Impact** | Medium — newer MCP spec transport for stateless HTTP clients |

### GAP-37: Health Check Endpoint

| Attribute | Detail |
|-----------|--------|
| **Playwright Feature** | `GET /health` when running in HTTP mode |
| **Charlotte Status** | Not implemented |
| **Impact** | Low — useful for monitoring in production deployments |

---

## 11. Configuration & Security

### GAP-38: JSON Configuration File

| Attribute | Detail |
|-----------|--------|
| **Playwright Feature** | `--config` flag to load settings from a JSON file |
| **Charlotte Status** | Not implemented — configuration only via `charlotte:configure` tool at runtime |
| **Impact** | Medium — simplifies repeatable setups, CI/CD integration |
| **Suggested Change** | Support a `charlotte.config.json` or `--config` CLI flag |

### GAP-39: Origin Allowlisting / Blocklisting

| Attribute | Detail |
|-----------|--------|
| **Playwright Feature** | `--allowed-origins`, `--blocked-origins` |
| **Charlotte Status** | Not implemented — no URL/origin restrictions |
| **Impact** | Medium — security feature to prevent agents from navigating to untrusted sites |
| **Implementation Notes** | Could be implemented as navigation guards in `charlotte:navigate`. |

### GAP-40: Service Worker Blocking

| Attribute | Detail |
|-----------|--------|
| **Playwright Feature** | `--block-service-workers` |
| **Charlotte Status** | Not implemented |
| **Impact** | Low — service workers can interfere with request interception and caching behavior |

### GAP-41: HTTPS Error Ignoring

| Attribute | Detail |
|-----------|--------|
| **Playwright Feature** | `--ignore-https-errors` |
| **Charlotte Status** | Not implemented |
| **Impact** | Low-Medium — needed for testing against self-signed certificates in dev environments |
| **Implementation Notes** | Puppeteer supports `ignoreHTTPSErrors: true` in launch options. |

### GAP-42: Capability Gating

| Attribute | Detail |
|-----------|--------|
| **Playwright Feature** | Tools grouped by capability (`vision`, `pdf`, `testing`, `tracing`), disabled by default, enabled via `--caps` flag |
| **Charlotte Status** | All 32 tools always exposed |
| **Impact** | Medium — capability gating is a security measure preventing LLMs from accessing dangerous operations (e.g., `run_code`, vision tools) unless explicitly opted in |
| **Suggested Change** | Implement `--caps` flag grouping tools like: `dev` (dev_serve, dev_inject, dev_audit), `vision` (future coordinate tools), `advanced` (evaluate, run_code) |

### GAP-43: Secrets Management

| Attribute | Detail |
|-----------|--------|
| **Playwright Feature** | `--secrets` flag to load dotenv files, masking secret values in tool outputs |
| **Charlotte Status** | Not implemented |
| **Impact** | Low — prevents accidental leaking of credentials in MCP tool responses |

---

## 12. Charlotte Advantages

Features Charlotte provides that Playwright MCP **does not** have as dedicated tools:

| # | Charlotte Feature | Description | Playwright MCP Equivalent |
|---|-------------------|-------------|---------------------------|
| A1 | `charlotte:diff` | Structural diff between page snapshots | None — agents must compare snapshots manually |
| A2 | `charlotte:find` | Search interactive elements by text, role, type, proximity, containment | None — agents must parse snapshot text |
| A3 | Detail levels (minimal/summary/full) | Tiered token output (336 chars vs 61K for Hacker News) | None — always returns full snapshot |
| A4 | Stable element IDs | Hash-based IDs survive DOM mutations | Ref strings regenerated each snapshot |
| A5 | `charlotte:network` (throttle) | Simulate 3G/4G/offline conditions | None — no network throttling tool |
| A6 | `charlotte:network` (block URLs) | Block URL patterns | Origin blocking only, not URL patterns |
| A7 | `charlotte:get_cookies` / `set_cookies` / `clear_cookies` | Dedicated cookie management tools | None — requires `browser_evaluate` or storage state files |
| A8 | `charlotte:set_headers` | Set custom HTTP headers | None — no dedicated tool |
| A9 | `charlotte:dev_serve` | Static file server with hot reload | None |
| A10 | `charlotte:dev_audit` | Accessibility, performance, SEO, contrast, broken link auditing | None |
| A11 | `charlotte:dev_inject` | Runtime CSS/JS injection tool | Only `--init-script` (config-time, not runtime) |
| A12 | `charlotte:configure` | Runtime snapshot depth and auto-snapshot tuning | None — all config via CLI args only |

---

## 13. Prioritized Implementation Recommendations

### Priority 1 — Critical Gaps (blocks common workflows)

| Gap | Tool | Rationale |
|-----|------|-----------|
| GAP-03 | `charlotte:dialog` | Unhandled dialogs freeze all automation |
| GAP-02 | `charlotte:upload` | File upload is a fundamental web interaction |
| GAP-01 | `charlotte:drag` | Drag-and-drop is common in modern web apps |
| GAP-21 | `charlotte:console` | Console access is essential for debugging |
| GAP-22 | `charlotte:requests` | Network request visibility essential for API debugging |

### Priority 2 — High Value (significant UX improvement)

| Gap | Tool / Change | Rationale |
|-----|---------------|-----------|
| GAP-04 | `charlotte:fill_form` | Reduces N tool calls to 1 for multi-field forms |
| GAP-05 | `slowly` param on `type` | Fixes autocomplete and search-as-you-type sites |
| GAP-06 | `modifiers` param on `click` | Enables Ctrl+Click, Shift+Click patterns |
| GAP-13 | `filename` param on tools | Reduces token consumption for large outputs |
| GAP-33 | `--cdp-endpoint` CLI arg | Enables connecting to existing browser sessions |
| GAP-32 | `--init-script` CLI arg | Persistent script injection across navigations |
| GAP-38 | `--config` CLI arg | Simplifies repeatable setups |

### Priority 3 — Medium Value (broadens use cases)

| Gap | Tool / Change | Rationale |
|-----|---------------|-----------|
| GAP-19 | Tracing | Debugging aid for complex automations |
| GAP-27 | Full device emulation | Accurate mobile testing |
| GAP-28 | Proxy config | Corporate environment support |
| GAP-29 | Storage state loading | Pre-authenticated session support |
| GAP-35/36 | SSE / HTTP transport | Web-based and remote clients |
| GAP-39 | Origin allow/block lists | Security hardening |
| GAP-42 | Capability gating | Security — prevent LLM tool misuse |

### Priority 4 — Low Value / Niche

| Gap | Tool / Change | Rationale |
|-----|---------------|-----------|
| GAP-07–11 | Vision tools | Only needed for canvas/non-accessible UIs |
| GAP-12 | PDF save | Niche export use case |
| GAP-14–18 | Testing/verification tools | Useful but agents can use `observe` + `find` |
| GAP-20 | Video recording | Already on roadmap |
| GAP-23 | `run_code` | Security risk; `evaluate` covers most cases |
| GAP-24–25 | Browser close/install | Auto-managed lifecycle is sufficient |
| GAP-26 | Multi-browser | Major effort (engine swap) |

---

## 14. Full Gap Reference Table

| ID | Category | Gap | Playwright Tool/Feature | Charlotte Status | Impact |
|----|----------|-----|-------------------------|------------------|--------|
| GAP-01 | Interaction | Drag and drop | `browser_drag` | Missing | High |
| GAP-02 | Interaction | File upload | `browser_file_upload` | Missing | High |
| GAP-03 | Interaction | Dialog handling | `browser_handle_dialog` | Missing | High |
| GAP-04 | Interaction | Batch form fill | `browser_fill_form` | Missing | Medium |
| GAP-05 | Interaction | Slow typing | `slowly` param | Missing | Medium |
| GAP-06 | Interaction | Click modifiers | `modifiers` param | Missing | Medium |
| GAP-07 | Vision | Coordinate click | `browser_mouse_click_xy` | Missing | Medium |
| GAP-08 | Vision | Coordinate move | `browser_mouse_move_xy` | Missing | Medium |
| GAP-09 | Vision | Coordinate drag | `browser_mouse_drag_xy` | Missing | Medium |
| GAP-10 | Vision | Mouse down/up | `browser_mouse_down/up` | Missing | Low |
| GAP-11 | Vision | Mouse wheel | `browser_mouse_wheel` | Missing | Low |
| GAP-12 | Export | PDF generation | `browser_pdf_save` | Missing | Low-Med |
| GAP-13 | Export | Save to files | `filename` param | Missing | Medium |
| GAP-14 | Testing | Verify element visible | `browser_verify_element_visible` | Missing | Medium |
| GAP-15 | Testing | Verify text visible | `browser_verify_text_visible` | Missing | Medium |
| GAP-16 | Testing | Verify list | `browser_verify_list_visible` | Missing | Low |
| GAP-17 | Testing | Verify value | `browser_verify_value` | Missing | Medium |
| GAP-18 | Testing | Generate locator | `browser_generate_locator` | Missing | Low-Med |
| GAP-19 | Tracing | Trace recording | `browser_start/stop_tracing` | Missing | Medium |
| GAP-20 | Tracing | Video recording | `--save-video` | Missing (roadmap) | Medium |
| GAP-21 | Monitoring | Console messages | `browser_console_messages` | Partial | Medium |
| GAP-22 | Monitoring | Network requests | `browser_network_requests` | Partial | Medium |
| GAP-23 | Code Exec | Run Puppeteer code | `browser_run_code` | Missing | Medium |
| GAP-24 | Session | Browser close | `browser_close` | Missing | Low |
| GAP-25 | Session | Browser install | `browser_install` | Missing | Low |
| GAP-26 | Session | Multi-browser | `--browser` flag | Missing | Medium |
| GAP-27 | Session | Full device emulation | `--device` flag | Partial | Medium |
| GAP-28 | Session | Proxy config | `--proxy-server` | Missing | Medium |
| GAP-29 | Session | Storage state | `--storage-state` | Partial | Medium |
| GAP-30 | Session | Custom user agent | `--user-agent` | Missing | Low-Med |
| GAP-31 | Session | Permission granting | `--grant-permissions` | Missing | Low |
| GAP-32 | Session | Persistent init scripts | `--init-script` | Partial | Medium |
| GAP-33 | Session | Connect to existing browser | `--cdp-endpoint` / `--extension` | Missing | Medium |
| GAP-34 | Session | Forward navigation | N/A | Charlotte has it | N/A |
| GAP-35 | Transport | SSE transport | `--port` flag | Missing | Medium |
| GAP-36 | Transport | Streamable HTTP | MCP spec endpoint | Missing | Medium |
| GAP-37 | Transport | Health check | `GET /health` | Missing | Low |
| GAP-38 | Config | JSON config file | `--config` flag | Missing | Medium |
| GAP-39 | Security | Origin allow/block | `--allowed/blocked-origins` | Missing | Medium |
| GAP-40 | Security | Service worker blocking | `--block-service-workers` | Missing | Low |
| GAP-41 | Security | HTTPS error ignoring | `--ignore-https-errors` | Missing | Low-Med |
| GAP-42 | Security | Capability gating | `--caps` flag | Missing | Medium |
| GAP-43 | Security | Secrets management | `--secrets` flag | Missing | Low |

---

## Methodology

This analysis was produced by:

1. **Charlotte audit**: Full source code review of all 32 tool definitions in `src/tools/`, browser management in `src/browser/`, rendering pipeline in `src/renderer/`, and configuration in `src/types/`.
2. **Playwright MCP audit**: Review of the official `@playwright/mcp` npm package, [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) GitHub repository, official documentation, and community resources.
3. **Cross-reference**: Each Playwright MCP tool was checked against Charlotte's tool inventory. Each Charlotte tool was checked for parameter-level parity with its Playwright equivalent.
