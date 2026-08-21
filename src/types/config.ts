import type { ToolProfile } from "../tools/tool-groups.js";

export type AutoSnapshotMode = "every_action" | "observe_only" | "manual";
export type DialogAutoDismiss = "none" | "accept_alerts" | "accept_all" | "dismiss_all";
export type DeviceType = "mobile" | "tablet" | "desktop";

/** Default viewport dimensions for each device type. */
export const DEVICE_VIEWPORT_PRESETS: Record<DeviceType, { width: number; height: number }> = {
  /** Common Modern Laptop Effective Resolution */
  desktop: { width: 1440, height: 900 },
  /** iPhone 14 Pro Effective Resolution */
  mobile: { width: 393, height: 852 },
  /** Standard Tablet Resolution */
  tablet: { width: 768, height: 1024 },
};

/**
 * Upper bounds on rendered tool output (issue #188).
 *
 * Without these, a pathological page (100k links, infinite-scroll feed, a giant
 * document body) produces a multi-MB tool response that can blow the MCP
 * client's context window. Each cap degrades gracefully rather than failing:
 * arrays/text are truncated with an explicit marker, and the caller is steered
 * toward `output_file` or a narrower detail level.
 */
export interface OutputLimits {
  /** Max interactive elements serialized before the list is truncated. */
  maxInteractiveElements: number;
  /** Max characters of `full_content` text before truncation. */
  maxFullContentChars: number;
  /** Total byte ceiling for a formatted page response before degrading. */
  maxResponseBytes: number;
  /** Byte ceiling for a charlotte_evaluate result before truncation. */
  maxEvaluateBytes: number;
}

/**
 * A script registered to run on every new document before any page JS
 * (issue #18) — Charlotte's equivalent of Playwright's `--init-script`.
 * Applied per page via Puppeteer's `page.evaluateOnNewDocument()`.
 */
export interface InitScript {
  /**
   * Where the script came from, for logs: the resolved absolute file path for
   * startup-configured scripts, or a label like `dev_inject#1` for scripts
   * registered at runtime via `charlotte_dev_inject { persist: true }`.
   */
  source: string;
  /** The JavaScript source text to evaluate. */
  content: string;
}

/** How screenshot artifacts are delivered to a remote client ⟨D6⟩. */
export type ArtifactDelivery = "inline" | "resource";

/**
 * The `http` config block — settings for the remote streamable-HTTP transport
 * (`charlotte --http`), in the full shape reserved by the remote design spec §5.
 *
 * Deliberately NOT part of {@link CharlotteConfig}: that bundle is per-session
 * browser/render state owned by the tool core, while these are process-level
 * transport settings resolved once at startup. Transports consume the core;
 * the core never sees transport config (design principle 0.3).
 *
 * Slice 1 consumes `port`, `host`, `authToken`, `profile`, and
 * `debugRequests`. The remaining fields are validated and documented, and
 * their consumers are noted per field.
 */
export interface HttpTransportConfig {
  /** TCP port to listen on. */
  port: number;
  /** Bind address. */
  host: string;
  /** Static bearer token; `undefined` means "not configured" (startup error). */
  authToken?: string;
  /** Tool profile, fixed for the lifetime of the process. */
  profile: ToolProfile;
  /**
   * Log every request (method, path, redacted headers) and response status to
   * stderr. Diagnostics only; `CHARLOTTE_DEBUG_HTTP` enables it independently.
   */
  debugRequests: boolean;
  /**
   * Public https origin clients reach this server at. Enables the OAuth facade
   * ⟨D2⟩; `undefined` means "not configured" — bearer-only mode, no facade
   * routes, no `WWW-Authenticate` on the /mcp 401.
   */
  publicOrigin?: string;
  /** Idle ms before the session's browser is torn down (D17, consumed by the HTTP transport's idle sweep). Whole-browser teardown; the next tool call relaunches via the #201 recovery path. ⟨tune⟩ 30 min, not yet calibrated. */
  sessionIdleTtlMs: number;
  /** RESERVED (post-MVP): concurrent sessions per server; MVP is a hard 1. */
  maxSessions: number;
  /** CIDR allowlist for the SSRF guard (D15, live — wired into the navigation guard by the HTTP transport). Empty = deny all private ranges. */
  allowPrivateNetworks: string[];
  /**
   * Extra `Host` header hostnames to accept, on top of the always-allowed set
   * derived at startup (loopback trio + bind `host` + `publicOrigin` hostname).
   * The inbound DNS-rebind guard (D16) 403s any request whose Host is not on the
   * combined allowlist. Hostnames only, no ports; IPv6 in brackets (`[::1]`).
   * Empty (the default) relies entirely on the derived set — correct for the
   * loopback + tunnel deployment; add entries only for a reverse proxy that
   * presents some other Host.
   */
  allowedHosts: string[];
  /** RESERVED (slice 2): expose filesystem-serving dev tools over HTTP. */
  enableDevTools: boolean;
  /** RESERVED (slice 2 ⟨D6⟩): inline base64 vs resource-style artifacts. */
  artifactDelivery: ArtifactDelivery;
}

/**
 * Built-in defaults for {@link HttpTransportConfig}. `authToken` is absent on
 * purpose — there is no default token, ever. `publicOrigin` likewise: only the
 * operator knows the origin their tunnel publishes, and guessing it would turn
 * the OAuth facade on with wrong metadata.
 */
