/**
 * Configuration resolution for Charlotte (issues #19, #184).
 *
 * Merges configuration from four sources with this precedence
 * (highest wins):
 *
 *   1. CLI arguments
 *   2. Environment variables
 *   3. Config file (JSON, validated with zod)
 *   4. Built-in defaults
 *
 * The merge logic here is a pure function (`resolveOptions`) so it can be
 * unit-tested without touching the filesystem or `process.argv`. The
 * thin I/O wrappers that read the actual config file and environment live
 * in `load-config.ts`.
 */

import type { ToolProfile, ToolGroupName } from "../tools/tool-groups.js";
import type {
  AutoSnapshotMode,
  DialogAutoDismiss,
  HttpTransportConfig,
  InitScript,
} from "../types/config.js";
import { DEFAULT_HTTP_CONFIG } from "../types/config.js";
import type { CharlotteFileConfig } from "./schema.js";
import { loadInitScripts } from "./load-config.js";

/**
 * Fully resolved Charlotte options after merging all sources. These feed
 * directly into index.ts startup: the `ServerOptions` half (profile /
 * toolGroups) plus the launch/runtime tunables.
 */
export interface ResolvedOptions {
  profile?: ToolProfile;
  toolGroups?: ToolGroupName[];
  outputDir?: string;
  headless: boolean;
  /** When true, Chromium launches with the sandbox DISABLED (issue #184). */
  noSandbox: boolean;
  cdpEndpoint?: string;
  /**
   * Init scripts (issue #18), read from disk during resolution so a missing
   * or unreadable file fails startup. `source` is the absolute path.
   */
  initScripts: InitScript[];
  snapshotDepth?: number;
  autoSnapshot?: AutoSnapshotMode;
  includeIframes?: boolean;
  iframeDepth?: number;
  dialogAutoDismiss?: DialogAutoDismiss;
  /** Output-size caps (issue #188). */
  maxInteractiveElements?: number;
  maxFullContentChars?: number;
  maxResponseBytes?: number;
  maxEvaluateBytes?: number;
  /**
   * Whether `--http` was passed. When false, Charlotte serves stdio (the
   * default, unchanged). The two modes are mutually exclusive in v1.
   */
  http: boolean;
  /**
   * Settings for the HTTP transport, always resolved (defaults included) so
   * `--http` has a complete config to hand to `startHttpTransport`. Ignored
   * entirely in stdio mode.
   */
  httpConfig: HttpTransportConfig;
}

/**
 * Values explicitly provided on the command line. Every field is optional:
 * presence means the user passed it. `noSandbox`/`headless` are tri-state
 * via `undefined` so they don't clobber lower-precedence sources when the
 * flag was absent.
 */
export interface CliInputs {
  profile?: ToolProfile;
  toolGroups?: ToolGroupName[];
  outputDir?: string;
  headless?: boolean;
  noSandbox?: boolean;
  cdpEndpoint?: string;
  /** `--init-script <path>` (repeatable). Relative paths resolve against cwd. */
  initScripts?: string[];
  /** `--http`: serve streamable HTTP instead of stdio. */
  http?: boolean;
  /** `--port <n>`: only meaningful together with `--http`. */
  port?: number;
}

/**
 * Values read from environment variables.
 */
export interface EnvInputs {
  noSandbox?: boolean;
  outputDir?: string;
  cdpEndpoint?: string;
  /** `CHARLOTTE_INIT_SCRIPT` — paths split on `path.delimiter`. Relative paths resolve against cwd. */
  initScripts?: string[];
  /** `CHARLOTTE_AUTH_TOKEN` — the HTTP mode bearer token. */
  authToken?: string;
}

const VALID_CDP_PREFIXES = ["http://", "https://", "ws://", "wss://", "channel:"];

function validateCdpEndpoint(endpoint: string): void {
  if (!VALID_CDP_PREFIXES.some((prefix) => endpoint.startsWith(prefix))) {
    throw new Error(
      `Invalid cdpEndpoint: ${endpoint}. Must start with one of: ${VALID_CDP_PREFIXES.join(", ")}`,
    );
  }
}

/**
 * Where relative paths in each configuration source are anchored. CLI and env
 * paths are relative to the process working directory; config-file paths are
 * relative to the config file itself (when its location is known), so a
 * config checked into a project keeps working from any cwd.
 */
export interface ResolveContext {
  /** Working directory for CLI/env relative paths. Default `process.cwd()`. */
  cwd?: string;
  /** Directory containing the loaded config file; falls back to `cwd`. */
  configDir?: string;
}

/**
 * Merge of CLI args, env vars, and config-file values into a single resolved
 * options object. Precedence: cli > env > file > defaults.
 *
 * Pure except for init scripts, whose files are read here so a bad path is a
 * startup error rather than a silently skipped script.
 */
