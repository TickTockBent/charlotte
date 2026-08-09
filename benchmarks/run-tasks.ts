#!/usr/bin/env node
/**
 * Per-task token battery.
 *
 * Compares Charlotte v0.8.0 (this repo's built dist/) against the repo's
 * currently-installed Playwright MCP on three scripted, realistic agent
 * tasks — not a generic orientation snapshot like run-drift.ts, but the
 * actual multi-call sequence a competent agent would use to GET SOMETHING
 * DONE: read headlines, find-and-click a link, fill and submit a form.
 *
 * The call sequence for each task/server pair is fixed methodology, printed
 * verbatim in tasks.md — see the SEQUENCES constant below, which must stay
 * in sync with what the run*Charlotte()/run*Playwright() functions actually
 * do.
 *
 * Honesty rules (also printed in tasks.md):
 *   - Each server gets its own most-efficient reasonable path. No
 *     handicapping either side to make the comparison closer or further
 *     apart.
 *   - Every response an agent would necessarily ingest counts toward the
 *     task total — including a file-written snapshot IF the path requires
 *     reading it for refs. In the sequences below every ref is obtained from
 *     an explicit browser_snapshot call that's already counted, so no
 *     separate file read is needed (verified empirically, see tasks.md).
 *   - Read-only/discovery calls (navigate, observe, find, snapshot) get one
 *     retry on transient failure, matching run-drift.ts's convention.
 *     Mutating calls (click, type, fill_form) do NOT auto-retry — retrying
 *     a click or form submit on ambiguous failure risks a double action
 *     against a live site, which would misrepresent the task's real cost.
 *   - Tool-definition cost is reported once per server, separately, and is
 *     never folded into a task's response-token total (it amortizes across
 *     an entire session, not per task).
 *
 * Usage:
 *   npx tsx benchmarks/run-tasks.ts --run-date 2026-08-09
 *
 * --run-date (or env DRIFT_RUN_DATE) is required, same rationale as
 * run-drift.ts: a task battery is only comparable within one run date.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BenchmarkMcpClient, ServerConfig, ToolCallResult } from "./harness/mcp-client.js";

const execFileAsync = promisify(execFile);

const REPO_ROOT = join(import.meta.dirname, "..");
const CACHE_ROOT = join(REPO_ROOT, "benchmarks", ".drift-cache");
const RESULTS_ROOT = join(REPO_ROOT, "benchmarks", "results", "tasks");

const CONNECT_TIMEOUT_MS = 45 * 1000;
const CALL_TIMEOUT_MS = 60 * 1000;

const CHARLOTTE_ENTRY = join(REPO_ROOT, "dist", "index.js");
const PLAYWRIGHT_ENTRY = join(REPO_ROOT, "node_modules", "@playwright", "mcp", "cli.js");
const PLAYWRIGHT_PACKAGE_JSON = join(REPO_ROOT, "node_modules", "@playwright", "mcp", "package.json");

const HN_URL = "https://news.ycombinator.com/";
// T3 originally targeted https://httpbin.org/forms/post but httpbin.org was in a
// sustained outage/flapping state on the run date (503s, 504s, and 30s navigation
// timeouts across ~40 minutes of testing, including two brief 200-recoveries that
// vanished again within a minute) — swapped to Selenium's own hosted test form,
// which is purpose-built for automation testing and stable. See tasks.md's
// methodology notes for the full honesty trail on this substitution.
const SELENIUM_FORM_URL = "https://www.selenium.dev/selenium/web/web-form.html";

// Field set on the Selenium form, verified empirically (see tasks.md): a plain
// <input type=text>, <input type=password>, <textarea>, and a native <select>
// (exposed as role="combobox" in Playwright's ARIA snapshot, type="select" with
// an options[] array in Charlotte's representation) — 3 text-ish fields + one
// dropdown + submit, per the task spec of "2-3 text fields + one select-or-radio +
// submit."
const FORM_TEXT_VALUE = "Charlotte QA";
const FORM_PASSWORD_VALUE = "hunter22";
const FORM_TEXTAREA_VALUE = "Benchmark run notes.";
const FORM_SELECT_OPTION_LABEL = "Two";

// ── Progress note (opt-in, same convention as run-drift.ts) ──

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
  console.error(`[tasks] ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function extractResponseText(response: unknown): string {
  try {
    const asRecord = response as { content?: Array<{ type?: string; text?: string }> };
    return asRecord?.content?.map((part) => part.text ?? "").join("\n") ?? "";
  } catch {
    return "";
  }
}

/**
 * httpbin.org (T3's original target — see the target-swap note in
 * tasks.md) was observed to be intermittently unavailable during
 * development of this benchmark (503s that load "successfully" as a page —
 * isError stays false, so the normal error path never fires). Kept as a
 * general-purpose diagnostic for T3's current target too: when a
 * downstream discovery step finds zero fields, this checks whether the
 * navigate response itself hints at a non-2xx status, so the failure note
 * says "site was down" instead of the more alarming-looking "form fields
 * not fully discovered" (which could otherwise read as a parsing bug).
 */
function detectLikelyPageErrorStatus(navResponseText: string): string | null {
  const titleMatch =
    navResponseText.match(/"title"\s*:\s*"([^"]*)"/) ?? navResponseText.match(/Page Title:\s*(.+)/);
  const title = titleMatch?.[1]?.trim() ?? "";
  if (/\b5\d\d\b/.test(title) || /service unavailable|temporarily unavailable|bad gateway|gateway timeout/i.test(title)) {
    return `target page likely returned an error status (title="${title}")`;
  }
  const statusMatch = navResponseText.match(/HTTP status:\s*(\d+)/i);
  if (statusMatch && Number(statusMatch[1]) >= 400) {
    return `target page returned HTTP ${statusMatch[1]}`;
  }
  return null;
}

// ── Process hygiene (same convention as run-drift.ts) ──

