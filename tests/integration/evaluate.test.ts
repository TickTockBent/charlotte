import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as path from "node:path";
import { BrowserManager } from "../../src/browser/browser-manager.js";
import { PageManager } from "../../src/browser/page-manager.js";

const SIMPLE_FIXTURE = `file://${path.resolve(import.meta.dirname, "../fixtures/pages/simple.html")}`;

describe("Evaluate via CDP Runtime.evaluate", () => {
  let browserManager: BrowserManager;
  let pageManager: PageManager;

  beforeAll(async () => {
    browserManager = new BrowserManager();
    await browserManager.launch();
    pageManager = new PageManager();
    await pageManager.openTab(browserManager);
  });

  afterAll(async () => {
    await browserManager.close();
  });

  beforeEach(async () => {
    const page = pageManager.getActivePage();
    await page.goto(SIMPLE_FIXTURE, { waitUntil: "load" });
  });

  it("evaluates a single expression", async () => {
    const page = pageManager.getActivePage();
    const cdpSession = await page.createCDPSession();
    try {
      const result = await cdpSession.send("Runtime.evaluate", {
        expression: "'hello'",
        returnByValue: true,
      });
      expect(result.result.type).toBe("string");
      expect(result.result.value).toBe("hello");
      expect(result.exceptionDetails).toBeUndefined();
    } finally {
      await cdpSession.detach();
    }
  });

  it("evaluates multi-statement code and returns last value", async () => {
    const page = pageManager.getActivePage();
    const cdpSession = await page.createCDPSession();
    try {
      const result = await cdpSession.send("Runtime.evaluate", {
        expression: "var x = 1; var y = 2; x + y",
        returnByValue: true,
      });
      expect(result.result.type).toBe("number");
      expect(result.result.value).toBe(3);
    } finally {
      await cdpSession.detach();
    }
  });

  it("evaluates multi-statement code with newlines", async () => {
    const page = pageManager.getActivePage();
    const cdpSession = await page.createCDPSession();
    try {
      // This is the exact pattern that failed with new Function('return ' + expr)
      // due to ASI turning "return\n" into "return;"
      const result = await cdpSession.send("Runtime.evaluate", {
        expression: [
          "// Find elements",
          "const blocks = document.querySelectorAll('h1');",
          "const paragraphs = document.querySelectorAll('p');",
          "'headings=' + blocks.length + ' paragraphs=' + paragraphs.length;",
        ].join("\n"),
        returnByValue: true,
      });
      expect(result.result.type).toBe("string");
      expect(result.result.value).toContain("headings=");
      expect(result.result.value).toContain("paragraphs=");
    } finally {
      await cdpSession.detach();
    }
  });

  it("evaluates multi-statement code with var declarations (formerly silent null)", async () => {
    const page = pageManager.getActivePage();
    const cdpSession = await page.createCDPSession();
    try {
      const result = await cdpSession.send("Runtime.evaluate", {
        expression:
          "var blocks = document.querySelectorAll('[data-line]');\n" +
          "var gutters = document.querySelectorAll('.gutter');\n" +
          "'dataLine=' + blocks.length + ' gutter=' + gutters.length;",
        returnByValue: true,
      });
      expect(result.result.type).toBe("string");
      // Should NOT be undefined/null — the last expression should be returned
      expect(result.result.value).toContain("dataLine=");
    } finally {
      await cdpSession.detach();
    }
  });

  it("returns exception details for syntax errors", async () => {
    const page = pageManager.getActivePage();
    const cdpSession = await page.createCDPSession();
    try {
      const result = await cdpSession.send("Runtime.evaluate", {
        expression: "if (true {",
        returnByValue: true,
      });
      // Should have exception details, not a silent null
      expect(result.exceptionDetails).toBeDefined();
    } finally {
      await cdpSession.detach();
    }
  });

  it("evaluates an IIFE (backward compatible)", async () => {
    const page = pageManager.getActivePage();
    const cdpSession = await page.createCDPSession();
    try {
      const result = await cdpSession.send("Runtime.evaluate", {
        expression: "(() => { const x = 42; return x * 2; })()",
        returnByValue: true,
      });
      expect(result.result.type).toBe("number");
      expect(result.result.value).toBe(84);
    } finally {
      await cdpSession.detach();
    }
  });

  it("awaits promises when awaitPromise is true", async () => {
    const page = pageManager.getActivePage();
    const cdpSession = await page.createCDPSession();
    try {
      const result = await cdpSession.send("Runtime.evaluate", {
        expression: "Promise.resolve('async result')",
        returnByValue: true,
        awaitPromise: true,
      });
      expect(result.result.type).toBe("string");
      expect(result.result.value).toBe("async result");
    } finally {
      await cdpSession.detach();
    }
  });

  it("returns DOM node descriptions for non-serializable results", async () => {
    const page = pageManager.getActivePage();
    const cdpSession = await page.createCDPSession();
    try {
      const result = await cdpSession.send("Runtime.evaluate", {
        expression: "document.querySelector('h1')",
        returnByValue: false, // can't serialize DOM nodes by value
      });
      expect(result.result.type).toBe("object");
      expect(result.result.subtype).toBe("node");
      expect(result.result.description).toContain("h1");
    } finally {
      await cdpSession.detach();
    }
  });
});