export function resolveOptions(
  cli: CliInputs,
  env: EnvInputs,
  file: CharlotteFileConfig,
  context: ResolveContext = {},
): ResolvedOptions {
  const cwd = context.cwd ?? process.cwd();
  const configDir = context.configDir ?? cwd;

  // ── Tools: profile vs groups ──
  // A higher-precedence source that specifies *either* profile or groups
  // wins outright and clears the other, so file-level groups don't bleed
  // into a CLI-chosen profile.
  let profile: ToolProfile | undefined;
  let toolGroups: ToolGroupName[] | undefined;
  if (cli.profile !== undefined || cli.toolGroups !== undefined) {
    profile = cli.profile;
    toolGroups = cli.profile !== undefined ? undefined : cli.toolGroups;
  } else if (file.tools?.profile !== undefined || file.tools?.groups !== undefined) {
    profile = file.tools.profile;
    toolGroups = file.tools.profile !== undefined ? undefined : file.tools.groups;
  }

  // ── headless: default true ──
  const headless = cli.headless ?? file.browser?.headless ?? true;

  // ── noSandbox: default false (sandbox ON, issue #184) ──
  const noSandbox = cli.noSandbox ?? env.noSandbox ?? file.browser?.noSandbox ?? false;

  // ── cdpEndpoint: cli > env > file (null in file means "unset") ──
  const fileCdp = file.browser?.cdpEndpoint ?? undefined;
  const cdpEndpoint = cli.cdpEndpoint ?? env.cdpEndpoint ?? fileCdp ?? undefined;
  if (cdpEndpoint !== undefined) {
    validateCdpEndpoint(cdpEndpoint);
  }

  // ── initScripts: cli > env > file (whole list wins, no merging) ──
  // Each file is read now; a missing path fails startup with the path named.
  let initScripts: InitScript[] = [];
  if (cli.initScripts !== undefined && cli.initScripts.length > 0) {
    initScripts = loadInitScripts(cli.initScripts, cwd, "--init-script");
  } else if (env.initScripts !== undefined && env.initScripts.length > 0) {
    initScripts = loadInitScripts(env.initScripts, cwd, "CHARLOTTE_INIT_SCRIPT");
  } else if (file.browser?.initScripts !== undefined && file.browser.initScripts.length > 0) {
    initScripts = loadInitScripts(file.browser.initScripts, configDir, "browser.initScripts");
  }

  // ── outputDir: cli > env > file ──
  const outputDir = cli.outputDir ?? env.outputDir ?? file.output?.dir ?? undefined;

  // ── http block ──
  // Same precedence rule as everything else: cli > env > file > default. The
  // token is the one field with no default: absent here means "not configured",
  // and `startHttpTransport` refuses to start.
  const httpFile = file.http ?? {};
  const authToken = env.authToken ?? httpFile.authToken ?? undefined;
  const httpConfig: HttpTransportConfig = {
    port: cli.port ?? httpFile.port ?? DEFAULT_HTTP_CONFIG.port,
    host: httpFile.host ?? DEFAULT_HTTP_CONFIG.host,
    // `--profile` still wins in HTTP mode; the value is fixed at startup
    // either way, since a stateless transport has no per-connection registry.
    profile: cli.profile ?? httpFile.profile ?? DEFAULT_HTTP_CONFIG.profile,
    // The env switch (CHARLOTTE_DEBUG_HTTP) is read by the transport itself,
    // so an operator can observe a running deployment without a config edit;
    // this field is the config-file half of the same OR.
    debugRequests: httpFile.debugRequests ?? DEFAULT_HTTP_CONFIG.debugRequests,
    sessionIdleTtlMs: httpFile.sessionIdleTtlMs ?? DEFAULT_HTTP_CONFIG.sessionIdleTtlMs,
    maxSessions: httpFile.maxSessions ?? DEFAULT_HTTP_CONFIG.maxSessions,
    allowPrivateNetworks: httpFile.allowPrivateNetworks ?? [
      ...DEFAULT_HTTP_CONFIG.allowPrivateNetworks,
    ],
    allowedHosts: httpFile.allowedHosts ?? [...DEFAULT_HTTP_CONFIG.allowedHosts],
    enableDevTools: httpFile.enableDevTools ?? DEFAULT_HTTP_CONFIG.enableDevTools,
    artifactDelivery: httpFile.artifactDelivery ?? DEFAULT_HTTP_CONFIG.artifactDelivery,
  };
  if (authToken !== undefined) {
    httpConfig.authToken = authToken;
  }
  // Same "absent means unconfigured" treatment as the token: assigning
  // `undefined` would put the key in the object and make "unset" and "set to
  // nothing" indistinguishable downstream, where the difference is whether the
  // OAuth facade exists at all.
  const publicOrigin = httpFile.publicOrigin ?? undefined;
  if (publicOrigin !== undefined) {
    httpConfig.publicOrigin = publicOrigin;
  }

  return {
    profile,
    toolGroups,
    outputDir,
    headless,
    noSandbox,
    cdpEndpoint,
    initScripts,
    snapshotDepth: file.snapshot?.depth,
    autoSnapshot: file.snapshot?.autoSnapshot,
    includeIframes: file.rendering?.includeIframes,
    iframeDepth: file.rendering?.iframeDepth,
    dialogAutoDismiss: file.dialog?.autoDismiss,
    maxInteractiveElements: file.limits?.maxInteractiveElements,
    maxFullContentChars: file.limits?.maxFullContentChars,
    maxResponseBytes: file.limits?.maxResponseBytes,
    maxEvaluateBytes: file.limits?.maxEvaluateBytes,
    http: cli.http ?? false,
    httpConfig,
  };
}
