#!/usr/bin/env bash
#
# Charlotte Remote container entrypoint (decision D27).
#
# Goal: `docker run charlotte` alone should stand up Charlotte Remote behind a
# public HTTPS URL and print everything the operator needs to paste into
# claude.ai. Everything else the image could already do keeps working.
#
# Mode ladder — first match wins:
#   0. explicit command args        -> exec them verbatim (`... doctor --http`)
#   1. /app/charlotte.config.json   -> today's behaviour, byte-for-byte
#   2. CHARLOTTE_TUNNEL=off         -> bearer-only HTTP on 0.0.0.0:3737
#   3. CHARLOTTE_PUBLIC_ORIGIN set  -> operator brings their own tunnel/proxy
#   4. (default)                    -> cloudflared quick tunnel, "demo mode"
#
# This runs as the non-root `charlotte` user, so every file it generates lives
# in /tmp — never /app, which is frequently a read-only bind mount.

set -euo pipefail

readonly MOUNTED_CONFIG_PATH="/app/charlotte.config.json"
readonly GENERATED_CONFIG_PATH="/tmp/charlotte.config.json"
readonly TUNNEL_LOG_PATH="/tmp/cloudflared.log"
# Charlotte's HTTP port default (src/config/schema.ts). Modes 2-4 write their
# own config and never override `port`, so this constant is authoritative for
# the health probe and the tunnel origin.
readonly CHARLOTTE_PORT=3737
readonly LOCAL_BASE_URL="http://127.0.0.1:${CHARLOTTE_PORT}"
readonly TUNNEL_URL_TIMEOUT_SECONDS=45
readonly HEALTH_TIMEOUT_SECONDS=30
readonly BANNER_RULE="──────────────────────────────────────────────────"

# Everything this script says goes to stderr, matching Charlotte's own logger
# (src/utils/logger.ts) so the ordering in `docker logs` is faithful.
log() {
  printf '[charlotte-entrypoint] %s\n' "$*" >&2
}

