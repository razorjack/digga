import { setTimeout as sleep } from "node:timers/promises";
import type { DiscogsClientOptions } from "./client.ts";
import { DiscogsApiError } from "./errors.ts";

/** Gap between Discogs requests; 1100 ms keeps an authenticated client under 60 a minute. */
const DISCOGS_REQUEST_MS = 1100;
export const DEFAULT_USER_AGENT = "Digga/0.1 (+https://github.com/razorjack/digga)";
const DEFAULT_BASE_URL = "https://api.discogs.com";
const defaultSleep = (ms: number, signal?: AbortSignal) => sleep(ms, undefined, { signal });
type Query = Record<string, string | number | undefined>;

/** How a request answers Discogs' 429, and how long it may take in all. */
export interface RetryPolicy {
  maxRetries: number;
  /** The wait before a retry when Discogs sends no Retry-After, by attempt from 0. */
  fallbackDelayMs(attempt: number): number;
  /** The longest the request may take, its turn in the queue included; unlimited when absent. */
  deadlineMs?: number;
}

/**
 * A page waits on the request and gives up after 5 minutes (DEFAULT_TIMEOUTS in the client's
 * api.ts). The server answers within 4, so the page never retries a request that still runs here.
 */
export const INTERACTIVE_RETRIES: RetryPolicy = {
  maxRetries: 2,
  fallbackDelayMs: () => 60_000,
  deadlineMs: 4 * 60_000,
};

/** Nobody waits on a job's request, so it waits as long as Discogs asks. */
export const JOB_RETRIES: RetryPolicy = {
  maxRetries: 3,
  fallbackDelayMs: (attempt) => 60_000 * (attempt + 1),
};

export interface RequestOptions {
  method?: "GET" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  retries: RetryPolicy;
}

export class DiscogsTransport {
  #options: DiscogsClientOptions;
  #fetch: typeof fetch;
  #sleep: NonNullable<DiscogsClientOptions["sleep"]>;
  #now: () => number;
  #baseUrl: string;
  /** X-Discogs-Ratelimit-Remaining from the last response; null until one says. */
  #remaining: number | null = null;
  #lastRequestAt: number | null = null;
  #chain: Promise<unknown> = Promise.resolve();

  constructor(options: DiscogsClientOptions) {
    this.#options = options;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#now = options.now ?? Date.now;
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  /** Serialization keeps concurrent callers within the same rate limit. */
  request<Result>(path: string, query: Query, options: RequestOptions): Promise<Result> {
    const deadline = startDeadline(options.retries.deadlineMs);
    const signal = anySignal(options.signal, deadline?.signal);
    const next = this.#chain.then(() =>
      this.#requestWithRetry<Result>(path, query, { ...options, signal }),
    );
    this.#chain = next.catch(() => {});
    return abortable(next, signal).finally(() => deadline?.clear());
  }

  async #requestWithRetry<Result>(
    path: string,
    query: Query,
    options: RequestOptions,
  ): Promise<Result> {
    const url = requestUrl(this.#baseUrl, path, query);
    for (let attempt = 0; ; attempt += 1) {
      options.signal?.throwIfAborted();
      await this.#waitForQuota(options.signal);
      const { response, text } = await this.#readResponse(url, options);
      this.#readRateLimit(response);
      if (response.status === 429 && attempt < options.retries.maxRetries) {
        await this.#backoff(response, attempt, options);
        continue;
      }
      if (!response.ok) throw new DiscogsApiError(response.status, text);
      return (text === "" ? undefined : JSON.parse(text)) as Result;
    }
  }

  async #waitForQuota(signal?: AbortSignal): Promise<void> {
    const interval = this.#options.minIntervalMs ?? DISCOGS_REQUEST_MS;
    const wait = this.#lastRequestAt === null ? 0 : this.#lastRequestAt + interval - this.#now();
    if (wait > 0) await abortable(this.#sleep(wait, signal), signal);
    if (this.#remaining !== null && this.#remaining <= 1) {
      this.#options.logger?.warn("Discogs rate limit nearly exhausted, pausing 60s");
      await abortable(this.#sleep(60_000, signal), signal);
      this.#remaining = null;
    }
  }

  async #readResponse(
    url: URL,
    options: RequestOptions,
  ): Promise<{ response: Response; text: string }> {
    const deadline = new AbortController();
    const timer = setTimeout(
      () => deadline.abort(new DOMException("Discogs request timed out", "TimeoutError")),
      this.#options.timeoutMs ?? 30_000,
    );
    timer.unref();
    const signal = options.signal
      ? AbortSignal.any([options.signal, deadline.signal])
      : deadline.signal;
    try {
      signal.throwIfAborted();
      const response = await abortable(this.#send(url, { ...options, signal }), signal);
      const text = await abortable(response.text(), signal);
      signal.throwIfAborted();
      return { response, text };
    } finally {
      clearTimeout(timer);
    }
  }

  #send(url: URL, options: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = {
      "User-Agent": this.#options.userAgent ?? DEFAULT_USER_AGENT,
      Accept: "application/vnd.discogs.v2.discogs+json",
    };
    if (this.#options.token) headers.Authorization = `Discogs token=${this.#options.token}`;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    this.#lastRequestAt = this.#now();
    return this.#fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  }

  #readRateLimit(response: Response): void {
    this.#remaining = numericHeader(response, "X-Discogs-Ratelimit-Remaining") ?? this.#remaining;
  }

  async #backoff(response: Response, attempt: number, options: RequestOptions): Promise<void> {
    const retryAfter = numericHeader(response, "Retry-After");
    const delay =
      retryAfter === null ? options.retries.fallbackDelayMs(attempt) : retryAfter * 1000;
    this.#options.logger?.warn(
      `Discogs 429, backing off ${delay}ms (attempt ${attempt + 1}/${options.retries.maxRetries})`,
    );
    await abortable(this.#sleep(delay, options.signal), options.signal);
  }
}

/** A signal that aborts after `deadlineMs`, and the timer's removal once the request is done. */
function startDeadline(
  deadlineMs: number | undefined,
): { signal: AbortSignal; clear: () => void } | null {
  if (deadlineMs === undefined) return null;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("Discogs did not answer in time", "TimeoutError")),
    deadlineMs,
  );
  timer.unref();
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

function anySignal(...signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const present = signals.filter((signal) => signal !== undefined);
  return present.length > 1 ? AbortSignal.any(present) : present[0];
}

/** Stops waiting promptly, including for queued work whose turn has not come yet. */
function abortable<Result>(promise: Promise<Result>, signal?: AbortSignal): Promise<Result> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

function requestUrl(baseUrl: string, path: string, query: Query): URL {
  const url = new URL(baseUrl + path);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url;
}

function numericHeader(response: Response, name: string): number | null {
  const header = response.headers.get(name);
  if (header === null) return null;
  const value = Number.parseInt(header, 10);
  return Number.isNaN(value) ? null : value;
}
