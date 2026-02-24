# Charlotte Technical Specification

**Version:** 0.3.0

Charlotte is an MCP server that renders web pages into structured, agent-readable `PageRepresentation` objects using headless Chromium and Puppeteer. It communicates over stdio using the Model Context Protocol.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Page Representation](#page-representation)
3. [Element Identity](#element-identity)
4. [Detail Levels](#detail-levels)
5. [Tools](#tools)
   - [Navigation](#navigation-tools)
   - [Observation](#observation-tools)
   - [Interaction](#interaction-tools)
   - [Dialog Handling](#dialog-handling-tools)
   - [Monitoring](#monitoring-tools)
   - [Session Management](#session-management-tools)
   - [Development Mode](#development-mode-tools)
   - [Utilities](#utility-tools)
6. [Snapshots and Diffs](#snapshots-and-diffs)
7. [Configuration](#configuration)
8. [Error Handling](#error-handling)

---

## Architecture

### Core Data Flow

```
AI Agent  <──MCP stdio──>  Charlotte Server
                              │
                        ┌─────┴──────┐
                        │  Renderer  │
                        │  Pipeline  │
                        └─────┬──────┘
                              │
                        ┌─────┴──────┐
                        │  Headless  │
                        │  Chromium  │
                        └────────────┘
```

### Renderer Pipeline

Each render executes these stages in order:

1. **AccessibilityExtractor** — CDP `Accessibility.getFullAXTree` produces a flat list of `ParsedAXNode` objects. Ignored nodes are flattened; their children are reparented to the nearest non-ignored ancestor.
2. **LayoutExtractor** — CDP `DOM.getBoxModel` resolves pixel bounds for each `backendDOMNodeId`. Nodes with null `backendDOMNodeId` are skipped.
3. **InteractiveExtractor** — AX nodes are mapped to typed `InteractiveElement` objects with state, and grouped into `FormRepresentation` objects where applicable.
4. **ContentExtractor** — AX text nodes are aggregated according to the requested detail level.
5. **ElementIdGenerator** — Stable hash-based IDs are assigned, then atomically swapped into the shared generator via `replaceWith()`.

### Dependency Injection

`src/index.ts` creates all services (`BrowserManager`, `PageManager`, `CDPSessionManager`, `RendererPipeline`, `ElementIdGenerator`, `SnapshotStore`, `CharlotteConfig`, `DevModeState`) and passes them as `ServerDeps` to `createServer()`, which distributes them as `ToolDependencies` to each tool module.

### Render Paths

**`renderActivePage(deps, options)`** — Common render path for all tools. Accepts:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `detail` | `"minimal" \| "summary" \| "full"` | `"summary"` | Verbosity level |
| `selector` | `string` | — | CSS selector to scope rendering |
| `includeStyles` | `boolean` | `false` | Include computed styles |
| `source` | `"observe" \| "action" \| "internal"` | `"action"` | Controls auto-snapshot behavior |
| `forceSnapshot` | `boolean` | `false` | Override auto-snapshot decision |

After rendering, it attaches console/network errors, optionally pushes a snapshot, and consumes any pending reload event from `DevModeState`. When a JavaScript dialog is blocking the page, returns a stub representation with `pending_dialog` instead of attempting to render (since CDP calls like `page.title()` hang while dialogs are open).

**`renderAfterAction(deps)`** — Used by interaction tools. Captures a pre-action snapshot, calls `renderActivePage` with `source: "action"`, computes a structural diff, and attaches the `delta` field to the response.

---

## Page Representation

Every tool that returns page state produces a `PageRepresentation`:

```typescript
interface PageRepresentation {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  snapshot_id: number;
  timestamp: string;                         // ISO 8601
  structure: PageStructure;
  interactive: InteractiveElement[];
  forms: FormRepresentation[];
  errors: {
    console: Array<{ level: string; text: string }>;
    network: Array<{ url: string; status: number; statusText: string }>;
  };
  interactive_summary?: InteractiveSummary;  // Present at minimal detail level
  reload_event?: ReloadEvent;                // Present when dev_serve detects file changes
  pending_dialog?: PendingDialog;            // Present when a JS dialog is blocking
  delta?: SnapshotDiff;                      // Present after interaction tools
}
```

### PageStructure

```typescript
interface PageStructure {
  landmarks: Landmark[];
  headings: Heading[];
  content_summary: string;                   // Structured count (summary), empty (minimal)
  full_content?: string;                     // All text nodes (full detail only)
}
```

### Landmark

```typescript
interface Landmark {
  id: string;            // Stable hash-based ID (e.g., "rgn-e0d2")
  role: string;          // ARIA landmark role (banner, main, navigation, contentinfo, etc.)
  label: string;         // Accessible name, or role as fallback
  bounds: Bounds;
}
```

### Heading

```typescript
interface Heading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  id: string;            // Stable element ID (e.g., "hdg-a3f1")
}
```

### Bounds

```typescript
interface Bounds {
  x: number;             // Left offset in viewport pixels
  y: number;             // Top offset in viewport pixels
  w: number;             // Width in pixels
  h: number;             // Height in pixels
}
```

### InteractiveElement

```typescript
interface InteractiveElement {
  id: string;            // Stable hash-based ID (e.g., "btn-a3f1")
  type: InteractiveElementType;
  label: string;         // Accessible name or visible text
  bounds: Bounds | null; // null if hidden or zero-sized
  state: ElementState;
  href?: string;         // Links only
  placeholder?: string;  // Inputs only
  value?: string;        // Current value
  options?: string[];    // Selects only
}

type InteractiveElementType =
  | "button" | "link" | "text_input" | "select"
  | "checkbox" | "radio" | "toggle" | "textarea"
  | "file_input" | "range" | "date_input" | "color_input";

interface ElementState {
  enabled?: boolean;
  visible?: boolean;
  focused?: boolean;
  checked?: boolean;     // Checkbox, radio, toggle
  expanded?: boolean;    // Collapsible elements
  selected?: boolean;    // Option or tab
  required?: boolean;
  invalid?: boolean;     // Validation error
}
```

### FormRepresentation

```typescript
interface FormRepresentation {
  id: string;            // Stable form ID (e.g., "frm-b1d4")
  action?: string;       // Form action URL
  method?: string;       // GET or POST
  fields: string[];      // Array of field element IDs
  submit: string | null; // Submit button element ID, or null
}
```

### ReloadEvent

```typescript
interface ReloadEvent {
  trigger: "file_change";
  files_changed: string[];
  timestamp: string;     // ISO 8601
}
```

### PendingDialog

```typescript
interface PendingDialog {
  type: "alert" | "confirm" | "prompt" | "beforeunload";
  message: string;
  default_value?: string;  // Only present for "prompt" dialogs
  timestamp: string;       // ISO 8601
}
```

Present in every tool response while a JavaScript dialog is blocking the page. Cleared only when the dialog is handled via `charlotte:dialog`.

### InteractiveSummary

```typescript
interface InteractiveSummary {
  total: number;
  by_landmark: Record<string, Record<string, number>>;
}
```

Present at minimal detail level. `by_landmark` keys match landmark format: `"role (label)"`, `"role"` for unlabeled, or `"(page root)"` for elements outside any landmark.

---

## Element Identity

### ID Format

```
{prefix}-{hex4}[-{disambiguator}]
```

Examples: `btn-a3f1`, `inp-c7e2`, `lnk-d4b9`, `btn-a3f1-2` (collision)

### Hash Function

MD5 of a composite key, truncated to 4 hex characters:

```typescript
hashToHex4(input: string): string {
  return createHash("md5").update(input).digest("hex").substring(0, 4);
}
```

### Composite Key

Seven components joined with `|`:

```
elementType | role | name | nearestLandmarkRole | nearestLandmarkLabel | nearestLabelledContainer | siblingIndex
```

| Component | Source |
|-----------|--------|
| `elementType` | Mapped from ARIA role (e.g., `"button"`, `"link"`) |
| `role` | Raw ARIA role string |
| `name` | Accessible name |
| `nearestLandmarkRole` | ARIA role of nearest ancestor landmark, or `""` |
| `nearestLandmarkLabel` | Label of nearest ancestor landmark, or `""` |
| `nearestLabelledContainer` | Label of nearest labeled container, or `""` |
| `siblingIndex` | Position among siblings of same type |

### Type Prefixes

| Element Type | Prefix |
|-------------|--------|
| `button` | `btn` |
| `link` | `lnk` |
| `text_input` | `inp` |
| `textarea` | `inp` |
| `file_input` | `inp` |
| `range` | `inp` |
| `date_input` | `inp` |
| `color_input` | `inp` |
| `select` | `sel` |
| `checkbox` | `chk` |
| `radio` | `rad` |
| `toggle` | `tog` |
| `static_text` | `txt` |
| `form` | `frm` |
| `region` | `rgn` |
| `heading` | `hdg` |
| *(fallback)* | `el` |

### Collision Handling

If a generated ID already exists, a numeric disambiguator is appended: `-2`, `-3`, etc.

### Atomic Swap

Each render creates a fresh `ElementIdGenerator`. After all IDs are assigned, `replaceWith()` atomically copies all maps from the new generator into the shared instance, avoiding any window where the shared generator is empty.

### Stale ID Recovery

When an element ID is not found in the current generator:

1. Trigger a fresh render with `detail: "minimal"`
2. Look up the ID again
3. If still not found, search for a similar element by prefix (same element type)

---

## Detail Levels

| Component | `minimal` | `summary` | `full` |
|-----------|-----------|-----------|--------|
| Landmarks | Yes | Yes | Yes |
| Headings | Yes | Yes | Yes |
| Interactive elements | Counts only (`interactive_summary`) | Full list | Full list |
| Forms | No | Yes | Yes |
| Content summary | No | Structured counts | Structured counts |
| Full text content | No | No | Yes |
| Console/network errors | Yes | Yes | Yes |

**Approximate token counts:** minimal ~200-500, summary ~500-1500, full varies with page content.

---

## Tools

All tools are prefixed with `charlotte:`. Every tool that returns page state calls `renderActivePage()` or `renderAfterAction()` and returns a formatted `PageRepresentation`.

### Navigation Tools

#### `charlotte:navigate`

Load a URL in the active page.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | `string` | Yes | — | URL to navigate to |
| `wait_for` | `"load" \| "domcontentloaded" \| "networkidle"` | No | `"load"` | Wait condition |
| `timeout` | `number` | No | `30000` | Max wait in ms |

**Returns:** PageRepresentation after navigation.

#### `charlotte:back`

Navigate back in browser history. No parameters.

#### `charlotte:forward`

Navigate forward in browser history. No parameters.

#### `charlotte:reload`

Reload the current page.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `hard` | `boolean` | No | `false` | Bypass cache |

### Observation Tools

#### `charlotte:observe`

Get current page state without performing any action.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `detail` | `"minimal" \| "summary" \| "full"` | No | `"summary"` | Verbosity level |
| `selector` | `string` | No | — | CSS selector to scope observation |
| `include_styles` | `boolean` | No | `false` | Include computed styles |

#### `charlotte:find`

Search for elements matching criteria.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `text` | `string` | No | — | Case-insensitive substring match |
| `role` | `string` | No | — | ARIA role filter |
| `type` | `string` | No | — | Element type filter |
| `near` | `string` | No | — | Element ID; find elements within ~200px |
| `within` | `string` | No | — | Element ID; find elements geometrically inside this element's bounds |

Spatial proximity uses Euclidean distance between element centers, threshold of 200px.

**Returns:** Array of matching `InteractiveElement` objects.

#### `charlotte:screenshot`

Capture a visual screenshot.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `selector` | `string` | No | — | CSS selector for specific element |
| `format` | `"png" \| "jpeg" \| "webp"` | No | `"png"` | Image format |
| `quality` | `number` | No | — | 1-100 for jpeg/webp |

**Returns:** Base64-encoded image.

#### `charlotte:diff`

Compare current page state to a previous snapshot.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `snapshot_id` | `number` | No | *(previous)* | Snapshot ID to compare against |
| `scope` | `"all" \| "structure" \| "interactive" \| "content"` | No | `"all"` | What to compare |

**Returns:** `SnapshotDiff` object (see [Snapshots and Diffs](#snapshots-and-diffs)).

### Interaction Tools

All interaction tools capture a pre-action snapshot and return a `PageRepresentation` with a `delta` diff attached.

#### `charlotte:click`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `element_id` | `string` | Yes | — | Target element ID |
| `click_type` | `"left" \| "right" \| "double"` | No | `"left"` | Click type |

Detects navigation triggered by the click and waits for page load if so.

#### `charlotte:type`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `element_id` | `string` | Yes | — | Target input element ID |
| `text` | `string` | Yes | — | Text to enter |
| `clear_first` | `boolean` | No | `true` | Clear existing value first |
| `press_enter` | `boolean` | No | `false` | Press Enter after typing |

#### `charlotte:select`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `element_id` | `string` | Yes | — | Target select element ID |
| `value` | `string` | Yes | — | Value or visible text of option |

#### `charlotte:toggle`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `element_id` | `string` | Yes | — | Target checkbox or switch element ID |

#### `charlotte:submit`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `form_id` | `string` | Yes | — | Form ID from page representation |

Prefers clicking the submit button if one exists; falls back to dispatching a `submit` event on the form element.

#### `charlotte:scroll`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `direction` | `"up" \| "down" \| "left" \| "right"` | Yes | — | Scroll direction |
| `amount` | `string` | No | `"page"` | `"page"`, `"half"`, or pixel value (e.g., `"200"`) |
| `element_id` | `string` | No | — | Container element to scroll within |

#### `charlotte:hover`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `element_id` | `string` | Yes | — | Target element ID |

#### `charlotte:drag`

Drag one element to another using mouse primitives (mousedown → intermediate moves → mouseup). Both `source_id` and `target_id` can reference interactive elements, landmarks, or headings — any element with an ID in the page representation.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `source_id` | `string` | Yes | — | Element ID of the drag source |
| `target_id` | `string` | Yes | — | Element ID of the drop target |

#### `charlotte:key`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `key` | `string` | Yes | — | Key name (e.g., `"Escape"`, `"Tab"`, `"Enter"`, `"ArrowDown"`, or a single character) |
| `modifiers` | `Array<"ctrl" \| "shift" \| "alt" \| "meta">` | No | `[]` | Modifier keys to hold |

#### `charlotte:wait_for`

Wait for a condition to be met on the page. At least one condition parameter is required.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `element_id` | `string` | No | — | Wait for element state change |
| `state` | `"visible" \| "hidden" \| "enabled" \| "disabled" \| "exists" \| "removed"` | No | — | Target element state |
| `text` | `string` | No | — | Wait for text to appear |
| `selector` | `string` | No | — | Wait for CSS selector to match |
| `js` | `string` | No | — | Wait for JS expression to return truthy |
| `timeout` | `number` | No | `10000` | Max wait in ms |

Polls every 100ms until the condition is met or timeout is reached.

### Dialog Handling Tools

#### `charlotte:dialog`

Handle a pending JavaScript dialog (alert, confirm, prompt, beforeunload).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `accept` | `boolean` | Yes | — | `true` to accept/OK, `false` to dismiss/Cancel |
| `prompt_text` | `string` | No | — | Text to enter for prompt dialogs before accepting |

**Returns:** `{ dialog_handled: { type, message, action }, page: PageRepresentation }`. The `dialog_handled` field confirms what was resolved.

**Error:** If no dialog is pending, returns `SESSION_ERROR` with suggestion to call `charlotte:observe`.

**Dialog lifecycle:**
1. A dialog appears (e.g., from a `click` that triggers `alert()`)
2. The action tool returns immediately with `pending_dialog` in the response
3. Agent calls `charlotte:dialog` to accept or dismiss
4. Response includes both `dialog_handled` metadata and the page state after resolution

### Monitoring Tools

#### `charlotte:console`

Retrieve console messages from the active page.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `level` | `"all" \| "log" \| "info" \| "warn" \| "error" \| "debug"` | No | `"all"` | Filter by log level |
| `clear` | `boolean` | No | `false` | Clear the message buffer after retrieval |

**Returns:** `{ messages, count, level, cleared }` where `messages` is an array of:

```typescript
interface ConsoleMessage {
  level: string;      // "log", "info", "warn", "error", "debug", etc.
  text: string;       // Message text
  timestamp: string;  // ISO 8601
}
```

Messages are captured from all console levels (not just errors). Buffer is capped at 1000 entries with FIFO eviction.

#### `charlotte:requests`

Retrieve network request history from the active page.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url_pattern` | `string` | No | — | Case-insensitive URL substring filter |
| `resource_type` | `string` | No | — | Filter by resource type (e.g., `"fetch"`, `"xhr"`, `"document"`, `"script"`) |
| `status_min` | `number` | No | — | Minimum HTTP status code (e.g., 400 for errors only) |
| `clear` | `boolean` | No | `false` | Clear the request buffer after retrieval |

**Returns:** `{ requests, count, cleared }` where `requests` is an array of:

```typescript
interface NetworkRequest {
  url: string;
  method: string;         // "GET", "POST", etc.
  status: number;         // HTTP status code
  statusText: string;
  resourceType: string;   // "document", "fetch", "xhr", "script", "stylesheet", etc.
  timestamp: string;      // ISO 8601
}
```

All HTTP responses are captured (not just errors). Buffer is capped at 1000 entries with FIFO eviction.

### Session Management Tools

#### `charlotte:tabs`

List all open browser tabs. No parameters.

**Returns:** Array of `{ id, url, title, active }` objects.

#### `charlotte:tab_open`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | `string` | No | — | URL to navigate to; blank page if omitted |

The new tab becomes the active tab.

#### `charlotte:tab_switch`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tab_id` | `string` | Yes | — | Tab ID to switch to |

#### `charlotte:tab_close`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tab_id` | `string` | Yes | — | Tab ID to close |

If the closed tab was active, switches to the first remaining tab.

#### `charlotte:viewport`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `width` | `number` | No | — | Viewport width in pixels |
| `height` | `number` | No | — | Viewport height in pixels |
| `device` | `"mobile" \| "tablet" \| "desktop"` | No | — | Device preset (overrides width/height) |

**Device presets:**

| Preset | Width | Height |
|--------|-------|--------|
| `mobile` | 375 | 667 |
| `tablet` | 768 | 1024 |
| `desktop` | 1280 | 720 |

Default viewport is `desktop` (1280x720).

#### `charlotte:network`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `throttle` | `"3g" \| "4g" \| "offline" \| "none"` | No | — | Network throttling preset |
| `block` | `string[]` | No | — | URL patterns to block (glob syntax). Empty array clears blocks. |

**Throttle presets:**

| Preset | Download | Upload | Latency |
|--------|----------|--------|---------|
| `3g` | 200 KB/s (1.6 Mbps) | 93.75 KB/s (750 kbps) | 150 ms |
| `4g` | 512 KB/s (4 Mbps) | 384 KB/s (3 Mbps) | 20 ms |
| `offline` | 0 | 0 | 0 |
| `none` | Unlimited | Unlimited | 0 |

#### `charlotte:set_cookies`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `cookies` | `Cookie[]` | Yes | — | Array of cookie objects |

Each cookie object:

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `name` | `string` | Yes | — |
| `value` | `string` | Yes | — |
| `domain` | `string` | Yes | — |
| `path` | `string` | No | `"/"` |
| `secure` | `boolean` | No | — |
| `httpOnly` | `boolean` | No | — |
| `sameSite` | `"Strict" \| "Lax" \| "None"` | No | — |

#### `charlotte:set_headers`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `headers` | `Record<string, string>` | Yes | — | Key-value header pairs |

Headers persist for all subsequent requests on the active page.

#### `charlotte:configure`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `snapshot_depth` | `number` | No | `50` | Ring buffer size (5-500) |
| `auto_snapshot` | `"every_action" \| "observe_only" \| "manual"` | No | `"every_action"` | Auto-snapshot mode |
| `screenshot_dir` | `string` | No | *(OS temp dir)* | Directory for persistent screenshot artifacts |
| `dialog_auto_dismiss` | `"none" \| "accept_alerts" \| "accept_all" \| "dismiss_all"` | No | `"none"` | Auto-dismiss behavior for JS dialogs |

See [Configuration](#configuration) for details.

### Development Mode Tools

#### `charlotte:dev_serve`

Serve a local directory as a static website with optional file watching and auto-reload.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | `string` | Yes | — | Local directory to serve |
| `port` | `number` | No | *(auto)* | Port to serve on |
| `watch` | `boolean` | No | `true` | Auto-reload on file changes |

When `watch` is enabled, file changes trigger a page reload. The resulting `ReloadEvent` is attached to the next tool response using single-consumption semantics: events accumulate between tool calls and are cleared on first read.

File watching uses chokidar with a `usePolling` option to handle systems with limited inotify watches.

#### `charlotte:dev_inject`

Inject CSS or JavaScript into the current page. At least one of `css` or `js` is required.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `css` | `string` | No | — | CSS to inject |
| `js` | `string` | No | — | JavaScript to execute |

**Returns:** PageRepresentation with delta diff showing what changed.

#### `charlotte:dev_audit`

Run accessibility and quality audits on the current page.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `checks` | `Array<"a11y" \| "performance" \| "seo" \| "contrast" \| "links">` | No | *(all)* | Categories to audit |

**Audit categories:**

| Category | Checks |
|----------|--------|
| `a11y` | Images without alt text, unlabeled buttons/links/inputs, heading hierarchy violations |
| `performance` | Unused CSS, large unoptimized images, layout thrashing, render-blocking resources |
| `seo` | Missing/empty title, missing meta description, canonical tag issues |
| `contrast` | WCAG 2.1 AA compliance: 4.5:1 for normal text, 3:1 for large text (>=24px or >=18.66px bold) |
| `links` | Broken links (404), redirect chains, missing href, external links without `rel="noopener"` |

**Returns:** Audit result with findings (each having severity, category, message, and element reference) and a summary.

### Utility Tools

#### `charlotte:evaluate`

Execute JavaScript in page context.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `expression` | `string` | Yes | — | JS expression to evaluate |
| `timeout` | `number` | No | `5000` | Max execution time in ms |
| `await_promise` | `boolean` | No | `true` | Await promises before returning |

**Returns:** `{ value, type }` with the serialized result.

---

## Snapshots and Diffs

### SnapshotStore

A ring buffer of past `PageRepresentation` objects.

| Property | Value |
|----------|-------|
| Default depth | 50 |
| Minimum depth | 5 |
| Maximum depth | 500 |
| ID sequence | Monotonically increasing from 1, never resets |
| Eviction | FIFO — oldest snapshot evicted when buffer is full |

```typescript
interface Snapshot {
  id: number;
  timestamp: string;
  representation: PageRepresentation;
}
```

### Auto-Snapshot Modes

| Mode | Behavior |
|------|----------|
| `every_action` | Snapshot after every tool call (default) |
| `observe_only` | Snapshot only on `charlotte:observe` |
| `manual` | No automatic snapshots |

### SnapshotDiff

```typescript
interface SnapshotDiff {
  from_snapshot: number;
  to_snapshot: number;
  changes: DiffChange[];
  summary: string;           // e.g., "5 changes: 2 added, 1 removed, 2 changed."
}

interface DiffChange {
  type: "added" | "removed" | "moved" | "changed";
  element?: string;          // Element ID
  detail?: string;           // Human-readable description
  property?: string;         // Property name (for "changed")
  from?: unknown;            // Previous value
  to?: unknown;              // New value
}
```

### Diff Scopes

| Scope | Compares |
|-------|----------|
| `all` | Structure + interactive + content |
| `structure` | Landmarks and headings only |
| `interactive` | Interactive elements and forms only |
| `content` | Content summary, URL, title only |

### Diff Algorithm

- **Landmarks** are keyed by `role:label`
- **Headings**, **interactive elements**, and **forms** are keyed by element ID
- **Change types:** `added` (present only in new), `removed` (present only in old), `moved` (bounds changed), `changed` (property value changed)
- **Form comparison** includes field array membership changes

---

## Configuration

```typescript
interface CharlotteConfig {
  snapshotDepth: number;                    // Default: 50, range: 5-500
  autoSnapshot: AutoSnapshotMode;           // Default: "every_action"
  dialogAutoDismiss: DialogAutoDismiss;     // Default: "none"
  screenshotDir?: string;                   // Default: OS temp dir
}

type AutoSnapshotMode = "every_action" | "observe_only" | "manual";
type DialogAutoDismiss = "none" | "accept_alerts" | "accept_all" | "dismiss_all";
```

Runtime configuration is modified via the `charlotte:configure` tool. Changes take effect immediately.

### Browser Configuration

Charlotte launches Chromium with:
- `--no-sandbox`
- `--disable-setuid-sandbox`
- `--disable-gpu`
- `--disable-dev-shm-usage`

Default viewport: 1280x720 (desktop preset).

---

## Error Handling

### Error Codes

| Code | Description |
|------|-------------|
| `ELEMENT_NOT_FOUND` | Element ID does not exist in the current page |
| `ELEMENT_NOT_INTERACTIVE` | Element exists but cannot be interacted with |
| `NAVIGATION_FAILED` | Page navigation failed |
| `TIMEOUT` | Operation exceeded its timeout |
| `EVALUATION_ERROR` | JavaScript evaluation failed |
| `SESSION_ERROR` | Browser session issue (not connected, tab not found, etc.) |
| `SNAPSHOT_EXPIRED` | Requested snapshot has been evicted from the ring buffer |

### Error Response Format

```json
{
  "error": {
    "code": "ELEMENT_NOT_FOUND",
    "message": "No element found with ID 'btn-a3f1'",
    "suggestion": "The page may have changed. Try observe() to get current element IDs."
  }
}
```

The `suggestion` field is optional and provides actionable guidance for recovery.

### Error Collection

Charlotte automatically collects errors from the page and includes them in every `PageRepresentation`:

- **Console errors:** `console.error()` and `console.warn()` messages
- **Network errors:** HTTP responses with status >= 400

These error summaries are a subset of the full monitoring data. Use `charlotte:console` to retrieve all console messages (including log, info, debug) and `charlotte:requests` to retrieve all HTTP responses (including successful ones). Both tools support filtering and buffer clearing.

Errors accumulate across renders and are not automatically cleared.