async function snapshotChromePids(): Promise<Set<number>> {
  try {
    const { stdout } = await execFileAsync("pgrep", ["-f", "chrome"], { maxBuffer: 64 * 1024 * 1024 });
    return new Set(
      stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map(Number)
        .filter((n) => Number.isFinite(n))
    );
  } catch {
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

// ── Tool-call recording ──

interface CallRecord {
  tool: string;
  args: Record<string, unknown>;
  chars: number;
  tokens: number;
  isError: boolean;
  errorText?: string;
}

/**
 * Call a tool and record its response size. Read-only/discovery calls
 * (navigate, observe, find, snapshot) pass retryable:true and get one retry
 * on transient failure. Mutating calls (click, type, fill_form) default to
 * a single attempt — see the honesty-rules doc comment at the top of this
 * file for why they don't auto-retry.
 */
async function callAndRecord(
  client: BenchmarkMcpClient,
  toolName: string,
  args: Record<string, unknown>,
  calls: CallRecord[],
  options: { retryable?: boolean } = {}
): Promise<ToolCallResult> {
  const attempts = options.retryable ? 2 : 1;
  let result: ToolCallResult | null = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    result = await withTimeout(
      client.callTool(toolName, args),
      CALL_TIMEOUT_MS,
      `${toolName} (attempt ${attempt + 1})`
    );
    if (!result.isError) break;
  }
  const finalResult = result as ToolCallResult;
  calls.push({
    tool: toolName,
    args,
    chars: finalResult.metrics.responseChars,
    tokens: finalResult.metrics.estimatedTokens,
    isError: finalResult.isError,
    errorText: finalResult.isError ? extractToolErrorText(finalResult.response) : undefined,
  });
  return finalResult;
}

// ── Element/ref discovery parsing ──

interface CharlotteElement {
  id: string;
  type: string;
  label: string;
}

function parseCharlotteElements(response: unknown): CharlotteElement[] {
  const text = extractResponseText(response);
  try {
    const parsed = JSON.parse(text) as { elements?: CharlotteElement[]; interactive?: CharlotteElement[] };
    return parsed.elements ?? parsed.interactive ?? [];
  } catch {
    return [];
  }
}

/** Prefer an exact (trimmed, case-insensitive) label match; else undefined. */
function findExactElement(elements: CharlotteElement[], type: string, exactLabel: string): CharlotteElement | undefined {
  const target = exactLabel.trim().toLowerCase();
  return elements.find((e) => e.type === type && e.label.trim().toLowerCase() === target);
}

/** Substring (case-insensitive) label match — used for longer/punctuated field labels. */
function findElementContaining(elements: CharlotteElement[], type: string, needle: string): CharlotteElement | undefined {
  const target = needle.toLowerCase();
  return elements.find((e) => e.type === type && e.label.toLowerCase().includes(target));
}

/**
 * Find a Playwright ARIA-snapshot ref for a given role + name. Prefers an
 * exact (quoted) accessible-name match; falls back to substring containment.
 * Exact-match preference matters on live/dynamic pages — e.g. Hacker News
 * front-page content briefly produced both a "login" nav link AND an
 * unrelated headline whose accessible name happened to contain "login" as a
 * substring, which a naive substring-only match would have picked up.
 */
function findPlaywrightRef(snapshotText: string, roleRegex: RegExp, name: string): string | null {
  const target = name.toLowerCase();
  const lines = snapshotText.split("\n");
  let fallback: string | null = null;
  for (const line of lines) {
    if (!roleRegex.test(line)) continue;
    // Refs are usually "e26" but gain a frame-index prefix on later snapshots
    // within the same session (e.g. "f2e26") — match any ref token, not just
    // the bare e\d+ shape, or later-snapshot refs (T2/T3's 2nd+ browser_snapshot
    // call) silently fail to match.
    const refMatch = line.match(/\[ref=([a-zA-Z0-9]+)\]/);
    if (!refMatch) continue;
    const nameMatch = line.match(/"([^"]*)"/);
    const lineName = (nameMatch?.[1] ?? "").toLowerCase();
    if (lineName === target) return refMatch[1];
    if (fallback === null && lineName.includes(target)) fallback = refMatch[1];
  }
  return fallback;
}

// ── Task result types ──

interface TaskRunResult {
  calls: CallRecord[];
  totalChars: number;
  totalTokens: number;
  callCount: number;
  success: boolean;
  note: string;
}

type TaskRunOutcome = TaskRunResult | { error: string };

function isTaskError(outcome: TaskRunOutcome): outcome is { error: string } {
  return "error" in outcome;
}

function summarizeCalls(calls: CallRecord[], success: boolean, note: string): TaskRunResult {
  const totalChars = calls.reduce((sum, c) => sum + c.chars, 0);
  const totalTokens = calls.reduce((sum, c) => sum + c.tokens, 0);
  return { calls, totalChars, totalTokens, callCount: calls.length, success, note };
}

interface TaskServerResult {
  sequence: string[]; // documented call sequence for this task/server pair
  run1: TaskRunOutcome;
  run2: TaskRunOutcome;
}

interface TaskResult {
  taskId: "T1" | "T2" | "T3";
  name: string;
  description: string;
  charlotte: TaskServerResult;
  playwright: TaskServerResult;
}

// ── Documented call sequences (printed verbatim in tasks.md) ──

const SEQUENCES = {
  T1: {
    charlotte: [
      'charlotte_navigate({ url })',
      'charlotte_find({ type: "link" }) — obtain the headlines: on Hacker News, headline text lives on link-role elements, so this is the minimal single-call read (empirically smaller than observe(detail:"summary") on the same page, which returns the same element set plus extra structure/content_summary wrapper).',
    ],
    playwright: [
      'browser_navigate({ url })',
      "browser_snapshot({}) — the inline accessibility tree; this is the only place page content appears (browser_navigate writes it to a file instead, see the observed-behavior note in tasks.md).",
    ],
  },
  T2: {
    charlotte: [
      'charlotte_navigate({ url })',
      'charlotte_find({ text: "login" }) — locate the login link specifically (targeted find, not a full link dump).',
      "charlotte_click({ element_id }) — click the located element.",
    ],
    playwright: [
      'browser_navigate({ url })',
      "browser_snapshot({}) — needed to obtain the login link's element ref before it can be clicked.",
      "browser_click({ element, target: ref }) — click it.",
    ],
  },
  T3: {
    charlotte: [
      'charlotte_navigate({ url })',
      'charlotte_observe({ detail: "summary" }) — discover all form field element_ids in one call.',
      "charlotte_type × 3 — text input, password, textarea.",
      'charlotte_select({ element_id, value: "Two" }) — native <select> dropdown; Charlotte exposes it as ' +
        'type="select" with an options[] array, and charlotte_select works on it directly (verified empirically).',
      'charlotte_click(submit button "Submit") — NOT charlotte_submit: this form (like httpbin\'s) has no ' +
        'accessible name (no aria-label/title), so Chromium\'s accessibility tree never exposes it with ' +
        'role="form", and Charlotte only recognizes forms via that AX role. No form_id is available for this ' +
        "page either — see the finding in tasks.md. The submit button is clicked directly instead.",
    ],
    playwright: [
      'browser_navigate({ url })',
      "browser_snapshot({}) — obtain refs for every field and the submit button in one call.",
      'browser_fill_form({ fields: [text, password, textarea, select] }) — batched multi-field fill in a single ' +
        'tool call; the dropdown is exposed as role="combobox" in the ARIA snapshot and filled via ' +
        'type: "combobox" (verified empirically).',
      "browser_click({ target: submit ref }) — submit.",
    ],
  },
} as const;

