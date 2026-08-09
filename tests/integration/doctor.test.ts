/**
 * Integration test for `charlotte doctor`'s browser-launch check (remote
 * design spec, slice 1). This is the one doctor check that needs real
 * Chromium, so it lives here rather than in `tests/unit/doctor.test.ts`.
 *
 * This host (see CLAUDE.md / #184) cannot launch the sandboxed browser —
 * Chromium must run `--no-sandbox` here (AppArmor userns restriction) — so
 * these tests exercise the no-sandbox path throughout, which is also the
 * exact scenario the WARN behavior exists for: `--http` + `--no-sandbox`
 * must downgrade a passing render to WARN (spec §3.5), never FAIL, and never
 * silently PASS.
 */
import { describe, it, expect } from "vitest";
import * as net from "node:net";
import * as os from "node:os";
import { checkConfig, checkBrowser, runDoctor } from "../../src/doctor.js";

/**
 * Grab an ephemeral free port and release it immediately. `--port 0` isn't
 * accepted by the CLI parser (ports must be 1-65535, matching real startup),
 * so tests that need a guaranteed-free port ask the OS for one this way
 * instead — the same small-race tradeoff other Charlotte test suites make.
 */
async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

describe("checkBrowser (integration — real Chromium)", () => {
  it("PASSes and renders in stdio mode with the sandbox off (no WARN outside --http)", async () => {
    const { resolved } = checkConfig({
      argv: ["--no-sandbox"],
      cwd: os.tmpdir(),
    });
    expect(resolved?.noSandbox).toBe(true);
    expect(resolved?.http).toBe(false);

    const result = await checkBrowser(resolved!);
    expect(result.status).toBe("PASS");
    expect(result.message).toMatch(/sandbox: OFF/);
  }, 30_000);

  it("WARNs (not FAILs) when --http is combined with --no-sandbox", async () => {
    const { resolved } = checkConfig({
      argv: ["--http", "--no-sandbox"],
      cwd: os.tmpdir(),
    });
    expect(resolved?.noSandbox).toBe(true);
    expect(resolved?.http).toBe(true);

    const result = await checkBrowser(resolved!);
    expect(result.status).toBe("WARN");
    expect(result.message).toMatch(/sandbox: OFF/);
    expect(result.hint).toMatch(/hardening regression/);
  }, 30_000);
});

describe("runDoctor (integration — full report, real Chromium)", () => {
  it("--http with a token, a free port, and --no-sandbox: overall WARN, exit 0 (no FAIL)", async () => {
    const freePort = await getFreePort();
    const report = await runDoctor({
      argv: ["--http", "--no-sandbox", "--port", String(freePort)],
      cwd: os.tmpdir(),
      env: { CHARLOTTE_AUTH_TOKEN: "doctor-test-token" },
    });

    expect(report.httpMode).toBe(true);
    const byName = Object.fromEntries(report.checks.map((c) => [c.name, c]));
    expect(byName["Config loads & validates"].status).toBe("PASS");
    expect(byName["Auth token present"].status).toBe("PASS");
    expect(byName["Port bindable"].status).toBe("PASS");
    expect(byName["Browser launches & renders"].status).toBe("WARN");

    expect(report.overall).toBe("WARN");
    expect(report.exitCode).toBe(0);
  }, 30_000);

  it("stdio mode with --no-sandbox: overall PASS, exit 0, no http-only checks run", async () => {
    const report = await runDoctor({
      argv: ["--no-sandbox"],
      cwd: os.tmpdir(),
    });

    expect(report.httpMode).toBe(false);
    const names = report.checks.map((c) => c.name);
    expect(names).not.toContain("Auth token present");
    expect(names).not.toContain("Port bindable");
    expect(names).toContain("Browser launches & renders");

    expect(report.overall).toBe("PASS");
    expect(report.exitCode).toBe(0);
  }, 30_000);
});
