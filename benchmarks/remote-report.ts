#!/usr/bin/env node
/**
 * Charlotte Remote — §8 budget-pinning measurement instrument.
 *
 * Emits the four spec-§8 measurements with NO ASSERTIONS and no pass/fail
 * thresholds — this is a measurement instrument, not a test. Its numbers are
 * printed for the maintainer to review and price against the design-intent
 * targets in the project calibration record. Pinning bands is a separate,
 * human step.
 *
 * Usage:
 *   npx tsx benchmarks/remote-report.ts            # full run (real N)
 *   npx tsx benchmarks/remote-report.ts --smoke     # reduced N, proves the
 *                                                    # whole thing works end
 *                                                    # to end before the real run
 *
 * The four measurements, harness-level (per the human's chosen method):
 *   1. HTTP overhead per tool call vs stdio — core-direct vs live-HTTP,
 *      wrapping `captureGoldenScenarios` (the remote-parity sequence) in a
 *      per-call timer, one shared fixture server.
 *   2. Cold start to first observation — t0 (harness setup starts) to t1
 *      (`charlotte_observe` resolves), full teardown between samples.
 *   3. Crash-recovery relaunch — SIGKILL the Chromium root PID under a warm
 *      HTTP harness, time to the next successful `charlotte_observe`.
 *   4. Idle session memory — RSS of the Chromium process tree (root PID +
 *      all descendants), read from /proc.
 *
 * Every harness is torn down in a try/finally, even on error paths, so a
 * mid-run failure never leaks a Chromium process or a temp dir.
 */
import * as path from "node:path";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import { setupHttpHarness, type HttpHarness } from "../tests/helpers/http-harness.js";
import { setupCoreDirectHarness, type CoreDirectHarness } from "../tests/helpers/core-direct.js";
import { captureGoldenScenarios, type CallToolFn } from "../tests/helpers/golden.js";
import { StaticServer } from "../src/dev/static-server.js";

// ---------------------------------------------------------------------------
// Small stats helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Linear-interpolation percentile (p in [0,100]). NaN on an empty sample. */
function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return NaN;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  const frac = idx - lower;
  return sorted[lower] * (1 - frac) + sorted[upper] * frac;
}

function median(samples: number[]): number {
  return percentile(samples, 50);
}

interface Spread {
  median: number;
  p10: number;
  p90: number;
  n: number;
}

function summarize(samples: number[]): Spread {
  return {
    median: median(samples),
    p10: percentile(samples, 10),
    p90: percentile(samples, 90),
    n: samples.length,
  };
}

function fmtMs(value: number): string {
  if (Number.isNaN(value)) return "n/a";
  return `${value.toFixed(1)}ms`;
}

function fmtMb(value: number): string {
  if (Number.isNaN(value)) return "n/a";
  return `${value.toFixed(1)}MB`;
}

// ---------------------------------------------------------------------------
// /proc process-tree RSS reader (measurement 4)
// ---------------------------------------------------------------------------

interface ProcessMemorySample {
  pid: number;
  /** VmRSS from /proc/<pid>/status, kB->MB not yet applied (this field is in kB). Includes shared pages — an upper bound when summed across a tree. */
  rssKb: number | null;
  /** Proportional Set Size, kB. Apportions shared pages, so summing PSS across a process tree does NOT double-count — this is the correct figure to sum. Null if unreadable (see readPssKb). */
  pssKb: number | null;
}

/** Parse `/proc/<pid>/status`'s `VmRSS:` line (kB). Returns null if unreadable (process gone). */
function readVmRssKb(pid: number): number | null {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, "utf-8");
    const match = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/**
 * PSS (Proportional Set Size) for `pid`, in kB. Preferred source is
 * `/proc/<pid>/smaps_rollup`'s single `Pss:` line (cheap, kernel-aggregated).
 * Falls back to summing every `Pss:` line in `/proc/<pid>/smaps` (present on
 * older kernels without smaps_rollup, ~3.4x more work to parse). Returns null
 * if neither is readable for this pid (process gone, or a permission edge
 * case) — that pid is then skipped from the PSS sum and noted, rather than
 * silently treated as zero.
 */
