/**
 * `charlotte doctor [--http] [--config <path>] [--port <n>]` — a preflight
 * smoke-check a self-hoster runs before wiring claude.ai up to a remote
 * Charlotte (remote design spec, slice 1). It never starts the MCP server:
 * it validates config, checks the auth token and port (in `--http` mode),
 * and confirms Chromium actually launches and renders — the four things
 * that, if broken, otherwise surface as a confusing failure deep inside a
 * claude.ai connector setup instead of here, with a remediation hint.
 *
 * `runDoctor` is the pure-ish, testable core (it touches the filesystem via
 * `loadStartupConfig`, the network via a throwaway `net` listener, and
 * launches a real Chromium — but takes no live process state and returns a
 * plain, serializable {@link DoctorReport}). `runDoctorCli` is the thin
 * wrapper that formats the report to stdout and resolves an exit code;
 * `index.ts` calls it and does the actual `process.exit`.
 *
 * stdout, not stderr: doctor is a human command a self-hoster reads in a
 * terminal, not an MCP session — stdout is only reserved for the wire
 * protocol while Charlotte is actually serving stdio.
 */
import * as net from "node:net";
import { loadStartupConfig } from "./config/index.js";
import type { ResolvedOptions } from "./config/resolve.js";
import { normalizePublicOrigin } from "./transports/oauth-facade.js";
import { BrowserManager } from "./browser/browser-manager.js";

export type DoctorCheckStatus = "PASS" | "WARN" | "FAIL";

export interface DoctorCheckResult {
  /** Short, stable name for the check (also the anchor a hint refers back to). */
  name: string;
  status: DoctorCheckStatus;
  /** One-line human summary of what was found. */
  message: string;
  /** Present on WARN/FAIL: what to do about it. */
  hint?: string;
}

export interface DoctorReport {
  /** Whether this run evaluated `--http` mode (gates the http-only checks). */
  httpMode: boolean;
  checks: DoctorCheckResult[];
  overall: DoctorCheckStatus;
  /** `0` when no check FAILed (WARNs are allowed), non-zero otherwise. */
  exitCode: number;
}

export interface DoctorOptions {
  /** CLI args to resolve, e.g. `["--http", "--port", "9999"]`. The leading `doctor` positional must already be stripped. */
  argv?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

function pass(name: string, message: string): DoctorCheckResult {
  return { name, status: "PASS", message };
}

function warn(name: string, message: string, hint: string): DoctorCheckResult {
  return { name, status: "WARN", message, hint };
}

function fail(name: string, message: string, hint: string): DoctorCheckResult {
  return { name, status: "FAIL", message, hint };
}

/**
 * Check 1: config loads & validates. In `--http` mode also confirms the
 * `http` block resolved and, if `http.publicOrigin` is set, that its shape
 * is valid (the same validation `startHttpTransport` applies, run here
 * before anything tries to bind or launch).
 *
 * Returns the resolved options alongside the check result so the remaining
 * checks — which all need them — don't re-parse; `resolved` is `undefined`
 * when config loading itself failed, which short-circuits the rest of the
 * report (there is nothing valid left to check against).
 */
export function checkConfig(options: DoctorOptions): {
  result: DoctorCheckResult;
  resolved?: ResolvedOptions;
} {
  let resolved: ResolvedOptions;
  try {
    resolved = loadStartupConfig(options.argv ?? [], options.cwd, options.env);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      result: fail(
        "Config loads & validates",
        `Configuration failed to load: ${detail}`,
        "Fix the reported field(s) in your config file (or the --config path / CLI flags) and re-run doctor.",
      ),
    };
  }

