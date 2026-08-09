import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as http from "node:http";
import { setupHttpHarness, type HttpHarness } from "../helpers/http-harness.js";
import { parseToolJson } from "../helpers/mcp-harness.js";
import { pollUntil } from "../helpers/poll.js";
import { startHttpTransport } from "../../src/transports/http.js";
import { createDefaultConfig } from "../../src/types/config.js";
import type { SessionContext } from "../../src/core/types.js";
import type { CallToolResult } from "@modelcontextprotocol/client";

/**
 * I6 under test — the outbound SSRF / navigation guard (policy D14, mechanism
 * D15: the in-process loopback **filtering proxy**, verified by
 * spikes/s2-proxy-spike.md).
 *
 * The proxy fronts Chromium at the network layer (below Puppeteer's target
 * manager), so every egress — initial navigation, redirect hops, subresources,
 * and crucially a **popup's initial request** — is resolved, classified against
 * the deny-set, and refused before the connection is made unless
 * CIDR-allowlisted. Refusal is a clean NAVIGATION_BLOCKED, never a partial load.
 *
 * The popup cases are the I6 dimension the mechanism pivot exists for: the
 * earlier CDP-`Fetch` approach could not veto a popup's initial request without
 * tearing the popup down. Here they must genuinely pass.
 *
 * Targets are deterministic local servers (loopback + a second loopback address,
 * 127.0.0.2); the guard is driven by the harness `navigationGuardAllowlist`
 * option — the same allowlist HTTP-mode startup uses.
 */

interface LocalServer {
  server: http.Server;
  port: number;
}

function startServer(host: string, handler: http.RequestListener): Promise<LocalServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) resolve({ server, port: address.port });
      else reject(new Error("no port"));
    });
  });
}

function stopServer(target: LocalServer | undefined): Promise<void> {
  if (!target) return Promise.resolve();
  return new Promise((resolve) => {
    target.server.closeAllConnections?.();
    target.server.close(() => resolve());
  });
}

interface ToolErrorPayload {
  session_id: string;
  error: { code: string; message: string; suggestion?: string };
}

function errorText(payload: ToolErrorPayload): string {
  return `${payload.error.message} ${payload.error.suggestion ?? ""}`;
}

/** A refusal must read clean — no raw Chromium error, no stack frames. */
function assertNoRawLeak(text: string): void {
  expect(text).not.toContain("net::");
  expect(text).not.toContain("ERR_");
  expect(text).not.toMatch(/\n\s+at\s+/);
}

describe("I6 (proxy): navigation to a denied IP is refused before connect", () => {
  let harness: HttpHarness;
  let loopbackServer: LocalServer;
  let loopbackHit = false;

  beforeAll(async () => {
    loopbackHit = false;
    loopbackServer = await startServer("127.0.0.1", (_req, res) => {
      loopbackHit = true; // must never flip — refused before connect
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body>PRIVATE LOOPBACK CONTENT</body></html>");
    });
    harness = await setupHttpHarness({ navigationGuardAllowlist: [] }); // deny all private
  });

  afterAll(async () => {
    await harness?.teardown();
    await stopServer(loopbackServer);
  });

  it("blocks a loopback 127.0.0.1 target with NAVIGATION_BLOCKED and never serves it", async () => {
    const result: CallToolResult = await harness.callTool("charlotte_navigate", {
      url: `http://127.0.0.1:${loopbackServer.port}/`,
    });

    expect(result.isError).toBe(true);
    const payload = parseToolJson<ToolErrorPayload>(result);
    expect(payload.error.code).toBe("NAVIGATION_BLOCKED");
    const text = errorText(payload);
    expect(text).toContain("127.0.0.1");
    expect(text).toContain("127.0.0.0/8");
    expect(payload.error.suggestion).toContain('"allowPrivateNetworks": ["127.0.0.0/8"]');
    assertNoRawLeak(text);
    expect(loopbackHit).toBe(false);
  });

  it("blocks http://0.0.0.0 (0.0.0.0/8)", async () => {
    const result = await harness.callTool("charlotte_navigate", { url: "http://0.0.0.0/" });
    expect(result.isError).toBe(true);
    const payload = parseToolJson<ToolErrorPayload>(result);
    expect(payload.error.code).toBe("NAVIGATION_BLOCKED");
    const text = errorText(payload);
    expect(text).toContain("0.0.0.0");
    expect(text).toContain("0.0.0.0/8");
    assertNoRawLeak(text);
  });

  it("blocks an HTTPS target at the CONNECT stage (no TLS/cert work)", async () => {
    // A denied CONNECT is refused before any TCP connect, so no https server is
    // needed — the proxy vetoes 127.0.0.1 at CONNECT, Chromium fails the tunnel,
    // and the tool surfaces NAVIGATION_BLOCKED.
    const result = await harness.callTool("charlotte_navigate", {
      url: "https://127.0.0.1:9443/",
    });
    expect(result.isError).toBe(true);
    const payload = parseToolJson<ToolErrorPayload>(result);
    expect(payload.error.code).toBe("NAVIGATION_BLOCKED");
    const text = errorText(payload);
    expect(text).toContain("127.0.0.1");
    expect(text).toContain("127.0.0.0/8");
    assertNoRawLeak(text);
  });
});