function readPssKb(pid: number): number | null {
  try {
    const rollup = fs.readFileSync(`/proc/${pid}/smaps_rollup`, "utf-8");
    const match = rollup.match(/^Pss:\s+(\d+)\s+kB/m);
    if (match) return Number(match[1]);
  } catch {
    // fall through to the smaps fallback below
  }
  try {
    const smaps = fs.readFileSync(`/proc/${pid}/smaps`, "utf-8");
    let total = 0;
    let found = false;
    for (const match of smaps.matchAll(/^Pss:\s+(\d+)\s+kB/gm)) {
      total += Number(match[1]);
      found = true;
    }
    return found ? total : null;
  } catch {
    return null;
  }
}

/** Parse `/proc/<pid>/stat` field 4 (ppid). Returns null if unreadable (process gone). */
function readPpid(pid: number): number | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf-8");
    // Fields after "(comm)" are space-separated; comm itself may contain spaces/parens,
    // so split on the LAST ')' rather than assuming a fixed field count before it.
    const closeParen = stat.lastIndexOf(")");
    const rest = stat.slice(closeParen + 2).trim().split(/\s+/);
    // rest[0] = state, rest[1] = ppid
    const ppid = Number(rest[1]);
    return Number.isFinite(ppid) ? ppid : null;
  } catch {
    return null;
  }
}

function listAllPids(): number[] {
  return fs
    .readdirSync("/proc")
    .filter((name) => /^\d+$/.test(name))
    .map(Number);
}

/**
 * Walk /proc once to build a ppid->children map, then BFS from `rootPid` to
 * collect the whole process tree (root + all descendants), reading VmRSS
 * (upper-bound secondary figure) and PSS (headline figure — apportions
 * shared pages, so it doesn't double-count across sibling processes) for
 * each live PID found. A process that disappears mid-walk is silently
 * dropped (best-effort snapshot, not a transactional read).
 */
