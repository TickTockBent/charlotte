# Self-Hosting Charlotte Remote

This guide walks a **new operator** — not the maintainer — through standing up
Charlotte's HTTP transport ("Charlotte Remote") on your own host and
connecting it to claude.ai as a custom connector. It assumes nothing about
your environment beyond "a Linux host with Docker."

For container internals (image comparison, sandbox posture in depth,
troubleshooting), see [DOCKER.md](DOCKER.md). For the general stdio setup and
tool reference, see [README.md](README.md).

## 1. What you need

- **A host with Docker** (and `docker compose`).
- **A public HTTPS origin.** claude.ai's custom-connector flow requires
  `https://` — plain HTTP is refused. Charlotte itself only ever speaks plain
  HTTP, bound to loopback or `0.0.0.0`; TLS is terminated *in front of it*, by
  one of:
  - A reverse proxy you control (Caddy, nginx, Traefik) that terminates TLS
    on a domain you own and forwards to Charlotte's port.
  - A tunnel (e.g. [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) /
    `cloudflared`) that exposes a local port under a public HTTPS hostname
    without opening an inbound firewall port.

  Either way, the end state is the same: some `https://charlotte.example.com`
  that forwards to `http://<charlotte-host>:3737`. This guide uses
  `https://charlotte.example.com` as a placeholder throughout — substitute
  your real hostname, and never commit the real one alongside a token.

## 2. Generate a bearer token

Charlotte's HTTP mode refuses to start without a bearer token — it is the
root credential for everything, including the OAuth facade (§3, §6). Generate
a long random one and export it as `CHARLOTTE_AUTH_TOKEN`:

```bash
export CHARLOTTE_AUTH_TOKEN="$(openssl rand -hex 32)"
```

Treat this like a password:
- Never commit it to git (including in `charlotte.config.json` — leave
  `http.authToken` as `null` there and supply the token only via the
  `CHARLOTTE_AUTH_TOKEN` environment variable, which always wins over the
  config file).
- Anyone who has it can drive your Charlotte instance's browser — including
  navigating your server's network (see §7, SSRF guard).
- Rotate it by generating a new value and restarting Charlotte with it (§7).

## 3. Write `charlotte.config.json`

Charlotte reads `charlotte.config.json` from its working directory (or a path
passed via `--config`). A minimal HTTP config:

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

- **`host`** — must be `"0.0.0.0"` when running in a container (or behind a
  reverse proxy on another host), so the server is reachable from outside its
  own network namespace. The code default, `127.0.0.1`, is loopback-only and
  is the right choice only if you're running Charlotte directly on the same
  host as your reverse proxy/tunnel client.
- **`port`** — defaults to `3737` if omitted. Only change it if something else
  on the host needs that port.
