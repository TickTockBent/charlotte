/**
 * Transport-agnostic tool core types.
 *
 * Tool logic lives in `(ctx, args) => result` functions that know nothing about
 * MCP transports; stdio (and, later, HTTP) adapters are thin consumers of the
 * definitions assembled in {@link ./index.ts}.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
  ShapeOutput,
  ZodRawShapeCompat,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";
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
 * A transport-agnostic tool: its MCP-facing metadata plus the handler.
 *
 * Generic over the zod raw shape so `args` keeps exactly the type
 * `server.registerTool()` infers today (`ShapeOutput<Shape>`), with no `any`
 * in any handler signature.
 *
 * `handler` is declared with method syntax deliberately: that makes it
 * bivariant, so definitions with different shapes can live in a single
 * `ToolDefinition[]` (the assembled `charlotteTools`) without an unsafe cast
 * per module.
 */
export interface ToolDefinition<Shape extends ZodRawShapeCompat = ZodRawShapeCompat> {
  name: string;
  description: string;
  /** Zod raw shape — passed verbatim to the transport's tool registration. */
  inputSchema: Shape;
  handler(ctx: SessionContext, args: ShapeOutput<Shape>): Promise<ToolResult>;
}

/**
 * Identity helper that infers `Shape` from the `inputSchema` literal, so a
 * handler's destructured args are typed from its own zod schema without the
 * author writing the shape type out by hand.
 */
export function defineTool<Shape extends ZodRawShapeCompat>(
  definition: ToolDefinition<Shape>,
): ToolDefinition<Shape> {
  return definition;
}
