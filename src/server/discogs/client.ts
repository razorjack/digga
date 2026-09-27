import type { Logger } from "../logger.ts";
import type {
  DiscogsCollectionPage,
  DiscogsIdentity,
  DiscogsList,
  DiscogsMaster,
  DiscogsRelease,
  DiscogsUserListsPage,
  DiscogsWantlistPage,
} from "./types.ts";

export const DEFAULT_USER_AGENT = "Digga/0.1 (+https://github.com/razorjack/digga)";
const DEFAULT_BASE_URL = "https://api.discogs.com";

export class DiscogsApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, message?: string) {
    super(message ?? `Discogs API ${status}: ${body.slice(0, 200)}`);
    this.name = "DiscogsApiError";
    this.status = status;
    this.body = body;
  }
}

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet (planned for a later session)`);
    this.name = "NotImplementedError";
  }
}

export interface DiscogsClientOptions {
  token?: string | undefined;
  userAgent?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Minimum gap between requests. 1100 ms keeps an authenticated client under 60/min. */
  minIntervalMs?: number;
  maxRetries?: number;
  logger?: Logger;
}

export interface RateLimitState {
  limit: number | null;
  remaining: number | null;
  used: number | null;
}

export interface DiscogsClient {
  getRelease(id: number, currency: string): Promise<DiscogsRelease>;
  getCollectionPage(
    username: string,
    page: number,
    perPage?: number,
  ): Promise<DiscogsCollectionPage>;
  getWantlistPage(username: string, page: number, perPage?: number): Promise<DiscogsWantlistPage>;
  getIdentity(): Promise<DiscogsIdentity>;
  getMaster(id: number): Promise<DiscogsMaster>;
  /** The user's lists; private ones only with that user's token. */
  getUserLists(username: string, page: number, perPage?: number): Promise<DiscogsUserListsPage>;
  /** A list with its items. The API has no endpoint to add or remove items. */
  getList(id: number): Promise<DiscogsList>;
  /** PUT /users/{u}/wants/{id}; the token must belong to that user. */
  addToWantlist(
    username: string,
    releaseId: number,
    opts?: { notes?: string; rating?: number },
  ): Promise<void>;
  /** DELETE /users/{u}/wants/{id}; a release that is not on the wantlist counts as removed. */
  removeFromWantlist(username: string, releaseId: number): Promise<void>;
  /** Stub: POST /users/{u}/collection/folders/{folder}/releases/{id}. */
  addToCollection(username: string, releaseId: number, folderId?: number): Promise<void>;
  rateLimit(): RateLimitState;
  hasToken(): boolean;
}

interface RequestOptions {
  method?: "GET" | "PUT" | "DELETE";
  /** Sent as JSON. */
  body?: unknown;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createDiscogsClient(opts: DiscogsClientOptions = {}): DiscogsClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const minInterval = opts.minIntervalMs ?? 1100;
  const maxRetries = opts.maxRetries ?? 3;
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
  const log = opts.logger;
  const state: RateLimitState = { limit: null, remaining: null, used: null };
  let lastRequestAt: number | null = null;
  let chain: Promise<unknown> = Promise.resolve();

  const headers = (): Record<string, string> => {
    const h: Record<string, string> = {
      "User-Agent": userAgent,
      Accept: "application/vnd.discogs.v2.discogs+json",
    };
    if (opts.token) h.Authorization = `Discogs token=${opts.token}`;
    return h;
  };

  const readRateLimit = (res: Response) => {
    const num = (name: string) => {
      const v = res.headers.get(name);
      return v === null ? null : Number.parseInt(v, 10);
    };
    state.limit = num("X-Discogs-Ratelimit") ?? state.limit;
    state.remaining = num("X-Discogs-Ratelimit-Remaining") ?? state.remaining;
    state.used = num("X-Discogs-Ratelimit-Used") ?? state.used;
  };

  const requestOnce = async <T>(
    path: string,
    query: Record<string, string | number | undefined>,
    init: RequestOptions,
  ): Promise<T> => {
    const url = new URL(baseUrl + path);
    for (const [k, v] of Object.entries(query))
      if (v !== undefined) url.searchParams.set(k, String(v));
    for (let attempt = 0; ; attempt += 1) {
      const wait = lastRequestAt === null ? 0 : lastRequestAt + minInterval - now();
      if (wait > 0) await sleep(wait);
      if (state.remaining !== null && state.remaining <= 1) {
        log?.warn("Discogs rate limit nearly exhausted, pausing 60s");
        await sleep(60_000);
        state.remaining = null;
      }
      lastRequestAt = now();
      const res = await fetchImpl(url, {
        method: init.method ?? "GET",
        headers:
          init.body === undefined
            ? headers()
            : { ...headers(), "Content-Type": "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      readRateLimit(res);
      if (res.status === 429 && attempt < maxRetries) {
        const retryAfter = Number.parseInt(res.headers.get("Retry-After") ?? "", 10);
        const backoff = Number.isNaN(retryAfter) ? 60_000 * (attempt + 1) : retryAfter * 1000;
        log?.warn(`Discogs 429, backing off ${backoff}ms (attempt ${attempt + 1}/${maxRetries})`);
        await sleep(backoff);
        continue;
      }
      if (!res.ok) throw new DiscogsApiError(res.status, await res.text());
      const text = await res.text();
      return (text === "" ? undefined : JSON.parse(text)) as T;
    }
  };

  /** Serialises requests so concurrent callers still respect the interval. */
  const request = <T>(
    path: string,
    query: Record<string, string | number | undefined> = {},
    init: RequestOptions = {},
  ): Promise<T> => {
    const next = chain.then(() => requestOnce<T>(path, query, init));
    chain = next.catch(() => {});
    return next;
  };

  return {
    getRelease: (id, currency) =>
      request<DiscogsRelease>(`/releases/${id}`, { curr_abbr: currency }),
    getCollectionPage: (username, page, perPage = 100) =>
      request<DiscogsCollectionPage>(
        `/users/${encodeURIComponent(username)}/collection/folders/0/releases`,
        {
          page,
          per_page: perPage,
          sort: "added",
          sort_order: "desc",
        },
      ),
    getWantlistPage: (username, page, perPage = 100) =>
      request<DiscogsWantlistPage>(`/users/${encodeURIComponent(username)}/wants`, {
        page,
        per_page: perPage,
      }),
    getIdentity: () => request<DiscogsIdentity>("/oauth/identity"),
    getMaster: (id) => request<DiscogsMaster>(`/masters/${id}`),
    getUserLists: (username, page, perPage = 100) =>
      request<DiscogsUserListsPage>(`/users/${encodeURIComponent(username)}/lists`, {
        page,
        per_page: perPage,
      }),
    getList: (id) => request<DiscogsList>(`/lists/${id}`),
    addToWantlist: async (username, releaseId, extra = {}) => {
      const body = Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined));
      await request(
        `/users/${encodeURIComponent(username)}/wants/${releaseId}`,
        {},
        {
          method: "PUT",
          body: Object.keys(body).length > 0 ? body : undefined,
        },
      );
    },
    removeFromWantlist: async (username, releaseId) => {
      try {
        await request(
          `/users/${encodeURIComponent(username)}/wants/${releaseId}`,
          {},
          {
            method: "DELETE",
          },
        );
      } catch (e) {
        if (!(e instanceof DiscogsApiError && e.status === 404)) throw e;
      }
    },
    addToCollection: () => Promise.reject(new NotImplementedError("addToCollection")),
    rateLimit: () => ({ ...state }),
    hasToken: () => Boolean(opts.token),
  };
}