  if (resolved.http && resolved.httpConfig.publicOrigin !== undefined) {
    try {
      normalizePublicOrigin(resolved.httpConfig.publicOrigin);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        result: fail(
          "Config loads & validates",
          `http.publicOrigin is invalid: ${detail}`,
          'Set http.publicOrigin to an absolute https origin with no path, query, or credentials (e.g. "https://charlotte.example.com"), or unset it for bearer-only mode.',
        ),
        resolved,
      };
    }
  }

  const modeNote = resolved.http
    ? `--http mode; http block resolved to ${resolved.httpConfig.host}:${resolved.httpConfig.port}` +
      (resolved.httpConfig.publicOrigin !== undefined
        ? `, publicOrigin ${resolved.httpConfig.publicOrigin}`
        : "")
    : "stdio mode";
  const initScriptNote =
    resolved.initScripts.length > 0
      ? `; ${resolved.initScripts.length} init script(s): ${resolved.initScripts
          .map((script) => script.source)
          .join(", ")}`
      : "";
  return {
    result: pass(
      "Config loads & validates",
      `Configuration is valid (${modeNote}${initScriptNote}).`,
    ),
    resolved,
  };
}

/**
 * Check 2 (`--http` only): a bearer token resolves from `CHARLOTTE_AUTH_TOKEN`
 * or `http.authToken`. FAILs when absent, since `startHttpTransport` refuses
 * to bind at all in that case — better to catch it here than after the
 * self-hoster has already pointed claude.ai at the URL.
 */
export function checkAuthToken(
  resolved: ResolvedOptions,
  env: NodeJS.ProcessEnv,
): DoctorCheckResult {
  const token = resolved.httpConfig.authToken?.trim();
  if (token) {
    const source = env.CHARLOTTE_AUTH_TOKEN?.trim()
      ? "CHARLOTTE_AUTH_TOKEN environment variable"
      : "http.authToken in the config file";
    return pass("Auth token present", `A bearer token is configured (source: ${source}).`);
  }
  return fail(
    "Auth token present",
    "No bearer token is configured. Checked CHARLOTTE_AUTH_TOKEN (unset) and http.authToken in the config file (unset).",
    'Set CHARLOTTE_AUTH_TOKEN in the environment, or "http": { "authToken": "..." } in the config file — Charlotte will not serve HTTP without one.',
  );
}

/**
 * Check 3 (`--http` only): actually bind `host:port` on a throwaway server,
 * then release it immediately. Confirms both "is something already
 * listening there" and "do we have permission to bind it" — the two
 * failure modes `startHttpTransport`'s own `listen()` would hit.
 */
export function checkPortBindable(host: string, port: number): Promise<DoctorCheckResult> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      server.close();
      let hint: string;
      if (error.code === "EADDRINUSE") {
        hint = `Something else is already listening on ${host}:${port}. Stop it, or pass a different --port / http.port.`;
      } else if (error.code === "EACCES") {
        hint = `Permission denied binding ${host}:${port}. Ports below 1024 need elevated privileges — use a port >= 1024 (default 3737) or grant the process the capability.`;
      } else {
        hint = `Could not bind ${host}:${port}: ${error.message}. Check the host address is valid and reachable from this machine.`;
      }
      resolve(
        fail(
          "Port bindable",
          `Failed to bind ${host}:${port} (${error.code ?? error.message}).`,
          hint,
        ),
      );
    });
    server.once("listening", () => {
      server.close(() => {
        resolve(pass("Port bindable", `${host}:${port} is free and bindable.`));
      });
    });
    server.listen(port, host);
  });
}

/**
 * Check 4 (always): launch a `BrowserManager` honoring the resolved
 * `noSandbox` setting, open a tab, navigate a trivial `data:` URL, and read
 * back its title. PASS confirms Chromium can actually render for this
 * install; FAIL surfaces the launch error with a container-oriented hint
 * (the most common cause on a host without a working sandbox). In `--http`
 * mode with the sandbox OFF, a successful launch is downgraded to WARN —
 * remote + unsandboxed is a hardening regression (spec §3.5), not a launch
 * failure, so it should not block a green doctor run but must not go unsaid.
 */
