/**
 * Zod schema for Charlotte's JSON configuration file (issue #19).
 *
 * The config file is the lowest-precedence configuration source above
 * built-in defaults: CLI args > env vars > config file > defaults.
 *
 * Every option that can be set on the command line (see src/cli.ts) is
 * also settable here, plus the runtime tunables that live on
 * CharlotteConfig (snapshot depth, auto-snapshot mode, etc.).
 *
 * The schema is intentionally `.strict()` at every level so a typo in a
 * key name produces a clear startup error instead of being silently
 * ignored.
 */

import { z } from "zod";

const ToolProfileSchema = z.enum(["core", "browse", "interact", "develop", "audit", "full"]);

const ToolGroupSchema = z.enum([
  "navigation",
  "observation",
  "interaction",
  "session",
  "dev_mode",
  "dialog",
  "evaluate",
  "monitoring",
]);

const AutoSnapshotSchema = z.enum(["every_action", "observe_only", "manual"]);

const DialogAutoDismissSchema = z.enum(["none", "accept_alerts", "accept_all", "dismiss_all"]);

/** `browser` section — Chromium launch / connection settings. */
const BrowserConfigSchema = z
  .object({
    /** Run Chromium headless. Default true. CLI: --no-headless. */
    headless: z.boolean().optional(),
    /**
     * Disable the Chromium sandbox (issue #184). Default false — the
     * sandbox is ON by default. Only enable this inside containers or
     * other environments where the sandbox cannot be used.
     * CLI: --no-sandbox, env: CHARLOTTE_NO_SANDBOX.
     */
    noSandbox: z.boolean().optional(),
    /**
     * Connect to an existing Chrome via CDP instead of launching one.
     * Must start with http://, https://, ws://, wss://, or channel:.
     */
    cdpEndpoint: z.string().nullable().optional(),
  })
  .strict();

/** `tools` section — which tools are exposed. */
const ToolsConfigSchema = z
  .object({
    /** Named tool profile. Mutually exclusive with `groups`. */
    profile: ToolProfileSchema.optional(),
    /** Explicit list of tool groups. Mutually exclusive with `profile`. */
    groups: z.array(ToolGroupSchema).optional(),
  })
  .strict();

/** `snapshot` section — render / snapshot tunables. */
const SnapshotConfigSchema = z
  .object({
    /** Snapshot ring-buffer depth. */
    depth: z.number().int().positive().optional(),
    /** When Charlotte auto-captures snapshots. */
    autoSnapshot: AutoSnapshotSchema.optional(),
  })
  .strict();

/** `rendering` section — page representation tunables. */
const RenderingConfigSchema = z
  .object({
    /** Include iframe content in page representations. */
    includeIframes: z.boolean().optional(),
    /** Maximum iframe nesting depth to traverse. */
    iframeDepth: z.number().int().positive().optional(),
  })
  .strict();

/** `dialog` section — JavaScript dialog handling. */
const DialogConfigSchema = z
  .object({
    autoDismiss: DialogAutoDismissSchema.optional(),
  })
  .strict();

/** `output` section — where Charlotte writes files. */
const OutputConfigSchema = z
  .object({
    /** Directory for large tool output files (screenshots, logs). */
    dir: z.string().optional(),
  })
  .strict();

/**
 * Full Charlotte config-file schema. Every section is optional; an empty
 * `{}` is valid and simply falls through to defaults.
 */
export const CharlotteFileConfigSchema = z
  .object({
    browser: BrowserConfigSchema.optional(),
    tools: ToolsConfigSchema.optional(),
    snapshot: SnapshotConfigSchema.optional(),
    rendering: RenderingConfigSchema.optional(),
    dialog: DialogConfigSchema.optional(),
    output: OutputConfigSchema.optional(),
  })
  .strict();

export type CharlotteFileConfig = z.infer<typeof CharlotteFileConfigSchema>;
