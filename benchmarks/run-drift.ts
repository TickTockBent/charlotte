#!/usr/bin/env node
/**
 * Drift benchmark.
 *
 * Measures how Charlotte's navigate-response size (orientation cost) and
 * tool-definition size have drifted across every release, against the same
 * live pages, run same-day. Each release is installed/built into its own
 * cache directory under benchmarks/.drift-cache/ so the comparison reflects
 * exactly what a user of that release got (including that release's own
 * bundled puppeteer/Chromium).
 *
 * Usage:
 *   npx tsx benchmarks/run-drift.ts --run-date 2026-08-09
 *   npx tsx benchmarks/run-drift.ts --run-date 2026-08-09 --versions v0.5.1,v0.8.0
 *   npx tsx benchmarks/run-drift.ts --run-date 2026-08-09 --setup-only
 *   npx tsx benchmarks/run-drift.ts --run-date 2026-08-09 --skip-setup
 *
 * --run-date (or env DRIFT_RUN_DATE) is required — see the same-day rule in
 * generateMarkdown()'s methodology notes: all versions must be re-measured
 * under one date, never merged across dates.
 *
 * Fresh cache setup on a machine with npm 11 needs one extra step: npm's
 * `allow-scripts` security gate blocks postinstall scripts (puppeteer's
 * Chromium download, esbuild's binary fetch) by default, and a blocked
 * postinstall exits 0 with just a warning — easy to miss. setupVersion()
 * already runs `npm approve-scripts --all` after every install/ci for this
 * reason; if you see a version's Chromium missing after a manual reinstall
 * outside this script, that's almost certainly why.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BenchmarkMcpClient, ServerConfig } from "./harness/mcp-client.js";

const execFileAsync = promisify(execFile);

const REPO_ROOT = join(import.meta.dirname, "..");
const CACHE_ROOT = join(REPO_ROOT, "benchmarks", ".drift-cache");
const RESULTS_ROOT = join(REPO_ROOT, "benchmarks", "results", "drift");

const SETUP_TIMEOUT_MS = 20 * 60 * 1000; // npm installs can be slow
const CONNECT_TIMEOUT_MS = 45 * 1000;
const NAVIGATE_TIMEOUT_MS = 60 * 1000;
const EXEC_MAX_BUFFER = 64 * 1024 * 1024;

const VERSION_ORDER = ["v0.2.0", "v0.3.0", "v0.4.2", "v0.5.1", "v0.6.3", "v0.7.0", "v0.8.0"];

const PAGES: Array<{ label: string; url: string }> = [
  { label: "Hacker News", url: "https://news.ycombinator.com/" },
  { label: "Wikipedia", url: "https://en.wikipedia.org/wiki/Main_Page" },
  { label: "GitHub", url: "https://github.com/anthropics" },
];

const HOST_NOTE =
  "Run on an Ubuntu 24.04 host (AppArmor userns restriction on Chrome sandboxing); " +
  "all versions launched with --no-sandbox unless noted otherwise in argsUsed.";

// Playwright MCP baseline (Unit 1). Uses the repo's own installed
// node_modules/@playwright/mcp (not a versioned cache — this is a single
// current-version baseline, not a per-release row). Spawn pattern matches
// benchmarks/configs/playwright.json (--headless --browser chromium), but
// with an absolute entry path and cwd=CACHE_ROOT to keep the config-free cwd
// invariant used for every other spawn in this file.
const PLAYWRIGHT_ENTRY = join(REPO_ROOT, "node_modules", "@playwright", "mcp", "cli.js");
const PLAYWRIGHT_PACKAGE_JSON = join(REPO_ROOT, "node_modules", "@playwright", "mcp", "package.json");

// ── Progress note (opt-in, best-effort append; failures here must never abort a run) ──
//
// Off by default — a hardcoded session-scratchpad path is ephemeral and dies
// with whatever session wrote it. Set DRIFT_PROGRESS_NOTE to an absolute path
// to get a running append-only log of setup/run progress; otherwise this is
// a no-op and only the stderr [drift] log lines are emitted.

async function appendProgress(line: string): Promise<void> {
  const progressNotePath = process.env.DRIFT_PROGRESS_NOTE;
  if (!progressNotePath) return;
  try {
    const existing = existsSync(progressNotePath) ? await readFile(progressNotePath, "utf-8") : "";
    await writeFile(progressNotePath, `${existing}\n${line}`);
  } catch {
    // progress note is a nice-to-have, never fatal
  }
}

function logProgress(message: string): void {
  const stamped = `[drift] ${message}`;
  console.error(stamped);
}

// ── Version specs ──

type VersionKind = "npm" | "worktree" | "local";

interface VersionSpec {
  version: string;
  kind: VersionKind;
  npmSpec?: string;
  cacheDir: string;
  entryPath: string;
  /**
   * INVARIANT: measurements must be config-free. Charlotte's config loader
   * resolves `<cwd>/charlotte.config.json` by EXACT cwd (no upward search —
   * see src/config/load-config.ts), so any directory that doesn't itself
   * contain a charlotte.config.json is safe. We deliberately never spawn a
   * measured server with cwd = REPO_ROOT: the repo root can carry the
   * operator's untracked local charlotte.config.json (e.g. an `http` block
   * from in-progress remote-mode work), and an older/differently-schema'd
   * release will fail config validation and exit before MCP init — a
   * spurious "Connection closed" that looks like a real startup failure but
   * is actually contamination from the operator's workstation, not a
   * release-vs-release difference. runCwd always points at a version's own
   * cache/worktree/build directory, never at REPO_ROOT.
   */
  runCwd: string;
}

function buildVersionSpecs(): VersionSpec[] {
  return VERSION_ORDER.map((version) => {
    if (version === "v0.7.0") {
      const cacheDir = join(CACHE_ROOT, "v0.7.0-src");
      return {
        version,
        kind: "worktree" as const,
        cacheDir,
        entryPath: join(cacheDir, "dist", "index.js"),
        runCwd: cacheDir,
      };
    }
    if (version === "v0.8.0") {
      return {
        version,
        kind: "local" as const,
        cacheDir: REPO_ROOT,
        entryPath: join(REPO_ROOT, "dist", "index.js"),
        // Built from REPO_ROOT, but MUST NOT be spawned with cwd=REPO_ROOT —
        // see the runCwd invariant above. CACHE_ROOT is inside the repo but
        // holds no charlotte.config.json of its own.
        runCwd: CACHE_ROOT,
      };
    }
    const npmSpec = version.replace(/^v/, "");
    const cacheDir = join(CACHE_ROOT, `v${npmSpec}`);
    return {
      version,
      kind: "npm" as const,
      npmSpec,
      cacheDir,
      entryPath: join(cacheDir, "node_modules", "@ticktockbent", "charlotte", "dist", "index.js"),
      runCwd: cacheDir,
    };
  });
}

// ── Setup (idempotent) ──

