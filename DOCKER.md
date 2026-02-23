# Running Charlotte in Docker

Charlotte can run in a Docker container for isolated, reproducible deployments.

## Quick Start

### Alpine (~1.2GB)
```bash
docker build -f Dockerfile.alpine -t charlotte:alpine .
```

### Debian (~1.2GB, more reliable)
```bash
docker build -f Dockerfile -t charlotte:debian .
```

## Running the Container

Charlotte is an MCP server that communicates via stdio. To test it interactively:

```bash
# Run interactively
docker run -it --rm --shm-size=2gb charlotte:alpine

# Or with docker-compose
docker compose up charlotte
```

## Using with Claude Desktop

To use the containerized Charlotte with Claude Desktop, you'll need a wrapper that connects stdio to the container. Example `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "charlotte": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "--shm-size=2gb",
        "charlotte:alpine"
      ]
    }
  }
}
```

## Important Notes

### Shared Memory (`shm_size`)
Charlotte's BrowserManager passes `--disable-dev-shm-usage` to Chromium, which makes it use `/tmp` instead of `/dev/shm`. This means `--shm-size` is not strictly required. However, the docker-compose file and examples below include `--shm-size=2gb` as a safety net — if the flag is ever removed or overridden, the default Docker shm size (64MB) would cause Chromium crashes.

### Security Context
If you encounter permission errors, you may need:
```bash
docker run -it --rm --shm-size=2gb --security-opt seccomp=unconfined charlotte:alpine
```

### Network Access
Charlotte needs network access to browse websites. By default, Docker provides this. If using custom networks:
```bash
docker run -it --rm --shm-size=2gb --network=host charlotte:alpine
```

## Image Comparison

| Image | Base | Size | Chromium Source | Reliability |
|-------|------|------|-----------------|-------------|
| `Dockerfile.alpine` | node:22-alpine | ~1.2GB | System package | Good |
| `Dockerfile` | node:22-slim | ~1.2GB | Puppeteer bundle | Excellent |

Both images are currently similar in size (~1.2GB). Alpine's system Chromium pulls in many transitive dependencies (mesa, ffmpeg, pipewire, llvm, etc.) that negate the base image size advantage. The Debian image uses Puppeteer's bundled Chromium for guaranteed compatibility, while Alpine may occasionally have version mismatches.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PUPPETEER_EXECUTABLE_PATH` | (bundled) | Path to Chromium binary |
| `PUPPETEER_SKIP_DOWNLOAD` | `false` | Skip bundled Chromium download (used in Alpine image) |
| `PUPPETEER_CACHE_DIR` | `~/.cache/puppeteer` | Where Puppeteer stores downloaded Chromium (set to `/app/.cache/puppeteer` in Debian image) |
| `NODE_ENV` | `production` | Node environment |

## Building for Production

For CI/CD, build with cache optimization:

```bash
# Build with BuildKit for better caching
DOCKER_BUILDKIT=1 docker build -f Dockerfile.alpine -t charlotte:alpine .

# Multi-platform build (for registry distribution)
docker buildx build --platform linux/amd64,linux/arm64 \
  -f Dockerfile.alpine -t yourregistry/charlotte:latest --push .
```

## Testing

A smoke test script exercises the full MCP tool suite against a running container. It sends JSON-RPC messages over stdio and verifies Charlotte can initialize, navigate, observe, find elements, type, click, screenshot, scroll, evaluate JS, and more.

### Prerequisites

The smoke test serves the sandbox pages from your host machine. The container accesses them via `--network=host` (Linux) or `host.docker.internal` (macOS/Windows).

### Running the smoke test

```bash
# 1. Build the image(s) you want to test
docker build -f Dockerfile.alpine -t charlotte:alpine .
docker build -f Dockerfile -t charlotte:debian .

# 2. Start a local server for the sandbox test pages
python3 -m http.server 9876 -d tests/sandbox &

# 3. Run the smoke test against an image
node tests/docker-smoke-test.mjs charlotte:alpine
node tests/docker-smoke-test.mjs charlotte:debian

# 4. Stop the sandbox server when done
kill %1
```

### What the smoke test covers

| # | Tool | Action |
|---|------|--------|
| 1 | `initialize` | MCP handshake, verify server info |
| 2 | `tools/list` | Confirm all 32 tools are registered |
| 3 | `navigate` | Load sandbox index page |
| 4 | `observe` (summary) | Verify interactive elements detected |
| 5 | `observe` (minimal) | Verify compact response format |
| 6 | `find` (links) | Search for link elements |
| 7 | `navigate` (forms) | Load forms page |
| 8 | `observe` (forms) | Verify form detection |
| 9 | `find` (text_input) | Search for text inputs |
| 10 | `type` | Type into first input |
| 11 | `navigate` (interactive) | Load interactive page |
| 12 | `find` (buttons) | Search for buttons |
| 13 | `click` | Click first button |
| 14 | `screenshot` | Capture page screenshot |
| 15 | `evaluate` | Execute JS (`document.title`) |
| 16 | `scroll` | Scroll down |
| 17 | `back` | Browser back navigation |
| 18 | `forward` | Browser forward navigation |
| 19 | `diff` | Snapshot comparison |
| 20 | `configure` | Update runtime config |

### Test results (2026-02-23)

| Image | Result | Time | Platform |
|-------|--------|------|----------|
| `charlotte:alpine` | 20/20 passed | 5.7s | Linux amd64 |
| `charlotte:debian` | 20/20 passed | 6.6s | Linux amd64 |

No performance regressions observed from the container environment. Both images complete the full tool suite in under 7 seconds.

## Troubleshooting

### "Failed to launch the browser process"
- Ensure `--shm-size=2gb` is set
- Try `--security-opt seccomp=unconfined`
- Check that the container has network access

### "No usable sandbox"
Charlotte's BrowserManager already passes `--no-sandbox` and `--disable-setuid-sandbox` to Chromium at launch. If you still see this error, ensure the container user has appropriate permissions.

### Chromium version mismatch (Alpine only)
If you see version warnings, switch to the Debian Dockerfile which bundles a compatible Chromium.
