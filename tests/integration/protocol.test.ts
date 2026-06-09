import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { BrowserManager } from "../../src/browser/browser-manager.js";
import { PageManager } from "../../src/browser/page-manager.js";
import { CDPSessionManager } from "../../src/browser/cdp-session.js";
import { RendererPipeline } from "../../src/renderer/renderer-pipeline.js";
import { ElementIdGenerator } from "../../src/renderer/element-id-generator.js";
import { SnapshotStore } from "../../src/state/snapshot-store.js";
import { ArtifactStore } from "../../src/state/artifact-store.js";
import { createDefaultConfig } from "../../src/types/config.js";
import { PROFILE_TOOLS, ALL_TOOL_NAMES } from "../../src/tools/tool-groups.js";
import type { ServerDeps } from "../../src/server.js";

const SIMPLE_FIXTURE = `file://${path.resolve(import.meta.dirname, "../fixtures/pages/simple.html")}`;

describe("MCP protocol end-to-end", () => {
  let browserManager: BrowserManager;
  let mcpClient: Client;
  let closeTransport: () => Promise<void>;

  beforeAll(async () => {
    browserManager = new BrowserManager(undefined, { noSandbox: true });
    await browserManager.launch();

    const config = createDefaultConfig();
    const pageManager = new PageManager(config);
    await pageManager.openTab(browserManager);
    const cdpSessionManager = new CDPSessionManager();
    const elementIdGenerator = new ElementIdGenerator();
    const rendererPipeline = new RendererPipeline(cdpSessionManager, elementIdGenerator);
    const artifactStore = new ArtifactStore(
      path.join(os.tmpdir(), "charlotte-protocol-test-artifacts"),
    );
    await artifactStore.initialize();

    const deps: ServerDeps = {
      browserManager,
      pageManager,
      cdpSessionManager,
      rendererPipeline,
      elementIdGenerator,
      snapshotStore: new SnapshotStore(config.snapshotDepth),
      artifactStore,
      config,
    };

    const { server } = createServer(deps, { profile: "browse" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    mcpClient = new Client({ name: "protocol-test", version: "1.0.0" });
    await mcpClient.connect(clientTransport);

    closeTransport = async () => {
      await mcpClient.close();
      await server.close();
    };
  });

  afterAll(async () => {
    await closeTransport();
    await browserManager.close();
  });

  // ─── Server initialization and capability negotiation ───

  describe("server initialization and capability negotiation", () => {
    it("reports server identity after connection", () => {
      const serverVersion = mcpClient.getServerVersion();
      expect(serverVersion).toBeDefined();
      expect(serverVersion!.name).toBe("charlotte");
      expect(serverVersion!.version).toBeTruthy();
    });

    it("negotiates expected capabilities", () => {
      const capabilities = mcpClient.getServerCapabilities();
      expect(capabilities).toBeDefined();
      expect(capabilities!.tools).toEqual({ listChanged: true });
      expect(capabilities!.logging).toEqual({});
    });

    it("provides server instructions mentioning profile", () => {
      const instructions = mcpClient.getInstructions();
      expect(instructions).toBeDefined();
      expect(instructions).toContain("Charlotte browser automation server");
      expect(instructions).toContain("Active profile: browse");
    });
  });

  // ─── tools/list ───

  describe("tools/list", () => {
    it("returns the correct number of tools for the browse profile", async () => {
      const expectedToolCount = PROFILE_TOOLS["browse"].length + 1; // +1 for charlotte_tools meta-tool
      const { tools } = await mcpClient.listTools();
      expect(tools).toHaveLength(expectedToolCount);
    });

    it("all tool names follow the charlotte_ naming convention", async () => {
      const { tools } = await mcpClient.listTools();
      for (const tool of tools) {
        expect(tool.name).toMatch(/^charlotte_/);
      }
    });

    it("each tool has a description and inputSchema", async () => {
      const { tools } = await mcpClient.listTools();
      for (const tool of tools) {
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe("object");
      }
    });

    it("full profile exposes all tools", async () => {
      // Ephemeral server/client pair — no browser operations, just listTools.
      // Pipeline instances are unshared (not wired like src/index.ts) since
      // only listTools is called and no rendering occurs.
      const mockDeps = {
        browserManager,
        pageManager: new PageManager(createDefaultConfig()),
        cdpSessionManager: new CDPSessionManager(),
        rendererPipeline: new RendererPipeline(new CDPSessionManager(), new ElementIdGenerator()),
        elementIdGenerator: new ElementIdGenerator(),
        snapshotStore: new SnapshotStore(5),
        artifactStore: new ArtifactStore(path.join(os.tmpdir(), "charlotte-protocol-full-test")),
        config: createDefaultConfig(),
      } satisfies ServerDeps;
      await mockDeps.artifactStore.initialize();

      const { server: fullServer } = createServer(mockDeps, { profile: "full" });
      const [fullClientTransport, fullServerTransport] = InMemoryTransport.createLinkedPair();
      await fullServer.connect(fullServerTransport);

      const fullClient = new Client({ name: "protocol-full-test", version: "1.0.0" });
      await fullClient.connect(fullClientTransport);

      try {
        const expectedFullCount = ALL_TOOL_NAMES.length + 1; // +1 for charlotte_tools
        const { tools } = await fullClient.listTools();
        expect(tools).toHaveLength(expectedFullCount);
      } finally {
        await fullClient.close();
        await fullServer.close();
      }
    });
  });

  // ─── Navigate + observe round-trip ───

  describe("navigate + observe round-trip", () => {
    // Tests are ordered: navigate runs first, observe reads the resulting page state
    it("navigates to a fixture page and returns page representation", async () => {
      const result = await mcpClient.callTool({
        name: "charlotte_navigate",
        arguments: { url: SIMPLE_FIXTURE, detail: "summary" },
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);

      const firstContent = (result.content as Array<{ type: string; text: string }>)[0];
      expect(firstContent.type).toBe("text");

      const page = JSON.parse(firstContent.text);
      expect(page.url).toContain("simple.html");
      expect(page.title).toBe("Simple Test Page");
      expect(page.structure.landmarks.length).toBeGreaterThan(0);
      expect(page.structure.headings.length).toBeGreaterThan(0);
      expect(page.interactive.length).toBeGreaterThan(0);
    });

    it("observes the same page with minimal detail", async () => {
      const result = await mcpClient.callTool({
        name: "charlotte_observe",
        arguments: { detail: "minimal" },
      });

      expect(result.isError).toBeFalsy();

      const page = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
      expect(page.url).toContain("simple.html");
      expect(page.title).toBe("Simple Test Page");
      expect(page.interactive_summary).toBeDefined();
      expect(page.interactive_summary.total).toBeGreaterThan(0);
    });
  });

  // ─── Error handling ───

  describe("error handling", () => {
    it("returns isError for an unknown tool name", async () => {
      const result = await mcpClient.callTool({
        name: "charlotte_nonexistent",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      const errorText = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(errorText).toContain("not found");
    });

    it("returns isError when a required parameter is missing", async () => {
      const result = await mcpClient.callTool({
        name: "charlotte_navigate",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      const errorText = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(errorText).toContain("Invalid arguments");
    });
  });
});