async function approveScriptsBestEffort(cwd: string): Promise<void> {
  // npm 11's allow-scripts security gate blocks postinstall scripts (puppeteer's
  // Chromium download, esbuild's binary fetch) by default. Approve whatever is
  // pending for this install prefix. Non-fatal if there's nothing pending.
  try {
    await execFileAsync("npm", ["approve-scripts", "--all"], {
      cwd,
      timeout: SETUP_TIMEOUT_MS,
      maxBuffer: EXEC_MAX_BUFFER,
    });
  } catch {
    // no pending scripts, or already approved — ignore
  }
}

async function setupVersion(spec: VersionSpec): Promise<void> {
  if (spec.kind === "local") {
    if (!existsSync(spec.entryPath)) {
      logProgress(`${spec.version}: building local working tree (npm run build)...`);
      await execFileAsync("npm", ["run", "build"], {
        cwd: REPO_ROOT,
        timeout: SETUP_TIMEOUT_MS,
        maxBuffer: EXEC_MAX_BUFFER,
      });
    }
    if (!existsSync(spec.entryPath)) {
      throw new Error(`${spec.version}: build completed but entry point missing: ${spec.entryPath}`);
    }
    return;
  }

  const readyMarker = join(spec.cacheDir, ".ready");
  if (existsSync(readyMarker)) {
    logProgress(`${spec.version}: cache ready, skipping setup.`);
    return;
  }

  if (spec.kind === "npm") {
    await mkdir(spec.cacheDir, { recursive: true });
    logProgress(`${spec.version}: npm install @ticktockbent/charlotte@${spec.npmSpec} --prefix ${spec.cacheDir}`);
    await execFileAsync(
      "npm",
      ["install", `@ticktockbent/charlotte@${spec.npmSpec}`, "--prefix", spec.cacheDir],
      { timeout: SETUP_TIMEOUT_MS, maxBuffer: EXEC_MAX_BUFFER }
    );
    await approveScriptsBestEffort(spec.cacheDir);
  } else if (spec.kind === "worktree") {
    if (!existsSync(spec.cacheDir)) {
      logProgress(`${spec.version}: git worktree add ${spec.cacheDir} v0.7.0`);
      await execFileAsync("git", ["worktree", "add", spec.cacheDir, "v0.7.0"], {
        cwd: REPO_ROOT,
        timeout: SETUP_TIMEOUT_MS,
        maxBuffer: EXEC_MAX_BUFFER,
      });
    }
    logProgress(`${spec.version}: npm ci`);
    await execFileAsync("npm", ["ci"], {
      cwd: spec.cacheDir,
      timeout: SETUP_TIMEOUT_MS,
      maxBuffer: EXEC_MAX_BUFFER,
    });
    await approveScriptsBestEffort(spec.cacheDir);
    logProgress(`${spec.version}: npm run build`);
    await execFileAsync("npm", ["run", "build"], {
      cwd: spec.cacheDir,
      timeout: SETUP_TIMEOUT_MS,
      maxBuffer: EXEC_MAX_BUFFER,
    });
  }

  if (!existsSync(spec.entryPath)) {
    throw new Error(`${spec.version}: setup completed but entry point missing: ${spec.entryPath}`);
  }
  await writeFile(readyMarker, new Date().toISOString());
  logProgress(`${spec.version}: setup complete, marker written.`);
}

// ── Best-effort metadata (puppeteer / chromium versions) ──

