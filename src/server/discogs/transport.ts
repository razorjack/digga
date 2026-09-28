import type { DiscogsClientOptions, RateLimitState } from "./client.ts";
import { DiscogsApiError } from "./errors.ts";

export const DEFAULT_USER_AGENT = "Digga/0.1 (+https://github.com/razorjack/digga)";
const DEFAULT_BASE_URL = "https://api.discogs.com";
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
type Query = Record<string, string | number | undefined>;
interface RequestOptions {
  method?: "GET" | "PUT" | "DELETE";
  body?: unknown;
}

export class DiscogsTransport {
  #options: DiscogsClientOptions;
  #fetch: typeof fetch;
  #sleep: (ms: number) => Promise<void>;
  #now: () => number;
  #baseUrl: string;
  #state: RateLimitState = { limit: null, remaining: null, used: null };
  #lastRequestAt: number | null = null;
  #chain: Promise<unknown> = Promise.resolve();

  constructor(options: DiscogsClientOptions) {
    this.#options = options;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#now = options.now ?? Date.now;
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  rateLimit(): RateLimitState {
    return { ...this.#state };
  }

  /** Serialization keeps concurrent callers within the same rate limit. */
  request<Result>(path: string, query: Query = {}, options: RequestOptions = {}): Promise<Result> {
    const next = this.#chain.then(() => this.#requestWithRetry<Result>(path, query, options));
    this.#chain = next.catch(() => {});
    return next;
  }

  async #requestWithRetry<Result>(
    path: string,
    query: Query,
    options: RequestOptions,
  ): Promise<Result> {
    const url = requestUrl(this.#baseUrl, path, query);
    for (let attempt = 0; ; attempt += 1) {
      await this.#waitForQuota();
      const response = await this.#send(url, options);
      this.#readRateLimit(response);
      if (response.status === 429 && attempt < (this.#options.maxRetries ?? 3)) {
        await this.#backoff(response, attempt);
        continue;
      }
      if (!response.ok) throw new DiscogsApiError(response.status, await response.text());
      const text = await response.text();
      return (text === "" ? undefined : JSON.parse(text)) as Result;
    }
  }

  async #waitForQuota(): Promise<void> {
    const interval = this.#options.minIntervalMs ?? 1100;
    const wait = this.#lastRequestAt === null ? 0 : this.#lastRequestAt + interval - this.#now();
    if (wait > 0) await this.#sleep(wait);
    if (this.#state.remaining !== null && this.#state.remaining <= 1) {
      this.#options.logger?.warn("Discogs rate limit nearly exhausted, pausing 60s");
      await this.#sleep(60_000);
      this.#state.remaining = null;
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
    });
  }

  #readRateLimit(response: Response): void {
    this.#state.limit = numericHeader(response, "X-Discogs-Ratelimit") ?? this.#state.limit;
    this.#state.remaining =
      numericHeader(response, "X-Discogs-Ratelimit-Remaining") ?? this.#state.remaining;
    this.#state.used = numericHeader(response, "X-Discogs-Ratelimit-Used") ?? this.#state.used;
  }

  async #backoff(response: Response, attempt: number): Promise<void> {
    const retryAfter = numericHeader(response, "Retry-After");
    const delay = retryAfter === null ? 60_000 * (attempt + 1) : retryAfter * 1000;
    const retries = this.#options.maxRetries ?? 3;
    this.#options.logger?.warn(
      `Discogs 429, backing off ${delay}ms (attempt ${attempt + 1}/${retries})`,
    );
    await this.#sleep(delay);
  }
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
