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

import { DiscogsTransport } from "./transport.ts";
import { DiscogsApiError, NotImplementedError } from "./errors.ts";
export { DiscogsApiError, NotImplementedError } from "./errors.ts";
export { DEFAULT_USER_AGENT } from "./transport.ts";

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

export function createDiscogsClient(options: DiscogsClientOptions = {}): DiscogsClient {
  const transport = new DiscogsTransport(options);
  const request = transport.request.bind(transport);
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
    addToWantlist: (username, releaseId, extra = {}) =>
      addToWantlist(transport, username, releaseId, extra),
    removeFromWantlist: (username, releaseId) => removeFromWantlist(transport, username, releaseId),
    addToCollection: () => Promise.reject(new NotImplementedError("addToCollection")),
    rateLimit: () => transport.rateLimit(),
    hasToken: () => Boolean(options.token),
  };
}

async function addToWantlist(
  transport: DiscogsTransport,
  username: string,
  releaseId: number,
  extra: { notes?: string; rating?: number },
): Promise<void> {
  const body = Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined));
  await transport.request(
    `/users/${encodeURIComponent(username)}/wants/${releaseId}`,
    {},
    {
      method: "PUT",
      body: Object.keys(body).length > 0 ? body : undefined,
    },
  );
}

async function removeFromWantlist(
  transport: DiscogsTransport,
  username: string,
  releaseId: number,
): Promise<void> {
  try {
    await transport.request(
      `/users/${encodeURIComponent(username)}/wants/${releaseId}`,
      {},
      { method: "DELETE" },
    );
  } catch (error) {
    if (!(error instanceof DiscogsApiError && error.status === 404)) throw error;
  }
}
