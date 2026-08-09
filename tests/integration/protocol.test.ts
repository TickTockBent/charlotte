import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import { PROFILE_TOOLS, ALL_TOOL_NAMES } from "../../src/tools/tool-groups.js";
import { setupMcpHarness, parseToolJson, type McpHarness } from "../helpers/mcp-harness.js";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/client";

const SIMPLE_FIXTURE = `file://${path.resolve(import.meta.dirname, "../fixtures/pages/simple.html")}`;

describe("MCP protocol end-to-end", () => {
  let harness: McpHarness;

  beforeAll(async () => {
    harness = await setupMcpHarness({ profile: "browse" });
  });

  afterAll(async () => {
    await harness.teardown();
  });

  // ─── Server initialization and capability negotiation ───

  describe("server initialization and capability negotiation", () => {
    it("reports server identity after connection", () => {
      const serverVersion = harness.client.getServerVersion();
      expect(serverVersion).toBeDefined();
      expect(serverVersion!.name).toBe("charlotte");
      expect(serverVersion!.version).toBeTruthy();
    });

    it("negotiates expected capabilities", () => {
      const capabilities = harness.client.getServerCapabilities();
      expect(capabilities).toBeDefined();
      expect(capabilities!.tools).toEqual({ listChanged: true });
      // `logging` capability dropped (slice-0.md Step 3): sendLoggingMessage
      // was never called, and the capability is deprecated as of 2026-07-28.
      expect(capabilities!.logging).toBeUndefined();
    });

    it("provides server instructions mentioning profile", () => {
      const instructions = harness.client.getInstructions();
      expect(instructions).toBeDefined();
      expect(instructions).toContain("Charlotte browser automation server");
      expect(instructions).toContain("Active profile: browse");
    });
  });

  // ─── tools/list ───

  describe("tools/list", () => {
    it("returns the correct number of tools for the browse profile", async () => {
      const expectedToolCount = PROFILE_TOOLS["browse"].length + 1; // +1 for charlotte_tools meta-tool
      const { tools } = await harness.client.listTools();
      expect(tools).toHaveLength(expectedToolCount);
    });

    it("all tool names follow the charlotte_ naming convention", async () => {
      const { tools } = await harness.client.listTools();
      for (const tool of tools) {
        expect(tool.name).toMatch(/^charlotte_/);
      }
    });

    it("each tool has a description and inputSchema", async () => {
      const { tools } = await harness.client.listTools();
      for (const tool of tools) {
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe("object");
      }
    });

    it("full profile exposes all tools", async () => {
      // Independent harness on the "full" profile — only listTools is called.
      const fullHarness = await setupMcpHarness({ profile: "full" });
      try {
        const expectedFullCount = ALL_TOOL_NAMES.length + 1; // +1 for charlotte_tools
        const { tools } = await fullHarness.client.listTools();
        expect(tools).toHaveLength(expectedFullCount);
      } finally {
        await fullHarness.teardown();
      }
    });
  });

  // ─── Navigate + observe round-trip ───

  describe("navigate + observe round-trip", () => {
    it("navigates to a fixture page and returns page representation", async () => {
      const result = (await harness.callTool("charlotte_navigate", {
        url: SIMPLE_FIXTURE,
        detail: "summary",
      })) as CallToolResult;

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);

      const page = parseToolJson<{
        url: string;
        title: string;
        structure: { landmarks: unknown[]; headings: unknown[] };
        interactive: unknown[];
      }>(result);
      expect(page.url).toContain("simple.html");
      expect(page.title).toBe("Simple Test Page");
      expect(page.structure.landmarks.length).toBeGreaterThan(0);
      expect(page.structure.headings.length).toBeGreaterThan(0);
      expect(page.interactive.length).toBeGreaterThan(0);
    });

    it("observes the same page with minimal detail", async () => {
      // Depends on the prior navigate: observe reads the resulting page state.
      const result = await harness.callTool("charlotte_observe", { detail: "minimal" });

      expect(result.isError).toBeFalsy();

      const page = parseToolJson<{
        url: string;
        title: string;
        interactive_summary: { total: number };
      }>(result);
      expect(page.url).toContain("simple.html");
      expect(page.title).toBe("Simple Test Page");
      expect(page.interactive_summary).toBeDefined();
      expect(page.interactive_summary.total).toBeGreaterThan(0);
    });
  });

  // ─── Error handling ───

  describe("error handling", () => {
    // D9 (docs/remote/decisions.md): under SDK v1 an unknown tool name came back
    // as an in-band `isError` result; SDK v2 raises it as a -32602 protocol
    // error instead. The channel change is a signed-off v2 divergence, not a
    // regression — assert the code and the message, so a silent drift in either
    // still fails.
    it("rejects an unknown tool name with a -32602 protocol error", async () => {
      const rejection = await harness.callTool("charlotte_nonexistent", {}).then(
        () => {
          throw new Error("expected callTool to reject for an unknown tool name");
        },
        (error: unknown) => error,
      );

      expect(rejection).toBeInstanceOf(ProtocolError);
      expect((rejection as ProtocolError).code).toBe(ProtocolErrorCode.InvalidParams);
      expect((rejection as ProtocolError).message).toContain(
        "Tool charlotte_nonexistent not found",
      );
    });

    it("returns isError when a required parameter is missing", async () => {
      const result = await harness.callTool("charlotte_navigate", {});

      expect(result.isError).toBe(true);
      const errorText = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(errorText).toContain("Invalid arguments");
    });
  });
});
