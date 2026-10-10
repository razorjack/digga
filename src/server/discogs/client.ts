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

import {
  DiscogsTransport,
  INTERACTIVE_RETRIES,
  type RequestOptions,
  type RetryPolicy,
} from "./transport.ts";
import { DiscogsApiError } from "./errors.ts";
export { DiscogsApiError } from "./errors.ts";
export {
  DEFAULT_USER_AGENT,
  INTERACTIVE_RETRIES,
  JOB_RETRIES,
  type RetryPolicy,
} from "./transport.ts";

export interface DiscogsClientOptions {
  token?: string | undefined;
  userAgent?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  /** Minimum gap between requests. 1100 ms keeps an authenticated client under 60/min. */
  minIntervalMs?: number;
  /** How requests answer 429 unless a caller asks otherwise; a page's patience by default. */
  retries?: RetryPolicy;
  /** Deadline for each HTTP attempt, including reading its response body. */
  timeoutMs?: number;
  logger?: Logger;
}

export interface DiscogsClient {
  /** Shares the request queue and quota, with cancellation for this caller's requests. */
  withSignal(signal?: AbortSignal): DiscogsClient;
  /** Shares the request queue and quota, answering 429 as the policy says. */
  withRetries(retries: RetryPolicy): DiscogsClient;
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
  hasToken(): boolean;
}

export function createDiscogsClient(options: DiscogsClientOptions = {}): DiscogsClient {
  const transport = new DiscogsTransport(options);
  return clientFor(transport, {
    authenticated: Boolean(options.token),
    retries: options.retries ?? INTERACTIVE_RETRIES,
  });
}

/** What a request takes beyond the client's own options. */
type CallOptions = Omit<RequestOptions, "signal" | "retries">;
type Request = <Result>(path: string, query?: Query, options?: CallOptions) => Promise<Result>;
type Query = Parameters<DiscogsTransport["request"]>[1];

function clientFor(
  transport: DiscogsTransport,
  options: { authenticated: boolean; signal?: AbortSignal; retries: RetryPolicy },
): DiscogsClient {
  const request: Request = (path, query = {}, callOptions = {}) =>
    transport.request(path, query, {
      ...callOptions,
      signal: options.signal,
      retries: options.retries,
    });
  return {
    withSignal: (signal) => clientFor(transport, { ...options, signal }),
    withRetries: (retries) => clientFor(transport, { ...options, retries }),
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
      addToWantlist(request, username, releaseId, options),
    removeFromWantlist: (username, releaseId) => removeFromWantlist(request, username, releaseId),
    hasToken: () => options.authenticated,
  };
}

async function addToWantlist(
  request: Request,
  username: string,
  releaseId: number,
  options: { notes?: string },
): Promise<void> {
  const body = options.notes === undefined ? undefined : { notes: options.notes };
  await request(
    `/users/${encodeURIComponent(username)}/wants/${releaseId}`,
    {},
    { method: "PUT", body },
  );
}

async function removeFromWantlist(
  request: Request,
  username: string,
  releaseId: number,
): Promise<void> {
  try {
    await request(
      `/users/${encodeURIComponent(username)}/wants/${releaseId}`,
      {},
      { method: "DELETE" },
    );
  } catch (error) {
    if (!(error instanceof DiscogsApiError && error.status === 404)) throw error;
  }
}
