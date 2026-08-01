# Configuration

Charlotte resolves its settings from four sources. When the same setting is
provided by more than one source, the **higher-precedence** source wins:

1. **CLI arguments** (highest)
2. **Environment variables**
3. **Config file** (JSON)
4. **Built-in defaults** (lowest)

## Config file

Pass a config file explicitly:

```bash
charlotte --config charlotte.config.json
```

If `--config` is omitted, Charlotte looks for `charlotte.config.json` in the
current working directory and loads it automatically when present. A missing
default file is not an error; a missing **explicit** `--config` path is.

The file is validated with [zod]. Unknown keys, wrong types, and invalid enum
values produce a clear startup error on **stderr** (stdout is reserved for the
MCP stdio transport) and Charlotte exits non-zero.

### Schema

Every section is optional. An empty `{}` is valid.

```json
{
  "browser": {
    "headless": true,
    "noSandbox": false,
    "cdpEndpoint": null
  },
  "tools": {
    "profile": "browse",
    "groups": ["navigation", "observation"]
  },
  "snapshot": {
    "depth": 50,
    "autoSnapshot": "every_action"
  },
  "rendering": {
    "includeIframes": false,
    "iframeDepth": 3
  },
  "dialog": {
    "autoDismiss": "none"
  },
  "output": {
    "dir": "./charlotte-output"
  },
  "limits": {
    "maxInteractiveElements": 2000,
    "maxFullContentChars": 200000,
    "maxResponseBytes": 1000000,
    "maxEvaluateBytes": 256000
  },
  "http": {
    "port": 3737,
    "host": "127.0.0.1",
    "authToken": null,
    "profile": "browse",
    "sessionIdleTtlMs": 1800000,
    "maxSessions": 1,
    "allowPrivateNetworks": [],
    "enableDevTools": false,
    "artifactDelivery": "inline"
  }
}
```

| Key | Type | Notes |
| --- | --- | --- |
| `browser.headless` | boolean | Run Chromium headless. Default `true`. |
| `browser.noSandbox` | boolean | Disable the Chromium sandbox. Default `false` (sandbox **ON**). See below. |
| `browser.cdpEndpoint` | string \| null | Connect to an existing Chrome (`http://`, `https://`, `ws://`, `wss://`, `channel:`). `null` = launch a fresh browser. |
| `tools.profile` | enum | One of `core`, `browse`, `interact`, `develop`, `audit`, `full`. Takes precedence over `groups`. |
| `tools.groups` | string[] | Explicit tool groups. Ignored when `profile` is set. |
| `snapshot.depth` | int > 0 | Snapshot ring-buffer depth. |
| `snapshot.autoSnapshot` | enum | `every_action`, `observe_only`, `manual`. |
| `rendering.includeIframes` | boolean | Include iframe content in page representations. |
| `rendering.iframeDepth` | int > 0 | Max iframe nesting depth. |
| `dialog.autoDismiss` | enum | `none`, `accept_alerts`, `accept_all`, `dismiss_all`. |
| `output.dir` | string | Directory for large tool output files. |
| `limits.maxInteractiveElements` | int > 0 | Max interactive elements serialized before the list is truncated. Default `2000`. |
| `limits.maxFullContentChars` | int > 0 | Max characters of `full_content` text before truncation. Default `200000`. |
| `limits.maxResponseBytes` | int > 0 | Total byte ceiling for a formatted page response; above this the response degrades to a compact summary with an `output_file` suggestion. Default `1000000`. |
| `limits.maxEvaluateBytes` | int > 0 | Byte ceiling for a `charlotte_evaluate` result before it is truncated. Default `256000`. |
| `http.port` | int 1–65535 | Port for `--http`. Default `3737`. CLI: `--port`. |
| `http.host` | string | Bind address for `--http`. Default `127.0.0.1` (loopback only). |
| `http.authToken` | string \| null | Static bearer token. **Required** in HTTP mode — no default. `CHARLOTTE_AUTH_TOKEN` wins over this. |
| `http.profile` | enum | Tool profile served over HTTP, fixed at startup. Default `browse`. `--profile` overrides it. |
| `http.sessionIdleTtlMs` | int > 0 | *Reserved.* Idle ms before a session's pages close. Validated, not yet consumed. |
| `http.maxSessions` | int > 0 | *Reserved.* Concurrent sessions; today there is exactly one. Validated, not yet consumed. |
| `http.allowPrivateNetworks` | string[] | *Reserved.* CIDR allowlist for the private-network guard. Validated, not yet consumed. |
| `http.enableDevTools` | boolean | *Reserved.* Expose filesystem-serving dev tools over HTTP. Validated, not yet consumed. |
| `http.artifactDelivery` | enum | *Reserved.* `inline` or `resource`. Validated, not yet consumed. |

