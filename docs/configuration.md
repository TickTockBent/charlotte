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

## Environment variables

| Variable | Maps to | Notes |
| --- | --- | --- |
| `CHARLOTTE_NO_SANDBOX` | `browser.noSandbox` | `1`/`true`/`yes`/`on` enable; `0`/`false`/`no`/`off` disable. |
| `CHARLOTTE_OUTPUT_DIR` | `output.dir` | |
| `CHARLOTTE_CDP_ENDPOINT` | `browser.cdpEndpoint` | |

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
