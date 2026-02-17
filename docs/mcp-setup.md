# MCP Setup Guide

Charlotte is an MCP server that communicates over stdio. It reads JSON-RPC requests from stdin, writes responses to stdout, and logs to stderr. Any MCP-compatible client can connect to it.

## Prerequisites

- Node.js >= 22
- npm

```bash
git clone https://github.com/ticktockbent/charlotte.git
cd charlotte
npm install
npm run build
```

## Claude Code

Create a `.mcp.json` file in your project root (or in the Charlotte repo root):

```json
{
  "mcpServers": {
    "charlotte": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/charlotte/dist/index.js"],
      "env": {}
    }
  }
}
```

Claude Code reads `.mcp.json` automatically when you start a session in that directory. Charlotte's tools will appear with the `charlotte:` prefix (e.g., `charlotte:navigate`, `charlotte:observe`).

**From source (development):**

```json
{
  "mcpServers": {
    "charlotte": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/charlotte/src/index.ts"],
      "env": {}
    }
  }
}
```

This runs TypeScript directly via `tsx` — no build step needed, but slightly slower startup.

## Claude Desktop

Add Charlotte to your Claude Desktop config at:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "charlotte": {
      "command": "node",
      "args": ["/absolute/path/to/charlotte/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop after modifying the config. Charlotte's tools will appear in the tool list.

## Generic MCP Clients

Charlotte implements the [Model Context Protocol](https://modelcontextprotocol.io/) over stdio transport. To connect from any MCP client:

1. Spawn the process: `node /path/to/charlotte/dist/index.js`
2. Send JSON-RPC requests to the process's stdin
3. Read JSON-RPC responses from stdout
4. Diagnostic logs go to stderr (do not parse stderr as protocol messages)

Charlotte registers 30 tools across 6 categories:

| Category | Tools |
|----------|-------|
| Navigation | `navigate`, `back`, `forward`, `reload` |
| Observation | `observe`, `find`, `screenshot`, `diff` |
| Interaction | `click`, `type`, `select`, `toggle`, `submit`, `scroll`, `hover`, `key`, `wait_for` |
| Session | `tabs`, `tab_open`, `tab_switch`, `tab_close`, `viewport`, `network`, `set_cookies`, `set_headers`, `configure` |
| Dev Mode | `dev_serve`, `dev_inject`, `dev_audit` |
| Utility | `evaluate` |

## Verification

After connecting, run this sequence to confirm Charlotte is working:

```
navigate({ url: "https://example.com" })
```

Expected: Returns a `PageRepresentation` with title "Example Domain", landmarks (main), headings (h1 "Example Domain"), and interactive elements (1 link).

```
observe({ detail: "minimal" })
```

Expected: Same page, landmarks + interactive elements only.

```
find({ type: "link" })
```

Expected: Returns the "More information..." link with its element ID and bounds.

If all three return structured JSON with the expected fields, Charlotte is connected and working.

## Sandbox

Charlotte includes a test website for exercising all tools locally without touching the internet:

```
dev_serve({ path: "tests/sandbox" })
```

See [Sandbox Guide](sandbox.md) for the full walkthrough.

## Troubleshooting

**Charlotte doesn't start:**
- Verify Node.js >= 22: `node --version`
- Verify the build completed: `ls dist/index.js`
- Check stderr output for Puppeteer/Chromium launch errors

**Tools not appearing in client:**
- Verify the path in your config is absolute, not relative
- For Claude Code: `.mcp.json` must be in the directory where you start the session
- For Claude Desktop: restart the app after config changes

**Chromium won't launch:**
- Puppeteer downloads its own Chromium. If it fails, run `npx puppeteer browsers install chrome` manually
- On headless Linux servers, you may need: `apt-get install -y libnss3 libatk-bridge2.0-0 libdrm2 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2`

**"stdout is not a TTY" or garbled output:**
- Charlotte must be run as a subprocess, not in a terminal. MCP clients handle this automatically. Do not run `npm start` and try to type JSON-RPC manually — use an MCP client.
