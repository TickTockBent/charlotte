import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BrowserManager } from "./browser/browser-manager.js";
import type { PageManager } from "./browser/page-manager.js";
import type { RendererPipeline } from "./renderer/renderer-pipeline.js";
import type { ElementIdGenerator } from "./renderer/element-id-generator.js";
import type { SnapshotStore } from "./state/snapshot-store.js";
import type { CharlotteConfig } from "./types/config.js";
import { registerEvaluateTools } from "./tools/evaluate.js";
import { registerNavigationTools } from "./tools/navigation.js";
import { registerObservationTools } from "./tools/observation.js";
import { registerInteractionTools } from "./tools/interaction.js";
import { registerSessionTools } from "./tools/session.js";

export interface ServerDeps {
  browserManager: BrowserManager;
  pageManager: PageManager;
  rendererPipeline: RendererPipeline;
  elementIdGenerator: ElementIdGenerator;
  snapshotStore: SnapshotStore;
  config: CharlotteConfig;
}

export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer(
    {
      name: "charlotte",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Phase 1: evaluate tool
  registerEvaluateTools(server, {
    browserManager: deps.browserManager,
    getActivePage: () => deps.pageManager.getActivePage(),
  });

  // Phase 2–4: all tool modules share the same dependency bundle
  const toolDeps = {
    browserManager: deps.browserManager,
    pageManager: deps.pageManager,
    rendererPipeline: deps.rendererPipeline,
    elementIdGenerator: deps.elementIdGenerator,
    snapshotStore: deps.snapshotStore,
    config: deps.config,
  };

  registerNavigationTools(server, toolDeps);
  registerObservationTools(server, toolDeps);
  registerInteractionTools(server, toolDeps);
  registerSessionTools(server, toolDeps);

  return server;
}
