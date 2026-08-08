# Running Charlotte in Docker

Charlotte can run in a Docker container for isolated, reproducible deployments.

There are two images with two different jobs:

- **`Dockerfile`** (Debian) — the **HTTP self-host image**. Runs Charlotte Remote
  (streamable HTTP transport) with Chromium's sandbox **enabled**. This is the
  image `docker-compose.yml`'s primary `charlotte` service builds. Full
  self-hosting walkthrough (token generation, `publicOrigin`/OAuth facade,
  tunnel setup): see `SELF_HOSTING.md`.
- **`Dockerfile.alpine`** — the local/dev **stdio image**. Runs the original
  stdio MCP transport for Claude Desktop-style local use, sandbox
  **disabled**. See [Sandbox / Security Posture](#sandbox--security-posture)
  below for why these two images differ.

## Quick Start

### Debian, HTTP mode (self-host)
```bash
docker build -f Dockerfile -t charlotte:http .
docker compose up charlotte
```

### Alpine, stdio mode (local/dev, ~1.2GB)
```bash
docker build -f Dockerfile.alpine -t charlotte:alpine .
docker compose --profile local up charlotte-stdio
```

## Running the Container

### HTTP mode (Debian image, recommended for self-hosting)

```bash
docker run -d --rm \
  --name charlotte-http \
  --shm-size=2gb \
  --security-opt seccomp=./docker/chrome-seccomp.json \
  -p 3737:3737 \
  -e CHARLOTTE_AUTH_TOKEN=<your-token> \
  -v "$(pwd)/charlotte.config.json:/app/charlotte.config.json:ro" \
  charlotte:http

curl http://127.0.0.1:3737/healthz
```

Your mounted `charlotte.config.json` needs at least `http.host: "0.0.0.0"` so
the server is reachable from outside the container (the code default,
`127.0.0.1`, is loopback-only — see [Sandbox / Security
Posture](#sandbox--security-posture) for why that default exists and
`SELF_HOSTING.md` for the full config). See `docker-compose.yml` for the
same invocation with comments on the seccomp/SYS_ADMIN tradeoff.

### stdio mode (Alpine image, local/dev)

Charlotte's original transport communicates via stdio. To test it
interactively:

```bash
# Run interactively
docker run -it --rm --shm-size=2gb charlotte:alpine

# Or with docker-compose
docker compose --profile local up charlotte-stdio
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

(Claude Desktop drives Charlotte over stdio, so this uses the Alpine stdio
image, not the HTTP image above.)

## Important Notes

### Shared Memory (`shm_size`)
Charlotte's BrowserManager passes `--disable-dev-shm-usage` to Chromium, which makes it use `/tmp` instead of `/dev/shm`. This means `--shm-size` is not strictly required. However, the docker-compose file and examples below include `--shm-size=2gb` as a safety net — if the flag is ever removed or overridden, the default Docker shm size (64MB) would cause Chromium crashes.

### Sandbox / Security Posture

Project decision D22 settled this after a
spike (R4) confirmed Chromium's own sandbox (user-namespaces + seccomp-BPF)
runs **enabled** in-container, **without `--privileged`**, on this host's
Docker (27.4.1) — the Ubuntu unprivileged-userns AppArmor restriction that
normally blocks it can be worked around without relaxing AppArmor. There are
three postures, in the order the Debian HTTP image expects you to reach for
them:

1. **Surgical seccomp profile (default, recommended)** —
   `docker/chrome-seccomp.json`. It's Docker's own default seccomp profile
   (pinned to Docker v27.4.1) with exactly one change: the 23-syscall
   namespace/mount bucket (`clone`, `clone3`, `unshare`, `setns`, `mount`,
   …) that default seccomp only allows to processes holding `CAP_SYS_ADMIN`
   is un-gated from that capability requirement. Nothing else is relaxed;
   the container does not get `CAP_SYS_ADMIN` or any other capability.
   Docker's **default AppArmor profile is kept** — do NOT add
   `--security-opt apparmor=unconfined`. Counterintuitively, AppArmor's
   *default (confined)* profile is what grants the userns-creation exemption
   on Ubuntu 23.10+/24.04-like hosts; unconfining AppArmor removes that
   exemption and breaks the sandbox again. This is what `docker-compose.yml`
   and the `docker run` example above use.
2. **`cap_add: [SYS_ADMIN]` with default seccomp (fallback)** — also
   verified working in spike R4. Useful on hosts/platforms where mounting a
   custom seccomp profile is awkward (some managed container services).
   Broader than posture 1 — `SYS_ADMIN` grants far more than the syscalls
   the sandbox actually needs (arbitrary `ioctl`, BPF, etc.) — so prefer the
   seccomp profile when you can mount one. Commented out, ready to swap in,
   in `docker-compose.yml`.
3. **No relaxation needed** — on hosts that don't carry the
   unprivileged-userns AppArmor restriction (i.e. not an Ubuntu
   23.10+/24.04-like kernel/AppArmor combo), Chromium's sandbox may already
   initialize under Docker's plain defaults. Worth trying first if you're
   unsure which camp your host falls into; postures 1/2 are what to reach
   for if you see `No usable sandbox!` in the logs (see Troubleshooting).

The **Alpine image's sandbox posture is unverified** — spike R4 only tested
the Debian image (Puppeteer's bundled Chromium). `Dockerfile.alpine` keeps
`CHARLOTTE_NO_SANDBOX=1` (sandbox disabled) rather than guessing that the
surgical profile also works against Alpine's system Chromium package. If you
need a sandboxed Alpine image, that needs its own spike first.

If you encounter permission errors on an image/host combination none of the
above covers, the blunt (and much weaker) fallback is:
```bash
docker run -it --rm --shm-size=2gb --security-opt seccomp=unconfined charlotte:alpine
```
This is what the Alpine stdio image effectively assumes isn't needed by
running with the sandbox off instead — prefer that over unconfining seccomp
on a sandbox-enabled container.

### Network Access
Charlotte needs network access to browse websites. By default, Docker provides this. If using custom networks:
```bash
docker run -it --rm --shm-size=2gb --network=host charlotte:alpine
```

## Image Comparison

| Image | Base | Transport | Sandbox | Size | Chromium Source |
|-------|------|-----------|---------|------|------------------|
| `Dockerfile` | node:22-slim | HTTP (`--http`) | **Enabled** (surgical seccomp profile / D22) | ~1.2GB base, +seccomp profile | Puppeteer bundle |
| `Dockerfile.alpine` | node:22-alpine | stdio | Disabled (unverified with sandbox on) | ~1.2GB | System package |

Alpine's system Chromium pulls in many transitive dependencies (mesa, ffmpeg, pipewire, llvm, etc.) that negate the base image size advantage over Debian. The Debian image uses Puppeteer's bundled Chromium for guaranteed compatibility, while Alpine may occasionally have version mismatches — and it's now also the only image with a verified sandbox-enabled path, so it's the one used for HTTP self-hosting.

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

> **stdio-only, Alpine image only.** `tests/docker-smoke-test.mjs` spawns
> `docker run -i --rm <image>` and speaks JSON-RPC over the container's
> stdin/stdout — that only works against an image whose `CMD` runs the stdio
> transport. Since the Debian `Dockerfile` now defaults to HTTP mode
> (`--http`, decision D22), this script no longer applies to it; run it only
> against `charlotte:alpine`. The Debian/HTTP image's smoke coverage is the
> manual `/healthz` + real MCP-call-over-HTTP check in the "HTTP mode"
> section above (and the eventual I9 suite for Charlotte Remote).

### Prerequisites

The smoke test serves the sandbox pages from your host machine. The container accesses them via `--network=host` (Linux) or `host.docker.internal` (macOS/Windows).

### Running the smoke test

```bash
# 1. Build the image
docker build -f Dockerfile.alpine -t charlotte:alpine .

# 2. Start a local server for the sandbox test pages
python3 -m http.server 9876 -d tests/sandbox &

# 3. Run the smoke test against the Alpine (stdio) image
node tests/docker-smoke-test.mjs charlotte:alpine

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

Historical — from before decision D22 switched the Debian image's `CMD` to
HTTP mode. The `charlotte:debian` row reflects the old stdio `CMD`; the
stdio smoke test no longer applies to that image (see note above).

| Image | Result | Time | Platform |
|-------|--------|------|----------|
| `charlotte:alpine` | 20/20 passed | 5.7s | Linux amd64 |
| `charlotte:debian` (pre-D22, stdio `CMD`) | 20/20 passed | 6.6s | Linux amd64 |

No performance regressions observed from the container environment. Both images complete the full tool suite in under 7 seconds.

## Troubleshooting

### "Failed to launch the browser process"
- Ensure `--shm-size=2gb` is set
- Debian/HTTP image: make sure you passed the seccomp profile or SYS_ADMIN
  fallback — see [Sandbox / Security Posture](#sandbox--security-posture);
  `--security-opt seccomp=unconfined` works too but is a much broader
  relaxation than this image needs
- Alpine/stdio image: try `--security-opt seccomp=unconfined` if you still
  hit permission errors with the sandbox already off
- Check that the container has network access

### "No usable sandbox!" / "Running without sandbox"
- **Debian/HTTP image**: this image runs with the sandbox ON by design (D22)
  — seeing this error means the seccomp/AppArmor posture isn't right yet, not
  that something needs to be disabled. Check, in order: (1) you passed
  `--security-opt seccomp=./docker/chrome-seccomp.json` (or `cap_add:
  SYS_ADMIN` as the fallback) — plain `docker run charlotte:http` with no
  security flags will fail this way, by design (config (a) in spike R4); (2)
  you did **not** also pass `--security-opt apparmor=unconfined` — combining
  it with the seccomp profile breaks the sandbox again (see [Sandbox /
  Security Posture](#sandbox--security-posture)); (3) `CHARLOTTE_NO_SANDBOX`
  isn't set to a truthy value in your environment/config, which would disable
  the sandbox on purpose.
- **Alpine image**: expected — this image runs with
  `CHARLOTTE_NO_SANDBOX=1` (sandbox off) because that posture is unverified
  for Alpine's system Chromium. Charlotte's BrowserManager passes
  `--no-sandbox`/`--disable-setuid-sandbox` to Chromium itself in that case,
  so this isn't an error condition for that image.

### Chromium version mismatch (Alpine only)
If you see version warnings, switch to the Debian Dockerfile which bundles a compatible Chromium.
