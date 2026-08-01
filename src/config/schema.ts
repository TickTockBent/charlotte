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
 * `limits` section — upper bounds on rendered output (issue #188).
 *
 * These cap the size of tool responses so a pathological page (100k links,
 * infinite-scroll feed, a giant document body) cannot blow the MCP client's
 * context window. All are optional; omitted values fall through to the
 * built-in defaults in `createDefaultConfig`.
 */
const LimitsConfigSchema = z
  .object({
    /** Max interactive elements serialized before the list is truncated. */
    maxInteractiveElements: z.number().int().positive().optional(),
    /** Max characters of `full_content` text before truncation. */
    maxFullContentChars: z.number().int().positive().optional(),
    /** Total byte ceiling for a formatted page response before degrading. */
    maxResponseBytes: z.number().int().positive().optional(),
    /** Byte ceiling for a charlotte_evaluate result before truncation. */
    maxEvaluateBytes: z.number().int().positive().optional(),
  })
  .strict();

/** `http.artifactDelivery` — how screenshots reach a remote client. */
const ArtifactDeliverySchema = z.enum(["inline", "resource"]);

/**
 * `http` section — the remote (streamable HTTP) transport, landed in its FULL
 * shape per the remote design spec §5 even where this slice ignores fields
 * (design principle 0.5, "reserve schema early"). Every reserved field is
 * validated here and annotated with the slice that will consume it, so a
 * config written today against the documented surface keeps working when the
 * consumer lands.
 *
 * Consumed in slice 1: `port`, `host`, `authToken`, `profile`.
 */
const HttpConfigSchema = z
  .object({
    /** TCP port for `charlotte --http`. Default 3737 ⟨tune⟩. CLI: --port. */
    port: z.number().int().min(1).max(65535).optional(),
    /**
     * Bind address. Default 127.0.0.1 — loopback-only is this slice's security
     * posture (reach it through a tunnel, never by binding 0.0.0.0).
     *
     * NOT in design spec §5; added here because slice 3's container packaging
     * has to bind 0.0.0.0 inside the container to be reachable at all.
     */
    host: z.string().min(1).optional(),
    /**
     * Static bearer token. REQUIRED in HTTP mode, no default — the server
     * refuses to start without one. `CHARLOTTE_AUTH_TOKEN` takes precedence
     * over this field; `null` means "not set here".
     */
    authToken: z.string().nullable().optional(),
    /**
     * Tool profile, fixed at startup in HTTP mode (the tool set cannot be
     * mutated per-connection over a stateless transport). Default "browse",
     * which already excludes the dev_mode/evaluate/monitoring groups.
     */
    profile: ToolProfileSchema.optional(),
    /**
     * RESERVED (slice 2 — session lifecycle): idle milliseconds before a
     * session's browser pages are closed. Default 1800000 ⟨tune⟩. Validated
     * and ignored in slice 1.
     */
    sessionIdleTtlMs: z.number().int().positive().optional(),
    /**
     * RESERVED (post-MVP — multi-session): concurrent sessions per server.
     * MVP is a hard 1 (one implicit session). Validated and ignored.
     */
    maxSessions: z.number().int().positive().optional(),
    /**
     * RESERVED (slice 2 — SSRF guard): CIDR allowlist punching holes in the
     * default-deny of loopback/RFC1918/link-local/cloud-metadata navigation.
     * Empty = deny all private ranges. Validated and ignored in slice 1,
     * where the interim posture is loopback binding + tunnel + token.
     */
    allowPrivateNetworks: z.array(z.string()).optional(),
    /**
     * RESERVED (slice 2 — remote threat posture): expose the filesystem-serving
     * dev_mode tools over HTTP. Default false; enabling it will carry a loud
     * startup warning. Validated and ignored in slice 1 (the default `browse`
     * profile excludes those tools regardless).
     */
    enableDevTools: z.boolean().optional(),
    /**
     * RESERVED (slice 2 ⟨D6⟩ — artifact delivery): how screenshot artifacts
     * reach a client that cannot read the server's filesystem. Default
     * "inline". Validated and ignored in slice 1.
     */
    artifactDelivery: ArtifactDeliverySchema.optional(),
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
    limits: LimitsConfigSchema.optional(),
    http: HttpConfigSchema.optional(),
  })
  .strict();

export type CharlotteFileConfig = z.infer<typeof CharlotteFileConfigSchema>;
