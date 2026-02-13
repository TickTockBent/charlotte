import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BrowserManager } from "./browser/browser-manager.js";
import { PageManager } from "./browser/page-manager.js";
import { CDPSessionManager } from "./browser/cdp-session.js";
import { RendererPipeline } from "./renderer/renderer-pipeline.js";
import { ElementIdGenerator } from "./renderer/element-id-generator.js";
import { createServer } from "./server.js";
import { logger } from "./utils/logger.js";

async function main(): Promise<void> {
  logger.info("Charlotte starting");

  // Initialize browser
  const browserManager = new BrowserManager();
  await browserManager.launch();

  // Initialize page management
  const pageManager = new PageManager();

  // Open a default tab
  await pageManager.openTab(browserManager);

  // Initialize renderer pipeline
  const cdpSessionManager = new CDPSessionManager();
  const elementIdGenerator = new ElementIdGenerator();
  const rendererPipeline = new RendererPipeline(
    cdpSessionManager,
    elementIdGenerator,
  );

  // Create and configure MCP server
  const mcpServer = createServer({
    browserManager,
    pageManager,
    rendererPipeline,
    elementIdGenerator,
  });

  // Connect stdio transport
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  logger.info("Charlotte MCP server running on stdio");

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down");
    await mcpServer.close();
    await browserManager.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  logger.error("Fatal error", error);
  process.exit(1);
});