describe("I6 (proxy): redirect hop + popups into a denied host are vetoed", () => {
  // Allow ONLY the entry host (127.0.0.1) so the initial request passes and the
  // redirect target / popup target (127.0.0.2) is the sole thing to catch.
  let harness: HttpHarness;
  let redirectServer: LocalServer;
  let openerServer: LocalServer;
  let privateServer: LocalServer;
  let privateHit = false;
  let privateUrl = "";

  beforeAll(async () => {
    privateHit = false;
    privateServer = await startServer("127.0.0.2", (_req, res) => {
      privateHit = true; // must never flip
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body>SSRF TARGET REACHED</body></html>");
    });
    privateUrl = `http://127.0.0.2:${privateServer.port}/private`;
    redirectServer = await startServer("127.0.0.1", (_req, res) => {
      res.writeHead(302, { location: privateUrl });
      res.end();
    });
    openerServer = await startServer("127.0.0.1", (_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        `<!doctype html><html><body>` +
          `<a id="link" href="${privateUrl}" target="_blank">blank</a>` +
          `<button id="winopen" onclick="window.open('${privateUrl}','_blank')">winopen</button>` +
          `</body></html>`,
      );
    });
    harness = await setupHttpHarness({ navigationGuardAllowlist: ["127.0.0.1/32"] });
  });

  afterAll(async () => {
    await harness?.teardown();
    await stopServer(redirectServer);
    await stopServer(openerServer);
    await stopServer(privateServer);
  });

  it("follows a redirect but refuses the private hop, and never serves it", async () => {
    privateHit = false;
    const result = await harness.callTool("charlotte_navigate", {
      url: `http://127.0.0.1:${redirectServer.port}/redirect`,
    });
    expect(result.isError).toBe(true);
    const payload = parseToolJson<ToolErrorPayload>(result);
    expect(payload.error.code).toBe("NAVIGATION_BLOCKED");
    const text = errorText(payload);
    expect(text).toContain("127.0.0.2"); // the hop, not the allowlisted entry
    expect(text).toContain("127.0.0.0/8");
    assertNoRawLeak(text);
    expect(privateHit).toBe(false);
  });

  // The pivot's whole point: a popup's INITIAL request is vetoed, never served.
  for (const trigger of ["winopen", "link"] as const) {
    const label = trigger === "winopen" ? "window.open()" : "target=_blank link";
    it(`blocks a popup opened via ${label} and never serves the private route`, async () => {
      privateHit = false;
      const opened = await harness.callTool("charlotte_navigate", {
        url: `http://127.0.0.1:${openerServer.port}/`,
      });
      expect(opened.isError).toBeFalsy();

      const page = harness.pageManager.getActivePage();
      const baselineTabs = (await harness.pageManager.listTabs()).length;
      await page.evaluate((id) => {
        (document.getElementById(id) as HTMLElement).click();
      }, trigger);

      // The popup opened (proves the case isn't vacuous)...
      await pollUntil(async () => (await harness.pageManager.listTabs()).length > baselineTabs, {
        message: "popup tab was never registered",
        timeout: 10000,
      });
      // ...and the proxy vetoed its initial request to the denied target.
      const block = await pollUntil(
        () => {
          const recorded = harness.pageManager.getLastNavigationBlock();
          return recorded?.ip === "127.0.0.2" ? recorded : undefined;
        },
        { message: "popup request to 127.0.0.2 was never vetoed", timeout: 10000 },
      );
      expect(block.matchedRange).toBe("127.0.0.0/8");
      // The private route behind the popup was NEVER served.
      expect(privateHit).toBe(false);
    });
  }
});

describe("S2-F2: HTTP mode refuses to start against an external CDP browser", () => {
  // The guard is enforced by a launch-time proxy (D15); it cannot front a
  // browser Charlotte did not launch. HTTP + cdpEndpoint must fail closed —
  // refuse to start — rather than silently serve an unguarded browser.
  it("throws a clear, actionable error and never begins listening", async () => {
    const config = createDefaultConfig();
    // Only `config` is touched before the refusal throws (guard-enable + check),
    // so a minimal ctx is sufficient — nothing gets to launch or listen.
    const ctx = { config } as unknown as SessionContext;

    await expect(
      startHttpTransport(ctx, {
        port: 0,
        host: "127.0.0.1",
        authToken: "test-token",
        profile: "browse",
        cdpEndpoint: "http://localhost:9222",
      }),
    ).rejects.toThrow(
      /SSRF navigation guard.*cannot be enforced when attaching to an external browser via CDP endpoint \(http:\/\/localhost:9222\)/s,
    );
  });

  it("does NOT refuse HTTP mode when no CDP endpoint is configured", async () => {
    // Sanity: the refusal is specific to the external-browser case. A guard-on
    // HTTP start without a cdpEndpoint proceeds (and is torn down normally).
    const harness = await setupHttpHarness({ navigationGuardAllowlist: ["127.0.0.0/8"] });
    expect(harness.transport.port).toBeGreaterThan(0);
    await harness.teardown();
  });
});

describe("I6 (proxy): an allowlisted range still SUCCEEDS (opt-out boundary)", () => {
  let harness: HttpHarness;
  let loopbackServer: LocalServer;
  let served = false;

  beforeAll(async () => {
    served = false;
    loopbackServer = await startServer("127.0.0.1", (_req, res) => {
      served = true;
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><head><title>Allowlisted</title></head><body><h1>OK</h1></body></html>");
    });
    harness = await setupHttpHarness({ navigationGuardAllowlist: ["127.0.0.0/8"] });
  });

  afterAll(async () => {
    await harness?.teardown();
    await stopServer(loopbackServer);
  });

  it("loads a loopback page when 127.0.0.0/8 is allowlisted (proxy pins + forwards)", async () => {
    const result = await harness.callTool("charlotte_navigate", {
      url: `http://127.0.0.1:${loopbackServer.port}/`,
    });
    expect(result.isError).toBeFalsy();
    const payload = parseToolJson<{ url: string; title: string }>(result);
    expect(payload.url).toBe(`http://127.0.0.1:${loopbackServer.port}/`);
    expect(payload.title).toBe("Allowlisted");
    expect(served).toBe(true);
  });
});