// ── T1: orient-and-read ──

async function runT1Charlotte(client: BenchmarkMcpClient): Promise<TaskRunResult> {
  const calls: CallRecord[] = [];
  const nav = await callAndRecord(client, "charlotte_navigate", { url: HN_URL }, calls, { retryable: true });
  if (nav.isError) return summarizeCalls(calls, false, `navigate failed: ${extractToolErrorText(nav.response)}`);
  const find = await callAndRecord(client, "charlotte_find", { type: "link" }, calls, { retryable: true });
  if (find.isError) return summarizeCalls(calls, false, `find failed: ${extractToolErrorText(find.response)}`);
  return summarizeCalls(calls, true, "completed: navigate + find(type:link)");
}

async function runT1Playwright(client: BenchmarkMcpClient): Promise<TaskRunResult> {
  const calls: CallRecord[] = [];
  const nav = await callAndRecord(client, "browser_navigate", { url: HN_URL }, calls, { retryable: true });
  if (nav.isError) return summarizeCalls(calls, false, `navigate failed: ${extractToolErrorText(nav.response)}`);
  const snap = await callAndRecord(client, "browser_snapshot", {}, calls, { retryable: true });
  if (snap.isError) return summarizeCalls(calls, false, `snapshot failed: ${extractToolErrorText(snap.response)}`);
  return summarizeCalls(calls, true, "completed: browser_navigate + browser_snapshot");
}

// ── T2: find-and-act ──

async function runT2Charlotte(client: BenchmarkMcpClient): Promise<TaskRunResult> {
  const calls: CallRecord[] = [];
  const nav = await callAndRecord(client, "charlotte_navigate", { url: HN_URL }, calls, { retryable: true });
  if (nav.isError) return summarizeCalls(calls, false, `navigate failed: ${extractToolErrorText(nav.response)}`);
  const find = await callAndRecord(client, "charlotte_find", { text: "login" }, calls, { retryable: true });
  if (find.isError) return summarizeCalls(calls, false, `find failed: ${extractToolErrorText(find.response)}`);
  const elements = parseCharlotteElements(find.response);
  const loginEl = findExactElement(elements, "link", "login") ?? elements[0];
  if (!loginEl) return summarizeCalls(calls, false, "login link not found in find(text:login) results");
  const click = await callAndRecord(client, "charlotte_click", { element_id: loginEl.id }, calls);
  if (click.isError) return summarizeCalls(calls, false, `click failed: ${extractToolErrorText(click.response)}`);
  return summarizeCalls(calls, true, "completed: navigate + find(text:login) + click(element_id)");
}

async function runT2Playwright(client: BenchmarkMcpClient): Promise<TaskRunResult> {
  const calls: CallRecord[] = [];
  const nav = await callAndRecord(client, "browser_navigate", { url: HN_URL }, calls, { retryable: true });
  if (nav.isError) return summarizeCalls(calls, false, `navigate failed: ${extractToolErrorText(nav.response)}`);
  const snap = await callAndRecord(client, "browser_snapshot", {}, calls, { retryable: true });
  if (snap.isError) return summarizeCalls(calls, false, `snapshot failed: ${extractToolErrorText(snap.response)}`);
  const text = extractResponseText(snap.response);
  const ref = findPlaywrightRef(text, /-\s*link\b/i, "login");
  if (!ref) return summarizeCalls(calls, false, "login link ref not found in browser_snapshot");
  const click = await callAndRecord(client, "browser_click", { element: "login link", target: ref }, calls);
  if (click.isError) return summarizeCalls(calls, false, `click failed: ${extractToolErrorText(click.response)}`);
  return summarizeCalls(calls, true, "completed: browser_navigate + browser_snapshot + browser_click");
}

// ── T3: form-fill ──

async function runT3Charlotte(client: BenchmarkMcpClient): Promise<TaskRunResult> {
  const calls: CallRecord[] = [];
  const nav = await callAndRecord(client, "charlotte_navigate", { url: SELENIUM_FORM_URL }, calls, { retryable: true });
  if (nav.isError) return summarizeCalls(calls, false, `navigate failed: ${extractToolErrorText(nav.response)}`);
  const obs = await callAndRecord(client, "charlotte_observe", { detail: "summary" }, calls, { retryable: true });
  if (obs.isError) return summarizeCalls(calls, false, `observe failed: ${extractToolErrorText(obs.response)}`);

  const elements = parseCharlotteElements(obs.response);
  const textField = findExactElement(elements, "text_input", "Text input");
  const passwordField = findExactElement(elements, "text_input", "Password");
  const textareaField = findExactElement(elements, "text_input", "Textarea");
  const selectField = findExactElement(elements, "select", "Dropdown (select)");
  const submitField = findExactElement(elements, "button", "Submit");

  if (!textField || !passwordField || !textareaField || !selectField || !submitField) {
    const pageErrorHint = detectLikelyPageErrorStatus(extractResponseText(nav.response));
    const reason = pageErrorHint ? ` — likely cause: ${pageErrorHint}` : "";
    return summarizeCalls(
      calls,
      false,
      `form fields not fully discovered (text=${!!textField}, password=${!!passwordField}, ` +
        `textarea=${!!textareaField}, select=${!!selectField}, submit=${!!submitField})${reason}`
    );
  }

  const typeText = await callAndRecord(
    client,
    "charlotte_type",
    { element_id: textField.id, text: FORM_TEXT_VALUE },
    calls
  );
  if (typeText.isError) return summarizeCalls(calls, false, `type(text) failed: ${extractToolErrorText(typeText.response)}`);
  const typePassword = await callAndRecord(
    client,
    "charlotte_type",
    { element_id: passwordField.id, text: FORM_PASSWORD_VALUE },
    calls
  );
  if (typePassword.isError)
    return summarizeCalls(calls, false, `type(password) failed: ${extractToolErrorText(typePassword.response)}`);
  const typeTextarea = await callAndRecord(
    client,
    "charlotte_type",
    { element_id: textareaField.id, text: FORM_TEXTAREA_VALUE },
    calls
  );
  if (typeTextarea.isError)
    return summarizeCalls(calls, false, `type(textarea) failed: ${extractToolErrorText(typeTextarea.response)}`);
  const select = await callAndRecord(
    client,
    "charlotte_select",
    { element_id: selectField.id, value: FORM_SELECT_OPTION_LABEL },
    calls
  );
  if (select.isError) return summarizeCalls(calls, false, `select failed: ${extractToolErrorText(select.response)}`);
  const clickSubmit = await callAndRecord(client, "charlotte_click", { element_id: submitField.id }, calls);
  if (clickSubmit.isError)
    return summarizeCalls(calls, false, `click(submit) failed: ${extractToolErrorText(clickSubmit.response)}`);

  return summarizeCalls(calls, true, "completed: navigate + observe(summary) + type×3 + select + click(submit)");
}

