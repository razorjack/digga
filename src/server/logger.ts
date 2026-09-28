import { inspect } from "node:util";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  child(scope: string): Logger;
}

export interface LogSink {
  write(level: LogLevel, scope: string, message: string, data?: unknown): void;
}

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function formatData(data: unknown): string {
  if (data === undefined) return "";
  if (data instanceof Error) return ` ${data.stack ?? data.message}`;
  try {
    return ` ${JSON.stringify(data)}`;
  } catch {
    return ` ${inspect(data)}`;
  }
}

export const consoleSink: LogSink = {
  write(level, scope, message, data) {
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${formatData(data)}`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  },
};

export const silentSink: LogSink = { write() {} };

/**
 * All server-side logging goes through here. Console today; a file sink
 * can be plugged in later (Electron) without touching callers.
 */
export function createLogger(
  options: { level?: LogLevel; sink?: LogSink; scope?: string } = {},
): Logger {
  const level = options.level ?? "info";
  const sink = options.sink ?? consoleSink;
  const scope = options.scope ?? "digga";
  const emit = (messageLevel: LogLevel, message: string, data?: unknown) => {
    if (LEVEL_RANK[messageLevel] < LEVEL_RANK[level]) return;
    sink.write(messageLevel, scope, message, data);
  };
  return {
    debug: (message, data) => emit("debug", message, data),
    info: (message, data) => emit("info", message, data),
    warn: (message, data) => emit("warn", message, data),
    error: (message, data) => emit("error", message, data),
    child: (childScope) => createLogger({ level, sink, scope: `${scope}:${childScope}` }),
  };
}