async function detectPuppeteerVersion(spec: VersionSpec): Promise<string | null> {
  try {
    const pkgPath = join(spec.cacheDir, "node_modules", "puppeteer", "package.json");
    const raw = await readFile(pkgPath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
}

async function detectChromeBuildId(spec: VersionSpec): Promise<string | null> {
  const candidates = [
    join(spec.cacheDir, "node_modules", "puppeteer-core", "lib", "esm", "puppeteer", "revisions.js"),
    join(spec.cacheDir, "node_modules", "puppeteer-core", "lib", "cjs", "puppeteer", "revisions.js"),
  ];
  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate, "utf-8");
      const match = raw.match(/chrome:\s*['"]([^'"]+)['"]/);
      if (match) return match[1];
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function detectPlaywrightMcpVersion(): Promise<string | null> {
  try {
    const raw = await readFile(PLAYWRIGHT_PACKAGE_JSON, "utf-8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
}

// ── Process hygiene ──

async function snapshotChromePids(): Promise<Set<number>> {
  try {
    const { stdout } = await execFileAsync("pgrep", ["-f", "chrome"], { maxBuffer: EXEC_MAX_BUFFER });
    return new Set(
      stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map(Number)
        .filter((n) => Number.isFinite(n))
    );
  } catch {
    // pgrep exits 1 with no matches
    return new Set();
  }
}

async function killNewChromeStragglers(before: Set<number>): Promise<number[]> {
  const after = await snapshotChromePids();
  const killed: number[] = [];
  for (const pid of after) {
    if (!before.has(pid)) {
      try {
        process.kill(pid, "SIGKILL");
        killed.push(pid);
      } catch {
        // already gone
      }
    }
  }
  return killed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Timeout helper ──

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function shortErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.length > 300 ? `${raw.slice(0, 300)}...` : raw;
}

function extractToolErrorText(response: unknown): string {
  try {
    const asRecord = response as { content?: Array<{ type?: string; text?: string }> };
    const textPart = asRecord?.content?.find((part) => part?.type === "text" && typeof part.text === "string");
    if (textPart?.text) {
      return textPart.text.length > 300 ? `${textPart.text.slice(0, 300)}...` : textPart.text;
    }
  } catch {
    // fall through
  }
  return "tool call returned isError with no readable text content";
}

// ── Connection with arg fallback ──

interface ConnectOutcome {
  client: BenchmarkMcpClient;
  argsUsed: string[];
}

async function connectWithFallback(spec: VersionSpec): Promise<ConnectOutcome> {
  const attempts: string[][] = [["--no-sandbox"], []];
  let lastError: unknown;

  for (const args of attempts) {
    const serverConfig: ServerConfig = {
      name: `charlotte-${spec.version}`,
      command: "node",
      args: [spec.entryPath, ...args],
      // Never REPO_ROOT — see the runCwd invariant on VersionSpec.
      cwd: spec.runCwd,
    };
    const client = new BenchmarkMcpClient(serverConfig);
    try {
      await withTimeout(client.connect(), CONNECT_TIMEOUT_MS, `${spec.version} connect (args=${JSON.stringify(args)})`);
      return { client, argsUsed: args };
    } catch (error) {
      lastError = error;
      logProgress(`${spec.version}: connect failed with args=${JSON.stringify(args)}: ${shortErrorMessage(error)}`);
      await client.disconnect().catch(() => {});
    }
  }

  throw new Error(`all connection attempts failed: ${shortErrorMessage(lastError)}`);
}

// ── Measurement types ──

interface TokenMeasurement {
  chars: number;
  tokens: number;
}

type MeasurementOrError = TokenMeasurement | { error: string };

interface PageResult {
  run1: MeasurementOrError;
  run2: MeasurementOrError;
}

type PageCell = PageResult | { error: string };

interface DriftVersionResult {
  version: string;
  argsUsed: string[] | null;
  startupError: string | null;
  puppeteerVersion: string | null;
  chromeBuildId: string | null;
  toolCount: number | null;
  defChars: number | null;
  defTokens: number | null;
  defTokensChars3_5: number | null;
  navigateToolName: string | null;
  pages: Record<string, PageCell>;
}

// ── Playwright baseline (Unit 1) ──
//
// Orientation cost for Playwright MCP is NOT its browser_navigate response —
// in 0.0.79, browser_navigate writes the accessibility snapshot to a
// .playwright-mcp/page-*.yml file and returns only a short page/status
// summary. The inline tree an agent actually has to ingest to orient comes
// from a separate browser_snapshot call. So each baseline page run is
// navigate THEN snapshot; both response sizes are recorded, but the
// headline/charted value is the snapshot, matching the metrics-pass
// convention this whole benchmark follows.

interface PlaywrightPageMeasurement {
  navigate: MeasurementOrError;
  snapshot: MeasurementOrError;
}

interface PlaywrightPageResult {
  run1: PlaywrightPageMeasurement;
  run2: PlaywrightPageMeasurement;
}

type PlaywrightPageCell = PlaywrightPageResult | { error: string };

interface DriftBaselineResult {
  label: "playwright";
  version: string | null;
  startupError: string | null;
  toolCount: number | null;
  defChars: number | null;
  defTokens: number | null;
  defTokensChars3_5: number | null;
  pages: Record<string, PlaywrightPageCell>;
}

interface DriftReport {
  meta: {
    runDate: string;
    generatedAt: string;
    tokenHeuristic: "ceil(chars/4)";
    pages: Array<{ label: string; url: string }>;
    hostNote: string;
    versionOrder: string[];
  };
  versions: DriftVersionResult[];
  baseline: DriftBaselineResult | null;
}

function isErrorCell(cell: MeasurementOrError): cell is { error: string } {
  return "error" in cell;
}

function isPlaywrightPageError(cell: PlaywrightPageCell): cell is { error: string } {
  return "error" in cell;
}

/** Headline chart value for a Playwright page run: the snapshot token count. */
function playwrightHeadlineTokens(run: PlaywrightPageMeasurement): number | null {
  return isErrorCell(run.snapshot) ? null : run.snapshot.tokens;
}

function findNavigateToolName(toolNames: string[]): string | null {
  const match = toolNames.find((name) => /(^|[:_])navigate$/i.test(name));
  return match ?? null;
}

/**
 * Call a tool once, retrying up to one transient failure, and reduce the
 * result to a MeasurementOrError. Shared by Charlotte's navigate measurement
 * and the Playwright baseline's navigate/snapshot measurements.
 */
async function measureToolCallOnce(
  client: BenchmarkMcpClient,
  toolName: string,
  args: Record<string, unknown>,
  label: string
): Promise<MeasurementOrError> {
  let lastMessage = "unknown error";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await withTimeout(
        client.callTool(toolName, args),
        NAVIGATE_TIMEOUT_MS,
        `${label} (attempt ${attempt + 1})`
      );
      if (result.isError) {
        lastMessage = extractToolErrorText(result.response);
        continue; // one retry per transient failure
      }
      return { chars: result.metrics.responseChars, tokens: result.metrics.estimatedTokens };
    } catch (error) {
      lastMessage = shortErrorMessage(error);
    }
  }
  return { error: lastMessage };
}

async function measureNavigateRun(
  client: BenchmarkMcpClient,
  navigateToolName: string,
  url: string
): Promise<MeasurementOrError> {
  return measureToolCallOnce(client, navigateToolName, { url }, `navigate ${url}`);
}

async function measureVersion(spec: VersionSpec, results: DriftVersionResult[]): Promise<void> {
  logProgress(`=== ${spec.version}: starting measurement ===`);
  await appendProgress(`- [ ] run: ${spec.version} started`);

  const puppeteerVersion = await detectPuppeteerVersion(spec);
  const chromeBuildId = await detectChromeBuildId(spec);

  const chromeBefore = await snapshotChromePids();

  let outcome: ConnectOutcome;
  try {
    outcome = await connectWithFallback(spec);
  } catch (error) {
    const startupError = shortErrorMessage(error);
    logProgress(`${spec.version}: FAILED TO START — ${startupError}`);
    const pages: Record<string, PageCell> = {};
    for (const page of PAGES) {
      pages[page.label] = { error: `version failed to start: ${startupError}` };
    }
    results.push({
      version: spec.version,
      argsUsed: null,
      startupError,
      puppeteerVersion,
      chromeBuildId,
      toolCount: null,
      defChars: null,
      defTokens: null,
      defTokensChars3_5: null,
      navigateToolName: null,
      pages,
    });
    const killed = await killNewChromeStragglers(chromeBefore);
    if (killed.length > 0) logProgress(`${spec.version}: killed straggler chrome PIDs ${killed.join(", ")}`);
    await appendProgress(`- [x] run: ${spec.version} — FAILED TO START (${startupError})`);
    return;
  }

  const { client, argsUsed } = outcome;
  logProgress(`${spec.version}: connected (args=${JSON.stringify(argsUsed)})`);

  try {
    const toolListMetrics = await client.listToolsWithMetrics();
    const defChars = toolListMetrics.definitionChars;
    const defTokens = Math.ceil(defChars / 4);
    const navigateToolName = findNavigateToolName(toolListMetrics.toolNames);

    logProgress(
      `${spec.version}: ${toolListMetrics.toolCount} tools, ${defChars} def chars, navigate tool = ${navigateToolName ?? "NOT FOUND"}`
    );

    const pages: Record<string, PageCell> = {};

    if (!navigateToolName) {
      for (const page of PAGES) {
        pages[page.label] = { error: "no navigate-like tool found in tool list" };
      }
    } else {
      for (const page of PAGES) {
        logProgress(`${spec.version}: navigating to ${page.label} (run 1)...`);
        const run1 = await measureNavigateRun(client, navigateToolName, page.url);
        logProgress(`${spec.version}: navigating to ${page.label} (run 2)...`);
        const run2 = await measureNavigateRun(client, navigateToolName, page.url);

        if (!isErrorCell(run1)) logProgress(`${spec.version}/${page.label}: run1=${run1.tokens} tokens`);
        if (!isErrorCell(run2)) logProgress(`${spec.version}/${page.label}: run2=${run2.tokens} tokens`);

        pages[page.label] = { run1, run2 };
      }
    }

    results.push({
      version: spec.version,
      argsUsed,
      startupError: null,
      puppeteerVersion,
      chromeBuildId,
      toolCount: toolListMetrics.toolCount,
      defChars,
      defTokens,
      defTokensChars3_5: toolListMetrics.estimatedDefinitionTokens,
      navigateToolName,
      pages,
    });
    await appendProgress(`- [x] run: ${spec.version} — measured OK (${toolListMetrics.toolCount} tools, ${defChars} def chars)`);
  } catch (error) {
    const message = shortErrorMessage(error);
    logProgress(`${spec.version}: measurement error — ${message}`);
    const pages: Record<string, PageCell> = {};
    for (const page of PAGES) {
      pages[page.label] = { error: `measurement failed: ${message}` };
    }
    results.push({
      version: spec.version,
      argsUsed,
      startupError: message,
      puppeteerVersion,
      chromeBuildId,
      toolCount: null,
      defChars: null,
      defTokens: null,
      defTokensChars3_5: null,
      navigateToolName: null,
      pages,
    });
    await appendProgress(`- [x] run: ${spec.version} — measurement FAILED (${message})`);
  } finally {
    await client.disconnect().catch(() => {});
    await sleep(1500); // grace period for graceful Chromium shutdown before we sweep
    const killed = await killNewChromeStragglers(chromeBefore);
    if (killed.length > 0) {
      logProgress(`${spec.version}: killed straggler chrome PIDs ${killed.join(", ")}`);
    }
  }
}

// ── Playwright baseline measurement (Unit 1) ──

async function measurePlaywrightPageRun(
  client: BenchmarkMcpClient,
  url: string
): Promise<PlaywrightPageMeasurement> {
  const navigate = await measureToolCallOnce(client, "browser_navigate", { url }, `playwright navigate ${url}`);
  if (isErrorCell(navigate)) {
    // Nothing meaningful to snapshot if navigation itself failed.
    return { navigate, snapshot: { error: `skipped: navigate failed (${navigate.error})` } };
  }
  const snapshot = await measureToolCallOnce(client, "browser_snapshot", {}, `playwright snapshot (${url})`);
  return { navigate, snapshot };
}

async function measureBaseline(): Promise<DriftBaselineResult> {
  logProgress("=== playwright baseline: starting measurement ===");
  await appendProgress(`- [ ] run: playwright baseline started`);

  const version = await detectPlaywrightMcpVersion();
  const chromeBefore = await snapshotChromePids();

  const serverConfig: ServerConfig = {
    name: "charlotte-playwright-baseline",
    command: "node",
    args: [PLAYWRIGHT_ENTRY, "--headless", "--browser", "chromium"],
    // Never REPO_ROOT — see the runCwd invariant on VersionSpec. Playwright
    // doesn't read charlotte.config.json, but we keep the discipline uniform
    // across every spawn in this file.
    cwd: CACHE_ROOT,
  };
  const client = new BenchmarkMcpClient(serverConfig);

  try {
    await withTimeout(client.connect(), CONNECT_TIMEOUT_MS, "playwright baseline connect");
  } catch (error) {
    const startupError = shortErrorMessage(error);
    logProgress(`playwright baseline: FAILED TO START — ${startupError}`);
    const pages: Record<string, PlaywrightPageCell> = {};
    for (const page of PAGES) {
      pages[page.label] = { error: `baseline failed to start: ${startupError}` };
    }
    await client.disconnect().catch(() => {});
    const killed = await killNewChromeStragglers(chromeBefore);
    if (killed.length > 0) logProgress(`playwright baseline: killed straggler chrome PIDs ${killed.join(", ")}`);
    await appendProgress(`- [x] run: playwright baseline — FAILED TO START (${startupError})`);
    return {
      label: "playwright",
      version,
      startupError,
      toolCount: null,
      defChars: null,
      defTokens: null,
      defTokensChars3_5: null,
      pages,
    };
  }

  try {
    const toolListMetrics = await client.listToolsWithMetrics();
    const defChars = toolListMetrics.definitionChars;
    const defTokens = Math.ceil(defChars / 4);
    logProgress(`playwright baseline: ${toolListMetrics.toolCount} tools, ${defChars} def chars`);

    const pages: Record<string, PlaywrightPageCell> = {};
    for (const page of PAGES) {
      logProgress(`playwright baseline: ${page.label} (run 1)...`);
      const run1 = await measurePlaywrightPageRun(client, page.url);
      logProgress(`playwright baseline: ${page.label} (run 2)...`);
      const run2 = await measurePlaywrightPageRun(client, page.url);
      if (!isErrorCell(run1.snapshot)) logProgress(`playwright baseline/${page.label}: run1 snapshot=${run1.snapshot.tokens} tokens`);
      if (!isErrorCell(run2.snapshot)) logProgress(`playwright baseline/${page.label}: run2 snapshot=${run2.snapshot.tokens} tokens`);
      pages[page.label] = { run1, run2 };
    }

    await appendProgress(
      `- [x] run: playwright baseline — measured OK (${toolListMetrics.toolCount} tools, ${defChars} def chars)`
    );
    return {
      label: "playwright",
      version,
      startupError: null,
      toolCount: toolListMetrics.toolCount,
      defChars,
      defTokens,
      defTokensChars3_5: toolListMetrics.estimatedDefinitionTokens,
      pages,
    };
  } catch (error) {
    const message = shortErrorMessage(error);
    logProgress(`playwright baseline: measurement error — ${message}`);
    const pages: Record<string, PlaywrightPageCell> = {};
    for (const page of PAGES) {
      pages[page.label] = { error: `measurement failed: ${message}` };
    }
    await appendProgress(`- [x] run: playwright baseline — measurement FAILED (${message})`);
    return {
      label: "playwright",
      version,
      startupError: message,
      toolCount: null,
      defChars: null,
      defTokens: null,
      defTokensChars3_5: null,
      pages,
    };
  } finally {
    await client.disconnect().catch(() => {});
    await sleep(1500);
    const killed = await killNewChromeStragglers(chromeBefore);
    if (killed.length > 0) {
      logProgress(`playwright baseline: killed straggler chrome PIDs ${killed.join(", ")}`);
    }
  }
}

// ── Reporting: markdown ──

function formatTokenCell(cell: MeasurementOrError | undefined): string {
  if (!cell) return "—";
  if (isErrorCell(cell)) return `ERROR`;
  return cell.tokens.toLocaleString();
}

function varianceFlag(pageResult: PageResult): string {
  if (isErrorCell(pageResult.run1) || isErrorCell(pageResult.run2)) return "";
  const { run1, run2 } = pageResult;
  if (run1.tokens === 0) return "";
  const pctDiff = Math.abs(run2.tokens - run1.tokens) / run1.tokens;
  return pctDiff > 0.05 ? ` ⚠ (run2 ${(pctDiff * 100).toFixed(1)}% diff)` : "";
}

function asciiBar(value: number, max: number, width = 40): string {
  if (max <= 0) return "";
  const filled = Math.max(0, Math.round((value / max) * width));
  return "█".repeat(filled);
}

function playwrightVarianceFlag(pageResult: PlaywrightPageResult): string {
  if (isErrorCell(pageResult.run1.snapshot) || isErrorCell(pageResult.run2.snapshot)) return "";
  const run1Tokens = pageResult.run1.snapshot.tokens;
  const run2Tokens = pageResult.run2.snapshot.tokens;
  if (run1Tokens === 0) return "";
  const pctDiff = Math.abs(run2Tokens - run1Tokens) / run1Tokens;
  return pctDiff > 0.05 ? ` ⚠ (run2 ${(pctDiff * 100).toFixed(1)}% diff)` : "";
}

function playwrightRowLabel(baseline: DriftBaselineResult): string {
  return `playwright ${baseline.version ?? "?"}`;
}

function generateMarkdown(report: DriftReport): string {
  const lines: string[] = [];
  lines.push(`# Charlotte release drift — orientation cost on live pages`);
  lines.push("");
  lines.push(`Run date: **${report.meta.runDate}**`);
  lines.push("");
  lines.push(
    `Measures navigate-response size (orientation cost) and tool-definition size across every ` +
      `Charlotte release, against the same live pages, run same-day.`
  );
  lines.push("");

  // Main table
  lines.push(`## Version × page (navigate tokens, headline = run 1)`);
  lines.push("");
  const pageHeaders = report.meta.pages.map((p) => p.label).join(" | ");
  lines.push(`| Version | ${pageHeaders} | Tool-def tokens | Tool count | Puppeteer / Chromium |`);
  lines.push(`| --- | ${report.meta.pages.map(() => "---").join(" | ")} | --- | --- | --- |`);

  for (const v of report.versions) {
    const cells = report.meta.pages.map((page) => {
      const cell = v.pages[page.label];
      if (!cell) return "—";
      if ("error" in cell) return `ERROR: ${cell.error.slice(0, 40)}`;
      const flag = varianceFlag(cell);
      return `${formatTokenCell(cell.run1)}${flag}`;
    });
    const defTokens = v.defTokens !== null ? v.defTokens.toLocaleString() : "—";
    const toolCount = v.toolCount !== null ? v.toolCount.toString() : "—";
    const browserVersions =
      v.puppeteerVersion || v.chromeBuildId
        ? `${v.puppeteerVersion ?? "?"} / ${v.chromeBuildId ?? "?"}`
        : "—";
    lines.push(
      `| ${v.version} | ${cells.join(" | ")} | ${defTokens} | ${toolCount} | ${browserVersions} |`
    );
  }
  if (report.baseline) {
    const baseline = report.baseline;
    const cells = report.meta.pages.map((page) => {
      const cell = baseline.pages[page.label];
      if (!cell) return "—";
      if (isPlaywrightPageError(cell)) return `ERROR: ${cell.error.slice(0, 40)}`;
      if (isErrorCell(cell.run1.snapshot)) return `ERROR: ${cell.run1.snapshot.error.slice(0, 40)}`;
      const flag = playwrightVarianceFlag(cell);
      return `${cell.run1.snapshot.tokens.toLocaleString()}${flag}`;
    });
    const defTokens = baseline.defTokens !== null ? baseline.defTokens.toLocaleString() : "—";
    const toolCount = baseline.toolCount !== null ? baseline.toolCount.toString() : "—";
    lines.push(
      `| ${playwrightRowLabel(baseline)} | ${cells.join(" | ")} | ${defTokens} | ${toolCount} | — (baseline; own bundled browser, not tracked per-row) |`
    );
  }
  lines.push("");
  lines.push(
    `Cells marked ⚠ had a >5% difference between run 1 and run 2 (same session, fresh navigate both times).`
  );
  if (report.baseline) {
    lines.push(
      `The \`playwright ${report.baseline.version ?? "?"}\` row is a same-day baseline, not a Charlotte release — ` +
        `see the methodology notes below for how its orientation cost is measured.`
    );
  }
  lines.push("");

  // Error details
  const errorLines: string[] = [];
  for (const v of report.versions) {
    if (v.startupError) {
      errorLines.push(`- **${v.version}**: startup failed — ${v.startupError}`);
      continue;
    }
    for (const page of report.meta.pages) {
      const cell = v.pages[page.label];
      if (!cell) continue;
      if ("error" in cell) {
        errorLines.push(`- **${v.version} / ${page.label}**: ${cell.error}`);
      } else {
        if (isErrorCell(cell.run1)) errorLines.push(`- **${v.version} / ${page.label} run1**: ${cell.run1.error}`);
        if (isErrorCell(cell.run2)) errorLines.push(`- **${v.version} / ${page.label} run2**: ${cell.run2.error}`);
      }
    }
  }
  if (report.baseline) {
    const baseline = report.baseline;
    if (baseline.startupError && Object.values(baseline.pages).every((cell) => isPlaywrightPageError(cell))) {
      errorLines.push(`- **playwright baseline**: startup failed — ${baseline.startupError}`);
    } else {
      for (const page of report.meta.pages) {
        const cell = baseline.pages[page.label];
        if (!cell) continue;
        if (isPlaywrightPageError(cell)) {
          errorLines.push(`- **playwright baseline / ${page.label}**: ${cell.error}`);
        } else {
          if (isErrorCell(cell.run1.navigate)) errorLines.push(`- **playwright baseline / ${page.label} run1 navigate**: ${cell.run1.navigate.error}`);
          if (isErrorCell(cell.run1.snapshot)) errorLines.push(`- **playwright baseline / ${page.label} run1 snapshot**: ${cell.run1.snapshot.error}`);
          if (isErrorCell(cell.run2.navigate)) errorLines.push(`- **playwright baseline / ${page.label} run2 navigate**: ${cell.run2.navigate.error}`);
          if (isErrorCell(cell.run2.snapshot)) errorLines.push(`- **playwright baseline / ${page.label} run2 snapshot**: ${cell.run2.snapshot.error}`);
        }
      }
    }
  }
  if (errorLines.length > 0) {
    lines.push(`## Error cells`);
    lines.push("");
    lines.push(...errorLines);
    lines.push("");
  }

  // ASCII bar chart per page
  lines.push(`## Orientation cost by page (ASCII chart, navigate tokens, run 1; playwright row = browser_snapshot tokens)`);
  lines.push("");
  for (const page of report.meta.pages) {
    lines.push(`### ${page.label}`);
    lines.push("");
    lines.push("```");
    const values = report.versions.map((v) => {
      const cell = v.pages[page.label];
      if (!cell || "error" in cell || isErrorCell(cell.run1)) return null;
      return cell.run1.tokens;
    });
    const baselineValue = report.baseline
      ? (() => {
          const cell = report.baseline!.pages[page.label];
          if (!cell || isPlaywrightPageError(cell)) return null;
          return playwrightHeadlineTokens(cell.run1);
        })()
      : null;
    const allValues = [...values, baselineValue];
    const max = Math.max(1, ...allValues.filter((n): n is number => n !== null));
    for (let i = 0; i < report.versions.length; i++) {
      const version = report.versions[i].version;
      const value = values[i];
      const label = version.padEnd(18);
      if (value === null) {
        lines.push(`${label} ERROR`);
      } else {
        lines.push(`${label} ${asciiBar(value, max)} ${value.toLocaleString()}`);
      }
    }
    if (report.baseline) {
      const label = playwrightRowLabel(report.baseline).padEnd(18);
      if (baselineValue === null) {
        lines.push(`${label} ERROR`);
      } else {
        lines.push(`${label} ${asciiBar(baselineValue, max)} ${baselineValue.toLocaleString()}`);
      }
    }
    lines.push("```");
    lines.push("");
  }

  // Tool-definition size chart
  lines.push(`## Tool-definition size (ASCII chart, def tokens)`);
  lines.push("");
  lines.push("```");
  const defValues = report.versions.map((v) => v.defTokens);
  const baselineDefTokens = report.baseline?.defTokens ?? null;
  const defMax = Math.max(1, ...defValues.filter((n): n is number => n !== null), baselineDefTokens ?? 0);
  for (const v of report.versions) {
    const label = v.version.padEnd(18);
    if (v.defTokens === null) {
      lines.push(`${label} ERROR`);
    } else {
      lines.push(
        `${label} ${asciiBar(v.defTokens, defMax)} ${v.defTokens.toLocaleString()} tokens (${v.toolCount} tools)`
      );
    }
  }
  if (report.baseline) {
    const label = playwrightRowLabel(report.baseline).padEnd(18);
    if (baselineDefTokens === null) {
      lines.push(`${label} ERROR`);
    } else {
      lines.push(
        `${label} ${asciiBar(baselineDefTokens, defMax)} ${baselineDefTokens.toLocaleString()} tokens (${report.baseline.toolCount} tools)`
      );
    }
  }
  lines.push("```");
  lines.push("");

  // Methodology
  lines.push(`## Methodology notes`);
  lines.push("");
  lines.push(
    `- **Same-day rule**: rows are only comparable within one run date. This report is a single ` +
      `run on ${report.meta.runDate} against live pages; each future release re-runs all versions ` +
      `from scratch rather than reusing old numbers, since Hacker News/Wikipedia/GitHub page content ` +
      `changes day to day.`
  );
  lines.push(`- **Token heuristic**: tokens ≈ ceil(chars / 4), computed from the full serialized MCP response text.`);
  lines.push(
    `- **Live-page caveat**: these are live, uncontrolled pages. Front-page HN stories, the Wikipedia ` +
      `"Main Page" featured content, and github.com/anthropics's pinned repos all change over time — ` +
      `drift numbers include real content drift, not just Charlotte's own changes.`
  );
  lines.push(
    `- **Per-version Chromium caveat**: this is NOT a clean "as-shipped" reconstruction of each release. ` +
      `The npm-installed rows (v0.2.0–v0.6.3) declared puppeteer as a loose semver range, so \`npm install\` ` +
      `resolved each of them to whatever puppeteer/Chromium build was current on the day this cache was set ` +
      `up — in this run, all five floated to the same puppeteer/Chromium pair, distinct from what a user ` +
      `installing those versions at their original release date would have gotten. Only v0.7.0 and v0.8.0 ` +
      `lockfile-pin an exact puppeteer version (via \`npm ci\`), so those two rows are the only ones that ` +
      `reflect a specific, reproducible Chromium build. In practice this makes the chart closer to measuring ` +
      `"Charlotte's code changes on top of a mostly Chromium-controlled AX tree" than true per-release drift ` +
      `— see the \`Puppeteer / Chromium\` column above (sourced from puppeteerVersion/chromeBuildId per row ` +
      `in drift.json) to see exactly which rows share a browser build and group/exclude them accordingly.`
  );
  if (report.baseline) {
    lines.push(
      `- **Playwright baseline methodology**: the \`playwright ${report.baseline.version ?? "?"}\` row is measured ` +
        `same-day, in the same run, against the same three pages — not pulled from a prior benchmark. Its ` +
        `orientation cost is \`browser_snapshot\`'s inline accessibility tree, not \`browser_navigate\`'s response: ` +
        `in this Playwright MCP version, \`browser_navigate\` writes the snapshot to a ` +
        `\`.playwright-mcp/page-*.yml\` file on disk and returns only a short page/status summary, so the tree an ` +
        `agent actually has to read to orient only appears in the follow-up \`browser_snapshot\` call. Both ` +
        `\`browser_navigate\` and \`browser_snapshot\` response sizes are recorded per run in drift.json; only the ` +
        `snapshot figure is charted/tabled here, matching the metrics-pass convention.`
    );
  }
  lines.push(`- ${report.meta.hostNote}`);
  lines.push("");

  return lines.join("\n");
}

// ── Reporting: SVG ──

const PAGE_COLORS = ["#0072B2", "#D55E00", "#009E73"]; // Okabe-Ito colorblind-safe palette
const PANEL_B_COLOR = "#4B5563";
const PLAYWRIGHT_BAR_COLOR = "#7C3AED"; // distinct from PANEL_B_COLOR, colorblind-safe violet

function diamondPoints(cx: number, cy: number, r = 4.5): string {
  return `${cx},${(cy - r).toFixed(1)} ${(cx + r).toFixed(1)},${cy} ${cx},${(cy + r).toFixed(1)} ${(cx - r).toFixed(1)},${cy}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function generateSvg(report: DriftReport): string {
  const width = 900;
  const height = 600;

  // ---- Panel A geometry ----
  const panelA = { left: 70, right: 870, top: 90, bottom: 380 };
  const panelAWidth = panelA.right - panelA.left;
  const panelAHeight = panelA.bottom - panelA.top;

  const versions = report.versions;
  const n = versions.length; // Charlotte release count (x-positions 0..n-1)
  const hasBaseline = report.baseline !== null;
  const totalXPositions = n + (hasBaseline ? 1 : 0); // +1 for the playwright x-position
  const baselineXIndex = n; // far right, per design
  const xStep = totalXPositions > 1 ? panelAWidth / (totalXPositions - 1) : 0;
  const xForIndex = (i: number) => panelA.left + i * xStep;

  // Collect all valid navigate-token values across pages/versions for scaling
  const allValues: number[] = [];
  for (const v of versions) {
    for (const page of report.meta.pages) {
      const cell = v.pages[page.label];
      if (cell && !("error" in cell) && !isErrorCell(cell.run1)) {
        allValues.push(cell.run1.tokens);
      }
    }
  }
  if (report.baseline) {
    for (const page of report.meta.pages) {
      const cell = report.baseline.pages[page.label];
      if (cell && !isPlaywrightPageError(cell)) {
        const headline = playwrightHeadlineTokens(cell.run1);
        if (headline !== null) allValues.push(headline);
      }
    }
  }
  const dataMax = allValues.length > 0 ? Math.max(...allValues) : 1;
  const dataMin = allValues.length > 0 ? Math.min(...allValues) : 0;
  // Force log scale whenever a baseline is plotted (by design: the baseline's
  // scale is different enough from Charlotte's that the >20x ratio rule
  // would trigger anyway) — otherwise fall back to the ratio heuristic.
  const useLogScale = hasBaseline || (dataMin > 0 && dataMax / dataMin > 20);

  const yDomainMax = dataMax * 1.15;
  const yDomainMin = useLogScale ? Math.max(1, dataMin * 0.85) : 0;

  const yForValue = (value: number): number => {
    if (useLogScale) {
      const logMin = Math.log10(yDomainMin);
      const logMax = Math.log10(yDomainMax);
      const t = (Math.log10(Math.max(value, yDomainMin)) - logMin) / (logMax - logMin);
      return panelA.bottom - t * panelAHeight;
    }
    const t = (value - yDomainMin) / (yDomainMax - yDomainMin || 1);
    return panelA.bottom - t * panelAHeight;
  };

  const svgParts: string[] = [];
  svgParts.push(
    `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" font-family="system-ui, sans-serif">`
  );
  svgParts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff" />`);

  // Title / subtitle
  svgParts.push(
    `<text x="${width / 2}" y="28" text-anchor="middle" font-size="18" font-weight="700" fill="#111827">` +
      `Charlotte release drift — orientation cost on live pages</text>`
  );
  svgParts.push(
    `<text x="${width / 2}" y="48" text-anchor="middle" font-size="12" fill="#4B5563">` +
      `Run date: ${escapeXml(report.meta.runDate)} · tokens ≈ chars/4${useLogScale ? " · Panel A uses a log y-axis" : ""}</text>`
  );

  // Panel A label
  svgParts.push(
    `<text x="${panelA.left}" y="${panelA.top - 12}" font-size="13" font-weight="600" fill="#111827">` +
      `Panel A — navigate response tokens by version</text>`
  );

  // Panel A axes
  svgParts.push(
    `<line x1="${panelA.left}" y1="${panelA.top}" x2="${panelA.left}" y2="${panelA.bottom}" stroke="#9CA3AF" stroke-width="1" />`
  );
  svgParts.push(
    `<line x1="${panelA.left}" y1="${panelA.bottom}" x2="${panelA.right}" y2="${panelA.bottom}" stroke="#9CA3AF" stroke-width="1" />`
  );

  // Y gridlines + ticks (5 steps)
  const tickCount = 5;
  for (let i = 0; i <= tickCount; i++) {
    let value: number;
    if (useLogScale) {
      const logMin = Math.log10(yDomainMin);
      const logMax = Math.log10(yDomainMax);
      value = Math.pow(10, logMin + (i / tickCount) * (logMax - logMin));
    } else {
      value = yDomainMin + (i / tickCount) * (yDomainMax - yDomainMin);
    }
    const y = yForValue(value);
    svgParts.push(
      `<line x1="${panelA.left}" y1="${y.toFixed(1)}" x2="${panelA.right}" y2="${y.toFixed(1)}" stroke="#E5E7EB" stroke-width="1" />`
    );
    svgParts.push(
      `<text x="${panelA.left - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#6B7280">${Math.round(value).toLocaleString()}</text>`
    );
  }

  // X axis labels
  for (let i = 0; i < n; i++) {
    const x = xForIndex(i);
    svgParts.push(
      `<text x="${x.toFixed(1)}" y="${panelA.bottom + 18}" text-anchor="middle" font-size="11" fill="#374151">${escapeXml(versions[i].version)}</text>`
    );
  }
  if (report.baseline) {
    const x = xForIndex(baselineXIndex);
    svgParts.push(
      `<text x="${x.toFixed(1)}" y="${panelA.bottom + 18}" text-anchor="middle" font-size="11" fill="#374151">${escapeXml(playwrightRowLabel(report.baseline))}</text>`
    );
  }

  // Lines + markers per page
  report.meta.pages.forEach((page, pageIndex) => {
    const color = PAGE_COLORS[pageIndex % PAGE_COLORS.length];
    let pathSegments: string[] = [];
    let currentSegment: string[] = [];

    for (let i = 0; i < n; i++) {
      const v = versions[i];
      const cell = v.pages[page.label];
      const x = xForIndex(i);
      const isError = !cell || "error" in cell || isErrorCell(cell.run1);

      if (isError) {
        if (currentSegment.length > 0) {
          pathSegments.push(currentSegment.join(" "));
          currentSegment = [];
        }
        // ✕ marker at baseline
        const baselineY = panelA.bottom;
        svgParts.push(
          `<text x="${x.toFixed(1)}" y="${(baselineY - 4).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="700" fill="${color}">✕</text>`
        );
        continue;
      }

      const value = (cell as PageResult).run1 as TokenMeasurement;
      const y = yForValue(value.tokens);
      currentSegment.push(`${currentSegment.length === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);

      svgParts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="${color}" />`);
      const labelY = y - 8;
      svgParts.push(
        `<text x="${x.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" font-size="9" fill="${color}">${value.tokens.toLocaleString()}</text>`
      );
    }
    if (currentSegment.length > 0) pathSegments.push(currentSegment.join(" "));

    for (const segment of pathSegments) {
      svgParts.push(`<path d="${segment}" fill="none" stroke="${color}" stroke-width="2" />`);
    }

    // Baseline point: same page color, diamond marker, deliberately NOT
    // connected by a line to the release points — it's a comparison
    // baseline, not the next point in Charlotte's release progression.
    if (report.baseline) {
      const baselineCell = report.baseline.pages[page.label];
      const x = xForIndex(baselineXIndex);
      const headline =
        baselineCell && !isPlaywrightPageError(baselineCell) ? playwrightHeadlineTokens(baselineCell.run1) : null;
      if (headline === null) {
        svgParts.push(
          `<text x="${x.toFixed(1)}" y="${(panelA.bottom - 4).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="700" fill="${color}">✕</text>`
        );
      } else {
        const y = yForValue(headline);
        svgParts.push(`<polygon points="${diamondPoints(x, y)}" fill="${color}" />`);
        svgParts.push(
          `<text x="${x.toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle" font-size="9" fill="${color}">${headline.toLocaleString()}</text>`
        );
      }
    }
  });

  // Legend for Panel A
  const legendY = panelA.top - 12;
  let legendX = panelA.left + 330;
  report.meta.pages.forEach((page, i) => {
    const color = PAGE_COLORS[i % PAGE_COLORS.length];
    svgParts.push(`<rect x="${legendX}" y="${legendY - 10}" width="10" height="10" fill="${color}" />`);
    svgParts.push(
      `<text x="${legendX + 14}" y="${legendY - 1}" font-size="11" fill="#111827">${escapeXml(page.label)}</text>`
    );
    legendX += 14 + page.label.length * 6.5 + 18;
  });
  if (report.baseline) {
    svgParts.push(
      `<circle cx="${panelA.left + 4}" cy="${legendY - 5}" r="3.5" fill="#6B7280" />` +
        `<text x="${panelA.left + 12}" y="${legendY - 1}" font-size="10" fill="#6B7280">release</text>`
    );
    const diamondCx = panelA.left + 70;
    svgParts.push(
      `<polygon points="${diamondPoints(diamondCx, legendY - 5, 4)}" fill="#6B7280" />` +
        `<text x="${diamondCx + 8}" y="${legendY - 1}" font-size="10" fill="#6B7280">playwright baseline</text>`
    );
  }

  // ---- Panel B geometry ----
  const panelB = { left: 70, right: 870, top: 440, bottom: 555 };
  const panelBHeight = panelB.bottom - panelB.top;

  svgParts.push(
    `<text x="${panelB.left}" y="${panelB.top - 14}" font-size="13" font-weight="600" fill="#111827">` +
      `Panel B — tool-definition tokens by version (tool count above each bar)</text>`
  );
  svgParts.push(
    `<line x1="${panelB.left}" y1="${panelB.top}" x2="${panelB.left}" y2="${panelB.bottom}" stroke="#9CA3AF" stroke-width="1" />`
  );
  svgParts.push(
    `<line x1="${panelB.left}" y1="${panelB.bottom}" x2="${panelB.right}" y2="${panelB.bottom}" stroke="#9CA3AF" stroke-width="1" />`
  );

  const defValues = versions.map((v) => v.defTokens).filter((val): val is number => val !== null);
  const baselineDefTokensForScale = report.baseline?.defTokens ?? null;
  const defMaxCandidates = [...defValues, ...(baselineDefTokensForScale !== null ? [baselineDefTokensForScale] : [])];
  const defMax = defMaxCandidates.length > 0 ? Math.max(...defMaxCandidates) * 1.2 : 1;
  const barSlot = totalXPositions > 0 ? (panelB.right - panelB.left) / totalXPositions : 0;
  const barWidth = Math.min(48, barSlot * 0.5);

  versions.forEach((v, i) => {
    const slotCenter = panelB.left + barSlot * (i + 0.5);
    if (v.defTokens === null) {
      svgParts.push(
        `<text x="${slotCenter.toFixed(1)}" y="${(panelB.bottom - 6).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="700" fill="${PANEL_B_COLOR}">✕</text>`
      );
    } else {
      const barHeight = (v.defTokens / defMax) * panelBHeight;
      const barY = panelB.bottom - barHeight;
      svgParts.push(
        `<rect x="${(slotCenter - barWidth / 2).toFixed(1)}" y="${barY.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" fill="${PANEL_B_COLOR}" opacity="0.85" />`
      );
      svgParts.push(
        `<text x="${slotCenter.toFixed(1)}" y="${(barY - 14).toFixed(1)}" text-anchor="middle" font-size="10" fill="#111827">${v.defTokens.toLocaleString()}</text>`
      );
      svgParts.push(
        `<text x="${slotCenter.toFixed(1)}" y="${(barY - 2).toFixed(1)}" text-anchor="middle" font-size="9" fill="#6B7280">${v.toolCount} tools</text>`
      );
    }
    svgParts.push(
      `<text x="${slotCenter.toFixed(1)}" y="${panelB.bottom + 16}" text-anchor="middle" font-size="11" fill="#374151">${escapeXml(v.version)}</text>`
    );
  });

  if (report.baseline) {
    const slotCenter = panelB.left + barSlot * (n + 0.5);
    const baseline = report.baseline;
    if (baseline.defTokens === null) {
      svgParts.push(
        `<text x="${slotCenter.toFixed(1)}" y="${(panelB.bottom - 6).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="700" fill="${PLAYWRIGHT_BAR_COLOR}">✕</text>`
      );
    } else {
      const barHeight = (baseline.defTokens / defMax) * panelBHeight;
      const barY = panelB.bottom - barHeight;
      svgParts.push(
        `<rect x="${(slotCenter - barWidth / 2).toFixed(1)}" y="${barY.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" fill="${PLAYWRIGHT_BAR_COLOR}" opacity="0.85" />`
      );
      svgParts.push(
        `<text x="${slotCenter.toFixed(1)}" y="${(barY - 14).toFixed(1)}" text-anchor="middle" font-size="10" fill="#111827">${baseline.defTokens.toLocaleString()}</text>`
      );
      svgParts.push(
        `<text x="${slotCenter.toFixed(1)}" y="${(barY - 2).toFixed(1)}" text-anchor="middle" font-size="9" fill="#6B7280">${baseline.toolCount} tools</text>`
      );
    }
    svgParts.push(
      `<text x="${slotCenter.toFixed(1)}" y="${panelB.bottom + 16}" text-anchor="middle" font-size="11" fill="#374151">${escapeXml(playwrightRowLabel(baseline))}</text>`
    );
  }

  svgParts.push(`</svg>`);
  return svgParts.join("\n");
}

// ── CLI ──

interface CliOptions {
  versionsFilter: string[] | null;
  setupOnly: boolean;
  skipSetup: boolean;
  runDate: string;
  baseline: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let versionsFilter: string[] | null = null;
  let setupOnly = false;
  let skipSetup = false;
  let runDate: string | undefined = process.env.DRIFT_RUN_DATE;
  let baseline = true; // Playwright baseline is on by default; --no-baseline skips it

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--versions" && args[i + 1]) {
      versionsFilter = args[++i].split(",").map((s) => s.trim());
    } else if (args[i] === "--setup-only") {
      setupOnly = true;
    } else if (args[i] === "--skip-setup") {
      skipSetup = true;
    } else if (args[i] === "--run-date" && args[i + 1]) {
      runDate = args[++i];
    } else if (args[i] === "--no-baseline") {
      baseline = false;
    }
  }

  if (!runDate) {
    console.error(
      "drift benchmark requires a run date: pass --run-date YYYY-MM-DD or set DRIFT_RUN_DATE.\n" +
        "This is required, not defaulted, because of the same-day rule: every row in a drift\n" +
        "report must come from versions re-measured under the SAME date, run back-to-back against\n" +
        "the same live pages. A silent default risks a future rerun landing in a stale dated\n" +
        "directory (e.g. overwriting or half-merging into an old benchmarks/results/drift/<date>/),\n" +
        "which would produce a report mixing measurements from different days."
    );
    process.exit(1);
  }

  return { versionsFilter, setupOnly, skipSetup, runDate, baseline };
}

