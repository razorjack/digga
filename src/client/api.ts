import {
  filtersParam,
  type DeleteVerdictResponse,
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
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
  const s = q.toString();
  return s === "" ? "" : `?${s}`;
}

export function createHttpApi(baseUrl = "/api"): Api {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const data: unknown = text === "" ? null : JSON.parse(text);
    if (!res.ok) {
      const err = (data ?? {}) as { error?: string; issues?: unknown };
      throw new ApiRequestError(
        res.status,
        err.error ?? `${method} ${path} failed with ${res.status}`,
        err.issues,
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
  };
}

/**
 * Every write is faked in memory until the owner has tuned the triage flow: nothing reaches the
 * database, the config file or Discogs. Export createHttpApi() instead to go live.
 */
export const api: Api = createSandboxApi(createHttpApi());
