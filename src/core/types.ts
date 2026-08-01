/**
 * Transport-agnostic tool core types.
 *
 * Tool logic lives in `(ctx, args) => result` functions that know nothing about
 * MCP transports; stdio (and, later, HTTP) adapters are thin consumers of the
 * definitions assembled in {@link ./index.ts}.
 */
import type { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { BrowserManager } from "../browser/browser-manager.js";
import type { PageManager } from "../browser/page-manager.js";
import type { CDPSessionManager } from "../browser/cdp-session.js";
import type { RendererPipeline } from "../renderer/renderer-pipeline.js";
import type { ElementIdGenerator } from "../renderer/element-id-generator.js";
import type { SnapshotStore } from "../state/snapshot-store.js";
import type { ArtifactStore } from "../state/artifact-store.js";
import type { CharlotteConfig } from "../types/config.js";
import type { DevModeState } from "../dev/dev-mode-state.js";

/**
 * The session identifier carried on every tool result's JSON payload (I2,
 * founding spec §5's schema reservation). MVP-fixed to a single constant —
 * post-MVP, once the HTTP transport (slice 1+) needs to distinguish concurrent
 * sessions, this becomes a minted per-connection handle. Kept as a literal
 * constant (not computed) so the shape of the reservation is visible at the
 * call site.
 */
export const DEFAULT_SESSION_ID = "default";

/**
 * Everything a tool handler needs to do its work: the browser-facing services,
 * the renderer pipeline, the stores, and the live config.
 *
 * This is the session's state, owned by the process that builds it — never by a
 * transport. Fields are identical to the historical `ServerDeps`/
 * `ToolDependencies` bundles, which are now aliases of this type.
 */
export interface SessionContext {
  browserManager: BrowserManager;
  pageManager: PageManager;
  cdpSessionManager: CDPSessionManager;
  rendererPipeline: RendererPipeline;
  elementIdGenerator: ElementIdGenerator;
  snapshotStore: SnapshotStore;
  artifactStore: ArtifactStore;
  config: CharlotteConfig;
  devModeState?: DevModeState;
}

/**
 * The payload a tool handler returns: `{ content: [...], isError?: true }`.
 *
 * Aliased to the MCP SDK's `CallToolResult` so the stdio adapter can hand
 * handler results straight back to `server.registerTool()` without conversion,
 * and so any drift in the SDK's expected shape surfaces at compile time.
 */
export type ToolResult = CallToolResult;

/**
 * A tool's input schema in zod "raw shape" form: one zod type per parameter.
 *
 * Local replacement for the SDK v1 type `ZodRawShapeCompat`, whose module
 * (`sdk/server/zod-compat.js`) no longer exists in the v2 package family — v2
 * takes Standard Schema objects and keeps no zod-specific type surface. Owning
 * the alias here is what lets `src/core/` stay free of transport-facing SDK
 * types (slice-1 risk note); the shape is still handed verbatim to
 * `registerTool()` by the adapter in `src/transports/`.
 */
export type ToolInputShape = Record<string, z.ZodType>;

/**
 * The parsed argument object a handler receives, inferred from its own raw
 * shape — i.e. exactly what `registerTool()` infers for its callback.
 *
 * Local replacement for the SDK v1 type `ShapeOutput<Shape>`; see
 * {@link ToolInputShape}.
 */
export type ToolInputArgs<Shape extends ToolInputShape> = z.infer<z.ZodObject<Shape>>;

/**
 * A transport-agnostic tool: its MCP-facing metadata plus the handler.
 *
 * Generic over the zod raw shape so `args` keeps exactly the type
 * `server.registerTool()` infers today ({@link ToolInputArgs}), with no `any`
 * in any handler signature.
 *
 * `handler` is declared with method syntax deliberately: that makes it
 * bivariant, so definitions with different shapes can live in a single
 * `ToolDefinition[]` (the assembled `charlotteTools`) without an unsafe cast
 * per module.
 */
export interface ToolDefinition<Shape extends ToolInputShape = ToolInputShape> {
  name: string;
  description: string;
  /** Zod raw shape — passed verbatim to the transport's tool registration. */
  inputSchema: Shape;
  handler(ctx: SessionContext, args: ToolInputArgs<Shape>): Promise<ToolResult>;
}

/**
 * Identity helper that infers `Shape` from the `inputSchema` literal, so a
 * handler's destructured args are typed from its own zod schema without the
 * author writing the shape type out by hand.
 */
export function defineTool<Shape extends ToolInputShape>(
  definition: ToolDefinition<Shape>,
): ToolDefinition<Shape> {
  return definition;
}
