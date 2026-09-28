import {
  filtersParam,
  type DeleteVerdictResponse,
  type DiscogsAccountResponse,
  type DiscogsListResponse,
  type DiscogsListsResponse,
  type DumpLoadJobInput,
  type EnrichJobInput,
  type ImportJobInput,
  type ImportKind,
  type JobsResponse,
  type ListenLogInput,
  type ListenLogResponse,
  type QueueQuery,
  type QueueResponse,
  type ReleaseDetail,
  type Stats,
  type StatsQuery,
  type TrackVerdictInput,
  type TrackVerdictResponse,
  type TwelvesResponse,
  type VerdictInput,
  type WantlistPushInput,
  type WantlistPushResponse,
} from "../shared/api.ts";
import type { Config } from "../shared/config.ts";
import type { Job, Verdict, VerdictStatus } from "../shared/types.ts";
import { createSandboxApi } from "./sandbox.ts";

/**
 * The one transport seam of the frontend. Every endpoint is a method here, and this
 * is the only file in src/client allowed to call fetch. An Electron IPC implementation
 * can replace createHttpApi() without touching any page.
 */
export interface Api {
  /** "sandbox" when writes are faked in memory by createSandboxApi(), "live" when they reach the server. */
  readonly mode: "live" | "sandbox";
  getQueue(query?: QueueQuery): Promise<QueueResponse>;
  getRelease(id: number): Promise<ReleaseDetail>;
  postVerdict(input: VerdictInput): Promise<Verdict>;
  deleteVerdict(key: string): Promise<DeleteVerdictResponse>;
  postTrackVerdict(input: TrackVerdictInput): Promise<TrackVerdictResponse>;
  postListenLog(input: ListenLogInput): Promise<ListenLogResponse>;
  getTwelves(query?: {
    status?: VerdictStatus[];
    applyFilters?: boolean;
  }): Promise<TwelvesResponse>;
  getStats(query?: StatsQuery): Promise<Stats>;
  getSettings(): Promise<Config>;
  putSettings(config: Config): Promise<Config>;
  startEnrich(input?: EnrichJobInput): Promise<Job>;
  startDumpLoad(input: DumpLoadJobInput): Promise<Job>;
  startImport(kind: ImportKind, input?: ImportJobInput): Promise<Job>;
  getJobs(): Promise<JobsResponse>;
  getJob(id: string): Promise<Job>;
  cancelJob(id: string): Promise<{ cancelled: boolean; job: Job }>;
  pushToWantlist(releaseId: number, input?: WantlistPushInput): Promise<WantlistPushResponse>;
  removeFromWantlist(releaseId: number): Promise<WantlistPushResponse>;
  /** Whether a token is set and whose it is; asks Discogs once per call. */
  getDiscogsAccount(): Promise<DiscogsAccountResponse>;
  getDiscogsLists(): Promise<DiscogsListsResponse>;
  /** Reads a Discogs list and maps its entries to triage keys; writes nothing. */
  getDiscogsList(id: number): Promise<DiscogsListResponse>;
}

export class ApiRequestError extends Error {
  status: number;
  issues: unknown;
  constructor(status: number, message: string, issues?: unknown) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.issues = issues;
  }
}

function queryString(params: Record<string, string | number | boolean | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined) query.set(key, String(value));
  const encoded = query.toString();
  return encoded === "" ? "" : `?${encoded}`;
}

