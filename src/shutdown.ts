import type { SessionContext } from "./core/types.js";
import { logger } from "./utils/logger.js";

interface ShutdownRuntime {
  on(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  stdin: Pick<NodeJS.ReadStream, "once" | "readableEnded" | "destroyed">;
  exit(code: number): void;
}

type Resources = {
  browserManager: Pick<SessionContext["browserManager"], "close">;
  devModeState?: Pick<NonNullable<SessionContext["devModeState"]>, "stopAll">;
};

/** The process owns the browser/dev servers even after its transport closes. */
export function installShutdownHandlers(
  ctx: Resources,
  closeTransport: () => Promise<void>,
  { stdio = false, runtime = process }: { stdio?: boolean; runtime?: ShutdownRuntime } = {},
): () => Promise<void> {
  let shuttingDown: Promise<void> | undefined;
  const shutdown = () => {
    // Assign before cleanup starts: closing a transport can trigger another event.
    shuttingDown ??= Promise.resolve().then(async () => {
      logger.info("Shutting down");
      // A failed resource cleanup must not skip closing the owned browser.
      const results = await Promise.allSettled([
        Promise.resolve().then(closeTransport),
        Promise.resolve().then(() => ctx.devModeState?.stopAll()),
        Promise.resolve().then(() => ctx.browserManager.close()),
      ]);
      const failures = results.filter((result) => result.status === "rejected");
      for (const failure of failures) logger.error("Shutdown cleanup failed", failure.reason);
      runtime.exit(failures.length ? 1 : 0);
    });
    return shuttingDown;
  };

  runtime.on("SIGINT", shutdown);
  runtime.on("SIGTERM", shutdown);
  if (stdio) {
    runtime.stdin.once("end", shutdown);
    runtime.stdin.once("close", shutdown);
    // EOF may have arrived while startup was awaiting configuration/connection.
    if (runtime.stdin.readableEnded || runtime.stdin.destroyed) void shutdown();
  }
  return shutdown;
}
