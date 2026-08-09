/**
 * Unit tests for the `charlotte doctor` preflight checks (remote design
 * spec, slice 1). Covers the checks that don't need a real browser —
 * config validity, auth-token presence, and port bindability — mirroring
 * `tests/unit/config/*.test.ts` conventions (no Chromium launched here).
 * The browser-launch check is exercised separately in
 * `tests/integration/doctor.test.ts`, since it needs real Chromium.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as net from "node:net";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  checkConfig,
  checkAuthToken,
  checkPortBindable,
  formatDoctorReport,
  type DoctorReport,
} from "../../src/doctor.js";

function writeTempConfig(content: unknown): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "charlotte-doctor-test-"));
  const file = path.join(dir, "charlotte.config.json");
  writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  return { dir, file };
}

describe("checkConfig", () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it("PASSes for a valid stdio config (no args)", () => {
    const { result, resolved } = checkConfig({ argv: [], cwd: os.tmpdir() });
    expect(result.status).toBe("PASS");
    expect(result.message).toMatch(/stdio mode/);
    expect(resolved?.http).toBe(false);
  });

  it("PASSes for a valid --http config and resolves the http block", () => {
    const { result, resolved } = checkConfig({
      argv: ["--http", "--port", "9191"],
      cwd: os.tmpdir(),
    });
    expect(result.status).toBe("PASS");
    expect(result.message).toMatch(/--http mode/);
    expect(resolved?.http).toBe(true);
    expect(resolved?.httpConfig.port).toBe(9191);
  });

  it("PASSes and reports publicOrigin when a valid one is configured", () => {
    const { dir, file } = writeTempConfig({
      http: { publicOrigin: "https://charlotte.example.com" },
    });
    tempDirs.push(dir);
    const { result } = checkConfig({ argv: ["--http", "--config", file], cwd: dir });
    expect(result.status).toBe("PASS");
    expect(result.message).toContain("https://charlotte.example.com");
  });

  it("FAILs with a clear message when the config file is invalid JSON/schema", () => {
    const { dir, file } = writeTempConfig({ browser: { headles: true } });
    tempDirs.push(dir);
    const { result, resolved } = checkConfig({ argv: ["--config", file], cwd: dir });
    expect(result.status).toBe("FAIL");
    expect(result.message).toMatch(/Configuration failed to load/);
    expect(result.hint).toBeTruthy();
    expect(resolved).toBeUndefined();
  });

  it("FAILs when --config points at a nonexistent file", () => {
    const { result } = checkConfig({ argv: ["--config", "/nonexistent/charlotte.config.json"] });
    expect(result.status).toBe("FAIL");
  });

  it("FAILs when http.publicOrigin has an invalid shape (e.g. http not https)", () => {
    const { dir, file } = writeTempConfig({
      http: { publicOrigin: "http://not-https.example.com" },
    });
    tempDirs.push(dir);
    const { result, resolved } = checkConfig({ argv: ["--http", "--config", file], cwd: dir });
    expect(result.status).toBe("FAIL");
    expect(result.message).toMatch(/publicOrigin is invalid/);
    // The rest of the resolved options are still returned even though this
    // one field is bad, since everything else did resolve.
    expect(resolved?.http).toBe(true);
  });
});

describe("checkAuthToken", () => {
  it("PASSes when CHARLOTTE_AUTH_TOKEN is set", () => {
    const { resolved } = checkConfig({
      argv: ["--http"],
      cwd: os.tmpdir(),
      env: { CHARLOTTE_AUTH_TOKEN: "secret-token" },
    });
    const result = checkAuthToken(resolved!, { CHARLOTTE_AUTH_TOKEN: "secret-token" });
    expect(result.status).toBe("PASS");
    expect(result.message).toMatch(/CHARLOTTE_AUTH_TOKEN/);
  });

  it("PASSes when only http.authToken (config file) is set", () => {
    const { dir, file } = writeTempConfig({ http: { authToken: "file-token" } });
    try {
      const { resolved } = checkConfig({ argv: ["--http", "--config", file], cwd: dir, env: {} });
      const result = checkAuthToken(resolved!, {});
      expect(result.status).toBe("PASS");
      expect(result.message).toMatch(/config file/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("FAILs when no token is configured anywhere", () => {
    const { resolved } = checkConfig({ argv: ["--http"], cwd: os.tmpdir(), env: {} });
    const result = checkAuthToken(resolved!, {});
    expect(result.status).toBe("FAIL");
    expect(result.hint).toMatch(/CHARLOTTE_AUTH_TOKEN/);
  });
});

describe("checkPortBindable", () => {
  it("PASSes for a free port", async () => {
    const result = await checkPortBindable("127.0.0.1", 0);
    // port 0 always binds an ephemeral port
    expect(result.status).toBe("PASS");
  });

  it("FAILs with an in-use hint when the port is already bound", async () => {
    const blocker = net.createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(0, "127.0.0.1", resolve);
    });
    const address = blocker.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;

    try {
      const result = await checkPortBindable("127.0.0.1", port);
      expect(result.status).toBe("FAIL");
      expect(result.message).toMatch(new RegExp(`${port}`));
      expect(result.hint).toMatch(/already/i);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });
});

describe("formatDoctorReport", () => {
  it("renders PASS/WARN/FAIL lines and a summary with the right counts", () => {
    const report: DoctorReport = {
      httpMode: true,
      checks: [
        { name: "A", status: "PASS", message: "ok" },
        { name: "B", status: "WARN", message: "meh", hint: "watch out" },
        { name: "C", status: "FAIL", message: "broken", hint: "fix it" },
      ],
      overall: "FAIL",
      exitCode: 1,
    };
    const text = formatDoctorReport(report);
    expect(text).toContain("[PASS] A");
    expect(text).toContain("[WARN] B");
    expect(text).toContain("-> watch out");
    expect(text).toContain("[FAIL] C");
    expect(text).toContain("-> fix it");
    expect(text).toContain("1 PASS, 1 WARN, 1 FAIL");
    expect(text).toContain("exit 1");
  });
});
