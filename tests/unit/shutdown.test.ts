import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import { installShutdownHandlers } from "../../src/shutdown.js";

function setup(stdio = true) {
  const runtime = Object.assign(new EventEmitter(), { stdin: new PassThrough(), exit: vi.fn() });
  const ctx = {
    browserManager: { close: vi.fn().mockResolvedValue(undefined) },
    devModeState: { stopAll: vi.fn().mockResolvedValue(undefined) },
  };
  const close = vi.fn().mockResolvedValue(undefined);
  const shutdown = installShutdownHandlers(ctx, close, { stdio, runtime });
  return { runtime, ctx, close, shutdown };
}

it("closes each resource once across overlapping EOF, close and signal events", async () => {
  const f = setup();
  f.runtime.stdin.emit("end");
  f.runtime.stdin.emit("close");
  f.runtime.emit("SIGTERM");
  await f.shutdown();
  expect(f.close).toHaveBeenCalledTimes(1);
  expect(f.ctx.devModeState.stopAll).toHaveBeenCalledTimes(1);
  expect(f.ctx.browserManager.close).toHaveBeenCalledTimes(1);
  expect(f.runtime.exit).toHaveBeenCalledExactlyOnceWith(0);
});

it("ignores stdin EOF/close in HTTP mode while retaining signal shutdown", async () => {
  const f = setup(false);
  f.runtime.stdin.emit("end");
  f.runtime.stdin.emit("close");
  await Promise.resolve();
  expect(f.close).not.toHaveBeenCalled();
  f.runtime.emit("SIGINT");
  await f.shutdown();
  expect(f.runtime.exit).toHaveBeenCalledExactlyOnceWith(0);
});

it("still closes the browser when dev-server cleanup fails", async () => {
  const f = setup();
  f.ctx.devModeState.stopAll.mockRejectedValue(new Error("cleanup failed"));
  await f.shutdown();
  expect(f.ctx.browserManager.close).toHaveBeenCalledTimes(1);
  expect(f.runtime.exit).toHaveBeenCalledExactlyOnceWith(1);
});

it("handles stdin already closed during startup", async () => {
  const f = setup(false);
  f.runtime.stdin.destroy();
  await installShutdownHandlers(f.ctx, f.close, { stdio: true, runtime: f.runtime })();
  expect(f.ctx.browserManager.close).toHaveBeenCalledTimes(1);
  expect(f.runtime.exit).toHaveBeenCalledExactlyOnceWith(0);
});
