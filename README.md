# Charlotte

**The Web, Readable.**

Charlotte is an MCP server that renders web pages into structured, agent-readable representations using headless Chromium. It exposes the browser's semantic understanding — accessibility tree, layout geometry, interactive elements — to AI agents via [Model Context Protocol](https://modelcontextprotocol.io/) tools, enabling navigation, observation, and interaction without vision models or brittle selectors.

## How It Works

Charlotte maintains a persistent headless Chromium session and acts as a translation layer between the visual web and the agent's text-native reasoning. Every page is decomposed into a structured representation:

```
┌─────────────┐     MCP Protocol     ┌──────────────────┐
│   AI Agent  │<───────────────────> │    Charlotte     │
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

**Session Management** — `tabs`, `tab_open`, `tab_switch`, `tab_close`, `viewport` (device presets), `network` (throttling, URL blocking), `set_cookies`, `set_headers`, `configure`, `get_cookies` (in progress), `clear_cookies` (in progress)

**Development Mode** — `dev_serve` (static server + file watching with auto-reload), `dev_inject` (CSS/JS injection), `dev_audit` (a11y, performance, SEO, contrast, broken links)

**Utilities** — `evaluate` (arbitrary JS execution in page context)

## Quick Start

### Prerequisites

- Node.js >= 22
- npm

### Installation

Charlotte is published on npm as [`@ticktockbent/charlotte`](https://www.npmjs.com/package/@ticktockbent/charlotte):

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
observe({ detail: "summary" })
find({ type: "link", text: "About" })
click({ element_id: "lnk-a3f1" })
```

### Fill out a form

```
observe({ detail: "minimal" })
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

Charlotte returns structured representations optimized for token efficiency:

```json
{
  "url": "https://example.com/dashboard",
  "title": "Dashboard",
  "viewport": { "width": 1280, "height": 720 },
  "snapshot_id": 1,
  "structure": {
    "landmarks": [
      { "role": "banner", "label": "Site header", "bounds": { "x": 0, "y": 0, "w": 1280, "h": 64 } },
      { "role": "main", "label": "Content", "bounds": { "x": 240, "y": 64, "w": 1040, "h": 656 } }
    ],
    "headings": [
      { "level": 1, "text": "Dashboard", "id": "h-1" }
    ],
    "content_summary": "main: 2 headings, 5 links, 1 form"
  },
  "interactive": [
    {
      "id": "btn-a3f1",
      "type": "button",
      "label": "Create Project",
      "bounds": { "x": 960, "y": 80, "w": 160, "h": 40 },
      "state": { "enabled": true, "visible": true }
    }
  ],
  "forms": [],
  "alerts": [],
  "errors": { "console": [], "network": [] }
}
```

Detail levels control verbosity:
- **`minimal`** (~200-500 tokens) — Landmarks + interactive elements only
- **`summary`** (~500-1500 tokens) — Adds content summaries, forms, errors
- **`full`** (variable) — Includes all visible text content

## Element IDs

Element IDs are stable across minor DOM mutations. They're generated by hashing a composite key of element type, ARIA role, accessible name, and DOM path signature:

```
btn-a3f1  (button)    inp-c7e2  (text input)
lnk-d4b9  (link)      sel-e8a3  (select)
chk-f1a2  (checkbox)  frm-b1d4  (form)
```

IDs survive unrelated DOM changes and element reordering within the same container.

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

## Roadmap

**Cookie Management** — `get_cookies` and `clear_cookies` tools are in progress, addressing a feature gap in cookie management. Currently Charlotte can set cookies via `set_cookies`, but agents have no way to inspect existing cookies or selectively clear them. The new tools will complete the cookie lifecycle.

**Screenshot Artifacts** — Save screenshots as persistent file artifacts rather than only returning inline data, enabling agents to reference and manage captured images across sessions.

**Video Recording** — Record interactions as video, capturing the full sequence of agent-driven navigation and manipulation for debugging, documentation, and review.

## Full Specification

See [docs/CHARLOTTE_SPEC.md](docs/CHARLOTTE_SPEC.md) for the complete specification including all tool parameters, the page representation format, element identity strategy, and architecture details.

## License

[MIT](LICENSE)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.
