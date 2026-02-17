# Sandbox Test Site

Charlotte ships with a self-contained test website that exercises all 30 MCP tools without touching the public internet. It lives in `tests/sandbox/` and is designed to be served locally via `charlotte:dev_serve`.

## Pages

| Page | File | What It Tests |
|------|------|---------------|
| **Home** | `index.html` | Landmarks, headings, table, list, image, blockquote, footer nav. Content extraction at all detail levels. |
| **Forms** | `forms.html` | Text inputs, email, password, selects, checkboxes, radios, textarea, search, number input, disabled fields, form submission. |
| **Interactive** | `interactive.html` | Counter buttons, dynamic DOM content, hover zone with tooltip, double-click target, keyboard input display, delayed content (2s timeout), hidden element reveal (1s timeout), scroll container (50 items), page title/meta modification. |
| **About** | `about.html` | Simple content page for back/forward navigation. Cookie display, viewport info, custom header display. |

## Running the Sandbox

### Prerequisites

- Charlotte built and configured as an MCP server (see [MCP Setup Guide](mcp-setup.md))

### Steps

1. **Serve the sandbox** using Charlotte's dev server:

   ```
   dev_serve({ path: "tests/sandbox" })
   ```

   This starts a local static server (auto-assigned port), navigates the browser to it, and returns the home page representation. File watching is enabled by default — edits to sandbox files trigger automatic page reloads.

2. **Exercise tools** against the local URL. The sections below walk through every tool.

## Tool Exercise Checklist

### Navigation

| Tool | Action | Verify |
|------|--------|--------|
| `navigate` | `navigate({ url: "<sandbox>/forms.html" })` | Title is "Forms - Charlotte Test Sandbox", landmarks include banner, nav, main, contentinfo |
| `back` | `back()` | Returns to previous page (home) |
| `forward` | `forward()` | Returns to forms page |
| `reload` | `reload()` | Same page, same element IDs (stable hashes) |
| `reload` (hard) | `reload({ hard: true })` | Cache bypass, same structure |

### Observation

| Tool | Action | Verify |
|------|--------|--------|
| `observe` (summary) | `observe()` on home page | Landmarks listed, content_summary shows counts per landmark |
| `observe` (minimal) | `observe({ detail: "minimal" })` | Landmarks + interactive elements only, no content_summary |
| `observe` (full) | `observe({ detail: "full" })` | `full_content` field with all visible text |
| `observe` (scoped) | `observe({ selector: "main" })` | Only main content area |
| `find` (by type) | `find({ type: "button" })` on interactive page | Returns all buttons with labels and bounds |
| `find` (by text) | `find({ text: "counter" })` | Returns increment/decrement counter buttons |
| `find` (near) | `find({ near: "<button_id>" })` | Elements sorted by distance from reference |
| `find` (within) | `find({ within: "<landmark_id>" })` | Elements geometrically inside the landmark |
| `screenshot` | `screenshot()` | Base64-encoded PNG of the page |
| `diff` | Click a button, then `diff()` | Shows changes between current and previous snapshot |

### Interaction (use forms.html and interactive.html)

| Tool | Action | Verify |
|------|--------|--------|
| `click` | Click increment button on interactive page | Counter value increases, delta shows state change |
| `type` | `type({ element_id: "<name_input>", text: "Test User" })` on forms page | Input value reflected in representation |
| `select` | `select({ element_id: "<country_select>", value: "ca" })` | Dropdown shows "Canada" |
| `toggle` | `toggle({ element_id: "<checkbox_id>" })` on forms page | `checked` state flips |
| `submit` | `submit({ form_id: "<contact_form>" })` | "Form Submitted!" heading appears in delta |
| `scroll` | `scroll({ direction: "down" })` | All element bounds shift upward |
| `hover` | `hover({ element_id: "<hover_zone>" })` on interactive page | Hover state triggered |
| `key` | `key({ key: "Escape" })` | Key display shows "Escape" (verify with `evaluate`) |
| `click` (double) | `click({ element_id: "<dblclick_target>", click_type: "double" })` | Target text changes to "Activated!" |

### Async

| Tool | Action | Verify |
|------|--------|--------|
| `wait_for` (text) | Click "Load Content (2s delay)" button, then `wait_for({ text: "Item Alpha", timeout: 5000 })` | Returns after ~2s with "Loaded Content" heading in representation |
| `wait_for` (selector) | Click "Show Hidden Element (1s delay)", then `wait_for({ selector: "#hidden-element[style*='display: block']", timeout: 3000 })` | Returns after ~1s with hidden element now visible |
| `wait_for` (JS) | `wait_for({ js: "document.title === 'some value'", timeout: 3000 })` | Returns when JS expression becomes truthy, or TIMEOUT |

### Session

| Tool | Action | Verify |
|------|--------|--------|
| `set_cookies` | `set_cookies({ cookies: [{ name: "test", value: "hello", domain: "localhost" }] })` | Navigate to about.html, cookie display shows the cookie |
| `set_headers` | `set_headers({ headers: { "X-Custom": "value" } })` | Headers set for subsequent requests |
| `viewport` (mobile) | `viewport({ device: "mobile" })` | Viewport 375x667, layout reflows (nav wraps) |
| `viewport` (desktop) | `viewport({ device: "desktop" })` | Viewport 1280x720 |
| `viewport` (custom) | `viewport({ width: 1024, height: 768 })` | Custom dimensions |
| `configure` | `configure({ snapshot_depth: 10 })` | Snapshot buffer resized |
| `tabs` | `tabs()` | Lists open tabs with URLs and active status |
| `tab_open` | `tab_open({ url: "<sandbox>/about.html" })` | New tab opened, representation returned |
| `tab_switch` | `tab_switch({ tab_id: "tab-1" })` | Switches to specified tab |
| `tab_close` | `tab_close({ tab_id: "tab-2" })` | Tab removed from list |
| `network` (throttle) | `network({ throttle: "3g" })` | Throttling applied |
| `network` (block) | `network({ block: ["*.png"] })` | URL pattern blocked |

### Dev Mode

| Tool | Action | Verify |
|------|--------|--------|
| `dev_serve` | `dev_serve({ path: "tests/sandbox" })` | Static server started, page navigated to localhost URL |
| `dev_inject` (CSS) | `dev_inject({ css: "body { background: red; }" })` | Styles applied, visible in screenshot |
| `dev_inject` (JS) | `dev_inject({ js: "document.title = 'Injected'" })` | Title change in delta |
| `dev_audit` | `dev_audit({ checks: ["a11y", "seo", "contrast"] })` | Returns findings with severity and recommendations |

### Evaluate

| Tool | Action | Verify |
|------|--------|--------|
| `evaluate` | `evaluate({ expression: "document.title" })` | Returns page title string |
| `evaluate` (complex) | `evaluate({ expression: "document.querySelectorAll('a').length" })` | Returns link count as number |
| `evaluate` (async) | `evaluate({ expression: "fetch('/index.html').then(r => r.status)", await_promise: true })` | Returns 200 |

## Test Log

A detailed test log from the initial sandbox validation is available at `tests/sandbox/test_log.md`. It documents the result of every tool call, including a bug found and fixed in the back/forward navigation tools.
