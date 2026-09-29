import type { Logger } from "../logger.ts";
import type {
  DiscogsCollectionPage,
  DiscogsIdentity,
  DiscogsInventoryPage,
  DiscogsList,
  DiscogsMaster,
  DiscogsRelease,
  DiscogsUser,
  DiscogsUserListsPage,
  DiscogsWantlistPage,
} from "./types.ts";

import { DiscogsTransport } from "./transport.ts";
import { DiscogsApiError } from "./errors.ts";
export { DiscogsApiError } from "./errors.ts";
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
  /** A user's public profile; 404 when the username does not exist. */
  getUser(username: string): Promise<DiscogsUser>;
  /** One page of a seller's listings; only For Sale ones unless the token is the seller's. */
  getInventoryPage(username: string, page: number, perPage?: number): Promise<DiscogsInventoryPage>;
  /** The user's lists; private ones only with that user's token. */
  getUserLists(username: string, page: number, perPage?: number): Promise<DiscogsUserListsPage>;
  /** A list with its items. The API has no endpoint to add or remove items. */
  getList(id: number): Promise<DiscogsList>;
  /** PUT /users/{u}/wants/{id}; the token must belong to that user. */
  addToWantlist(username: string, releaseId: number, options?: { notes?: string }): Promise<void>;
  /** DELETE /users/{u}/wants/{id}; a release that is not on the wantlist counts as removed. */
  removeFromWantlist(username: string, releaseId: number): Promise<void>;
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
    getUser: (username) => request<DiscogsUser>(`/users/${encodeURIComponent(username)}`),
    getInventoryPage: (username, page, perPage = 100) =>
      request<DiscogsInventoryPage>(`/users/${encodeURIComponent(username)}/inventory`, {
        page,
        per_page: perPage,
      }),
    getUserLists: (username, page, perPage = 100) =>
      request<DiscogsUserListsPage>(`/users/${encodeURIComponent(username)}/lists`, {
        page,
        per_page: perPage,
      }),
    getList: (id) => request<DiscogsList>(`/lists/${id}`),
    addToWantlist: (username, releaseId, options = {}) =>
      addToWantlist(transport, username, releaseId, options),
    removeFromWantlist: (username, releaseId) => removeFromWantlist(transport, username, releaseId),
    rateLimit: () => transport.rateLimit(),
    hasToken: () => Boolean(options.token),
  };
}

async function addToWantlist(
  transport: DiscogsTransport,
  username: string,
  releaseId: number,
  options: { notes?: string },
): Promise<void> {
  const body = options.notes === undefined ? undefined : { notes: options.notes };
  await transport.request(
    `/users/${encodeURIComponent(username)}/wants/${releaseId}`,
    {},
    { method: "PUT", body },
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