function collectProcessTreeMemory(rootPid: number): ProcessMemorySample[] {
  const allPids = listAllPids();
  const childrenByPpid = new Map<number, number[]>();
  for (const pid of allPids) {
    const ppid = readPpid(pid);
    if (ppid === null) continue;
    const siblings = childrenByPpid.get(ppid) ?? [];
    siblings.push(pid);
    childrenByPpid.set(ppid, siblings);
  }

  const result: ProcessMemorySample[] = [];
  const seen = new Set<number>();
  const queue: number[] = [rootPid];
  while (queue.length > 0) {
    const pid = queue.shift()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    const rssKb = readVmRssKb(pid);
    const pssKb = readPssKb(pid);
    if (rssKb !== null || pssKb !== null) result.push({ pid, rssKb, pssKb });
    const children = childrenByPpid.get(pid) ?? [];
    queue.push(...children);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Run-size configuration (full vs --smoke)
// ---------------------------------------------------------------------------

interface RunSizes {
  httpOverhead: { warmupPasses: number; passes: number };
  coldStart: { warmupSamples: number; samples: number };
  crashRecovery: { warmupSamples: number; samples: number };
  idleMemory: { samples: number };
}

const FULL_SIZES: RunSizes = {
  httpOverhead: { warmupPasses: 3, passes: 30 },
  coldStart: { warmupSamples: 1, samples: 10 },
  crashRecovery: { warmupSamples: 1, samples: 10 },
  idleMemory: { samples: 5 },
};

const SMOKE_SIZES: RunSizes = {
  httpOverhead: { warmupPasses: 1, passes: 5 },
  coldStart: { warmupSamples: 0, samples: 3 },
  crashRecovery: { warmupSamples: 0, samples: 3 },
  idleMemory: { samples: 3 },
};

// Profile every HTTP harness in this report is stood up with. "browse" matches
// the precedent set by the slice-1 observational note in the project
// calibration record, and keeps the HTTP-overhead number comparable to that
// note (overhead scales with registered tool-set size).
const REPORT_PROFILE = "browse" as const;

const FIXTURES_DIR = path.resolve(import.meta.dirname, "../tests/fixtures/pages");

// ---------------------------------------------------------------------------
// Measurement 1 — HTTP overhead per tool call vs stdio
// ---------------------------------------------------------------------------

interface PerCallOverhead {
  label: string;
  core: Spread;
  http: Spread;
  deltaMedianMs: number;
}

interface HttpOverheadResult {
  perCall: PerCallOverhead[];
  aggregateDeltaMs: Spread;
  warmupPasses: number;
  passes: number;
  httpFasterThanCoreLabels: string[];
}

/**
 * Wraps a raw `callTool` with a per-pass timer. Each call to this factory
 * returns a FRESH closure with its own call counter starting at 1, so the
 * label for the Nth call in a `captureGoldenScenarios` pass is stable and
 * identical across passes and across the core/HTTP paths (both execute the
 * exact same fixed scenario sequence — see tests/helpers/golden.ts).
 */
function makeTimedCallTool(
  rawCallTool: CallToolFn,
  sink: Map<string, number[]>,
): CallToolFn {
  let callIndex = 0;
  return async (name, args) => {
    callIndex += 1;
    const label = `${String(callIndex).padStart(2, "0")}:${name}`;
    const startedAt = Date.now();
    const result = await rawCallTool(name, args);
    const elapsedMs = Date.now() - startedAt;
    const samples = sink.get(label) ?? [];
    samples.push(elapsedMs);
    sink.set(label, samples);
    return result;
  };
}

async function measureHttpOverhead(sizes: RunSizes["httpOverhead"]): Promise<HttpOverheadResult> {
  const fixtureServer = new StaticServer();
  const info = await fixtureServer.start({
    directoryPath: FIXTURES_DIR,
    allowedRoot: FIXTURES_DIR,
  });

  let coreHarness: CoreDirectHarness | undefined;
  let httpHarness: HttpHarness | undefined;
  try {
    coreHarness = await setupCoreDirectHarness();
    httpHarness = await setupHttpHarness({ profile: REPORT_PROFILE });

    const coreSamples = new Map<string, number[]>();
    const httpSamples = new Map<string, number[]>();

    const totalPasses = sizes.warmupPasses + sizes.passes;
    for (let pass = 0; pass < totalPasses; pass += 1) {
      const timedCore = makeTimedCallTool(coreHarness.callTool, coreSamples);
      await captureGoldenScenarios(timedCore, info.url);

      const timedHttp = makeTimedCallTool(httpHarness.callTool, httpSamples);
      await captureGoldenScenarios(timedHttp, info.url);
    }

    const labels = [...new Set([...coreSamples.keys(), ...httpSamples.keys()])].sort();
    const perCall: PerCallOverhead[] = [];
    const httpFasterThanCoreLabels: string[] = [];

    for (const label of labels) {
      const coreAll = coreSamples.get(label) ?? [];
      const httpAll = httpSamples.get(label) ?? [];
      // Discard the first `warmupPasses` entries — samples were appended in
      // pass order, one entry per pass, so this drops the warmup passes and
      // keeps exactly `sizes.passes` per label (barring a scenario error).
      const coreKept = coreAll.slice(sizes.warmupPasses);
      const httpKept = httpAll.slice(sizes.warmupPasses);

      const coreSpread = summarize(coreKept);
      const httpSpread = summarize(httpKept);
      const deltaMedianMs = httpSpread.median - coreSpread.median;
      if (deltaMedianMs < 0) httpFasterThanCoreLabels.push(label);

      perCall.push({ label, core: coreSpread, http: httpSpread, deltaMedianMs });
    }

    const perCallDeltas = perCall.map((entry) => entry.deltaMedianMs);
    const aggregateDeltaMs = summarize(perCallDeltas);

    return {
      perCall,
      aggregateDeltaMs,
      warmupPasses: sizes.warmupPasses,
      passes: sizes.passes,
      httpFasterThanCoreLabels,
    };
  } finally {
    await httpHarness?.teardown().catch(() => {});
    await coreHarness?.teardown().catch(() => {});
    await fixtureServer.stop().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Measurement 2 — cold start to first observation
// ---------------------------------------------------------------------------

interface ColdStartResult {
  spread: Spread;
  warmupSamples: number;
  allSamplesMs: number[];
}

async function measureColdStart(sizes: RunSizes["coldStart"]): Promise<ColdStartResult> {
  const totalRuns = sizes.warmupSamples + sizes.samples;
  const allSamplesMs: number[] = [];

  for (let run = 0; run < totalRuns; run += 1) {
    const startedAt = Date.now();
    let harness: HttpHarness | undefined;
    try {
      harness = await setupHttpHarness({
        serveDirectory: FIXTURES_DIR,
        profile: REPORT_PROFILE,
      });
      await harness.callTool("charlotte_observe", { detail: "summary" });
      allSamplesMs.push(Date.now() - startedAt);
    } finally {
      // Full teardown between samples so every run is a genuine cold start.
      await harness?.teardown().catch(() => {});
    }
  }

  const kept = allSamplesMs.slice(sizes.warmupSamples);
  return { spread: summarize(kept), warmupSamples: sizes.warmupSamples, allSamplesMs };
}

// ---------------------------------------------------------------------------
// Measurement 3 — crash-recovery relaunch
// ---------------------------------------------------------------------------

interface CrashRecoveryResult {
  spread: Spread;
  warmupSamples: number;
  allSamplesMs: number[];
  /** Count of individual `charlotte_observe` calls that came back isError/threw, across all samples. */
  failedObserveCalls: number;
  /** Count of kill cycles ("samples") attempted (one SIGKILL each). */
  samplesAttempted: number;
  /** Count of samples that never recovered within the per-sample retry budget. */
  samplesNeverRecovered: number;
}

/** Best-effort extraction of the first text content block, for error messages. */
function extractErrorText(result: { content?: unknown }): string {
  const content = result.content as Array<{ type?: string; text?: string }> | undefined;
  const firstText = content?.find((block) => typeof block?.text === "string")?.text;
  return firstText ?? "(tool call returned isError with no text content)";
}

/**
 * Per spec: ONE SIGKILL per sample, then time from kill to the next
 * `charlotte_observe` resolving *successfully* (a resolved isError result is
 * not success — MCP tool errors don't throw). Immediately-post-relaunch CDP
 * calls can race the target/page-adoption lifecycle and fail transiently, so
 * a failed observe call is retried (same kill, no second kill) with a short
 * backoff — re-killing on every failure was tried first and produced a
 * runaway cascade (kills landing on a Chromium that hadn't finished booting
 * yet), which is a measurement-methodology artifact, not the thing being
 * measured. Every failed call is still counted and surfaced.
 */
async function measureCrashRecovery(
  sizes: RunSizes["crashRecovery"],
): Promise<CrashRecoveryResult> {
  const harness = await setupHttpHarness({
    serveDirectory: FIXTURES_DIR,
    profile: REPORT_PROFILE,
  });

  const target = sizes.warmupSamples + sizes.samples;
  const allSamplesMs: number[] = [];
  let failedObserveCalls = 0;
  let samplesNeverRecovered = 0;
  const maxRetriesPerSample = 20;
  const retryBackoffMs = 100;

  try {
    for (let sample = 0; sample < target; sample += 1) {
      const browser = await harness.ctx.browserManager.getBrowser();
      const pid = browser.process()?.pid;
      if (pid === undefined) {
        samplesNeverRecovered += 1;
        console.error(
          `  [crash-recovery] sample ${sample + 1}: no PID available on the live browser process, skipping`,
        );
        continue;
      }

      process.kill(pid, "SIGKILL");
      const startedAt = Date.now();
      let succeeded = false;
      for (let retry = 0; retry < maxRetriesPerSample; retry += 1) {
        try {
          const result = await harness.callTool("charlotte_observe", { detail: "summary" });
          if (result.isError) {
            throw new Error(extractErrorText(result));
          }
          allSamplesMs.push(Date.now() - startedAt);
          succeeded = true;
          break;
        } catch (error) {
          failedObserveCalls += 1;
          const message = error instanceof Error ? error.message : String(error);
          console.error(
            `  [crash-recovery] sample ${sample + 1} retry ${retry + 1}: recovery call failed — ${message}`,
          );
          await sleep(retryBackoffMs);
        }
      }
      if (!succeeded) {
        samplesNeverRecovered += 1;
        console.error(
          `  [crash-recovery] sample ${sample + 1}: never recovered after ${maxRetriesPerSample} retries`,
        );
      }
    }
  } finally {
    await harness.teardown().catch(() => {});
  }

  const kept = allSamplesMs.slice(sizes.warmupSamples);
  return {
    spread: summarize(kept),
    warmupSamples: sizes.warmupSamples,
    allSamplesMs,
    failedObserveCalls,
    samplesAttempted: target,
    samplesNeverRecovered,
  };
}

// ---------------------------------------------------------------------------
// Measurement 4 — idle session memory
// ---------------------------------------------------------------------------

interface IdleMemorySnapshot {
  /** Headline figure: summed PSS across the Chromium process tree, MB. Apportions shared pages — no double-counting. */
  totalPssMb: number;
  /** Secondary figure: summed VmRSS across the tree, MB. Includes shared pages in full for every process that maps them — an UPPER BOUND, not the real footprint. */
  totalRssMb: number;
  /** PIDs in the tree where PSS could not be read (neither smaps_rollup nor smaps) — excluded from totalPssMb, noted rather than silently zeroed. */
  pssUnavailablePids: number[];
  processes: ProcessMemorySample[];
}

interface IdleMemoryResult {
  /** PSS spread, MB — the headline number. */
  spread: Spread;
  /** RSS spread, MB — secondary, labeled as an upper bound. */
  spreadRssUpperBound: Spread;
  snapshots: IdleMemorySnapshot[];
}

async function measureIdleMemory(sizes: RunSizes["idleMemory"]): Promise<IdleMemoryResult> {
  const harness = await setupHttpHarness({
    serveDirectory: FIXTURES_DIR,
    profile: REPORT_PROFILE,
  });

  try {
    // Warm the session with the golden sequence once so "idle" reflects a
    // session that has actually done real work, not a freshly-launched tab.
    await captureGoldenScenarios(harness.callTool, harness.fixtureServer!.url);
    await sleep(1000); // let the page settle

    const snapshots: IdleMemorySnapshot[] = [];
    for (let i = 0; i < sizes.samples; i += 1) {
      const browser = await harness.ctx.browserManager.getBrowser();
      const pid = browser.process()?.pid;
      if (pid === undefined) {
        throw new Error("measureIdleMemory: no PID available on the live browser process");
      }
      const processes = collectProcessTreeMemory(pid);
      const totalRssMb =
        processes.reduce((sum, p) => sum + (p.rssKb ?? 0), 0) / 1024;
      const pssUnavailablePids = processes.filter((p) => p.pssKb === null).map((p) => p.pid);
      const totalPssMb =
        processes.reduce((sum, p) => sum + (p.pssKb ?? 0), 0) / 1024;
      if (pssUnavailablePids.length > 0) {
        console.error(
          `  [idle-memory] snapshot ${i + 1}: PSS unavailable for pid(s) ${pssUnavailablePids.join(", ")} — excluded from the PSS sum`,
        );
      }
      snapshots.push({ totalPssMb, totalRssMb, pssUnavailablePids, processes });
      if (i < sizes.samples - 1) await sleep(500);
    }

    return {
      spread: summarize(snapshots.map((s) => s.totalPssMb)),
      spreadRssUpperBound: summarize(snapshots.map((s) => s.totalRssMb)),
      snapshots,
    };
  } finally {
    await harness.teardown().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

interface DesignIntent {
  label: string;
  note: string;
}

const DESIGN_INTENT: Record<
  "httpOverhead" | "coldStart" | "crashRecovery" | "idleMemory",
  DesignIntent
> = {
  httpOverhead: { label: "50ms", note: "(not asserted)" },
  coldStart: { label: "5s", note: "(not asserted)" },
  crashRecovery: { label: "8s", note: "(not asserted)" },
  idleMemory: { label: "400MB", note: "(not asserted)" },
};

interface TableRow {
  measure: string;
  medianLabel: string;
  spreadLabel: string;
  n: number;
  designIntent: string;
}

function padRight(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function renderTable(rows: TableRow[]): string {
  const headers = ["Measure", "Median (p10–p90)", "N", "Design intent"];
  const columns = [
    Math.max(headers[0].length, ...rows.map((r) => r.measure.length)),
    Math.max(headers[1].length, ...rows.map((r) => `${r.medianLabel} (${r.spreadLabel})`.length)),
    Math.max(headers[2].length, ...rows.map((r) => String(r.n).length)),
    Math.max(headers[3].length, ...rows.map((r) => r.designIntent.length)),
  ];

  const lines: string[] = [];
  lines.push(
    `${padRight(headers[0], columns[0])}  ${padRight(headers[1], columns[1])}  ${padRight(headers[2], columns[2])}  ${headers[3]}`,
  );
  lines.push(columns.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) {
    const medianCol = `${row.medianLabel} (${row.spreadLabel})`;
    lines.push(
      `${padRight(row.measure, columns[0])}  ${padRight(medianCol, columns[1])}  ${padRight(String(row.n), columns[2])}  ${row.designIntent}`,
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const smoke = process.argv.includes("--smoke");
  const sizes = smoke ? SMOKE_SIZES : FULL_SIZES;
  const runStartedAt = new Date();

  console.log(`=== Charlotte Remote §8 measurement report ${smoke ? "(SMOKE RUN)" : ""} ===`);
  console.log(
    `Started ${runStartedAt.toISOString()} on ${os.hostname()} (${os.platform()}/${os.arch()}, ${os.cpus().length} CPUs)`,
  );
  console.log("This is a measurement instrument. No assertions, no pass/fail thresholds.\n");

  console.log(
    `[1/4] HTTP overhead per tool call vs stdio (warmup=${sizes.httpOverhead.warmupPasses}, passes=${sizes.httpOverhead.passes})...`,
  );
  const httpOverhead = await measureHttpOverhead(sizes.httpOverhead);
  console.log(
    `      done — aggregate delta median ${fmtMs(httpOverhead.aggregateDeltaMs.median)}, ${httpOverhead.perCall.length} call labels`,
  );
  if (httpOverhead.httpFasterThanCoreLabels.length > 0) {
    console.log(
      `      FINDING: HTTP path faster than core-direct for: ${httpOverhead.httpFasterThanCoreLabels.join(", ")}`,
    );
  }

  console.log(
    `\n[2/4] Cold start to first observation (warmup=${sizes.coldStart.warmupSamples}, samples=${sizes.coldStart.samples})...`,
  );
  const coldStart = await measureColdStart(sizes.coldStart);
  console.log(`      done — median ${fmtMs(coldStart.spread.median)}`);

  console.log(
    `\n[3/4] Crash-recovery relaunch (warmup=${sizes.crashRecovery.warmupSamples}, samples=${sizes.crashRecovery.samples})...`,
  );
  const crashRecovery = await measureCrashRecovery(sizes.crashRecovery);
  console.log(
    `      done — median ${fmtMs(crashRecovery.spread.median)}, failed observe calls: ${crashRecovery.failedObserveCalls} across ${crashRecovery.samplesAttempted} samples, samples never recovered: ${crashRecovery.samplesNeverRecovered}`,
  );
  if (crashRecovery.failedObserveCalls > 0) {
    console.log(
      `      FINDING: ${crashRecovery.failedObserveCalls} recovery call(s) failed transiently (retried with backoff)`,
    );
  }
  if (crashRecovery.samplesNeverRecovered > 0) {
    console.log(
      `      FINDING: ${crashRecovery.samplesNeverRecovered} sample(s) never recovered within the retry budget`,
    );
  }

  console.log(`\n[4/4] Idle session memory (samples=${sizes.idleMemory.samples})...`);
  const idleMemory = await measureIdleMemory(sizes.idleMemory);
  console.log(
    `      done — PSS median ${fmtMb(idleMemory.spread.median)} (headline); RSS median ${fmtMb(idleMemory.spreadRssUpperBound.median)} (secondary, upper bound — includes shared pages in full)`,
  );

  const rows: TableRow[] = [
    {
      measure: "HTTP overhead per tool call vs stdio",
      medianLabel: fmtMs(httpOverhead.aggregateDeltaMs.median),
      spreadLabel: `${fmtMs(httpOverhead.aggregateDeltaMs.p10)}–${fmtMs(httpOverhead.aggregateDeltaMs.p90)}`,
      n: httpOverhead.passes,
      designIntent: `${DESIGN_INTENT.httpOverhead.label} ${DESIGN_INTENT.httpOverhead.note}`,
    },
    {
      measure: "Cold start to first observation",
      medianLabel: fmtMs(coldStart.spread.median),
      spreadLabel: `${fmtMs(coldStart.spread.p10)}–${fmtMs(coldStart.spread.p90)}`,
      n: coldStart.spread.n,
      designIntent: `${DESIGN_INTENT.coldStart.label} ${DESIGN_INTENT.coldStart.note}`,
    },
    {
      measure: "Crash-recovery relaunch",
      medianLabel: fmtMs(crashRecovery.spread.median),
      spreadLabel: `${fmtMs(crashRecovery.spread.p10)}–${fmtMs(crashRecovery.spread.p90)}`,
      n: crashRecovery.spread.n,
      designIntent: `${DESIGN_INTENT.crashRecovery.label} ${DESIGN_INTENT.crashRecovery.note}`,
    },
    {
      measure: "Idle session memory",
      medianLabel: fmtMb(idleMemory.spread.median),
      spreadLabel: `${fmtMb(idleMemory.spread.p10)}–${fmtMb(idleMemory.spread.p90)}`,
      n: idleMemory.spread.n,
      designIntent: `${DESIGN_INTENT.idleMemory.label} ${DESIGN_INTENT.idleMemory.note}`,
    },
  ];

  console.log("\n" + renderTable(rows));

  const assumptions = {
    host: os.hostname(),
    platform: `${os.platform()}/${os.arch()}`,
    cpus: os.cpus().length,
    totalMemMb: Math.round(os.totalmem() / (1024 * 1024)),
    nodeVersion: process.version,
    noSandbox: true,
    transport: "loopback TCP (127.0.0.1, ephemeral port)",
    toolProfile: REPORT_PROFILE,
    workload: "remote-parity golden sequence (captureGoldenScenarios): 4 fixture pages x navigate/observe/find + 1 click",
    fixturePages: ["simple.html", "form.html", "plain-form.html", "interaction.html"],
    smoke,
    excludesNodeProcessStartup:
      "Cold-start measurement starts t0 at harness setup (Chromium launch), not at Node process start / module import — real container cold-start is a slice-3 concern.",
    idleMemoryMethod:
      "Idle session memory is the summed PSS (Proportional Set Size, from /proc/<pid>/smaps_rollup or /proc/<pid>/smaps) of the Chromium process tree only — root process + every descendant (renderer/GPU/utility processes etc). PSS apportions shared pages across processes so the sum does not double-count, unlike summed RSS (kept as a secondary upper-bound figure). The Node.js server process running this harness/report is explicitly EXCLUDED from the figure.",
  };

  console.log("\n=== Assumptions ===");
  for (const [key, value] of Object.entries(assumptions)) {
    console.log(`  ${key}: ${JSON.stringify(value)}`);
  }

  const report = {
    generatedAt: runStartedAt.toISOString(),
    smoke,
    assumptions,
    measurements: {
      httpOverheadPerToolCallVsStdio: {
        designIntentMs: 50,
        aggregateDeltaMs: httpOverhead.aggregateDeltaMs,
        warmupPasses: httpOverhead.warmupPasses,
        passes: httpOverhead.passes,
        httpFasterThanCoreLabels: httpOverhead.httpFasterThanCoreLabels,
        perCall: httpOverhead.perCall,
      },
      coldStartToFirstObservation: {
        designIntentMs: 5000,
        spread: coldStart.spread,
        warmupSamples: coldStart.warmupSamples,
        allSamplesMs: coldStart.allSamplesMs,
      },
      crashRecoveryRelaunch: {
        designIntentMs: 8000,
        spread: crashRecovery.spread,
        warmupSamples: crashRecovery.warmupSamples,
        allSamplesMs: crashRecovery.allSamplesMs,
        failedObserveCalls: crashRecovery.failedObserveCalls,
        samplesAttempted: crashRecovery.samplesAttempted,
        samplesNeverRecovered: crashRecovery.samplesNeverRecovered,
      },
      idleSessionMemory: {
        designIntentMb: 400,
        // Headline: summed PSS across the Chromium process tree (apportions
        // shared pages — does not double-count).
        spreadPssMb: idleMemory.spread,
        // Secondary: summed VmRSS across the tree — an UPPER BOUND (shared
        // pages counted in full against every process that maps them).
        spreadRssUpperBoundMb: idleMemory.spreadRssUpperBound,
        snapshots: idleMemory.snapshots,
      },
    },
  };

  const resultsDir = path.resolve(import.meta.dirname, "results");
  await fsPromises.mkdir(resultsDir, { recursive: true });
  const outPath = path.join(resultsDir, `remote-report-${Date.now()}.json`);
  await fsPromises.writeFile(outPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`\nJSON report written to: ${outPath}`);
}

main().catch((error) => {
  console.error("remote-report failed:", error);
  process.exitCode = 1;
});
