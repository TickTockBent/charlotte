# Charlotte

**The Web, Readable.**

Your AI agent burns ~60,000 characters of accessibility tree just to look at the Hacker News front page. Charlotte does it in 337.

Charlotte is an MCP server that gives AI agents structured, token-efficient access to the web.
Instead of dumping the full accessibility tree on every call, Charlotte returns only what
the agent needs: a compact page summary on arrival, targeted queries for specific elements,
and full detail only when explicitly requested. On content-heavy pages that orientation is
up to ~180x smaller than a full accessibility-tree snapshot from [Playwright MCP](https://github.com/microsoft/playwright-mcp); on trivially small pages the two are roughly the same size.

## Why Charlotte?

Most browser MCP servers dump the entire accessibility tree on every call — a flat text blob that can exceed a million characters on content-heavy pages. Agents pay for all of it whether they need it or not.

Charlotte decomposes each page into a typed, structured representation — landmarks, headings, interactive elements, forms, content summaries — and lets agents control how much they receive with three detail levels. When an agent navigates to a new page, it gets a compact orientation (337 characters for Hacker News) instead of the full element dump (~60,000 characters). When it needs specifics, it asks for them.

### Benchmarks

Measured on Charlotte v0.7.0 against [Playwright MCP](https://github.com/microsoft/playwright-mcp) v0.0.75, by characters returned per tool call on real websites (`npx tsx benchmarks/run-benchmarks.ts --suite comparison`). Raw results: [`benchmarks/results/raw/v0.7.0/`](benchmarks/results/raw/v0.7.0/).

**Orientation cost** (what an agent pays to "see" a page on arrival):

A Charlotte `navigate` returns a usable orientation by default — landmarks, headings, and interactive element counts grouped by page region. To get the equivalent with Playwright MCP, an agent calls `browser_snapshot`, which returns the full accessibility tree. (Playwright's `browser_navigate` alone returns only a short confirmation, not the page content, so it isn't a like-for-like comparison.)

| Site | Charlotte `navigate` | Playwright `browser_snapshot` | Smaller by |
|:---|---:|---:|---:|
| example.com | 388 | 465 | 1.2x |
| httpbin form | 592 | 1,925 | 3.3x |
| GitHub repo | 3,559 | 81,835 | 23x |
| Wikipedia (AI article) | 8,571 | 1,049,228 | 122x |
| Hacker News | 337 | 59,996 | 178x |

The advantage scales with page complexity: on content-heavy pages the structured orientation is **23–178x smaller** than the full snapshot, while on a trivially small page like example.com the two are within ~20% of each other (and on a page that small, the structured representation can be the larger of the two — there is simply nothing to summarize away). Charlotte's value shows up precisely where Playwright's flat dump hurts most. When an agent needs more than the orientation, it calls `observe` or `find` for exactly the part it wants instead of paying for the whole tree up front.

**Tool definition overhead** (invisible cost per API call):

| Profile | Tools | Def. tokens/call | Savings vs full |
|:---|---:|---:|---:|
| full | 43 | 9,297 | — |
| browse (default) | 23 | 4,785 | **~49%** |
| core | 7 | 2,323 | **~75%** |

Tool definitions are sent on every API round-trip. With the default `browse` profile, Charlotte carries ~49% less definition overhead than loading all 43 tools; the minimal `core` profile cuts it by ~75%. See the [profile benchmark report](docs/charlotte-profile-benchmark-report.md) for full results.

**The workflow difference:** A Playwright agent that reads the full snapshot receives ~60,000 characters every time it looks at Hacker News, whether it's reading headlines or hunting for a login button. A Charlotte agent gets 337 characters on arrival, calls `find({ type: "link", text: "login" })` to get exactly what it needs, and never pays for the rest.

## How It Works

Charlotte maintains a persistent headless Chromium session and acts as a translation layer between the visual web and the agent's text-native reasoning. Every page is decomposed into a structured representation:

```
┌─────────────┐     MCP Protocol     ┌──────────────────┐
│   AI Agent  │<────────────────────>│    Charlotte     │
└─────────────┘                      │                  │
                                     │  ┌────────────┐  │
                                     │  │  Renderer  │  │
                                     │  │  Pipeline  │  │
                                     │  └─────┬──────┘  │
                                     │        │         │
                                     │  ┌─────▼──────┐  │
                                     │  │  Headless  │  │
                                     │  │  Chromium  │  │
                                     │  └────────────┘  │
                                     └──────────────────┘
```

Agents receive landmarks, headings, interactive elements with typed metadata, bounding boxes, form structures, and content summaries — all derived from what the browser already knows about every page.

## Features

**Navigation** — `navigate`, `back`, `forward`, `reload`

**Observation** — `observe` (3 detail levels, structural tree view), `find` (spatial + semantic search, CSS selector mode, `output_file` for large result sets), `screenshot` (with persistent artifact management), `screenshots`, `screenshot_get`, `screenshot_delete`, `diff` (structural comparison against snapshots)

**Interaction** (iframe-aware) — `click`, `click_at` (coordinate-based), `type` (with slow typing support), `select`, `toggle`, `submit`, `scroll`, `hover`, `drag`, `key` (single/sequence with element targeting), `wait_for` (async condition polling), `upload` (file input), `fill_form` (batch form fill), `dialog` (accept/dismiss JS dialogs)

**Monitoring** — `console` (all severity levels, filtering, timestamps), `requests` (full HTTP history, method/status/resource type filtering)

**Session Management** — `tabs`, `tab_open`, `tab_switch`, `tab_close`, `viewport` (device presets), `network` (throttling, URL blocking), `set_cookies`, `get_cookies`, `clear_cookies`, `set_headers`, `configure`

**Development Mode** — `dev_serve` (static server + file watching with auto-reload), `dev_inject` (CSS/JS injection), `dev_audit` (a11y, performance, SEO, contrast, broken links)

**Utilities** — `evaluate` (arbitrary JS execution in page context)

## Tool Profiles

Charlotte ships 43 tools (42 registered + the `charlotte_tools` meta-tool), but most workflows only need a subset. Startup profiles control which tools load into the agent's context, reducing definition overhead by up to 78%.

```bash
charlotte --profile browse    # 23 tools (default) — navigate, observe, interact, tabs
charlotte --profile core      # 7 tools — navigate, observe, find, click, type, submit
charlotte --profile full      # 43 tools — everything
charlotte --profile interact  # 31 tools — full interaction + dialog + evaluate
charlotte --profile develop   # 34 tools — interact + dev_serve, dev_inject, dev_audit
charlotte --profile audit     # 14 tools — navigation + observation + dev_audit + viewport
```

Agents can activate more tools mid-session without restarting:

```
charlotte_tools enable dev_mode    → activates dev_serve, dev_audit, dev_inject
charlotte_tools disable dev_mode   → deactivates them
charlotte_tools list               → see what's loaded
```

## Quick Start

### Prerequisites

- Node.js >= 20
- npm

### Installation

Charlotte is listed on the [MCP Registry](https://registry.modelcontextprotocol.io) as `io.github.TickTockBent/charlotte` and published on npm as [`@ticktockbent/charlotte`](https://www.npmjs.com/package/@ticktockbent/charlotte):

```bash
npm install -g @ticktockbent/charlotte
```

Docker images are available on [Docker Hub](https://hub.docker.com/r/ticktockbent/charlotte) and [GitHub Container Registry](https://github.com/ticktockbent/charlotte/pkgs/container/charlotte):

```bash
# Alpine (default, smaller)
docker pull ticktockbent/charlotte:alpine

# Debian (if you need glibc compatibility)
docker pull ticktockbent/charlotte:debian

# Or from GHCR
docker pull ghcr.io/ticktockbent/charlotte:latest
```

Or install from source:

```bash
git clone https://github.com/ticktockbent/charlotte.git
cd charlotte
npm install
npm run build
```

### Run

Charlotte communicates over stdio using the MCP protocol:

```bash
# If installed globally (default browse profile)
charlotte

# With a specific profile
charlotte --profile core

# If installed from source
npm start
```

### MCP Client Configuration

#### Claude Code

Create `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "charlotte": {
      "type": "stdio",
      "command": "npx",
      "args": ["@ticktockbent/charlotte"],
      "env": {}
    }
  }
}
```

#### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "charlotte": {
      "command": "npx",
      "args": ["@ticktockbent/charlotte"]
    }
  }
}
```

#### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "charlotte": {
      "command": "npx",
      "args": ["@ticktockbent/charlotte"]
    }
  }
}
```

#### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "charlotte": {
      "command": "npx",
      "args": ["@ticktockbent/charlotte"]
    }
  }
}
```

#### VS Code (Copilot)

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "charlotte": {
      "type": "stdio",
      "command": "npx",
      "args": ["@ticktockbent/charlotte"]
    }
  }
}
```