// ── Main ──

async function main(): Promise<void> {
  const options = parseArgs();
  const allSpecs = buildVersionSpecs();
  const specs = options.versionsFilter
    ? allSpecs.filter((s) => options.versionsFilter!.includes(s.version))
    : allSpecs;

  if (specs.length === 0) {
    console.error("No versions matched --versions filter. Available:", VERSION_ORDER.join(", "));
    process.exit(1);
  }

  // CACHE_ROOT doubles as the config-free spawn cwd for the local (v0.8.0)
  // spec — make sure it exists even on a --skip-setup run.
  await mkdir(CACHE_ROOT, { recursive: true });

  if (!options.skipSetup) {
    logProgress(`Setting up ${specs.length} version(s)...`);
    for (const spec of specs) {
      await setupVersion(spec);
    }
  } else {
    logProgress("Skipping setup (--skip-setup).");
  }

  if (options.setupOnly) {
    logProgress("Setup-only mode complete.");
    return;
  }

  const results: DriftVersionResult[] = [];
  for (const spec of specs) {
    await measureVersion(spec, results);
  }

  let baseline: DriftBaselineResult | null = null;
  if (options.baseline) {
    baseline = await measureBaseline();
  } else {
    logProgress("Skipping Playwright baseline (--no-baseline).");
  }

  const report: DriftReport = {
    meta: {
      runDate: options.runDate,
      generatedAt: options.runDate,
      tokenHeuristic: "ceil(chars/4)",
      pages: PAGES,
      hostNote: HOST_NOTE,
      versionOrder: specs.map((s) => s.version),
    },
    versions: results,
    baseline,
  };

  const outputDir = join(RESULTS_ROOT, options.runDate);
  await mkdir(outputDir, { recursive: true });

  const jsonPath = join(outputDir, "drift.json");
  await writeFile(jsonPath, JSON.stringify(report, null, 2));
  logProgress(`Wrote ${jsonPath}`);

  const mdPath = join(outputDir, "drift.md");
  await writeFile(mdPath, generateMarkdown(report));
  logProgress(`Wrote ${mdPath}`);

  const svgPath = join(outputDir, "drift.svg");
  await writeFile(svgPath, generateSvg(report));
  logProgress(`Wrote ${svgPath}`);

  logProgress("Done.");
}

main().catch((error) => {
  console.error("Drift benchmark failed:", error);
  process.exit(1);
});
