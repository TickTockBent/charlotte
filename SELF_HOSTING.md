# Self-Hosting Charlotte Remote

This guide walks a **new operator** — not the maintainer — through standing up Charlotte's HTTP transport ("Charlotte Remote") on your own host and connecting it to claude.ai as a custom connector. It assumes nothing about your environment beyond "a Linux host with Docker." For the trust model, network guards, and sizing, see [SECURITY.md](SECURITY.md); for container/sandbox internals, see [DOCKER.md](DOCKER.md); for the stdio setup and tool reference, see [README.md](README.md).

**Just want to try it?** The one-command demo in the [README](README.md#self-hosting-charlotte-remote) gets you connected to claude.ai in about a minute on an ephemeral tunnel URL — no domain, no config. This guide is the durable setup: your own domain, a stable token, compose.

## 1. What you need

- A host with Docker (and `docker compose`).
- A public HTTPS origin — a reverse proxy (Caddy, nginx, Traefik) or tunnel (e.g. Cloudflare Tunnel) that forwards to Charlotte's port.
- That's it.

## 2. Generate a bearer token

Charlotte's HTTP mode refuses to start without a bearer token — it is the root credential for everything, including the OAuth facade (§3, §5). Generate a long random one and export it as `CHARLOTTE_AUTH_TOKEN`:
```bash
export CHARLOTTE_AUTH_TOKEN="$(openssl rand -hex 32)"
```

Treat this like a password:
- Never commit it to git (including in `charlotte.config.json` — leave `http.authToken` as `null` there and supply the token only via the `CHARLOTTE_AUTH_TOKEN` environment variable, which always wins over the config file).
- Anyone who has it can drive your Charlotte instance's browser — including navigating your server's network (see [SECURITY.md](SECURITY.md)).
- Rotate it by generating a new value and restarting Charlotte with it (see [SECURITY.md](SECURITY.md)).

## 3. Write `charlotte.config.json`

Charlotte reads `charlotte.config.json` from its working directory (or a path passed via `--config`). A minimal HTTP config:
```json
{
  "http": {
    "host": "0.0.0.0",
    "port": 3737,
    "profile": "browse",
    "publicOrigin": "https://charlotte.example.com"
  }
}
```

- **`host`** — `"0.0.0.0"` to be reachable from outside the container; default `127.0.0.1` is loopback-only.
- **`port`** — defaults to `3737`.
- **`profile`** — the HTTP tool set, fixed at startup; default `"browse"` ([tool profiles](README.md#tool-profiles)).
- **`publicOrigin`** — the public `https://` origin clients reach this server at; enables the OAuth facade (§5). Unset = bearer-only mode.

Every other `http.*` key is documented in [docs/configuration.md](docs/configuration.md).

## 4. Run it

The shipped `docker-compose.yml` builds and runs the HTTP-mode image:
```bash
docker compose up charlotte
```

This expects two things from you, both already wired into `docker-compose.yml`:

- `CHARLOTTE_AUTH_TOKEN` exported in your shell (from §2) before you run `docker compose up` — `docker-compose.yml` requires it and refuses to start without it.
- `./charlotte.config.json` mounted read-only into the container (already wired via `volumes:` — just make sure the file from §3 exists at that path).

Chromium sandbox posture is pre-wired in the shipped compose file — see [DOCKER.md](DOCKER.md#sandbox--security-posture) if you need to change it.

## 5. Connect claude.ai

With Charlotte reachable at `https://charlotte.example.com` (§1) and running with `http.publicOrigin` set to that same origin (§3), add it as a custom connector:

1. In claude.ai: **Settings → Connectors → Add custom connector**.
2. **Name**: anything. **URL**: `https://charlotte.example.com/mcp`.
3. **Leave the OAuth Client ID / Secret fields blank.** You never enter your `CHARLOTTE_AUTH_TOKEN` in the claude.ai UI — you'll be redirected to Charlotte's own consent page partway through the connection attempt, and that is the one place you type the token.
4. Save / attempt the connection.

For what happens under the hood during that handshake, see [SECURITY.md](SECURITY.md). If the connector add fails before the consent page appears, see §6.

## 6. Troubleshooting

Run this first:
```bash
docker compose run --rm charlotte node dist/index.js doctor --http
# or, from a source checkout:
CHARLOTTE_AUTH_TOKEN=... npx charlotte doctor --http
```

It validates config, token, and port, and confirms Chromium actually launches, before you wire claude.ai up to a URL that might not work (`PASS`/`WARN`/`FAIL` output is self-describing).

**"No usable sandbox!" in Charlotte's logs.** Seccomp/AppArmor posture isn't right — see [DOCKER.md § Sandbox / Security Posture](DOCKER.md#sandbox--security-posture).

**`401` from `/mcp`, or claude.ai can't authenticate.** Token mismatch. Confirm the container has the token you think it has (`docker compose config` shows the resolved `environment:` block), and that you entered the *same* token on Charlotte's consent page:
```bash
curl -s -o /dev/null -w '%{http_code}\n' https://charlotte.example.com/mcp \
  -H "Authorization: Bearer $CHARLOTTE_AUTH_TOKEN" -X POST -d '{}'
# 401 with no/wrong token, something other than a bare 401 with the right one
```

**Adding the connector fails before the consent page appears.** Check, in order: (1) `http.publicOrigin` is set and matches the URL you gave claude.ai exactly; (2) your reverse proxy / tunnel is actually forwarding `https://charlotte.example.com/*` — try `curl https://charlotte.example.com/healthz` from outside your network; (3) the inbound Host-header guard isn't rejecting the proxy's forwarded `Host` header (see [SECURITY.md](SECURITY.md)) — add it to `http.allowedHosts` if so.
