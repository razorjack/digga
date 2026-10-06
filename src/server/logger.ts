import fs from "node:fs";
import path from "node:path";
import { inspect } from "node:util";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

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

function formatLine(level: LogLevel, scope: string, message: string, data: unknown): string {
  return `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${formatData(data)}`;
}

export const consoleSink: LogSink = {
  write(level, scope, message, data) {
    const line = formatLine(level, scope, message, data);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  },
};

/** Appends each line to `file`, for a process without a terminal, such as the Electron app. */
export function createFileSink(file: string): LogSink {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return {
    write(level, scope, message, data) {
      fs.appendFileSync(file, `${formatLine(level, scope, message, data)}\n`);
    },
  };
}

export const silentSink: LogSink = { write() {} };

/** All server-side logging goes through here: the console for the CLI, a file for Electron. */
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
