import type {
  DeleteVerdictResponse,
  DumpLoadJobInput,
  EnrichJobInput,
  ImportJobInput,
  ImportKind,
  JobsResponse,
  ListenLogInput,
  ListenLogResponse,
  QueueQuery,
  QueueResponse,
  ReleaseDetail,
  Stats,
  TrackVerdictInput,
  TrackVerdictResponse,
  TwelvesResponse,
  VerdictInput,
  WantlistPushInput,
  WantlistPushResponse,
} from "../shared/api.ts";
import type { Config } from "../shared/config.ts";
import type { Job, Verdict, VerdictStatus } from "../shared/types.ts";

/**
 * The one transport seam of the frontend. Every endpoint is a method here, and this
 * is the only file in src/client allowed to call fetch. An Electron IPC implementation
 * can replace createHttpApi() without touching any page.
 */
export interface Api {
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
  getStats(): Promise<Stats>;
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
    getQueue: (query = {}) => call("GET", `/queue${queryString(query)}`),
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
    getStats: () => call("GET", "/stats"),
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

export const api: Api = createHttpApi();