### HTTP mode (`http`)

`charlotte --http [--port N]` serves the MCP streamable HTTP endpoint instead of
stdio. The two modes are mutually exclusive — one process serves one transport.

- `POST /mcp` — the MCP endpoint. Requires `Authorization: Bearer <token>`;
  anything else is answered `401 {"error":"unauthorized"}` before any browser or
  session activity. The server **refuses to start** without a token.
- `GET /healthz` — unauthenticated liveness: `{version, uptime_s,
  browser_connected}`. No page data, no config echo.

The tool set is fixed at startup from `http.profile` (`--profile` overrides;
`--tools` is ignored with a warning), because a stateless HTTP transport has no
per-connection registry to mutate — `charlotte_tools` is therefore not exposed
over HTTP. Default `browse` excludes the dev-mode, evaluate, and monitoring
groups.

Keys marked *Reserved* above are validated and documented now so a config
written today keeps working when their consumers land; they have no effect yet.

### Output-size limits (`limits`)

These caps (issue #188) bound how much a single tool response can return so a
pathological page — 100k links, an infinite-scroll feed, a giant document body
— cannot blow the MCP client's context window. All are optional; omitted keys
fall through to the built-in defaults above. When a page response exceeds
`maxResponseBytes` it degrades to a compact summary and suggests writing the
full result to a file via `output_file`; `charlotte_evaluate` results are capped
independently by `maxEvaluateBytes`. Truncated responses carry a `truncation`
marker so agents can tell the output was clipped.

## Environment variables

| Variable | Maps to | Notes |
| --- | --- | --- |
| `CHARLOTTE_NO_SANDBOX` | `browser.noSandbox` | `1`/`true`/`yes`/`on` enable; `0`/`false`/`no`/`off` disable. |
| `CHARLOTTE_OUTPUT_DIR` | `output.dir` | |
| `CHARLOTTE_CDP_ENDPOINT` | `browser.cdpEndpoint` | |
| `CHARLOTTE_AUTH_TOKEN` | `http.authToken` | HTTP-mode bearer token. Wins over the config file. Empty value = unset. |

## The Chromium sandbox (`--no-sandbox`)

The Chromium sandbox is the primary defense between a malicious web page and
the account Charlotte runs as. Because Charlotte navigates agents to arbitrary,
often untrusted, URLs, **the sandbox is enabled by default**.

Disable it only when you must (most commonly inside containers, where the
kernel sandbox cannot be set up). The opt-out is exposed three ways, in
precedence order:

```bash
charlotte --no-sandbox                 # CLI flag
CHARLOTTE_NO_SANDBOX=1 charlotte       # environment variable
# or "browser": { "noSandbox": true }  in the config file
```

The provided Dockerfiles set `CHARLOTTE_NO_SANDBOX=1` because the container
cannot use the kernel sandbox; `docker-compose.yml` keeps Docker's default
seccomp filter in place (it no longer uses `seccomp=unconfined`) so the
container is not left without any syscall filtering.

[zod]: https://github.com/colinhacks/zod