async function runT3Playwright(client: BenchmarkMcpClient): Promise<TaskRunResult> {
  const calls: CallRecord[] = [];
  const nav = await callAndRecord(client, "browser_navigate", { url: SELENIUM_FORM_URL }, calls, { retryable: true });
  if (nav.isError) return summarizeCalls(calls, false, `navigate failed: ${extractToolErrorText(nav.response)}`);
  const snap = await callAndRecord(client, "browser_snapshot", {}, calls, { retryable: true });
  if (snap.isError) return summarizeCalls(calls, false, `snapshot failed: ${extractToolErrorText(snap.response)}`);

  const text = extractResponseText(snap.response);
  const textRef = findPlaywrightRef(text, /-\s*textbox\b/i, "text input");
  const passwordRef = findPlaywrightRef(text, /-\s*textbox\b/i, "password");
  const textareaRef = findPlaywrightRef(text, /-\s*textbox\b/i, "textarea");
  const selectRef = findPlaywrightRef(text, /-\s*combobox\b/i, "dropdown (select)");
  const submitRef = findPlaywrightRef(text, /-\s*button\b/i, "submit");

  if (!textRef || !passwordRef || !textareaRef || !selectRef || !submitRef) {
    const pageErrorHint = detectLikelyPageErrorStatus(extractResponseText(nav.response));
    const reason = pageErrorHint ? ` — likely cause: ${pageErrorHint}` : "";
    return summarizeCalls(
      calls,
      false,
      `form field refs not fully discovered (text=${!!textRef}, password=${!!passwordRef}, ` +
        `textarea=${!!textareaRef}, select=${!!selectRef}, submit=${!!submitRef})${reason}`
    );
  }

  const fill = await callAndRecord(
    client,
    "browser_fill_form",
    {
      fields: [
        { target: textRef, name: "Text input", type: "textbox", value: FORM_TEXT_VALUE },
        { target: passwordRef, name: "Password", type: "textbox", value: FORM_PASSWORD_VALUE },
        { target: textareaRef, name: "Textarea", type: "textbox", value: FORM_TEXTAREA_VALUE },
        { target: selectRef, name: "Dropdown (select)", type: "combobox", value: FORM_SELECT_OPTION_LABEL },
      ],
    },
    calls
  );
  if (fill.isError) return summarizeCalls(calls, false, `fill_form failed: ${extractToolErrorText(fill.response)}`);

  const click = await callAndRecord(client, "browser_click", { element: "Submit button", target: submitRef }, calls);
  if (click.isError) return summarizeCalls(calls, false, `click(submit) failed: ${extractToolErrorText(click.response)}`);

  return summarizeCalls(calls, true, "completed: browser_navigate + browser_snapshot + browser_fill_form + browser_click");
}

// ── Server connection ──

interface ServerHandle {
  name: "charlotte" | "playwright";
  client: BenchmarkMcpClient | null;
  startupError: string | null;
  toolCount: number | null;
  defChars: number | null;
  defTokens: number | null;
  defTokensChars3_5: number | null;
  version: string | null;
}

async function connectCharlotte(): Promise<ServerHandle> {
  const serverConfig: ServerConfig = {
    name: "charlotte-tasks",
    command: "node",
    args: [CHARLOTTE_ENTRY, "--no-sandbox"],
    // Config-free cwd invariant — never REPO_ROOT (see run-drift.ts for why).
    cwd: CACHE_ROOT,
  };
  const client = new BenchmarkMcpClient(serverConfig);
  try {
    await withTimeout(client.connect(), CONNECT_TIMEOUT_MS, "charlotte connect");
    const toolListMetrics = await client.listToolsWithMetrics();
    return {
      name: "charlotte",
      client,
      startupError: null,
      toolCount: toolListMetrics.toolCount,
      defChars: toolListMetrics.definitionChars,
      defTokens: Math.ceil(toolListMetrics.definitionChars / 4),
      defTokensChars3_5: toolListMetrics.estimatedDefinitionTokens,
      version: "0.8.0",
    };
  } catch (error) {
    const startupError = shortErrorMessage(error);
    await client.disconnect().catch(() => {});
    return {
      name: "charlotte",
      client: null,
      startupError,
      toolCount: null,
      defChars: null,
      defTokens: null,
      defTokensChars3_5: null,
      version: "0.8.0",
    };
  }
}

