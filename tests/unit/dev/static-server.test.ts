import { describe, it, expect, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { StaticServer } from "../../../src/dev/static-server.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "../../fixtures/pages");

describe("StaticServer", () => {
  let server: StaticServer;

  afterEach(async () => {
    if (server?.isRunning()) {
      await server.stop();
    }
  });

  it("starts on auto-assigned port and returns valid info", async () => {
    server = new StaticServer();
    const info = await server.start({ directoryPath: FIXTURES_DIR });

    expect(info.port).toBeGreaterThan(0);
    // Server reports 127.0.0.1 (not localhost) to ensure headless Chromium can connect
    // even on hosts where localhost resolves to ::1 first (IPv6-only DNS).
    expect(info.url).toBe(`http://127.0.0.1:${info.port}`);
    expect(info.directoryPath).toBe(FIXTURES_DIR);
    expect(server.isRunning()).toBe(true);
  });

  it("serves static files from the directory", async () => {
    server = new StaticServer();
    const info = await server.start({ directoryPath: FIXTURES_DIR });

    const response = await fetch(`${info.url}/simple.html`);
    expect(response.ok).toBe(true);

    const html = await response.text();
    expect(html).toContain("Simple Test Page");
  });

  it("returns 404 for non-existent files", async () => {
    server = new StaticServer();
    const info = await server.start({ directoryPath: FIXTURES_DIR });

    const response = await fetch(`${info.url}/does-not-exist.html`);
    expect(response.status).toBe(404);
  });

  it("stops the server", async () => {
    server = new StaticServer();
    const info = await server.start({ directoryPath: FIXTURES_DIR });

    expect(server.isRunning()).toBe(true);
    await server.stop();
    expect(server.isRunning()).toBe(false);
    expect(server.getInfo()).toBeNull();

    // Verify the port is no longer listening
    await expect(fetch(`${info.url}/simple.html`)).rejects.toThrow();
  });

  it("restarts when start is called while already running", async () => {
    server = new StaticServer();
    const firstInfo = await server.start({ directoryPath: FIXTURES_DIR });
    const secondInfo = await server.start({ directoryPath: FIXTURES_DIR });

    // Different auto-assigned ports
    expect(secondInfo.port).not.toBe(firstInfo.port);
    expect(server.isRunning()).toBe(true);

    // The new server should be functional
    const response = await fetch(`${secondInfo.url}/simple.html`);
    expect(response.ok).toBe(true);
  });

  it("starts on a specific port", async () => {
    server = new StaticServer();

    // Find a free port by starting with auto-assign first
    const autoInfo = await server.start({ directoryPath: FIXTURES_DIR });
    const freePort = autoInfo.port;
    await server.stop();

    // Now start on that specific port
    const info = await server.start({
      directoryPath: FIXTURES_DIR,
      port: freePort,
    });
    expect(info.port).toBe(freePort);
  });

  it("getInfo returns server info while running", async () => {
    server = new StaticServer();
    expect(server.getInfo()).toBeNull();

    const info = await server.start({ directoryPath: FIXTURES_DIR });
    expect(server.getInfo()).toEqual(info);
  });

  // ── Security hardening tests ──

  it("blocks directory traversal when path lacks separator-anchored boundary", async () => {
    // /home/user/project-secrets should be blocked when root is /home/user/project
    // (would pass a bare startsWith check but fails the sep-anchored one)
    const parentDir = await fs.mkdtemp(path.join(os.tmpdir(), "charlotte-ss-test-root-"));
    const servedDir = path.join(parentDir, "project");
    await fs.mkdir(servedDir);
    const trickDir = path.join(parentDir, "project-secrets");
    await fs.mkdir(trickDir);

    try {
      server = new StaticServer();
      // Attempting to serve project-secrets with allowedRoot = project should throw
      await expect(
        server.start({ directoryPath: trickDir, allowedRoot: servedDir }),
      ).rejects.toThrow(/Directory traversal blocked/);
    } finally {
      await fs.rm(parentDir, { recursive: true, force: true });
    }
  });

  it("returns 403 for dotfile requests", async () => {
    server = new StaticServer();
    const info = await server.start({ directoryPath: FIXTURES_DIR });

    // .git/config (or any dotfile) should return 403
    const response = await fetch(`${info.url}/.git/config`);
    expect(response.status).toBe(403);
  });

  it("returns 403 for requests with dot-segment in path", async () => {
    server = new StaticServer();
    const info = await server.start({ directoryPath: FIXTURES_DIR });

    const response = await fetch(`${info.url}/.hidden-file`);
    expect(response.status).toBe(403);
  });

  it("returns 403 for symlinks that escape the served root", async () => {
    // Must create tempDir within cwd() (allowedRoot default) so the server can start
    const tempRoot = await fs.mkdtemp(
      path.join(process.cwd(), "tests", "fixtures", "tmp-symlink-test-"),
    );

    try {
      // Create a symlink inside tempRoot that points outside it
      const symlinkPath = path.join(tempRoot, "escape-link");
      const outsideTarget = os.tmpdir(); // a path outside tempRoot
      await fs.symlink(outsideTarget, symlinkPath);

      server = new StaticServer();
      const info = await server.start({ directoryPath: tempRoot });

      // Following the symlink would escape the directory — should be 403
      const response = await fetch(`${info.url}/escape-link/`);
      // Either 403 (blocked by middleware) or 404 (directory listing disabled) is acceptable,
      // but must NOT be 200 serving files from the escaped target.
      expect(response.status).not.toBe(200);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("reports 127.0.0.1 not localhost in URL", async () => {
    server = new StaticServer();
    const info = await server.start({ directoryPath: FIXTURES_DIR });
    expect(info.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });
});