#### Cline

Add to Cline MCP settings (via the Cline sidebar > MCP Servers > Configure):

```json
{
  "mcpServers": {
    "charlotte": {
      "command": "npx",
      "args": ["@ticktockbent/charlotte"]
    }
  }
}
```

#### Amp

Add to `~/.amp/settings.json`:

```json
{
  "mcpServers": {
    "charlotte": {
      "command": "npx",
      "args": ["@ticktockbent/charlotte"]
    }
  }
}
```

See [docs/mcp-setup.md](docs/mcp-setup.md) for the full setup guide, including development mode, generic MCP clients, verification steps, and troubleshooting.

## Configuration

Charlotte resolves settings from four sources, highest precedence first: **CLI arguments → environment variables → config file → built-in defaults**. See [docs/configuration.md](docs/configuration.md) for the complete reference.

### Config file

Pass a JSON config file with `--config`, or drop a `charlotte.config.json` in the working directory and Charlotte loads it automatically:

```bash
charlotte --config charlotte.config.json
```

```json
{
  "browser": { "headless": true, "noSandbox": false },
  "tools": { "profile": "browse" },
  "rendering": { "includeIframes": false, "iframeDepth": 3 },
  "output": { "dir": "./charlotte-output" },
  "limits": {
    "maxInteractiveElements": 2000,
    "maxFullContentChars": 200000,
    "maxResponseBytes": 1000000,
    "maxEvaluateBytes": 256000
  }
}
```

