/**
 * stdio transport adapter.
 *
 * Registers the transport-agnostic tool definitions from `src/core/` against an
 * `McpServer`. The adapter owns everything MCP-specific — registration, the
 * `RegisteredTool` handles the profile machinery toggles, and (in server.ts)
 * the meta-tool that mutates that registry. Handlers themselves never see the
 * server.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { charlotteTools } from "../core/index.js";
import { waitForTools } from "../core/wait-for.js";
import type { SessionContext, ToolDefinition } from "../core/types.js";
import type { ToolRegistry } from "../tools/meta-tool.js";

/**
 * Register a list of core tool definitions against an McpServer and return the
 * resulting `RegisteredTool` handles keyed by tool name.
 *
 * The single `as never` cast is the whole erasure boundary: `charlotteTools`
 * holds definitions with heterogeneous zod shapes, while `registerTool` wants
 * the callback's `args` type tied to the shape it was handed. Each handler
 * keeps its own precisely-inferred `args` type (see `ToolDefinition`); only
 * this one call site erases it.
 */
export function registerToolDefinitions(
  server: McpServer,
  ctx: SessionContext,
  definitions: readonly ToolDefinition[],
): ToolRegistry {
  const registry: ToolRegistry = {};

  for (const definition of definitions) {
    // `inputSchema` is a zod raw shape, which SDK v2 still accepts (deprecated
    // overload — it wraps the shape in `z.object()` itself). Kept deliberately:
    // the raw shape is what `ToolDefinition`'s generic infers each handler's
    // `args` type from, and it keeps `src/core/` free of Standard-Schema
    // plumbing. Switching to `z.object()`-wrapped schemas is a separate change.
    registry[definition.name] = server.registerTool(
      definition.name,
      {
        description: definition.description,
        inputSchema: definition.inputSchema,
      },
      ((args: never) => definition.handler(ctx, args)) as never,
    );
  }

  return registry;
}

/**
 * Register every Charlotte tool against an McpServer, in the canonical order
 * from {@link charlotteTools}.
 */
export function registerCoreTools(server: McpServer, ctx: SessionContext): ToolRegistry {
  return registerToolDefinitions(server, ctx, charlotteTools);
}

/**
 * Register only the wait-for tool group.
 *
 * Retained as a named helper (it was `registerWaitForTools` in
 * `src/tools/wait-for.ts`) for callers that stand up a partial server with just
 * this tool.
 */
export function registerWaitForTools(server: McpServer, ctx: SessionContext): ToolRegistry {
  return registerToolDefinitions(server, ctx, waitForTools);
}