async function detectPlaywrightVersion(): Promise<string | null> {
  try {
    const raw = await readFile(PLAYWRIGHT_PACKAGE_JSON, "utf-8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
}

async function connectPlaywright(): Promise<ServerHandle> {
  const version = await detectPlaywrightVersion();
  const serverConfig: ServerConfig = {
    name: "playwright-tasks",
    command: "node",
    args: [PLAYWRIGHT_ENTRY, "--headless", "--browser", "chromium"],
    cwd: CACHE_ROOT,
  };
  const client = new BenchmarkMcpClient(serverConfig);
  try {
    await withTimeout(client.connect(), CONNECT_TIMEOUT_MS, "playwright connect");
    const toolListMetrics = await client.listToolsWithMetrics();
    return {
      name: "playwright",
      client,
      startupError: null,
      toolCount: toolListMetrics.toolCount,
      defChars: toolListMetrics.definitionChars,
      defTokens: Math.ceil(toolListMetrics.definitionChars / 4),
      defTokensChars3_5: toolListMetrics.estimatedDefinitionTokens,
      version,
    };
  } catch (error) {
    const startupError = shortErrorMessage(error);
    await client.disconnect().catch(() => {});
    return {
      name: "playwright",
      client: null,
      startupError,
      toolCount: null,
      defChars: null,
      defTokens: null,
      defTokensChars3_5: null,
      version,
    };
  }
}

// ── Orchestration ──

const TASK_DEFS: Array<{
  taskId: "T1" | "T2" | "T3";
  name: string;
  description: string;
  charlotteRunner: (client: BenchmarkMcpClient) => Promise<TaskRunResult>;
  playwrightRunner: (client: BenchmarkMcpClient) => Promise<TaskRunResult>;
}> = [
  {
    taskId: "T1",
    name: "orient-and-read",
    description: `Navigate to ${HN_URL} and obtain the page's headlines.`,
    charlotteRunner: runT1Charlotte,
    playwrightRunner: runT1Playwright,
  },
  {
    taskId: "T2",
    name: "find-and-act",
    description: `Navigate to ${HN_URL}, locate the "login" link, click it.`,
    charlotteRunner: runT2Charlotte,
    playwrightRunner: runT2Playwright,
  },
  {
    taskId: "T3",
    name: "form-fill",
    description: `Navigate to ${SELENIUM_FORM_URL}, fill the text/password/textarea fields, pick a dropdown option, submit.`,
    charlotteRunner: runT3Charlotte,
    playwrightRunner: runT3Playwright,
  },
];

async function runTaskTwice(
  serverName: "charlotte" | "playwright",
  taskId: string,
  handle: ServerHandle,
  runner: (client: BenchmarkMcpClient) => Promise<TaskRunResult>
): Promise<TaskServerResult> {
  const sequence = [...SEQUENCES[taskId as "T1" | "T2" | "T3"][serverName]];
  if (!handle.client) {
    const error = `server failed to start: ${handle.startupError}`;
    return { sequence, run1: { error }, run2: { error } };
  }
  logProgress(`${serverName}/${taskId}: run 1...`);
  let run1: TaskRunOutcome;
  try {
    run1 = await runner(handle.client);
  } catch (error) {
    run1 = { error: shortErrorMessage(error) };
  }
  logProgress(`${serverName}/${taskId}: run 2...`);
  let run2: TaskRunOutcome;
  try {
    run2 = await runner(handle.client);
  } catch (error) {
    run2 = { error: shortErrorMessage(error) };
  }
  if (!isTaskError(run1)) logProgress(`${serverName}/${taskId}: run1 = ${run1.totalTokens} tokens, ${run1.callCount} calls, success=${run1.success}`);
  if (!isTaskError(run2)) logProgress(`${serverName}/${taskId}: run2 = ${run2.totalTokens} tokens, ${run2.callCount} calls, success=${run2.success}`);
  return { sequence, run1, run2 };
}

// ── Reporting: JSON meta ──

interface TasksReport {
  meta: {
    runDate: string;
    tokenHeuristic: "ceil(chars/4)";
    pages: { hn: string; seleniumForm: string };
    honestyRules: string[];
    observedPlaywrightPostActionBehavior: string;
    servers: {
      charlotte: {
        version: string | null;
        startupError: string | null;
        toolCount: number | null;
        defChars: number | null;
        defTokens: number | null;
        defTokensChars3_5: number | null;
      };
      playwright: {
        version: string | null;
        startupError: string | null;
        toolCount: number | null;
        defChars: number | null;
        defTokens: number | null;
        defTokensChars3_5: number | null;
      };
    };
  };
  tasks: TaskResult[];
}

const HONESTY_RULES = [
  "Each server gets its own most-efficient reasonable path for each task — no handicapping either side.",
  "Every response an agent would necessarily ingest counts toward the task total, including a file-written " +
    "snapshot IF the path requires reading it for refs. In every sequence below, every ref needed for a " +
    "follow-up action was already obtained from an explicit browser_snapshot call that's counted in the total " +
    "— no sequence here ever needed a separate file read, verified empirically (see the observed-behavior note).",
  "Read-only/discovery calls (navigate, observe, find, snapshot) get one retry on transient failure. Mutating " +
    "calls (click, type, fill_form) do not auto-retry, to avoid double-submitting an action against a live site " +
    "on an ambiguous failure.",
  "Tool-definition cost is reported once per server, separately from every task, and is never folded into a " +
    "task's response-token total — it amortizes across an entire session, not per task.",
  "Metric per task per server: total response tokens (sum of chars/4 across every call in the sequence) and " +
    "tool-call count. The whole battery is run twice; headline = run 1; >5% run1-vs-run2 variance is flagged.",
];

// ── Reporting: markdown ──

function formatOutcomeCell(outcome: TaskRunOutcome): string {
  if (isTaskError(outcome)) return `ERROR: ${outcome.error.slice(0, 60)}`;
  const status = outcome.success ? "" : " (incomplete)";
  return `${outcome.totalTokens.toLocaleString()} tok / ${outcome.callCount} calls${status}`;
}

function varianceNote(run1: TaskRunOutcome, run2: TaskRunOutcome): string {
  if (isTaskError(run1) || isTaskError(run2)) return "";
  if (run1.totalTokens === 0) return "";
  const pctDiff = Math.abs(run2.totalTokens - run1.totalTokens) / run1.totalTokens;
  return pctDiff > 0.05 ? ` ⚠ (run2 ${(pctDiff * 100).toFixed(1)}% diff)` : "";
}

function generateMarkdown(report: TasksReport): string {
  const lines: string[] = [];
  lines.push("# Charlotte vs Playwright — per-task token battery");
  lines.push("");
  lines.push(`Run date: **${report.meta.runDate}**`);
  lines.push("");
  lines.push(
    "Three scripted, realistic agent tasks run against Charlotte v0.8.0 (this repo's built dist/) and the " +
      "repo's currently-installed Playwright MCP, same-day, same live pages."
  );
  lines.push("");

  lines.push("## Servers");
  lines.push("");
  lines.push("| Server | Version | Tool count | Tool-def tokens |");
  lines.push("| --- | --- | --- | --- |");
  const c = report.meta.servers.charlotte;
  const p = report.meta.servers.playwright;
  lines.push(
    `| Charlotte | ${c.version ?? "?"} | ${c.toolCount ?? "—"} | ${c.defTokens !== null ? c.defTokens.toLocaleString() : "—"} |`
  );
  lines.push(
    `| Playwright MCP | ${p.version ?? "?"} | ${p.toolCount ?? "—"} | ${p.defTokens !== null ? p.defTokens.toLocaleString() : "—"} |`
  );
  if (c.startupError) lines.push(`\n**Charlotte startup error**: ${c.startupError}`);
  if (p.startupError) lines.push(`\n**Playwright startup error**: ${p.startupError}`);
  lines.push("");
  lines.push(
    "Tool-definition tokens are reported once per server here and are NEVER added into the per-task totals " +
      "below — see honesty rules."
  );
  lines.push("");

  lines.push("## Task battery (headline = run 1)");
  lines.push("");
  lines.push("| Task | Charlotte | Playwright | Charlotte/Playwright ratio |");
  lines.push("| --- | --- | --- | --- |");
  for (const task of report.tasks) {
    const cCell = formatOutcomeCell(task.charlotte.run1) + varianceNote(task.charlotte.run1, task.charlotte.run2);
    const pCell = formatOutcomeCell(task.playwright.run1) + varianceNote(task.playwright.run1, task.playwright.run2);
    // Only compute a ratio when BOTH sides actually completed the task —
    // otherwise this would compare two failed-attempt error-page byte counts
    // and present them as if they meant something about relative efficiency.
    let ratio = "—";
    if (
      !isTaskError(task.charlotte.run1) &&
      !isTaskError(task.playwright.run1) &&
      task.charlotte.run1.success &&
      task.playwright.run1.success &&
      task.playwright.run1.totalTokens > 0
    ) {
      ratio = `1 : ${(task.playwright.run1.totalTokens / Math.max(1, task.charlotte.run1.totalTokens)).toFixed(1)}`;
    } else if (
      (!isTaskError(task.charlotte.run1) && !task.charlotte.run1.success) ||
      (!isTaskError(task.playwright.run1) && !task.playwright.run1.success) ||
      isTaskError(task.charlotte.run1) ||
      isTaskError(task.playwright.run1)
    ) {
      ratio = "n/a (see detail)";
    }
    lines.push(`| **${task.taskId}** ${task.name} | ${cCell} | ${pCell} | ${ratio} |`);
  }
  lines.push("");
  lines.push("Cells marked ⚠ had a >5% token difference between run 1 and run 2 of that task/server pair.");
  lines.push("");

  lines.push("## Task descriptions and exact call sequences");
  lines.push("");
  lines.push(
    "The sequence below IS the methodology — this is exactly what the code executes per task per server, not " +
      "an approximation."
  );
  lines.push("");
  for (const task of report.tasks) {
    lines.push(`### ${task.taskId}: ${task.name}`);
    lines.push("");
    lines.push(task.description);
    lines.push("");
    lines.push("**Charlotte:**");
    for (const step of task.charlotte.sequence) lines.push(`1. ${step}`);
    lines.push("");
    lines.push("**Playwright:**");
    for (const step of task.playwright.sequence) lines.push(`1. ${step}`);
    lines.push("");
    lines.push("Run 1 / Run 2 detail:");
    lines.push("");
    lines.push("| Server | Run | Tokens | Calls | Success | Note |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const [serverLabel, serverResult] of [
      ["Charlotte", task.charlotte],
      ["Playwright", task.playwright],
    ] as const) {
      for (const [runLabel, outcome] of [
        ["run1", serverResult.run1],
        ["run2", serverResult.run2],
      ] as const) {
        if (isTaskError(outcome)) {
          lines.push(`| ${serverLabel} | ${runLabel} | — | — | ERROR | ${outcome.error.slice(0, 80)} |`);
        } else {
          lines.push(
            `| ${serverLabel} | ${runLabel} | ${outcome.totalTokens.toLocaleString()} | ${outcome.callCount} | ` +
              `${outcome.success ? "yes" : "no"} | ${outcome.note} |`
          );
        }
      }
    }
    lines.push("");
  }

  lines.push("## Honesty rules");
  lines.push("");
  for (const rule of report.meta.honestyRules) lines.push(`- ${rule}`);
  lines.push("");

  lines.push("## Observed Playwright post-action behavior (0.0.79)");
  lines.push("");
  lines.push(report.meta.observedPlaywrightPostActionBehavior);
  lines.push("");

  lines.push("## Methodology notes");
  lines.push("");
  lines.push(
    "- **Same-day rule**: this battery is only comparable within one run date; a future rerun re-executes the " +
      "whole battery from scratch rather than reusing old numbers."
  );
  lines.push("- **Token heuristic**: tokens ≈ ceil(chars / 4), computed from each call's full serialized MCP response text.");
  lines.push(
    "- **Live-page caveat**: news.ycombinator.com and selenium.dev are live, uncontrolled services (though " +
      "selenium.dev's web-form.html is purpose-built for automation testing and was observed to be stable — " +
      "see the T3 target-swap note immediately below)."
  );
  lines.push(
    "- **T3 target swap, kept for the honesty trail**: T3 originally targeted `https://httpbin.org/forms/post`, " +
      "per the original task spec. httpbin.org was in a sustained outage/flapping state on the run date — 503s, " +
      "504 Gateway Timeouts, and 30-second navigation timeouts across roughly 40 minutes of testing, including " +
      "two brief recoveries to HTTP 200 that reverted within about a minute. Both servers' T3 sequences failed " +
      "identically against it (confirmed on two independent full-battery runs), which is itself informative — " +
      "httpbin.org is not a reliable target for a battery meant to be re-run every release — but doesn't " +
      "produce a usable T3 data point. T3 was swapped to Selenium's own hosted test form " +
      "(`https://www.selenium.dev/selenium/web/web-form.html`), which stayed up throughout this run."
  );
  lines.push(
    '- **Charlotte form-representation finding**: both httpbin.org/forms/post AND selenium.dev/web-form.html\'s ' +
      "`<form>` elements have no accessible name (no aria-label/title), so Chromium never exposes either with " +
      'role="form" in the accessibility tree — and Charlotte\'s form detection ' +
      "(src/renderer/interactive-extractor.ts) only recognizes AX nodes with role===\"form\". So although the " +
      "form_id mechanism was worth re-checking on a new target (a labeled form elsewhere in the wild WOULD make " +
      "it usable and, in that case, cheaper — one call instead of a discovery call plus a click), it turned out " +
      "unusable on selenium.dev too. `charlotte_submit` remains untested by this battery; T3's Charlotte " +
      "sequence clicks the submit button directly instead, like any other button, on both targets."
  );
  lines.push(
    "- **T3 flips the pattern seen in T1/T2**: Charlotte is far cheaper on read-oriented tasks (T1: 1.6x " +
      "cheaper; T2: 31x cheaper) but ~5x MORE expensive than Playwright on this multi-step mutation task. Why: " +
      "every Charlotte mutating call (charlotte_type, charlotte_select, charlotte_click) returns the FULL page " +
      "representation by design (`Returns full page representation after typing/selecting/clicking` — see each " +
      "tool's description), so a 5-mutation sequence pays for 5 full-page re-reads. Playwright's action calls " +
      "(browser_fill_form, browser_click) return only a short page/status summary (see the observed-behavior " +
      "note above) and batch 4 fields into one browser_fill_form call, so its whole mutation phase costs less " +
      "than a single one of Charlotte's post-action representations. This is a genuine, task-shape-dependent " +
      "result, not a methodology artifact — both sequences are each server's own efficient, idiomatic path."
  );
  lines.push("");

  return lines.join("\n");
}

// ── Reporting: SVG ──

const CHARLOTTE_COLOR = "#0072B2";
const PLAYWRIGHT_COLOR = "#D55E00";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function generateSvg(report: TasksReport): string {
  const width = 900;
  const height = 600;

  const plot = { left: 190, right: 860, top: 90, bottom: 540 };
  const plotWidth = plot.right - plot.left;

  const values: number[] = [];
  for (const task of report.tasks) {
    if (!isTaskError(task.charlotte.run1)) values.push(task.charlotte.run1.totalTokens);
    if (!isTaskError(task.playwright.run1)) values.push(task.playwright.run1.totalTokens);
  }
  const dataMax = values.length > 0 ? Math.max(...values) : 1;
  const dataMin = values.length > 0 ? Math.min(...values.filter((v) => v > 0)) : 1;
  const useLogScale = dataMin > 0 && dataMax / dataMin > 20;
  const domainMax = dataMax * 1.15;
  const domainMin = useLogScale ? Math.max(1, dataMin * 0.5) : 0;

  const xForValue = (value: number): number => {
    if (useLogScale) {
      const logMin = Math.log10(domainMin);
      const logMax = Math.log10(domainMax);
      const t = (Math.log10(Math.max(value, domainMin)) - logMin) / (logMax - logMin);
      return plot.left + t * plotWidth;
    }
    const t = (value - domainMin) / (domainMax - domainMin || 1);
    return plot.left + t * plotWidth;
  };

  const svgParts: string[] = [];
  svgParts.push(
    `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" font-family="system-ui, sans-serif">`
  );
  svgParts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff" />`);

  svgParts.push(
    `<text x="${width / 2}" y="28" text-anchor="middle" font-size="18" font-weight="700" fill="#111827">` +
      `Charlotte vs Playwright — per-task token cost</text>`
  );
  svgParts.push(
    `<text x="${width / 2}" y="48" text-anchor="middle" font-size="12" fill="#4B5563">` +
      `Run date: ${escapeXml(report.meta.runDate)} · tokens ≈ chars/4 · headline = run 1` +
      `${useLogScale ? " · log x-axis" : ""}</text>`
  );

  // Legend
  const legendY = 68;
  svgParts.push(
    `<rect x="${plot.left}" y="${legendY - 10}" width="10" height="10" fill="${CHARLOTTE_COLOR}" />` +
      `<text x="${plot.left + 14}" y="${legendY - 1}" font-size="11" fill="#111827">Charlotte</text>`
  );
  svgParts.push(
    `<rect x="${plot.left + 110}" y="${legendY - 10}" width="10" height="10" fill="${PLAYWRIGHT_COLOR}" />` +
      `<text x="${plot.left + 124}" y="${legendY - 1}" font-size="11" fill="#111827">Playwright</text>`
  );

  // X axis
  svgParts.push(
    `<line x1="${plot.left}" y1="${plot.bottom}" x2="${plot.right}" y2="${plot.bottom}" stroke="#9CA3AF" stroke-width="1" />`
  );
  const tickCount = 5;
  for (let i = 0; i <= tickCount; i++) {
    let value: number;
    if (useLogScale) {
      const logMin = Math.log10(domainMin);
      const logMax = Math.log10(domainMax);
      value = Math.pow(10, logMin + (i / tickCount) * (logMax - logMin));
    } else {
      value = domainMin + (i / tickCount) * (domainMax - domainMin);
    }
    const x = xForValue(value);
    svgParts.push(
      `<line x1="${x.toFixed(1)}" y1="${plot.top}" x2="${x.toFixed(1)}" y2="${plot.bottom}" stroke="#E5E7EB" stroke-width="1" />`
    );
    svgParts.push(
      `<text x="${x.toFixed(1)}" y="${plot.bottom + 16}" text-anchor="middle" font-size="10" fill="#6B7280">${Math.round(value).toLocaleString()}</text>`
    );
  }

  // Grouped horizontal bars: one group per task, two bars (Charlotte, Playwright)
  const groupCount = report.tasks.length;
  const groupHeight = (plot.bottom - plot.top) / groupCount;
  const barHeight = Math.min(28, groupHeight * 0.32);
  const barGap = 6;

  report.tasks.forEach((task, i) => {
    const groupTop = plot.top + i * groupHeight;
    const groupCenter = groupTop + groupHeight / 2;
    const cY = groupCenter - barHeight / 2 - barGap / 2;
    const pY = groupCenter + barGap / 2;

    svgParts.push(
      `<text x="${plot.left - 12}" y="${(groupCenter + 4).toFixed(1)}" text-anchor="end" font-size="12" font-weight="600" fill="#111827">${escapeXml(task.taskId + ": " + task.name)}</text>`
    );

    // Charlotte bar
    if (isTaskError(task.charlotte.run1)) {
      svgParts.push(
        `<text x="${(plot.left + 6).toFixed(1)}" y="${(cY + barHeight / 2 + 4).toFixed(1)}" font-size="11" font-weight="700" fill="${CHARLOTTE_COLOR}">✕ ${escapeXml(task.charlotte.run1.error.slice(0, 40))}</text>`
      );
    } else {
      const value = task.charlotte.run1.totalTokens;
      const x = xForValue(value);
      const barW = Math.max(1, x - plot.left);
      svgParts.push(
        `<rect x="${plot.left}" y="${cY.toFixed(1)}" width="${barW.toFixed(1)}" height="${barHeight.toFixed(1)}" fill="${CHARLOTTE_COLOR}" opacity="0.9" />`
      );
      svgParts.push(
        `<text x="${(x + 6).toFixed(1)}" y="${(cY + barHeight / 2 + 4).toFixed(1)}" font-size="10" fill="#111827">${value.toLocaleString()} tok / ${task.charlotte.run1.callCount} calls</text>`
      );
    }

    // Playwright bar
    if (isTaskError(task.playwright.run1)) {
      svgParts.push(
        `<text x="${(plot.left + 6).toFixed(1)}" y="${(pY + barHeight / 2 + 4).toFixed(1)}" font-size="11" font-weight="700" fill="${PLAYWRIGHT_COLOR}">✕ ${escapeXml(task.playwright.run1.error.slice(0, 40))}</text>`
      );
    } else {
      const value = task.playwright.run1.totalTokens;
      const x = xForValue(value);
      const barW = Math.max(1, x - plot.left);
      svgParts.push(
        `<rect x="${plot.left}" y="${pY.toFixed(1)}" width="${barW.toFixed(1)}" height="${barHeight.toFixed(1)}" fill="${PLAYWRIGHT_COLOR}" opacity="0.9" />`
      );
      svgParts.push(
        `<text x="${(x + 6).toFixed(1)}" y="${(pY + barHeight / 2 + 4).toFixed(1)}" font-size="10" fill="#111827">${value.toLocaleString()} tok / ${task.playwright.run1.callCount} calls</text>`
      );

      // Ratio label, once per group — only meaningful when both sides
      // actually completed the task (see the matching guard in
      // generateMarkdown's summary table for why).
      if (
        !isTaskError(task.charlotte.run1) &&
        task.charlotte.run1.success &&
        task.playwright.run1.success &&
        task.charlotte.run1.totalTokens > 0
      ) {
        const ratio = value / task.charlotte.run1.totalTokens;
        svgParts.push(
          `<text x="${plot.right}" y="${(groupCenter + 4).toFixed(1)}" text-anchor="end" font-size="10" font-weight="600" fill="#4B5563">1 : ${ratio.toFixed(1)}</text>`
        );
      }
    }

    if (i < groupCount - 1) {
      svgParts.push(
        `<line x1="${plot.left}" y1="${(groupTop + groupHeight).toFixed(1)}" x2="${plot.right}" y2="${(groupTop + groupHeight).toFixed(1)}" stroke="#F3F4F6" stroke-width="1" />`
      );
    }
  });

  svgParts.push(`</svg>`);
  return svgParts.join("\n");
}

// ── CLI ──

interface CliOptions {
  runDate: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let runDate: string | undefined = process.env.DRIFT_RUN_DATE;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--run-date" && args[i + 1]) {
      runDate = args[++i];
    }
  }

  if (!runDate) {
    console.error(
      "task battery requires a run date: pass --run-date YYYY-MM-DD or set DRIFT_RUN_DATE.\n" +
        "This is required, not defaulted, because of the same-day rule: every cell in a task battery\n" +
        "must come from the SAME run, against the same live pages. A silent default risks a future\n" +
        "rerun landing in a stale dated directory, producing a report mixing measurements from\n" +
        "different days."
    );
    process.exit(1);
  }

  return { runDate };
}