Every section is optional; an empty `{}` is valid. The file is validated with zod — unknown keys, wrong types, or invalid enum values produce a clear startup error on stderr and Charlotte exits non-zero. Three settings also have environment variables: `CHARLOTTE_NO_SANDBOX`, `CHARLOTTE_OUTPUT_DIR`, and `CHARLOTTE_CDP_ENDPOINT`.

### The Chromium sandbox is on by default

> **v0.7.0 behavior change:** Earlier releases baked `--no-sandbox` into every Chromium launch. As of v0.7.0 the **Chromium sandbox is enabled by default** — the primary defense between an untrusted page and the account Charlotte runs as. You must opt out explicitly where the kernel sandbox is unavailable.

```bash
charlotte --no-sandbox                  # CLI flag
CHARLOTTE_NO_SANDBOX=1 charlotte        # environment variable
# or "browser": { "noSandbox": true }   in the config file
```

**Migration note (Docker / bare-metal):** Containers usually cannot set up the kernel sandbox, so the provided Dockerfiles set `CHARLOTTE_NO_SANDBOX=1` for you, and `docker-compose.yml` now keeps Docker's default seccomp filter (it no longer runs `seccomp=unconfined`). If you run Charlotte **bare-metal as root**, Chromium refuses to launch with the sandbox enabled — run as a non-root user (recommended) or pass `--no-sandbox`. Existing setups that previously relied on the implicit `--no-sandbox` and run in an environment where the sandbox can't initialize must now set `CHARLOTTE_NO_SANDBOX=1` (or the flag/config equivalent) to keep working.

### Output-size limits

The `limits.*` keys bound how much a single tool response can return so a pathological page (100k links, an infinite-scroll feed, a giant document body) cannot overflow the agent's context window. When a page response exceeds `maxResponseBytes` it degrades to a compact summary and suggests writing the full result to disk via `output_file`; `charlotte_evaluate` results are capped independently by `maxEvaluateBytes`. Truncated responses carry a `truncation` marker. See [docs/configuration.md](docs/configuration.md#output-size-limits-limits) for the keys and defaults.

### Crash recovery

A Chromium crash no longer wedges the server. The next tool call automatically relaunches the browser, clears the dead tab and CDP-session caches, and opens a fresh blank tab — so an agent can keep working after a renderer crash without restarting the MCP server.

