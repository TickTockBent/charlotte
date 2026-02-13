export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[currentLevel];
}

function writeLog(level: LogLevel, message: string, data?: unknown): void {
  if (!shouldLog(level)) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(data !== undefined ? { data } : {}),
  };

  process.stderr.write(JSON.stringify(entry) + "\n");
}

export const logger = {
  debug: (message: string, data?: unknown) => writeLog("debug", message, data),
  info: (message: string, data?: unknown) => writeLog("info", message, data),
  warn: (message: string, data?: unknown) => writeLog("warn", message, data),
  error: (message: string, data?: unknown) => writeLog("error", message, data),
};
