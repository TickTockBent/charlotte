import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as path from "node:path";
import {
  setupMcpHarness,
  parseToolJson,
  parseToolText,
  type McpHarness,
} from "../helpers/mcp-harness.js";

const SIMPLE_FIXTURE = `file://${path.resolve(import.meta.dirname, "../fixtures/pages/simple.html")}`;

/**
 * Exercises the real `charlotte_evaluate` handler (src/tools/evaluate.ts) end to
 * end through the MCP transport. Previously this file drove Chromium's raw
 * `Runtime.evaluate` directly and never touched the handler — so the handler's
 * serialization, byte-cap, timeout, and error-response logic were untested
 * (#195). The behaviors those raw-CDP tests pinned (last-expression value,
 * multi-statement/ASI handling, exceptions, promise awaiting, DOM-node
 * descriptions) are ported here as assertions against the handler's response.
 */
describe("charlotte_evaluate handler", () => {
  let harness: McpHarness;

  beforeAll(async () => {
    harness = await setupMcpHarness({ profile: "full" });
  });

  afterAll(async () => {
    await harness.teardown();
  });

  beforeEach(async () => {
    await harness.callTool("charlotte_navigate", { url: SIMPLE_FIXTURE });
  });

  it("evaluates a single expression and returns its value + type", async () => {
    const result = await harness.callTool("charlotte_evaluate", { expression: "'hello'" });
    expect(result.isError).toBeFalsy();
    const parsed = parseToolJson<{ value: unknown; type: string }>(result);
    expect(parsed.type).toBe("string");
    expect(parsed.value).toBe("hello");
  });

  it("evaluates multi-statement code and returns the last expression value", async () => {
    const result = await harness.callTool("charlotte_evaluate", {
      expression: "var x = 1; var y = 2; x + y",
    });
    expect(result.isError).toBeFalsy();
    const parsed = parseToolJson<{ value: unknown; type: string }>(result);
    expect(parsed.type).toBe("number");
    expect(parsed.value).toBe(3);
  });

  it("evaluates multi-statement code with newlines (no ASI return bug)", async () => {
    // This is the exact pattern that failed with new Function('return ' + expr)
    // due to ASI turning "return\n" into "return;".
    const result = await harness.callTool("charlotte_evaluate", {
      expression: [
        "// Find elements",
        "const blocks = document.querySelectorAll('h1');",
        "const paragraphs = document.querySelectorAll('p');",
        "'headings=' + blocks.length + ' paragraphs=' + paragraphs.length;",
      ].join("\n"),
    });
    expect(result.isError).toBeFalsy();
    const parsed = parseToolJson<{ value: string; type: string }>(result);
    expect(parsed.type).toBe("string");
    expect(parsed.value).toContain("headings=");
    expect(parsed.value).toContain("paragraphs=");
  });

  it("evaluates var declarations followed by an expression (formerly silent null)", async () => {
    const result = await harness.callTool("charlotte_evaluate", {
      expression:
        "var blocks = document.querySelectorAll('[data-line]');\n" +
        "var gutters = document.querySelectorAll('.gutter');\n" +
        "'dataLine=' + blocks.length + ' gutter=' + gutters.length;",
    });
    expect(result.isError).toBeFalsy();
    const parsed = parseToolJson<{ value: string; type: string }>(result);
    expect(parsed.type).toBe("string");
    // Should NOT be undefined/null — the last expression should be returned.
    expect(parsed.value).toContain("dataLine=");
  });

  it("returns an EVALUATION_ERROR (isError) for syntax errors instead of a silent null", async () => {
    const result = await harness.callTool("charlotte_evaluate", { expression: "if (true {" });
    expect(result.isError).toBe(true);
    const parsed = parseToolJson<{ error: { code: string; message: string } }>(result);
    expect(parsed.error.code).toBe("EVALUATION_ERROR");
    expect(parsed.error.message).toContain("Evaluation error");
  });

  it("evaluates an IIFE (backward compatible)", async () => {
    const result = await harness.callTool("charlotte_evaluate", {
      expression: "(() => { const x = 42; return x * 2; })()",
    });
    expect(result.isError).toBeFalsy();
    const parsed = parseToolJson<{ value: unknown; type: string }>(result);
    expect(parsed.type).toBe("number");
    expect(parsed.value).toBe(84);
  });

  it("awaits promises by default", async () => {
    const result = await harness.callTool("charlotte_evaluate", {
      expression: "Promise.resolve('async result')",
    });
    expect(result.isError).toBeFalsy();
    const parsed = parseToolJson<{ value: unknown; type: string }>(result);
    expect(parsed.type).toBe("string");
    expect(parsed.value).toBe("async result");
  });

  it("serializes plain objects by value", async () => {
    // The handler always evaluates with returnByValue:true, so structured
    // results round-trip as JSON objects (DOM nodes serialize to {} this way —
    // hence agents project specific fields, which is what we assert here).
    const result = await harness.callTool("charlotte_evaluate", {
      expression: "({ tag: document.querySelector('h1').tagName, count: 1 + 1 })",
    });
    expect(result.isError).toBeFalsy();
    const parsed = parseToolJson<{ value: { tag: string; count: number }; type: string }>(result);
    expect(parsed.type).toBe("object");
    expect(parsed.value.tag).toBe("H1");
    expect(parsed.value.count).toBe(2);
  });

  it("returns undefined/null-typed results without throwing", async () => {
    const result = await harness.callTool("charlotte_evaluate", {
      expression: "void 0",
    });
    expect(result.isError).toBeFalsy();
    const parsed = parseToolJson<{ value: unknown; type: string }>(result);
    expect(parsed.type).toBe("undefined");
    expect(parsed.value).toBeNull();
  });

  it("times out a never-resolving promise with a TIMEOUT error", async () => {
    const result = await harness.callTool("charlotte_evaluate", {
      expression: "new Promise(() => {})",
      timeout: 200,
    });
    expect(result.isError).toBe(true);
    const parsed = parseToolJson<{ error: { code: string } }>(result);
    expect(parsed.error.code).toBe("TIMEOUT");
  });

  it("truncates results that exceed the evaluate byte cap", async () => {
    // maxEvaluateBytes defaults to 256_000; produce a string comfortably larger.
    const result = await harness.callTool("charlotte_evaluate", {
      expression: "'x'.repeat(400000)",
    });
    expect(result.isError).toBeFalsy();
    const text = parseToolText(result);
    expect(text).toContain("truncated");
    const parsed = parseToolJson<{ truncated?: { total_bytes: number } }>(result);
    expect(parsed.truncated).toBeDefined();
    expect(parsed.truncated!.total_bytes).toBeGreaterThan(256_000);
  });
});