## Usage Examples

Once connected, an agent can use Charlotte's tools:

### Browse a website

```
navigate({ url: "https://example.com" })
// → 612 chars: landmarks, headings, interactive element counts

find({ type: "link", text: "More information" })
// → just the matching element with its ID

click({ element_id: "lnk-a3f1c2" })
```

### Fill out a form

```
navigate({ url: "https://httpbin.org/forms/post" })
find({ type: "text_input" })
type({ element_id: "inp-c7e29b", text: "hello@example.com" })
select({ element_id: "sel-e8a3f5", value: "option-2" })
submit({ form_id: "frm-b1d4e7" })
```

### Local development feedback loop

```
dev_serve({ path: "./my-site", watch: true })
observe({ detail: "full" })
dev_audit({ checks: ["a11y", "contrast"] })
dev_inject({ css: "body { font-size: 18px; }" })
```

## Page Representation

Charlotte returns structured representations with three detail levels that let agents control how much context they consume:

### Minimal (default for `navigate`)

Landmarks, headings, and interactive element counts grouped by page region. Designed for orientation — "what's on this page?" — without listing every element.

```json
{
  "url": "https://news.ycombinator.com",
  "title": "Hacker News",
  "viewport": { "width": 1280, "height": 720 },
  "structure": {
    "headings": [{ "level": 1, "text": "Hacker News", "id": "hdg-a1b2c3" }]
  },
  "interactive_summary": {
    "total": 93,
    "by_landmark": {
      "(page root)": { "link": 91, "text_input": 1, "button": 1 }
    }
  }
}
```

### Summary (default for `observe`)

Full interactive element list with typed metadata, form structures, and content summaries.

```json
{
  "url": "https://example.com/dashboard",
  "title": "Dashboard",
  "viewport": { "width": 1280, "height": 720 },
  "structure": {
    "landmarks": [
      { "id": "rgn-b2c1d0", "role": "banner", "label": "Site header", "bounds": { "x": 0, "y": 0, "w": 1280, "h": 64 } },
      { "id": "rgn-d4e5f6", "role": "main", "label": "Content", "bounds": { "x": 240, "y": 64, "w": 1040, "h": 656 } }
    ],
    "headings": [{ "level": 1, "text": "Dashboard", "id": "hdg-1a2b3c" }],
    "content_summary": "main: 2 headings, 5 links, 1 form"
  },
  "interactive": [
    {
      "id": "btn-a3f1c2",
      "type": "button",
      "label": "Create Project",
      "bounds": { "x": 960, "y": 80, "w": 160, "h": 40 },
      "state": {}
    }
  ],
  "forms": []
}
```

### Full

Everything in summary, plus all visible text content on the page.

## Detail Levels

| Level | Tokens | Use case |
|:---|:---|:---|
| `minimal` | ~50-200 | Orientation after navigation. What regions exist? How many interactive elements? |
| `summary` | ~500-5000 | Working with the page. Full element list, form structures, content summaries. |
| `full` | variable | Reading page content. All visible text included. |

Navigation tools default to `minimal`. The `observe` tool defaults to `summary`. Both accept an optional `detail` parameter to override.

## Element IDs

Element IDs are stable across minor DOM mutations. They're generated by hashing a composite key of element type, ARIA role, accessible name, and DOM path signature:

```
btn-a3f1c2  (button)    inp-c7e29b  (text input)
lnk-d4b910  (link)      sel-e8a3f5  (select)
chk-f1a204  (checkbox)  frm-b1d4e7  (form)
rgn-e0d2a8  (landmark)  hdg-0f4063  (heading)
dom-b2c3d9  (DOM element, from CSS selector queries)
```

> **v0.7.0 ID format change:** element-ID hashes are now **6 hex characters** (e.g. `btn-a3f1c2`), up from 4 in earlier releases. This drastically reduces cross-element hash collisions on large pages. Agents that hard-coded or pattern-matched 4-character IDs should re-`find` elements rather than reuse cached IDs across the upgrade.

IDs survive unrelated DOM changes and element reordering within the same container. When an agent navigates at minimal detail (no individual element IDs), it uses `find` to locate elements by text, type, or spatial proximity — the returned elements include IDs ready for interaction.