- **`profile`** — the tool set exposed over HTTP, fixed for the life of the
  process (a stateless HTTP transport has no per-connection registry to
  mutate at runtime). Default `"browse"` already excludes the
  filesystem-serving `dev_mode` tools, `evaluate` (arbitrary JS execution),
  and `monitoring`. Valid values: `core`, `browse`, `interact`, `develop`,
  `audit`, `full` — see [README.md](README.md#tool-profiles) for what each
  includes. Prefer the narrowest profile your use case needs.
- **`publicOrigin`** — the absolute `https://` origin *clients* reach this
  server at (not the bind address). **Setting it enables the OAuth facade**
  (§6): discovery, dynamic client registration, a consent page, and a token
  endpoint, which is how claude.ai's connector UI authenticates — it has no
  field for a raw bearer token and can only complete a real OAuth handshake.
  **Leaving it unset** puts Charlotte in bearer-only mode: no facade routes,
  and any MCP client that can send `Authorization: Bearer <token>` directly
  (e.g. a custom script, or an MCP client with a plain bearer-token field)
  can still use it — you just can't add it through claude.ai's connector UI
  that way. Must be exactly a scheme+host(+port) origin: no path, query,
  credentials, or trailing slash, and must be `https://` (Charlotte validates
  this at startup and refuses to start on a malformed value).

Two advanced knobs worth knowing about (both default to "wide open" — you
opt in to *tightening* them further, they don't need to be touched for a
basic setup):

- **`allowedHosts`** (string array, default `[]`) — extra `Host`-header
  hostnames the inbound DNS-rebind guard accepts, beyond the hostnames
  Charlotte derives automatically (`localhost`/`127.0.0.1`/`[::1]`, the
  `host` you configured, and the `publicOrigin` hostname). You only need this
  if a proxy in front of Charlotte presents some other hostname on the `Host`
  header than `publicOrigin`.
- **`allowPrivateNetworks`** (CIDR string array, default `[]`) — carves
  exceptions into the outbound navigation guard, which otherwise
  default-denies loopback/RFC1918/link-local/cloud-metadata addresses (§7).
  Only set this if you deliberately want Charlotte's browser able to reach
  something on your private network (e.g. an internal test site) — it's a
  meaningful widening of what a compromised/malicious credential holder can
  reach.

There is also **`sessionIdleTtlMs`** (default `1800000`, i.e. 30 minutes):
after this many idle milliseconds with no authorized `/mcp` traffic,
Charlotte tears down its browser to reclaim memory; the next tool call
transparently relaunches it. You generally don't need to touch this.

A few other `http.*` keys exist in the schema (`maxSessions`,
`enableDevTools`, `artifactDelivery`) but are currently **validated only, not
yet consumed by any behavior** — don't rely on them to change anything today.

## 4. Run it

The shipped `docker-compose.yml` builds and runs the HTTP-mode image:

```bash
docker compose up charlotte
```

This starts the `charlotte` service — the Debian-based, HTTP-transport,
**Chromium-sandbox-enabled** image — bound to `3737:3737`, with a `2gb` shared
memory allocation Chromium needs. It expects two things from you, both
already wired into `docker-compose.yml`:

1. `CHARLOTTE_AUTH_TOKEN` set in the `environment:` block (replace the
   placeholder `REPLACE_ME_WITH_A_REAL_TOKEN` with the token from §2 — or
   override it however you manage container secrets).
2. `./charlotte.config.json` mounted read-only into the container at
   `/app/charlotte.config.json` (already wired via `volumes:` — just make
   sure the file from §3 exists at that path in your checkout).

### Sandbox posture

Chromium's own sandbox (user-namespaces + seccomp-BPF) is a load-bearing
defense: Charlotte navigates its browser to arbitrary, often untrusted, URLs,
and in HTTP mode a hostile page would otherwise be exploiting the renderer on
*your server*, not a visitor's machine. The Docker image ships with the
sandbox **enabled**, not disabled — this is decision D22, verified against
this exact image. `docker-compose.yml` wires it two ways:

1. **Surgical seccomp profile (default, what's active in the compose file)**
   — `security_opt: ["seccomp:./docker/chrome-seccomp.json"]`. This is
   Docker's own default seccomp profile with exactly one change: a bucket of
   23 namespace/mount syscalls (`clone`, `unshare`, `setns`, `mount`, …) that
   default seccomp only allows to processes holding `CAP_SYS_ADMIN` is
   un-gated from that requirement — nothing else is relaxed, and the
   container does **not** get `CAP_SYS_ADMIN` or any other capability.
   Docker's default AppArmor profile is deliberately left in place — do
   **not** add `apparmor:unconfined`. Counterintuitively, on hosts with
   Ubuntu's unprivileged-userns AppArmor restriction (23.10+/24.04-like),
   AppArmor's *default confined* profile is what grants Chromium's sandbox
   the exemption it needs to set up namespaces at all; unconfining AppArmor
   removes that exemption and breaks the sandbox again.
2. **`cap_add: [SYS_ADMIN]` fallback (commented out in the compose file)** —
   for platforms where mounting a custom seccomp profile is awkward (some
   managed container services). Also verified working, but broader than it
   needs to be (`SYS_ADMIN` grants far more than the sandbox actually uses),
   so prefer posture 1 when you can. Swap it in by commenting out
   `security_opt` and uncommenting the `cap_add` block in
   `docker-compose.yml`.

If your host doesn't carry the Ubuntu unprivileged-userns AppArmor
restriction in the first place, Chromium's sandbox may initialize fine under
Docker's plain defaults with neither relaxation — but the shipped compose
file already applies posture 1, which is safe to leave on regardless.

**Do not run HTTP mode with `--no-sandbox` / `CHARLOTTE_NO_SANDBOX=1`.**
That's a real option in `browser.noSandbox` / the CLI, but it's a hardening
regression specifically in remote mode — `charlotte doctor --http` will WARN
about it (§5), on purpose. Full detail and troubleshooting for this posture:
[DOCKER.md § Sandbox / Security Posture](DOCKER.md#sandbox--security-posture).

Once it's up, confirm liveness from the host:

```bash
curl http://127.0.0.1:3737/healthz
# {"version":"0.8.0","uptime_s":3,"browser_connected":false}
```

`browser_connected` starts `false` — Chromium launches lazily on the first
tool call, same as stdio mode.

## 5. Preflight: `charlotte doctor --http`

Before wiring claude.ai up to a URL that might not actually work, run the
built-in preflight check. It validates config, checks the auth token and
port, and confirms Chromium actually launches and renders — without starting
the MCP server itself.

Against the running container (overrides the image's normal `--http` startup
command with the doctor subcommand instead, reusing the same env/volume
wiring from `docker-compose.yml`):

```bash
docker compose run --rm charlotte node dist/index.js doctor --http
```

Or, if you're running Charlotte directly on the host (from a source
checkout, not the container):

```bash
CHARLOTTE_AUTH_TOKEN=... npx charlotte doctor --http
```

Doctor runs four checks and reports `PASS`/`WARN`/`FAIL` for each:

1. **Config loads & validates** — the config file parses and, if
   `http.publicOrigin` is set, its shape is valid.
2. **Auth token present** (`--http` only) — `CHARLOTTE_AUTH_TOKEN` or
   `http.authToken` resolved to something. Charlotte's HTTP transport won't
   even bind a port without this, so a FAIL here is definitive.
3. **Port bindable** (`--http` only) — the configured `host:port` is free and
   you have permission to bind it.
4. **Browser launches & renders** — a real Chromium launch, navigating a
   trivial page and reading its title back. In `--http` mode, a successful
   launch with the sandbox **off** is downgraded to a **WARN**, not a PASS —
   expected and fine if you deliberately opted into `--no-sandbox`
   (uncommon, and not what the shipped image does), otherwise treat it as a
   signal something is misconfigured.

Exit code is non-zero only on a `FAIL`; `WARN`s are surfaced but don't block.

## 6. Connect claude.ai

With Charlotte reachable at `https://charlotte.example.com` (§1) and running
with `http.publicOrigin` set to that same origin (§3), add it as a custom
connector:

1. In claude.ai: **Settings → Connectors → Add custom connector**.
2. **Name**: anything (e.g. `Charlotte`). **URL**:
   `https://charlotte.example.com/mcp`.
3. **Leave the OAuth Client ID / Secret fields blank.** You never enter your
   `CHARLOTTE_AUTH_TOKEN` anywhere in the claude.ai UI — the facade derives
   claude.ai's credential from it automatically as part of the OAuth
   handshake below.
4. Save / attempt the connection.

What happens next (this is claude.ai's real, observed connector behavior
against Charlotte's OAuth facade, not a guess):

- claude.ai `POST`s `/mcp` with no credential → `401`.
- It fetches Charlotte's OAuth discovery documents
  (`/.well-known/oauth-protected-resource`,
  `/.well-known/oauth-authorization-server`) — both only exist because
  `publicOrigin` is set (§3); without it these 404 and the connector add
  fails with an error about not being able to register a sign-in service.
- It dynamically registers itself as an OAuth client
  (`POST /oauth/register`) and gets back a `client_id` — no manual
  credential-copying required on your end.
- **Your browser** is redirected to Charlotte's consent page
  (`GET /oauth/authorize`) — a plain server-rendered page with one field.
  **Enter your `CHARLOTTE_AUTH_TOKEN` here.** This is the one and only place
  you type the token during connector setup.
- On success, Charlotte redirects back to claude.ai with an authorization
  code; claude.ai's backend exchanges it (`POST /oauth/token`) for a bearer
  token derived from your operator token — distinct from it, but
  cryptographically tied to it (no server-side storage: restart Charlotte
  with the same token and the derived credential is unchanged; restart with a
  *different* token and claude.ai's stored credential silently stops working,
  which is how you revoke it — see §7).
- From then on, claude.ai's connector authenticates every `/mcp` call with
  that derived bearer token, transparently — no further prompts.

If the connector add fails before you ever see the consent page, see §8.

## 7. Security & sizing

**Outbound SSRF / navigation guard.** Every navigation Charlotte's browser
makes is checked against a deny-by-default list of private address ranges —
loopback, RFC1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`),
link-local (`169.254.0.0/16`, including the `169.254.169.254` cloud metadata
address), CGNAT/Tailscale (`100.64.0.0/10`), and their IPv6 equivalents. This
is checked against the **resolved** IP at request time (not just the URL
string), so it isn't fooled by a hostname that resolves to a private address
or a redirect chain that ends up there. `http.allowPrivateNetworks` (§3) is
the only way to punch a hole in this — leave it `[]` unless you have a
specific reason your Charlotte needs to reach something on your own network.

**Inbound Host-header guard.** Requests whose `Host` header doesn't match an
expected hostname are refused with `403` before touching the session or
browser — this defends against a malicious page in someone else's browser
"DNS-rebinding" its own domain to your loopback address and POSTing straight
to Charlotte's listener. The allowlist is derived automatically from
`localhost`/`127.0.0.1`/`[::1]`, your configured `host`, and your
`publicOrigin` hostname; `allowedHosts` (§3) extends it if a proxy sits in
between and presents some other hostname.

**The token is the whole trust boundary.** Anyone holding a valid bearer
(your operator token, or a derived one claude.ai's connector obtained through
consent) can drive Charlotte's browser to fetch anything the SSRF guard
doesn't block. Keep `CHARLOTTE_AUTH_TOKEN` as secret as any other credential.
**To revoke access** (e.g. claude.ai's stored derived token, or a leaked
operator token): generate a new token and restart Charlotte with it — every
previously derived credential stops matching immediately, since nothing is
stored server-side to selectively revoke.

**One browser, not one browser per user.** Charlotte Remote is a single
implicit session shared by every client that holds a valid token — it is
**not multi-tenant**. Two different callers hitting the same server see the
same tabs, same navigation history, same everything. Don't point multiple
untrusted parties at one Charlotte instance expecting isolation between them.

**Provisioning: budget about 1 GB of RAM per running session.** Measured
against Chromium's actual process tree: summed RSS (what a container memory
limit / `top` will show you) peaks around 923 MB per idle session; the
"honest" per-session share accounting for pages shared across Chromium's
process tree (PSS) is about 330 MB. Size your host/container memory limit for
the larger, ~1 GB figure — that's what will actually get enforced against you
if you set a hard cgroup limit.

**Screenshots and other artifacts are capped, not paths.** A screenshot or
similar artifact up to 256 KB is returned inline in the tool response; above
that cap, the tool call is refused with a steering message instead of
returning a filesystem path — an HTTP client (unlike a local stdio client)
has no way to read a path on your server's disk, so there is no
"here's a file on the server, go read it" fallback in HTTP mode.

## 8. Troubleshooting

**"No usable sandbox!" in Charlotte's logs.** The container's seccomp/AppArmor
posture isn't right yet — see §4's Sandbox posture section and
[DOCKER.md](DOCKER.md#sandbox--security-posture) for the full diagnostic
checklist (in short: make sure you're passing the seccomp profile or the
`SYS_ADMIN` fallback, and that you have **not** added
`apparmor:unconfined` alongside it).

**`401` from `/mcp`, or claude.ai says it can't authenticate.** Token
mismatch. Confirm the running container actually has the token you think it
has (`docker compose config` will show the resolved `environment:` block), and
that you entered the *same* token on Charlotte's consent page that the server
is running with. A quick manual check:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://charlotte.example.com/mcp \
  -H "Authorization: Bearer $CHARLOTTE_AUTH_TOKEN" -X POST -d '{}'
# 401 with no/wrong token, something other than a bare 401 with the right one
```

**Adding the connector fails before the consent page appears.** Almost
always means the discovery documents aren't reachable the way claude.ai
expects. Check, in order: (1) `http.publicOrigin` is actually set and matches
the URL you gave claude.ai exactly (scheme + host, no path); (2) your
reverse proxy / tunnel is actually forwarding `https://charlotte.example.com/*`
to Charlotte's port — try `curl https://charlotte.example.com/healthz`
from outside your network; (3) the inbound Host-header guard isn't rejecting
the proxy's forwarded `Host` header (§7) — if your proxy rewrites `Host` to
something other than your `publicOrigin` hostname, add it to
`http.allowedHosts`.

**When in doubt, start with `charlotte doctor --http`** (§5) — it catches
the config/token/port/sandbox problems above before they show up as an
opaque failure inside claude.ai's connector UI.
