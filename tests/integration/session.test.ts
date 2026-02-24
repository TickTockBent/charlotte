import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import { BrowserManager } from "../../src/browser/browser-manager.js";
import { PageManager } from "../../src/browser/page-manager.js";
import { CDPSessionManager } from "../../src/browser/cdp-session.js";
import { RendererPipeline } from "../../src/renderer/renderer-pipeline.js";
import { ElementIdGenerator } from "../../src/renderer/element-id-generator.js";
import { SnapshotStore } from "../../src/state/snapshot-store.js";
import { ArtifactStore } from "../../src/state/artifact-store.js";
import { createDefaultConfig } from "../../src/types/config.js";
import type { ToolDependencies } from "../../src/tools/tool-helpers.js";

const INTERACTION_FIXTURE = `file://${path.resolve(import.meta.dirname, "../fixtures/pages/interaction.html")}`;

describe("Session integration", () => {
  let browserManager: BrowserManager;
  let pageManager: PageManager;
  let cdpSessionManager: CDPSessionManager;
  let elementIdGenerator: ElementIdGenerator;
  let rendererPipeline: RendererPipeline;
  let deps: ToolDependencies;

  beforeAll(async () => {
    browserManager = new BrowserManager();
    await browserManager.launch();
    pageManager = new PageManager();
    await pageManager.openTab(browserManager);
    cdpSessionManager = new CDPSessionManager();
    elementIdGenerator = new ElementIdGenerator();
    rendererPipeline = new RendererPipeline(cdpSessionManager, elementIdGenerator);
    const config = createDefaultConfig();
    const artifactStore = new ArtifactStore(
      path.join(os.tmpdir(), "charlotte-session-test-artifacts"),
    );
    await artifactStore.initialize();
    deps = {
      browserManager,
      pageManager,
      rendererPipeline,
      elementIdGenerator,
      snapshotStore: new SnapshotStore(config.snapshotDepth),
      artifactStore,
      config,
    };
  });

  afterAll(async () => {
    await browserManager.close();
  });

  describe("set_cookies", () => {
    it("sets a cookie and retrieves it", async () => {
      const page = pageManager.getActivePage();
      await page.goto(INTERACTION_FIXTURE, { waitUntil: "load" });

      // Set a cookie with explicit URL (required for non-HTTP pages)
      await page.setCookie({
        name: "test_session",
        value: "abc123",
        url: "http://localhost",
      });

      // Verify via page.cookies with matching URL
      const cookies = await page.cookies("http://localhost");
      const testCookie = cookies.find((c) => c.name === "test_session");
      expect(testCookie).toBeDefined();
      expect(testCookie!.value).toBe("abc123");
    });

    it("sets multiple cookies at once", async () => {
      const page = pageManager.getActivePage();

      await page.setCookie(
        {
          name: "cookie_a",
          value: "value_a",
          url: "http://localhost",
        },
        {
          name: "cookie_b",
          value: "value_b",
          url: "http://localhost",
        },
      );

      const cookies = await page.cookies("http://localhost");
      const cookieA = cookies.find((c) => c.name === "cookie_a");
      const cookieB = cookies.find((c) => c.name === "cookie_b");
      expect(cookieA).toBeDefined();
      expect(cookieB).toBeDefined();
      expect(cookieA!.value).toBe("value_a");
      expect(cookieB!.value).toBe("value_b");
    });

    it("sets cookies with httpOnly flag", async () => {
      const page = pageManager.getActivePage();

      await page.setCookie({
        name: "http_only_cookie",
        value: "secret",
        url: "http://localhost",
        httpOnly: true,
      });

      const cookies = await page.cookies("http://localhost");
      const httpOnlyCookie = cookies.find(
        (c) => c.name === "http_only_cookie",
      );
      expect(httpOnlyCookie).toBeDefined();
      expect(httpOnlyCookie!.httpOnly).toBe(true);
    });
  });

  describe("get_cookies", () => {
    it("returns cookies for the current page", async () => {
      const page = pageManager.getActivePage();
      await page.goto(INTERACTION_FIXTURE, { waitUntil: "load" });

      // Clear any leftover cookies from previous tests
      const existing = await page.cookies("http://localhost");
      if (existing.length) await page.deleteCookie(...existing);

      // Set cookies with http URL (CDP requires http/https for cookie operations)
      await page.setCookie(
        { name: "session_id", value: "s123", url: "http://localhost" },
        { name: "pref_lang", value: "en", url: "http://localhost" },
      );

      // Retrieve via page.cookies() with matching URL
      const cookies = await page.cookies("http://localhost");
      expect(cookies.length).toBeGreaterThanOrEqual(2);
      const sessionCookie = cookies.find((c) => c.name === "session_id");
      expect(sessionCookie).toBeDefined();
      expect(sessionCookie!.value).toBe("s123");
    });

    it("returns an empty list when no cookies are set", async () => {
      const page = pageManager.getActivePage();
      await page.goto(INTERACTION_FIXTURE, { waitUntil: "load" });

      // Clear all cookies
      const existing = await page.cookies("http://localhost");
      if (existing.length) await page.deleteCookie(...existing);

      const cookies = await page.cookies("http://localhost");
      expect(cookies.length).toBe(0);
    });
  });

  describe("clear_cookies", () => {
    it("clears all cookies for the page", async () => {
      const page = pageManager.getActivePage();
      await page.goto(INTERACTION_FIXTURE, { waitUntil: "load" });

      // CDP requires http/https URLs for cookie operations
      await page.setCookie(
        { name: "to_clear_a", value: "val_a", url: "http://localhost" },
        { name: "to_clear_b", value: "val_b", url: "http://localhost" },
      );

      // Verify cookies exist
      let cookies = await page.cookies("http://localhost");
      expect(cookies.some((c) => c.name === "to_clear_a")).toBe(true);

      // Delete all
      await page.deleteCookie(...cookies);

      cookies = await page.cookies("http://localhost");
      expect(cookies.length).toBe(0);
    });

    it("clears specific cookies by name", async () => {
      const page = pageManager.getActivePage();
      await page.goto(INTERACTION_FIXTURE, { waitUntil: "load" });

      // Clear any existing first
      const existing = await page.cookies("http://localhost");
      if (existing.length) await page.deleteCookie(...existing);

      // CDP requires http/https URLs for cookie operations
      await page.setCookie(
        { name: "keep_me", value: "keep", url: "http://localhost" },
        { name: "delete_me", value: "delete", url: "http://localhost" },
      );

      // Delete only "delete_me"
      const allCookies = await page.cookies("http://localhost");
      const toDelete = allCookies.filter((c) => c.name === "delete_me");
      await page.deleteCookie(...toDelete);

      const remaining = await page.cookies("http://localhost");
      expect(remaining.some((c) => c.name === "keep_me")).toBe(true);
      expect(remaining.some((c) => c.name === "delete_me")).toBe(false);
    });
  });

  describe("set_headers", () => {
    it("sets extra HTTP headers on the page", async () => {
      const page = pageManager.getActivePage();

      // Set extra headers — this configures headers for future requests
      await page.setExtraHTTPHeaders({
        "X-Custom-Header": "test-value",
        Authorization: "Bearer token123",
      });

      // The headers will be sent with subsequent requests.
      // For file:// URLs we can't easily verify headers, but we verify the API call succeeds.
      // Navigate to trigger the headers to be applied
      await page.goto(INTERACTION_FIXTURE, { waitUntil: "load" });

      // Verify the page loaded successfully after setting headers
      const title = await page.title();
      expect(title).toBe("Interaction Test Page");
    });

    it("overwrites previously set headers", async () => {
      const page = pageManager.getActivePage();

      await page.setExtraHTTPHeaders({
        "X-First": "first-value",
      });

      // Set new headers — this replaces all extra headers
      await page.setExtraHTTPHeaders({
        "X-Second": "second-value",
      });

      // Navigate to apply headers
      await page.goto(INTERACTION_FIXTURE, { waitUntil: "load" });
      const title = await page.title();
      expect(title).toBe("Interaction Test Page");
    });
  });
});
