/**
 * Modern (2026-07-28) tools/list cache hint (D20).
 *
 * The HTTP tool set is fixed at startup (D3), so `src/transports/http.ts`
 * declares a `cacheHints["tools/list"]` of `{ ttlMs: 3_600_000, cacheScope:
 * "private" }` on the `McpServer`. The SDK only ever fills these fields on
 * modern (2026-07-28) `tools/list` results — see the legacy-absent guard in
 * `tests/integration/http-transport.test.ts` for the 2025-era counterpart.
 * This test proves the modern side of that asymmetry: a modern request
 * actually observes `ttlMs`/`cacheScope` on the wire.
 */
import { describe, it, expect, afterEach } from "vitest";
import { setupHttpHarness, readJsonRpc, type HttpHarness } from "../helpers/http-harness.js";

describe("HTTP tools/list cache hint (D20, modern 2026-07-28)", () => {
  let harness: HttpHarness | undefined;

  afterEach(async () => {
    await harness?.teardown();
    harness = undefined;
  });

  it("carries ttlMs and cacheScope on a modern tools/list response", async () => {
    harness = await setupHttpHarness({ profile: "browse" });

    const response = await harness.postMcp(
      {
        jsonrpc: "2.0",
        id: 9001,
        method: "tools/list",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": { name: "charlotte-cache-test", version: "1.0.0" },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      },
      {
        headers: {
          "Mcp-Method": "tools/list",
          "Mcp-Name": "tools",
        },
      },
    );

    const message = await readJsonRpc(response);

    expect(message.result?.ttlMs).toBe(3_600_000);
    expect(message.result?.cacheScope).toBe("private");
  });
});
