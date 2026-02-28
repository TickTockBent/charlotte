# Charlotte

## Tagline
Headless browser for AI agents — navigate, interact with, and test web pages via MCP.

## Description
Charlotte is an MCP server that gives AI agents full browser control through headless Chromium. It renders web pages into structured, agent-readable representations — extracting landmarks, interactive elements, forms, and content — so agents can understand and interact with any web page without parsing raw HTML. Charlotte provides 39 tools covering navigation, clicking, typing, screenshots, cookie management, network monitoring, visual diffing, accessibility auditing, and local development serving. Built for developers who want their AI agents to browse, test, and debug web applications.

## Setup Requirements
- No API keys or environment variables required. Charlotte launches a local headless Chromium instance via Puppeteer.
- `CHARLOTTE_CHROMIUM_PATH` (optional): Path to a custom Chromium/Chrome binary. Defaults to Puppeteer's bundled Chromium.

## Category
Developer Tools

## Features
- Renders pages into structured representations with landmarks, headings, interactive elements, and forms
- Full browser interaction: click, type, select, toggle, submit, scroll, hover, drag and drop
- Tab management: open, close, and switch between multiple tabs
- Screenshot capture, retrieval, and management
- Cookie and header management for authenticated testing
- Console and network request monitoring with filtering
- Visual diff between page snapshots to detect changes after actions
- Wait for conditions: selectors, text, or custom JS expressions
- Run arbitrary JavaScript in the page context
- Local dev server with file watching and automatic reload detection
- Accessibility, performance, SEO, contrast, and link auditing
- Configurable detail levels (full or minimal) to control response size
- Dialog handling for alerts, confirms, and prompts
- Keyboard input for special keys, shortcuts, and key combinations
- Viewport resizing for responsive testing

## Getting Started
- "Navigate to example.com and describe what you see" — uses charlotte:navigate + charlotte:observe
- "Click the login button and fill in the form" — uses charlotte:click + charlotte:type + charlotte:submit
- "Take a screenshot of the current page" — uses charlotte:screenshot
- "Check this page for accessibility issues" — uses charlotte:dev_audit
- "Serve my local project folder and test it in the browser" — uses charlotte:dev_serve + charlotte:navigate
- Tool: charlotte:observe — Read the current page structure: landmarks, headings, interactive elements, and content
- Tool: charlotte:find — Search for elements by text, role, or state
- Tool: charlotte:evaluate — Run JavaScript in the page and return results
- Tool: charlotte:diff — Compare snapshots to see what changed after an action

## Tags
browser, headless, chromium, puppeteer, web, testing, automation, scraping, accessibility, a11y, screenshots, mcp, navigation, forms, interaction, developer-tools, auditing, web-testing, responsive, cookies

## Documentation URL
https://github.com/ticktockbent/charlotte#readme
