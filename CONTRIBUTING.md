# Contributing to Charlotte

Thanks for your interest in contributing to Charlotte! This document covers the basics of getting set up and submitting changes.

## Getting Started

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/your-username/charlotte.git
   cd charlotte
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Run the tests to make sure everything works:
   ```bash
   npm test
   ```

## Development Workflow

### Running in development mode

```bash
npm run dev
```

This uses `tsx` with file watching for fast iteration.

### Running tests

```bash
# All tests
npm test

# Unit tests only (fast, no browser)
npm run test:unit

# Integration tests only (launches Chromium)
npm run test:integration

# Watch mode
npm run test:watch
```

### Type checking

```bash
npx tsc --noEmit
```

### Building

```bash
npm run build
```

## Project Structure

```
src/
  browser/      # Puppeteer lifecycle, tab management, CDP sessions
  renderer/     # Accessibility tree, layout, content extraction, element IDs
  state/        # Snapshot store, structural differ
  tools/        # MCP tool implementations
  dev/          # Dev mode: static server, file watcher, auditor
  types/        # TypeScript interfaces and error types
  utils/        # Logger, hash, wait utilities
tests/
  unit/         # Fast tests (mocked dependencies)
  integration/  # Full browser tests against fixture HTML
  fixtures/     # Test HTML pages
```

### Key patterns

- **Tool registration**: Each tool module exports a `registerXxxTools(server, deps)` function
- **ToolDependencies**: All tools receive the same dependency bundle (browserManager, pageManager, rendererPipeline, etc.)
- **renderActivePage**: The common render path for all tools — handles snapshots, reload events, and response assembly
- **renderAfterAction**: Captures pre/post snapshots and computes deltas for interaction tools
- **Element IDs**: Hash-based (`type prefix + 4-char hex`), stable across re-renders

## Submitting Changes

1. Create a branch for your change:
   ```bash
   git checkout -b my-feature
   ```

2. Make your changes. Please:
   - Follow the existing code style (TypeScript strict mode, descriptive variable names)
   - Add tests for new functionality
   - Keep changes focused — one feature or fix per PR

3. Make sure all tests pass and types check:
   ```bash
   npm test
   npx tsc --noEmit
   ```

4. Commit with a clear message describing what changed and why.

5. Push and open a pull request against `main`.

## Writing Tests

- **Unit tests** go in `tests/unit/` and should not launch a browser. Mock CDP responses where needed.
- **Integration tests** go in `tests/integration/` and run against real Chromium with fixture HTML pages.
- Test fixtures live in `tests/fixtures/pages/`. Add new HTML files there if your feature needs specific page structures.
- Always clean up after tests (close browsers, stop servers, remove temp files).

## Adding a New Tool

1. Decide which tool module it belongs to (navigation, observation, interaction, session, dev-mode), or create a new module if it doesn't fit.
2. Use `server.registerTool()` with zod schemas for input validation.
3. Follow the existing pattern: `ensureConnected()` -> perform action -> `renderActivePage()` or `renderAfterAction()` -> `formatPageResponse()`.
4. Add both unit and integration tests.
5. Wire it up in `src/server.ts` if it's a new module.

## Reporting Issues

Please include:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Node.js version and OS

## Code of Conduct

Be respectful and constructive. We're all here to build something useful.
