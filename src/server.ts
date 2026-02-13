import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BrowserManager } from "./browser/browser-manager.js";
import type { PageManager } from "./browser/page-manager.js";
import type { RendererPipeline } from "./renderer/renderer-pipeline.js";
import type { ElementIdGenerator } from "./renderer/element-id-generator.js";
import { registerEvaluateTools } from "./tools/evaluate.js";

export interface ServerDeps {
  browserManager: BrowserManager;
  pageManager: PageManager;
  rendererPipeline: RendererPipeline;
  elementIdGenerator: ElementIdGenerator;
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

  return server;
}
