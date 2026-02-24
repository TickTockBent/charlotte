import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as path from "node:path";
import * as http from "node:http";
import { BrowserManager } from "../../src/browser/browser-manager.js";
import { PageManager } from "../../src/browser/page-manager.js";
import { createDefaultConfig } from "../../src/types/config.js";
import type { CharlotteConfig } from "../../src/types/config.js";

const MONITORING_FIXTURE = `file://${path.resolve(import.meta.dirname, "../fixtures/pages/monitoring.html")}`;

describe("Monitoring integration", () => {
  let browserManager: BrowserManager;
  let config: CharlotteConfig;
  let pageManager: PageManager;

  beforeAll(async () => {
    browserManager = new BrowserManager();
    await browserManager.launch();
    config = createDefaultConfig();
    pageManager = new PageManager(config);
    await pageManager.openTab(browserManager);
  });

  afterAll(async () => {
    await browserManager.close();
  });

  describe("console message capture", () => {
    beforeEach(async () => {
      const page = pageManager.getActivePage();
      await page.goto(MONITORING_FIXTURE, { waitUntil: "load" });
      pageManager.clearConsoleMessages();
    });

    it("captures console.log messages", async () => {
      const page = pageManager.getActivePage();
      await page.click("#log-btn");
      await new Promise((resolve) => setTimeout(resolve, 100));

      const messages = pageManager.getConsoleMessages("log");
      expect(messages.length).toBeGreaterThanOrEqual(1);

      const logMessage = messages.find((m) => m.text === "log message");
      expect(logMessage).toBeDefined();
      expect(logMessage!.level).toBe("log");
      expect(logMessage!.timestamp).toBeTruthy();
    });

    it("captures console.info messages", async () => {
      const page = pageManager.getActivePage();
      await page.click("#info-btn");
      await new Promise((resolve) => setTimeout(resolve, 100));

      const messages = pageManager.getConsoleMessages("info");
      expect(messages.length).toBeGreaterThanOrEqual(1);

      const infoMessage = messages.find((m) => m.text === "info message");
      expect(infoMessage).toBeDefined();
      expect(infoMessage!.level).toBe("info");
    });

    it("captures console.warn messages", async () => {
      const page = pageManager.getActivePage();
      await page.click("#warn-btn");
      await new Promise((resolve) => setTimeout(resolve, 100));

      const messages = pageManager.getConsoleMessages("warn");
      expect(messages.length).toBeGreaterThanOrEqual(1);

      const warnMessage = messages.find((m) => m.text === "warning message");
      expect(warnMessage).toBeDefined();
      expect(warnMessage!.level).toBe("warn");
    });

    it("captures console.error messages", async () => {
      const page = pageManager.getActivePage();
      await page.click("#error-btn");
      await new Promise((resolve) => setTimeout(resolve, 100));

      const messages = pageManager.getConsoleMessages("error");
      expect(messages.length).toBeGreaterThanOrEqual(1);

      const errorMessage = messages.find((m) => m.text === "error message");
      expect(errorMessage).toBeDefined();
      expect(errorMessage!.level).toBe("error");
    });

    it("captures console.debug messages", async () => {
      const page = pageManager.getActivePage();
      await page.click("#debug-btn");
      await new Promise((resolve) => setTimeout(resolve, 100));

      const messages = pageManager.getConsoleMessages("debug");
      expect(messages.length).toBeGreaterThanOrEqual(1);

      const debugMessage = messages.find((m) => m.text === "debug message");
      expect(debugMessage).toBeDefined();
      expect(debugMessage!.level).toBe("debug");
    });

    it("returns all levels when filter is 'all'", async () => {
      const page = pageManager.getActivePage();
      await page.click("#multi-log-btn");
      await new Promise((resolve) => setTimeout(resolve, 100));

      const allMessages = pageManager.getConsoleMessages("all");
      const relevantMessages = allMessages.filter((m) =>
        ["first", "second", "third", "fourth"].includes(m.text),
      );

      expect(relevantMessages).toHaveLength(4);
      expect(relevantMessages.map((m) => m.level)).toEqual(
        expect.arrayContaining(["log", "info", "warn", "error"]),
      );
    });

    it("returns all levels when no filter provided", async () => {
      const page = pageManager.getActivePage();
      await page.click("#multi-log-btn");
      await new Promise((resolve) => setTimeout(resolve, 100));

      const allMessages = pageManager.getConsoleMessages();
      const relevantMessages = allMessages.filter((m) =>
        ["first", "second", "third", "fourth"].includes(m.text),
      );

      expect(relevantMessages).toHaveLength(4);
    });

    it("clearConsoleMessages empties the buffer", async () => {
      const page = pageManager.getActivePage();
      await page.click("#log-btn");
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(pageManager.getConsoleMessages().length).toBeGreaterThan(0);
      pageManager.clearConsoleMessages();
      expect(pageManager.getConsoleMessages()).toHaveLength(0);
    });

    it("getConsoleErrors still returns only error/warn for backward compat", async () => {
      const page = pageManager.getActivePage();
      await page.click("#multi-log-btn");
      await new Promise((resolve) => setTimeout(resolve, 100));

      const errors = pageManager.getConsoleErrors();
      for (const err of errors) {
        expect(["error", "warn"]).toContain(err.level);
      }
      // Should not include log or info
      expect(errors.find((e) => e.level === "log")).toBeUndefined();
      expect(errors.find((e) => e.level === "info")).toBeUndefined();
    });
  });

  describe("network request capture", () => {
    // Use a local HTTP server so fetch/XHR work (file:// doesn't support fetch)
    let httpServer: http.Server;
    let serverUrl: string;

    beforeAll(async () => {
      httpServer = http.createServer((req, res) => {
        if (req.url === "/api/data") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } else if (req.url === "/not-found") {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not Found");
        } else {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<html><body><h1>Test</h1></body></html>");
        }
      });

      await new Promise<void>((resolve) => {
        httpServer.listen(0, "127.0.0.1", () => resolve());
      });
      const address = httpServer.address() as { port: number };
      serverUrl = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    });

    beforeEach(async () => {
      pageManager.clearNetworkRequests();
      const page = pageManager.getActivePage();
      await page.goto(serverUrl, { waitUntil: "load" });
    });

    it("captures the page navigation request", async () => {
      const requests = pageManager.getNetworkRequests();
      const docRequest = requests.find(
        (r) => r.resourceType === "document" && r.url === `${serverUrl}/`,
      );
      expect(docRequest).toBeDefined();
      expect(docRequest!.method).toBe("GET");
      expect(docRequest!.status).toBe(200);
      expect(docRequest!.timestamp).toBeTruthy();
    });

    it("captures fetch requests with method and status", async () => {
      const page = pageManager.getActivePage();
      await page.evaluate(async (baseUrl) => {
        await fetch(`${baseUrl}/api/data`);
      }, serverUrl);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const requests = pageManager.getNetworkRequests();
      const apiRequest = requests.find((r) => r.url.includes("/api/data"));
      expect(apiRequest).toBeDefined();
      expect(apiRequest!.method).toBe("GET");
      expect(apiRequest!.status).toBe(200);
    });

    it("captures POST method correctly", async () => {
      const page = pageManager.getActivePage();
      await page.evaluate(async (baseUrl) => {
        await fetch(`${baseUrl}/api/data`, { method: "POST" });
      }, serverUrl);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const requests = pageManager.getNetworkRequests();
      const postRequest = requests.find(
        (r) => r.url.includes("/api/data") && r.method === "POST",
      );
      expect(postRequest).toBeDefined();
      expect(postRequest!.status).toBe(200);
    });

    it("captures failed requests (status >= 400)", async () => {
      const page = pageManager.getActivePage();
      await page.evaluate(async (baseUrl) => {
        await fetch(`${baseUrl}/not-found`);
      }, serverUrl);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const requests = pageManager.getNetworkRequests();
      const failedRequest = requests.find(
        (r) => r.url.includes("/not-found"),
      );
      expect(failedRequest).toBeDefined();
      expect(failedRequest!.status).toBe(404);
    });

    it("getNetworkErrors returns only status >= 400 for backward compat", async () => {
      const page = pageManager.getActivePage();
      await page.evaluate(async (baseUrl) => {
        await fetch(`${baseUrl}/not-found`);
      }, serverUrl);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const allRequests = pageManager.getNetworkRequests();
      const errors = pageManager.getNetworkErrors();

      // All errors should have status >= 400
      for (const err of errors) {
        expect(err.status).toBeGreaterThanOrEqual(400);
      }
      // Should have at least one error (the 404)
      expect(errors.length).toBeGreaterThanOrEqual(1);
      // Total requests should be > errors (page load + 404)
      expect(allRequests.length).toBeGreaterThan(errors.length);
    });

    it("clearNetworkRequests empties the buffer", async () => {
      expect(pageManager.getNetworkRequests().length).toBeGreaterThan(0);
      pageManager.clearNetworkRequests();
      expect(pageManager.getNetworkRequests()).toHaveLength(0);
    });

    it("captures resource type correctly", async () => {
      const requests = pageManager.getNetworkRequests();
      const docRequest = requests.find(
        (r) => r.url === `${serverUrl}/`,
      );
      expect(docRequest).toBeDefined();
      expect(docRequest!.resourceType).toBe("document");
    });

    it("captures fetch resource type", async () => {
      const page = pageManager.getActivePage();
      await page.evaluate(async (baseUrl) => {
        await fetch(`${baseUrl}/api/data`);
      }, serverUrl);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const requests = pageManager.getNetworkRequests();
      const fetchRequest = requests.find((r) => r.url.includes("/api/data"));
      expect(fetchRequest).toBeDefined();
      expect(fetchRequest!.resourceType).toBe("fetch");
    });
  });

  describe("clearErrors clears both buffers", () => {
    it("clears console messages and network requests together", async () => {
      const page = pageManager.getActivePage();
      await page.goto(MONITORING_FIXTURE, { waitUntil: "load" });
      await page.click("#log-btn");
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Console should have entries from the click
      expect(pageManager.getConsoleMessages().length).toBeGreaterThan(0);

      pageManager.clearErrors();

      expect(pageManager.getConsoleMessages()).toHaveLength(0);
      expect(pageManager.getNetworkRequests()).toHaveLength(0);
    });
  });
});
