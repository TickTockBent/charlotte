import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { afterEach, expect, it } from "vitest";
import { pollUntil } from "../helpers/poll.js";

let child: ChildProcessWithoutNullStreams;
let browserPid: number | undefined;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    try {
      await pollUntil(() => child.exitCode !== null || child.signalCode !== null);
    } catch {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  }
  if (browserPid && alive(browserPid)) process.kill(browserPid, "SIGKILL");
  browserPid = undefined;
});

it("exits and closes its launched browser when the stdio client disconnects", async () => {
  child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: new URL("../../", import.meta.url),
    stdio: "pipe",
    env: process.env,
  });
  const replies = new Map<number, unknown>();
  const stdout = createInterface({ input: child.stdout });
  const stderr = createInterface({ input: child.stderr });
  stdout.on("line", (line) => {
    const reply = JSON.parse(line);
    if (typeof reply.id === "number") replies.set(reply.id, reply);
  });
  stderr.on("line", (line) => {
    try {
      const entry = JSON.parse(line);
      if (entry.message === "Chromium launched") browserPid = entry.data.pid;
    } catch {
      /* Non-JSON startup diagnostics are not protocol messages. */
    }
  });
  const send = (message: object) =>
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
  send({
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "disconnect-test", version: "1" },
    },
  });
  await pollUntil(() => replies.has(1));
  send({ method: "notifications/initialized" });
  send({
    id: 2,
    method: "tools/call",
    params: {
      name: "charlotte_navigate",
      arguments: { url: "about:blank" },
    },
  });
  await pollUntil(() => replies.has(2));
  expect(replies.get(2)).toMatchObject({ result: {} });
  expect(replies.get(2), JSON.stringify(replies.get(2))).not.toMatchObject({
    result: { isError: true },
  });
  await pollUntil(() => browserPid !== undefined);
  expect(alive(browserPid!)).toBe(true);

  // Close only the client input: sending SIGTERM here would mask the regression.
  child.stdin.end();
  await pollUntil(() => child.exitCode !== null, { timeout: 10000 });
  expect(child.exitCode).toBe(0);
  await pollUntil(() => !alive(browserPid!));
});