export function createHttpApi(baseUrl = "/api"): Api {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const data: unknown = text === "" ? null : JSON.parse(text);
    if (!response.ok) {
      const error = (data ?? {}) as { error?: string; issues?: unknown };
      throw new ApiRequestError(
        response.status,
        error.error ?? `${method} ${path} failed with ${response.status}`,
        error.issues,
      );
    }
    return data as T;
  };
  return {
    mode: "live",
    getQueue: ({ filters, ...rest } = {}) =>
      call("GET", `/queue${queryString({ ...rest, filters: filtersParam(filters) })}`),
    getRelease: (id) => call("GET", `/releases/${id}`),
    postVerdict: (input) => call("POST", "/verdicts", input),
    deleteVerdict: (key) => call("DELETE", `/verdicts/${encodeURIComponent(key)}`),
    postTrackVerdict: (input) => call("POST", "/track-verdicts", input),
    postListenLog: (input) => call("POST", "/listen-log", input),
    getTwelves: (query = {}) =>
      call(
        "GET",
        `/twelves${queryString({ status: query.status?.join(","), applyFilters: query.applyFilters })}`,
      ),
    getStats: ({ filters } = {}) =>
      call("GET", `/stats${queryString({ filters: filtersParam(filters) })}`),
    getSettings: () => call("GET", "/settings"),
    putSettings: (config) => call("PUT", "/settings", config),
    startEnrich: (input = {}) => call("POST", "/jobs/enrich", input),
    startDumpLoad: (input) => call("POST", "/jobs/dump-load", input),
    startImport: (kind, input = {}) => call("POST", `/jobs/import/${kind}`, input),
    getJobs: () => call("GET", "/jobs"),
    getJob: (id) => call("GET", `/jobs/${id}`),
    cancelJob: (id) => call("POST", `/jobs/${id}/cancel`),
    pushToWantlist: (releaseId, input = {}) =>
      call("POST", `/discogs/wantlist/${releaseId}`, input),
    removeFromWantlist: (releaseId) => call("DELETE", `/discogs/wantlist/${releaseId}`),
    getDiscogsAccount: () => call("GET", "/discogs/account"),
    getDiscogsLists: () => call("GET", "/discogs/lists"),
    getDiscogsList: (id) => call("GET", `/discogs/lists/${id}`),
  };
}

/** The app's Api: the server's own, or a sandbox around it that fakes the digging writes. */
export interface AppApi extends Api {
  /** Switches modes; every switch into the sandbox starts an empty one. */
  setSandbox(on: boolean): void;
  /** The implementation in use now. A write sent through it stays in that mode after a switch. */
  pinned(): Api;
  /** Bumped by every switch, so state built in the previous mode can be dropped. */
  readonly generation: number;
}

export function createAppApi(
  http: Api,
  makeSandbox: (inner: Api) => Api = createSandboxApi,
): AppApi {
  let current = makeSandbox(http);
  let generation = 0;
  return {
    get mode() {
      return current.mode;
    },
    get generation() {
      return generation;
    },
    setSandbox(on) {
      if ((current.mode === "sandbox") === on) return;
      current = on ? makeSandbox(http) : http;
      generation += 1;
    },
    pinned: () => current,
    getQueue: (query) => current.getQueue(query),
    getRelease: (id) => current.getRelease(id),
    postVerdict: (input) => current.postVerdict(input),
    deleteVerdict: (key) => current.deleteVerdict(key),
    postTrackVerdict: (input) => current.postTrackVerdict(input),
    postListenLog: (input) => current.postListenLog(input),
    getTwelves: (query) => current.getTwelves(query),
    getStats: (query) => current.getStats(query),
    getSettings: () => current.getSettings(),
    putSettings: (config) => current.putSettings(config),
    startEnrich: (input) => current.startEnrich(input),
    startDumpLoad: (input) => current.startDumpLoad(input),
    startImport: (kind, input) => current.startImport(kind, input),
    getJobs: () => current.getJobs(),
    getJob: (id) => current.getJob(id),
    cancelJob: (id) => current.cancelJob(id),
    pushToWantlist: (releaseId, input) => current.pushToWantlist(releaseId, input),
    removeFromWantlist: (releaseId) => current.removeFromWantlist(releaseId),
    getDiscogsAccount: () => current.getDiscogsAccount(),
    getDiscogsLists: () => current.getDiscogsLists(),
    getDiscogsList: (id) => current.getDiscogsList(id),
  };
}

/**
 * Starts in the sandbox, so nothing is written before the config is read; the settings store
 * then switches to the mode `sandbox` in digga.config.json asks for.
 */
export const api: AppApi = createAppApi(createHttpApi());