export async function checkBrowser(resolved: ResolvedOptions): Promise<DoctorCheckResult> {
  const browserManager = new BrowserManager(undefined, { noSandbox: resolved.noSandbox });
  try {
    await browserManager.launch();
    const page = await browserManager.newPage();
    try {
      await page.goto("data:text/html,<title>Charlotte%20Doctor</title><h1>charlotte doctor</h1>");
      const title = await page.title();
      if (title !== "Charlotte Doctor") {
        return fail(
          "Browser launches & renders",
          `Chromium launched but the test page rendered unexpectedly (title: ${JSON.stringify(title)}).`,
          "Chromium started but rendering looks broken; check for a corrupted install or an incompatible Chromium version.",
        );
      }
      const sandboxNote = resolved.noSandbox ? "sandbox: OFF" : "sandbox: ON";
      if (resolved.http && resolved.noSandbox) {
        return warn(
          "Browser launches & renders",
          `Chromium launched and rendered a test page (${sandboxNote}).`,
          "Remote + unsandboxed Chromium is a hardening regression (design spec §3.5): a hostile page now exploits the renderer on your server, not the visitor's machine. Only run --no-sandbox / CHARLOTTE_NO_SANDBOX in a container with a working seccomp profile (see https://charlotte.mintlify.site/self-hosting and https://charlotte.mintlify.site/docker).",
        );
      }
      return pass(
        "Browser launches & renders",
        `Chromium launched and rendered a test page (${sandboxNote}).`,
      );
    } finally {
      await page.close().catch(() => {});
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fail(
      "Browser launches & renders",
      `Chromium failed to launch or render: ${detail}`,
      "If running in a container, pass --no-sandbox (or CHARLOTTE_NO_SANDBOX=1) and make sure a seccomp profile / userns setup is available (see https://charlotte.mintlify.site/self-hosting and https://charlotte.mintlify.site/docker); on bare metal, check that Chromium's dependencies are installed.",
    );
  } finally {
    await browserManager.close().catch(() => {});
  }
}

function summarize(checks: DoctorCheckResult[]): {
  overall: DoctorCheckStatus;
  exitCode: number;
} {
  const hasFail = checks.some((check) => check.status === "FAIL");
  const hasWarn = checks.some((check) => check.status === "WARN");
  const overall: DoctorCheckStatus = hasFail ? "FAIL" : hasWarn ? "WARN" : "PASS";
  return { overall, exitCode: hasFail ? 1 : 0 };
}

/**
 * Run every applicable doctor check and return the structured report.
 *
 * Config is checked first; if it fails to load there is nothing valid to
 * check the rest against, so the report stops there with a single FAIL.
 * Auth-token and port checks only run in `--http` mode (they are meaningless
 * for stdio, which never binds a port or requires a token). The browser
 * check always runs — Chromium has to work for either transport.
 */
export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const env = options.env ?? process.env;
  const checks: DoctorCheckResult[] = [];

  const { result: configResult, resolved } = checkConfig(options);
  checks.push(configResult);

  if (!resolved) {
    const { overall, exitCode } = summarize(checks);
    return { httpMode: false, checks, overall, exitCode };
  }

  const httpMode = resolved.http;

  if (httpMode) {
    checks.push(checkAuthToken(resolved, env));
    checks.push(await checkPortBindable(resolved.httpConfig.host, resolved.httpConfig.port));
  }

  checks.push(await checkBrowser(resolved));

  const { overall, exitCode } = summarize(checks);
  return { httpMode, checks, overall, exitCode };
}

/** Render a {@link DoctorReport} as the human-readable text `runDoctorCli` prints to stdout. */
export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push(`Charlotte doctor — mode: ${report.httpMode ? "http" : "stdio"}`);
  lines.push("");
  for (const check of report.checks) {
    lines.push(`[${check.status}] ${check.name}`);
    lines.push(`       ${check.message}`);
    if (check.hint) {
      lines.push(`       -> ${check.hint}`);
    }
  }
  lines.push("");
  const counts = { PASS: 0, WARN: 0, FAIL: 0 } as Record<DoctorCheckStatus, number>;
  for (const check of report.checks) counts[check.status]++;
  lines.push(
    `Summary: ${counts.PASS} PASS, ${counts.WARN} WARN, ${counts.FAIL} FAIL — overall ${report.overall} (exit ${report.exitCode})`,
  );
  return lines.join("\n");
}

/**
 * Thin CLI wrapper: run doctor, print the human report to stdout, and
 * resolve the exit code the caller should pass to `process.exit`.
 */
export async function runDoctorCli(
  argv: string[] = [],
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const report = await runDoctor({ argv, cwd, env });
  process.stdout.write(formatDoctorReport(report) + "\n");
  return report.exitCode;
}