# ─── Mode 0: an explicit command overrides the whole ladder ───
# Preserves `docker compose run --rm charlotte node dist/index.js doctor --http`
# and friends, which SELF_HOSTING.md documents.
if [[ $# -gt 0 ]]; then
  exec "$@"
fi

# ─── Mode 1: operator-supplied config file ───
# The compose path. Do not write config, do not start a tunnel, do not touch
# the token — Charlotte itself still refuses to start without one.
if [[ -f "$MOUNTED_CONFIG_PATH" ]]; then
  log "Using ${MOUNTED_CONFIG_PATH} (operator-supplied); no tunnel, no generated config."
  exec node dist/index.js --http
fi

# ─── Modes 2-4 ───

# Pick the mode before doing any work, so the failure messages can be specific.
if [[ "${CHARLOTTE_TUNNEL:-}" == "off" ]]; then
  mode="local"
elif [[ -n "${CHARLOTTE_PUBLIC_ORIGIN:-}" ]]; then
  mode="external-origin"
else
  mode="demo"
fi

# A token is mandatory in HTTP mode. Generate an ephemeral one rather than
# refusing to boot — but say so loudly in the banner, since it changes on every
# restart and invalidates the connector the operator just added.
auth_token_was_generated=0
if [[ -z "${CHARLOTTE_AUTH_TOKEN:-}" ]]; then
  CHARLOTTE_AUTH_TOKEN="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  auth_token_was_generated=1
fi
export CHARLOTTE_AUTH_TOKEN

charlotte_pid=""
tunnel_pid=""
shutdown_requested=0

# SIGTERM both children; each ignores a signal it has already handled.
stop_children() {
  local pid
  for pid in "$charlotte_pid" "$tunnel_pid"; do
    if [[ -n "$pid" ]]; then
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done
}

on_terminate() {
  shutdown_requested=1
  stop_children
}

# dumb-init is PID 1 and forwards signals here; `wait` below is interruptible,
# so the handler runs promptly on `docker stop`.
trap on_terminate TERM INT

# Writes {"http": {"host": "0.0.0.0"[, "publicOrigin": "..."]}}. Built by node
# so the origin is JSON-escaped rather than string-concatenated into the file.
write_generated_config() {
  local public_origin="$1"
  node -e '
    const [, outputPath, publicOrigin] = process.argv;
    const httpConfig = { host: "0.0.0.0" };
    if (publicOrigin) {
      httpConfig.publicOrigin = publicOrigin;
    }
    require("fs").writeFileSync(
      outputPath,
      JSON.stringify({ http: httpConfig }, null, 2) + "\n",
    );
  ' "$GENERATED_CONFIG_PATH" "$public_origin"
}

# Starts a cloudflared quick tunnel in the background. MUST be called from the
# main shell (not a command substitution) — a subshell would lose `tunnel_pid`
# and leave the tunnel unsupervised.
# `--config /dev/null` keeps cloudflared from picking up any stray config.
start_quick_tunnel() {
  : >"$TUNNEL_LOG_PATH"
  cloudflared --no-autoupdate --config /dev/null \
    tunnel --url "$LOCAL_BASE_URL" >>"$TUNNEL_LOG_PATH" 2>&1 &
  tunnel_pid=$!
}

# Echoes the public URL cloudflared assigned, once it appears in the log.
# Safe to call inside a command substitution: it only reads `tunnel_pid`.
discover_tunnel_url() {
  local deadline=$((SECONDS + TUNNEL_URL_TIMEOUT_SECONDS))
  local discovered_url=""
  while ((SECONDS < deadline)); do
    discovered_url="$(grep -om1 'https://[A-Za-z0-9.-]*\.trycloudflare\.com' "$TUNNEL_LOG_PATH" || true)"
    if [[ -n "$discovered_url" ]]; then
      printf '%s' "$discovered_url"
      return 0
    fi
    if ! kill -0 "$tunnel_pid" 2>/dev/null; then
      log "cloudflared exited before it published a URL. Its output:"
      tail -n 30 "$TUNNEL_LOG_PATH" >&2 || true
      return 1
    fi
    sleep 1
  done
  return 1
}

# Polls /healthz until it answers 200, or Charlotte dies, or we time out.
wait_for_charlotte() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
  while ((SECONDS < deadline)); do
    if node -e '
      fetch(process.argv[1])
        .then((response) => process.exit(response.ok ? 0 : 1))
        .catch(() => process.exit(1));
    ' "${LOCAL_BASE_URL}/healthz" 2>/dev/null; then
      return 0
    fi
    if ! kill -0 "$charlotte_pid" 2>/dev/null; then
      log "Charlotte exited during startup."
      return 1
    fi
    sleep 1
  done
  return 1
}

print_banner() {
  local connector_url="$1"
  {
    printf '\n%s\n' "$BANNER_RULE"
    printf '  Charlotte Remote is up.\n\n'
    printf '  Connector URL:   %s/mcp\n' "$connector_url"
    if ((auth_token_was_generated)); then
      printf '  Operator token:  %s\n' "$CHARLOTTE_AUTH_TOKEN"
    else
      printf '  Operator token:  (from CHARLOTTE_AUTH_TOKEN)\n'
    fi
    if [[ "$mode" == "local" ]]; then
      # No publicOrigin means no OAuth facade — plain bearer auth only.
      printf '                   (bearer-only: send it as `Authorization: Bearer <token>`;\n'
      printf '                    no OAuth facade without a public origin)\n'
    else
      printf '                   (enter it on Charlotte'"'"'s consent page when claude.ai asks —\n'
      printf '                    leave claude.ai'"'"'s OAuth Client ID/Secret fields blank)\n'
    fi
    printf '\n'
    case "$mode" in
      demo)
        # Only the quick-tunnel URL is ephemeral; the other modes have a
        # stable address, so the warning is scoped to this mode.
        printf '  This demo URL and token are EPHEMERAL:\n'
        printf '  - the URL changes every restart (re-add the connector after a restart)\n'
        if ((auth_token_was_generated)); then
          printf '  - the token was auto-generated; pass -e CHARLOTTE_AUTH_TOKEN=... for a stable one\n'
        fi
        ;;
      local)
        printf '  Local-only mode (CHARLOTTE_TUNNEL=off): nothing is exposed publicly.\n'
        printf '  Reach it on the port you mapped with `-p`.\n'
        if ((auth_token_was_generated)); then
          printf '\n  The token was auto-generated and changes on every restart;\n'
          printf '  pass -e CHARLOTTE_AUTH_TOKEN=... for a stable one.\n'
        fi
        ;;
      external-origin)
        printf '  Using the origin you supplied via CHARLOTTE_PUBLIC_ORIGIN. Point your\n'
        printf '  tunnel/proxy at this container'"'"'s port %s.\n' "$CHARLOTTE_PORT"
        if ((auth_token_was_generated)); then
          printf '\n  The token was auto-generated and changes on every restart;\n'
          printf '  pass -e CHARLOTTE_AUTH_TOKEN=... for a stable one.\n'
        fi
        ;;
    esac
    printf '%s\n\n' "$BANNER_RULE"
  } >&2
}

