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
import type { AutoSnapshotMode, DialogAutoDismiss } from "../types/config.js";
import type { CharlotteFileConfig } from "./schema.js";

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
  snapshotDepth?: number;
  autoSnapshot?: AutoSnapshotMode;
  includeIframes?: boolean;
  iframeDepth?: number;
  dialogAutoDismiss?: DialogAutoDismiss;
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
}

/**
 * Values read from environment variables.
 */
export interface EnvInputs {
  noSandbox?: boolean;
  outputDir?: string;
  cdpEndpoint?: string;
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
 * Pure merge of CLI args, env vars, and config-file values into a single
 * resolved options object. Precedence: cli > env > file > defaults.
 */
export function resolveOptions(
  cli: CliInputs,
  env: EnvInputs,
  file: CharlotteFileConfig,
): ResolvedOptions {
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

  // ── outputDir: cli > env > file ──
  const outputDir = cli.outputDir ?? env.outputDir ?? file.output?.dir ?? undefined;

  return {
    profile,
    toolGroups,
    outputDir,
    headless,
    noSandbox,
    cdpEndpoint,
    snapshotDepth: file.snapshot?.depth,
    autoSnapshot: file.snapshot?.autoSnapshot,
    includeIframes: file.rendering?.includeIframes,
    iframeDepth: file.rendering?.iframeDepth,
    dialogAutoDismiss: file.dialog?.autoDismiss,
  };
}