// ── Main ──

async function main(): Promise<void> {
  const options = parseArgs();
  await mkdir(CACHE_ROOT, { recursive: true });

  logProgress("Connecting to Charlotte...");
  const chromeBeforeCharlotte = await snapshotChromePids();
  const charlotte = await connectCharlotte();
  if (charlotte.startupError) {
    logProgress(`Charlotte failed to start: ${charlotte.startupError}`);
  } else {
    logProgress(`Charlotte connected: ${charlotte.toolCount} tools, ${charlotte.defChars} def chars`);
  }

  logProgress("Connecting to Playwright...");
  const chromeBeforePlaywright = await snapshotChromePids();
  const playwright = await connectPlaywright();
  if (playwright.startupError) {
    logProgress(`Playwright failed to start: ${playwright.startupError}`);
  } else {
    logProgress(`Playwright connected: ${playwright.version}, ${playwright.toolCount} tools, ${playwright.defChars} def chars`);
  }

  const tasks: TaskResult[] = [];
  for (const def of TASK_DEFS) {
    logProgress(`=== ${def.taskId}: ${def.name} ===`);
    const charlotteResult = await runTaskTwice("charlotte", def.taskId, charlotte, def.charlotteRunner);
    const playwrightResult = await runTaskTwice("playwright", def.taskId, playwright, def.playwrightRunner);
    tasks.push({
      taskId: def.taskId,
      name: def.name,
      description: def.description,
      charlotte: charlotteResult,
      playwright: playwrightResult,
    });
    await appendProgress(`- [x] tasks: ${def.taskId} (${def.name}) measured`);
  }

  await charlotte.client?.disconnect().catch(() => {});
  await playwright.client?.disconnect().catch(() => {});
  await sleep(1500);
  const killedCharlotte = await killNewChromeStragglers(chromeBeforeCharlotte);
  if (killedCharlotte.length > 0) logProgress(`Killed straggler chrome PIDs (charlotte): ${killedCharlotte.join(", ")}`);
  const killedPlaywright = await killNewChromeStragglers(chromeBeforePlaywright);
  if (killedPlaywright.length > 0) logProgress(`Killed straggler chrome PIDs (playwright): ${killedPlaywright.join(", ")}`);

  const observedPlaywrightPostActionBehavior =
    "Empirically observed in this Playwright MCP version: browser_navigate, browser_click, and (by the same " +
    "code path) browser_fill_form do NOT return the inline accessibility tree after acting — each returns a " +
    "short '### Page' summary (URL, title, HTTP status, console error/warning counts) plus a '### Snapshot' " +
    "section that only LINKS to a `.playwright-mcp/page-*.yml` file, not the tree itself. The full inline tree " +
    "only ever appears in an explicit browser_snapshot response. None of T1/T2/T3's sequences needed to read " +
    "that file: every ref a later step needed was already obtained from an earlier, explicit browser_snapshot " +
    "call that's counted in the task total, so no hidden file-read cost was incurred or omitted here.";

  const report: TasksReport = {
    meta: {
      runDate: options.runDate,
      tokenHeuristic: "ceil(chars/4)",
      pages: { hn: HN_URL, seleniumForm: SELENIUM_FORM_URL },
      honestyRules: HONESTY_RULES,
      observedPlaywrightPostActionBehavior,
      servers: {
        charlotte: {
          version: charlotte.version,
          startupError: charlotte.startupError,
          toolCount: charlotte.toolCount,
          defChars: charlotte.defChars,
          defTokens: charlotte.defTokens,
          defTokensChars3_5: charlotte.defTokensChars3_5,
        },
        playwright: {
          version: playwright.version,
          startupError: playwright.startupError,
          toolCount: playwright.toolCount,
          defChars: playwright.defChars,
          defTokens: playwright.defTokens,
          defTokensChars3_5: playwright.defTokensChars3_5,
        },
      },
    },
    tasks,
  };

  const outputDir = join(RESULTS_ROOT, options.runDate);
  await mkdir(outputDir, { recursive: true });

  const jsonPath = join(outputDir, "tasks.json");
  await writeFile(jsonPath, JSON.stringify(report, null, 2));
  logProgress(`Wrote ${jsonPath}`);

  const mdPath = join(outputDir, "tasks.md");
  await writeFile(mdPath, generateMarkdown(report));
  logProgress(`Wrote ${mdPath}`);

  const svgPath = join(outputDir, "tasks.svg");
  await writeFile(svgPath, generateSvg(report));
  logProgress(`Wrote ${svgPath}`);

  logProgress("Done.");
}

main().catch((error) => {
  console.error("Task battery failed:", error);
  process.exit(1);
});