export const DEFAULT_HTTP_CONFIG: Omit<HttpTransportConfig, "authToken" | "publicOrigin"> = {
  // ⟨tune⟩ — an arbitrary high port, not yet calibrated against anything.
  port: 3737,
  // Loopback only. Remote reach comes from a tunnel in front, never from
  // binding a wider interface by default (pillar 5).
  host: "127.0.0.1",
  // Excludes dev_mode, evaluate, and monitoring groups by construction.
  profile: "browse",
  // Off: request logging is a diagnostic tool, not a default posture.
  debugRequests: false,
  // ⟨tune⟩ — 30 minutes. Consumed by the idle sweep (D17); the number itself is not yet calibrated/pinned.
  sessionIdleTtlMs: 1_800_000,
  maxSessions: 1,
  allowPrivateNetworks: [],
  allowedHosts: [],
  enableDevTools: false,
  artifactDelivery: "inline",
};

export interface CharlotteConfig {
  /** Root directory boundary for dev_serve to prevent path traversal */
  allowedWorkspaceRoot?: string;
  snapshotDepth: number;
  autoSnapshot: AutoSnapshotMode;
  dialogAutoDismiss: DialogAutoDismiss;
  /** Directory for persistent screenshot artifacts. Defaults to OS temp dir. */
  screenshotDir?: string;
  /** Directory for large tool output files. When set, tools with output_file support write here. */
  outputDir?: string;
  /** Whether to include iframe content in page representations. Default: false. */
  includeIframes: boolean;
  /** Maximum iframe nesting depth to traverse. Default: 3. */
  iframeDepth: number;
  /** Default viewport dimensions used at browser launch and as fallback. */
  defaultViewport: { width: number; height: number };
  /** Named device viewport presets for the charlotte_viewport tool. */
  deviceViewportPresets: Record<DeviceType, { width: number; height: number }>;
  /** Output-size caps that bound tool response size (issue #188). */
  limits: OutputLimits;
  /**
   * Operator-configured init scripts (issue #18), already read from disk at
   * startup. PageManager applies each to every page it manages, so they run
   * on every new document before page JS. Default: none.
   */
  initScripts: InitScript[];
  /**
   * Outbound SSRF / navigation guard (slice 2, decision D14). OFF by default so
   * stdio mode is entirely unaffected; the HTTP transport turns it on at
   * startup. When enabled, `PageManager.wirePageListeners` installs a CDP
   * `Fetch` request-stage veto that refuses any navigation whose DNS-resolved
   * IP falls in a private/loopback/link-local/metadata range, unless an
   * `allowPrivateNetworks` CIDR carves it back out.
   */
  navigationGuard: {
    /** When true, install the guard on every page. HTTP mode sets this. */
    enabled: boolean;
    /**
     * CIDR carve-outs from the default deny-set (mirrored from the HTTP
     * transport's `allowPrivateNetworks`; empty = deny all private ranges).
     */
    allowPrivateNetworks: string[];
  };
  /**
   * Remote (HTTP-mode) artifact handling (D6/D19, I8). OFF by default so stdio is
   * unaffected; HTTP startup flips `enabled` on. When enabled, the screenshot
   * tools cap inline images at `maxInlineBytes` (refuse+steer above it), omit
   * server filesystem paths, and default full_page to viewport.
   */
  remoteArtifacts: {
    /** When true, apply the remote artifact rules. HTTP mode sets this. */
    enabled: boolean;
    /** Inline image byte cap; above it the tool refuses and steers. */
    maxInlineBytes: number;
  };
}

/** Built-in defaults for {@link OutputLimits}. */
export const DEFAULT_OUTPUT_LIMITS: OutputLimits = {
  // ~2000 elements is far beyond any usable page yet still bounds the worst case.
  maxInteractiveElements: 2000,
  // ~200k chars (~50k tokens) of page text before truncating full_content.
  maxFullContentChars: 200_000,
  // ~1 MB serialized response. Above this we degrade to a summary + suggestion.
  maxResponseBytes: 1_000_000,
  // ~256 KB for an evaluate result before truncating + suggesting output_file.
  maxEvaluateBytes: 256_000,
};

export function createDefaultConfig(): CharlotteConfig {
  return {
    snapshotDepth: 50,
    autoSnapshot: "every_action",
    dialogAutoDismiss: "none",
    allowedWorkspaceRoot: process.cwd(), // Default to cwd for universal safety
    includeIframes: false,
    iframeDepth: 3,
    defaultViewport: { ...DEVICE_VIEWPORT_PRESETS.desktop },
    deviceViewportPresets: {
      desktop: { ...DEVICE_VIEWPORT_PRESETS.desktop },
      mobile: { ...DEVICE_VIEWPORT_PRESETS.mobile },
      tablet: { ...DEVICE_VIEWPORT_PRESETS.tablet },
    },
    limits: { ...DEFAULT_OUTPUT_LIMITS },
    initScripts: [],
    // Guard off by default: stdio mode never denies navigation. The HTTP
    // transport flips `enabled` on at startup (deny-private-by-default, D14).
    navigationGuard: { enabled: false, allowPrivateNetworks: [] },
    // Off by default: stdio never caps or path-strips screenshots. HTTP startup
    // flips `enabled` on (D6). 256 KB is Gate-D-priced (D6 §1, 2026-08-03) against
    // the screenshot size-distribution spike — pinned here in a reviewed build.
    remoteArtifacts: { enabled: false, maxInlineBytes: 256_000 },
  };
}