## Development

```bash
# Run in watch mode
npm run dev

# Run all tests
npm test

# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration

# Type check
npx tsc --noEmit
```

### Project Structure

```
src/
  browser/          # Puppeteer lifecycle, tab management, CDP sessions
  renderer/         # Accessibility tree extraction, layout, content, element IDs
  state/            # Snapshot store, structural differ
  tools/            # MCP tool definitions (navigation, observation, interaction, session, dev-mode)
  dev/              # Static server, file watcher, auditor
  types/            # TypeScript interfaces
  utils/            # Logger, hash, wait utilities
tests/
  unit/             # Fast tests with mocks
  integration/      # Full Puppeteer tests against fixture HTML
  fixtures/pages/   # Test HTML files
```

### Architecture

The **Renderer Pipeline** is the core — it calls extractors in order and assembles a `PageRepresentation`:

1. Accessibility tree extraction (CDP `Accessibility.getFullAXTree`)
2. Layout extraction (CDP `DOM.getBoxModel`)
3. Landmark, heading, interactive element, and content extraction
4. Element ID generation (hash-based, stable across re-renders)

All tools go through `renderActivePage()` which handles snapshots, reload events, dialog detection, and response formatting.

## Sandbox

Charlotte includes a test website in `tests/sandbox/` that exercises all tools without touching the public internet. Serve it locally with:

```
dev_serve({ path: "tests/sandbox" })
```

Five pages cover navigation, forms, interactive elements, popups, delayed content, scroll containers, and more. See [docs/sandbox.md](docs/sandbox.md) for the full page reference and a tool-by-tool exercise checklist.

## Known Issues

**Shadow DOM** — Open shadow DOM works transparently. Chromium's accessibility tree pierces open shadow boundaries, so web components (e.g., GitHub's `<relative-time>`, `<tool-tip>`) render their content into Charlotte's representation without special handling. Closed shadow roots are opaque to the accessibility tree and will not be captured.

## Roadmap

### Session & Configuration

**Persistent Init Scripts** — Add a `--init-script` CLI argument to inject JavaScript on every page load via `page.evaluateOnNewDocument()`. Charlotte's `dev_inject` currently applies CSS/JS once and does not persist across navigations.

**Full Device Emulation** — Extend `charlotte_viewport` to accept named devices (e.g., "iPhone 15") and configure user agent, touch support, and device pixel ratio via CDP, not just viewport dimensions.

### Feature Roadmap

**Video Recording** — Record interactions as video, capturing the full sequence of agent-driven navigation and manipulation for debugging, documentation, and review.

**ARM64 Docker Images** — Add `linux/arm64` platform support to the Docker publish workflow for native performance on Apple Silicon Macs and ARM servers.

See [docs/playwright-mcp-gap-analysis.md](docs/playwright-mcp-gap-analysis.md) for the full gap analysis against Playwright MCP, including lower-priority items (vision tools, testing/verification, tracing, transport, security) and areas where Charlotte has advantages.

## Full Specification

See [docs/CHARLOTTE_SPEC.md](docs/CHARLOTTE_SPEC.md) for the complete specification including all tool parameters, the page representation format, element identity strategy, and architecture details.

## License

[MIT](LICENSE)

## Community

- Open a [bug report](https://github.com/TickTockBent/charlotte/issues/new?template=bug_report.md) for reproducible defects, regressions, or MCP-client-specific problems.
- Open a [feature request](https://github.com/TickTockBent/charlotte/issues/new?template=feature_request.md) for workflow improvements or new capabilities.
- Open a [tool request](https://github.com/TickTockBent/charlotte/issues/new?template=tool_request.md) if you want to propose a new tool, parameter surface, or profile placement.
- Browse [open issues](https://github.com/TickTockBent/charlotte/issues) to find current work and discussion.
- Check the planned [good first issue filter](https://github.com/TickTockBent/charlotte/issues?q=is%3Aopen+label%3A%22good+first+issue%22) as maintainers tag starter-friendly tasks.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

*Part of a growing suite of literary-named MCP servers. See more at [github.com/TickTockBent](https://github.com/TickTockBent).*
