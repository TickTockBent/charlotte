import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it, expect } from "vitest";
import { Browser, detectBrowserPlatform, resolveBuildId } from "@puppeteer/browsers";

// Puppeteer 25's downloader honors proxy env vars only when the optional
// `proxy-agent` peer is installed. Without it, Chrome downloads silently
// bypass the proxy (D37). The test is offline: the proxy refuses everything.
const PROXY_ENV_NAMES = ["HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "no_proxy"] as const;

const DIRECT_ATTEMPT_GUARD_MS = 5000;

describe("Chrome for Testing download proxy support", () => {
  it("routes the browser download through HTTPS_PROXY", async () => {
    const connectTargets: string[] = [];
    const plainRequests: string[] = [];

    const proxyServer = createServer((request, response) => {
      plainRequests.push(`${request.method} ${request.url}`);
      response.writeHead(403, { Connection: "close" });
      response.end();
    });
    proxyServer.on("connect", (request, clientSocket) => {
      connectTargets.push(`CONNECT ${request.url}`);
      clientSocket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    });
    await new Promise<void>((resolve) => proxyServer.listen(0, "127.0.0.1", resolve));
    const proxyUrl = `http://127.0.0.1:${(proxyServer.address() as AddressInfo).port}`;

    const originalEnv: Record<string, string | undefined> = {};
    for (const name of PROXY_ENV_NAMES) originalEnv[name] = process.env[name];

    let guardTimer: NodeJS.Timeout | undefined;
    try {
      process.env.HTTPS_PROXY = proxyUrl;
      process.env.HTTP_PROXY = proxyUrl;
      delete process.env.NO_PROXY;
      delete process.env.no_proxy;

      const resolution = resolveBuildId(Browser.CHROME, detectBrowserPlatform()!, "stable").catch(
        () => undefined,
      );
      const guard = new Promise<void>((resolve) => {
        guardTimer = setTimeout(resolve, DIRECT_ATTEMPT_GUARD_MS);
      });
      await Promise.race([resolution, guard]);

      expect(connectTargets).toContain("CONNECT googlechromelabs.github.io:443");
    } finally {
      clearTimeout(guardTimer);
      for (const name of PROXY_ENV_NAMES) {
        if (originalEnv[name] === undefined) delete process.env[name];
        else process.env[name] = originalEnv[name];
      }
      proxyServer.closeAllConnections();
      await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
    }
  });
});
