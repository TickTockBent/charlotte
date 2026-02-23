# Charlotte

**The Web, Readable.**

Charlotte is an MCP server that renders web pages into structured, agent-readable representations using headless Chromium. It exposes the browser's semantic understanding — accessibility tree, layout geometry, interactive elements — to AI agents via [Model Context Protocol](https://modelcontextprotocol.io/) tools, enabling navigation, observation, and interaction without vision models or brittle selectors.

## Why Charlotte?

Most browser MCP servers dump the entire accessibility tree on every call — a flat text blob that can exceed a million characters on content-heavy pages. Agents pay for all of it whether they need it or not.

Charlotte takes a different approach. It decomposes each page into a typed, structured representation — landmarks, headings, interactive elements, forms, content summaries — and lets agents control how much they receive with three detail levels. When an agent navigates to a new page, it gets a compact orientation (336 characters for Hacker News) instead of the full element dump (61,000+ characters). When it needs specifics, it asks for them.

### Benchmarks

Charlotte v0.2.0 vs Playwright MCP, measured by characters returned per tool call on real websites:

**Navigation** (first contact with a page):

| Site | Charlotte `navigate` | Playwright `browser_navigate` |
|:---|---:|---:|
| example.com | 612 | 817 |
| Wikipedia (AI article) | 7,667 | 1,040,636 |
| Hacker News | 336 | 61,230 |
| GitHub repo | 3,185 | 80,297 |

Charlotte's `navigate` returns minimal detail by default — landmarks, headings, and interactive element counts grouped by page region. Enough to orient, not enough to overwhelm. On Wikipedia, that's **135x smaller** than Playwright's response.

**Observation** (when the agent needs full detail):

| Site | Charlotte `observe` | Playwright `browser_snapshot` |
|:---|---:|---:|
| example.com | 612 | 498 |
| Wikipedia (AI article) | 521,127 | 1,040,878 |
| Hacker News | 30,781 | 61,143 |
| GitHub repo | 37,628 | 80,190 |

Even at full summary detail, Charlotte's structured format is **~2x smaller** than Playwright's raw accessibility dump — while providing typed metadata, form structures, and content summaries that a flat tree doesn't.

**The workflow difference:** Playwright agents receive 61K+ characters every time they look at Hacker News, whether they're reading headlines or looking for a login button. Charlotte agents get 336 characters on arrival, call `find({ type: "link", text: "login" })` to get exactly what they need, and never pay for the rest.

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

**Observation** — `observe` (3 detail levels), `find` (spatial + semantic search), `screenshot`, `diff` (structural comparison against snapshots)

**Interaction** — `click`, `type`, `select`, `toggle`, `submit`, `scroll`, `hover`, `key`, `wait_for` (async condition polling)

**Session Management** — `tabs`, `tab_open`, `tab_switch`, `tab_close`, `viewport` (device presets), `network` (throttling, URL blocking), `set_cookies`, `get_cookies`, `clear_cookies`, `set_headers`, `configure`

**Development Mode** — `dev_serve` (static server + file watching with auto-reload), `dev_inject` (CSS/JS injection), `dev_audit` (a11y, performance, SEO, contrast, broken links)

**Utilities** — `evaluate` (arbitrary JS execution in page context)

## Quick Start

### Prerequisites

- Node.js >= 22
- npm

### Installation

Charlotte is listed on the [MCP Registry](https://registry.modelcontextprotocol.io) as `io.github.TickTockBent/charlotte` and published on npm as [`@ticktockbent/charlotte`](https://www.npmjs.com/package/@ticktockbent/charlotte):

```bash
npm install -g @ticktockbent/charlotte
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
# If installed globally
charlotte

# If installed from source
npm start
```

### MCP Client Configuration

Add Charlotte to your MCP client configuration. For Claude Code, create `.mcp.json` in your project root:

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

For Claude Desktop, add to `claude_desktop_config.json`:

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

## Usage Examples

Once connected, an agent can use Charlotte's tools:

### Browse a website

```
navigate({ url: "https://example.com" })
// → 612 chars: landmarks, headings, interactive element counts

find({ type: "link", text: "More information" })
// → just the matching element with its ID

click({ element_id: "lnk-a3f1" })
```

### Fill out a form

```
navigate({ url: "https://httpbin.org/forms/post" })
find({ type: "text_input" })
type({ element_id: "inp-c7e2", text: "hello@example.com" })
select({ element_id: "sel-e8a3", value: "option-2" })
submit({ form_id: "frm-b1d4" })
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
    "headings": [{ "level": 1, "text": "Hacker News", "id": "h-a1b2" }]
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
      { "role": "banner", "label": "Site header", "bounds": { "x": 0, "y": 0, "w": 1280, "h": 64 } },
      { "role": "main", "label": "Content", "bounds": { "x": 240, "y": 64, "w": 1040, "h": 656 } }
    ],
    "headings": [{ "level": 1, "text": "Dashboard", "id": "h-1a2b" }],
    "content_summary": "main: 2 headings, 5 links, 1 form"
  },
  "interactive": [
    {
      "id": "btn-a3f1",
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
btn-a3f1  (button)    inp-c7e2  (text input)
lnk-d4b9  (link)      sel-e8a3  (select)
chk-f1a2  (checkbox)  frm-b1d4  (form)
```

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

All tools go through `renderActivePage()` which handles snapshots, reload events, and response formatting.

## Sandbox

Charlotte includes a test website in `tests/sandbox/` that exercises all 30 tools without touching the public internet. Serve it locally with:

```
dev_serve({ path: "tests/sandbox" })
```

Four pages cover navigation, forms, interactive elements, delayed content, scroll containers, and more. See [docs/sandbox.md](docs/sandbox.md) for the full page reference and a tool-by-tool exercise checklist.

## Known Issues

**Tool naming convention** — Charlotte uses `:` as a namespace separator in tool names (e.g., `charlotte:navigate`, `charlotte:observe`). MCP SDK v1.26.0+ logs validation warnings for this character, as the emerging [SEP standard](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/986) restricts tool names to `[A-Za-z0-9_.-]`. This does not affect functionality — all tools work correctly — but produces stderr warnings on server startup. Will be addressed in a future release to comply with the SEP standard.

## Roadmap

**Screenshot Artifacts** — Save screenshots as persistent file artifacts rather than only returning inline data, enabling agents to reference and manage captured images across sessions.

**Video Recording** — Record interactions as video, capturing the full sequence of agent-driven navigation and manipulation for debugging, documentation, and review.

**ARM64 Docker Images** — Add `linux/arm64` platform support to the Docker publish workflow for native performance on Apple Silicon Macs and ARM servers.

## Full Specification

See [docs/CHARLOTTE_SPEC.md](docs/CHARLOTTE_SPEC.md) for the complete specification including all tool parameters, the page representation format, element identity strategy, and architecture details.

## License

[MIT](LICENSE)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.
