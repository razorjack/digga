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
  opts: { level?: LogLevel; sink?: LogSink; scope?: string } = {},
): Logger {
  const level = opts.level ?? "info";
  const sink = opts.sink ?? consoleSink;
  const scope = opts.scope ?? "digga";
  const emit = (l: LogLevel, message: string, data?: unknown) => {
    if (LEVEL_RANK[l] < LEVEL_RANK[level]) return;
    sink.write(l, scope, message, data);
  };
  return {
    debug: (m, d) => emit("debug", m, d),
    info: (m, d) => emit("info", m, d),
    warn: (m, d) => emit("warn", m, d),
    error: (m, d) => emit("error", m, d),
    child: (childScope) => createLogger({ level, sink, scope: `${scope}:${childScope}` }),
  };
}