public_origin=""
case "$mode" in
  local)
    log "CHARLOTTE_TUNNEL=off — local bearer-only mode, no tunnel."
    ;;
  external-origin)
    public_origin="$CHARLOTTE_PUBLIC_ORIGIN"
    log "CHARLOTTE_PUBLIC_ORIGIN=${public_origin} — using your origin, no tunnel."
    ;;
  demo)
    log "Demo mode: starting a cloudflared quick tunnel (logs: ${TUNNEL_LOG_PATH})."
    start_quick_tunnel
    if ! public_origin="$(discover_tunnel_url)"; then
      log "FAILED: no cloudflared quick tunnel URL within ${TUNNEL_URL_TIMEOUT_SECONDS}s."
      log "Quick tunnels need outbound HTTPS to Cloudflare. To run without one:"
      log "  docker run -e CHARLOTTE_TUNNEL=off ...   (local bearer-only)"
      log "  docker run -e CHARLOTTE_PUBLIC_ORIGIN=https://your.host ...   (your own proxy)"
      stop_children
      exit 1
    fi
    log "Quick tunnel URL: ${public_origin}"
    ;;
esac

write_generated_config "$public_origin"
log "Wrote ${GENERATED_CONFIG_PATH}; starting Charlotte."

node dist/index.js --http --config "$GENERATED_CONFIG_PATH" &
charlotte_pid=$!

# Banner last, so it is what the operator actually sees at the bottom of the
# scrollback — but only once /healthz is genuinely answering.
if wait_for_charlotte; then
  case "$mode" in
    local) print_banner "$LOCAL_BASE_URL" ;;
    *) print_banner "$public_origin" ;;
  esac
else
  log "Charlotte did not become healthy within ${HEALTH_TIMEOUT_SECONDS}s — see the log above."
fi

# ─── Supervise ───
child_pids=("$charlotte_pid")
if [[ -n "$tunnel_pid" ]]; then
  child_pids+=("$tunnel_pid")
fi

child_exit_status=0
wait -n "${child_pids[@]}" || child_exit_status=$?

if ((shutdown_requested)); then
  log "Signal received — stopping Charlotte${tunnel_pid:+ and cloudflared}."
  wait || true
  exit 0
fi

log "A child process exited (status ${child_exit_status}); tearing down the other."
if [[ -n "$tunnel_pid" ]] && ! kill -0 "$tunnel_pid" 2>/dev/null; then
  # The tunnel is the quiet one (its output goes to a file), so surface it.
  tail -n 30 "$TUNNEL_LOG_PATH" >&2 || true
fi
stop_children
wait || true
exit "$child_exit_status"
