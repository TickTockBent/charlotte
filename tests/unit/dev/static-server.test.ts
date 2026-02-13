import { describe, it, expect, afterEach } from "vitest";
import * as path from "node:path";
import { StaticServer } from "../../../src/dev/static-server.js";

const FIXTURES_DIR = path.resolve(
  import.meta.dirname,
  "../../fixtures/pages",
);

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
    expect(info.url).toBe(`http://localhost:${info.port}`);
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
});
