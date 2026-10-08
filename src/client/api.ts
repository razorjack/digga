import {
  filtersParam,
  type BackupsResponse,
  type DeleteVerdictResponse,
  type DiscogsAccountResponse,
  type DiscogsListsResponse,
  type DiscogsProfileResponse,
  type DumpFileResponse,
  type DumpLoadJobInput,
  type DumpsResponse,
  type ExpectedVerdict,
  type ExportFile,
  type ForgetDiscogsDataResponse,
  type ImportJobInput,
  type ImportKind,
  type JobsResponse,
  type ListenLogInput,
  type ListenLogResponse,
  type QueueQuery,
  type QueueResponse,
  type ReleaseDetail,
  type ScopeSearchResponse,
  type SetupResponse,
  type Stats,
  type StatsQuery,
  type TrackMarksResponse,
  type TrackVerdictInput,
  type TrackVerdictResponse,
  type TwelvesResponse,
  type VerdictInput,
  type WantlistPushResponse,
} from "../shared/api.ts";
import type { Config } from "../shared/config.ts";
import type { SavedSession, SessionInput, SessionResolution } from "../shared/digging-session.ts";
import { formatWait } from "../shared/display.ts";
import type { StyleCensus } from "../shared/style-census.ts";
import { scopeParam } from "../shared/scope.ts";
import type { Job, Verdict, VerdictStatus } from "../shared/types.ts";

/**
 * The one transport seam of the frontend. Every endpoint is a method here, and this
 * is the only file in src/client allowed to call fetch. An Electron IPC implementation
 * can replace createHttpApi() without touching any page.
 */
export interface Api {
  /** The digging session saved last, to offer resuming it; null when there is none. */
  getLatestSession(): Promise<SavedSession | null>;
  /** Saves where the digging session is. */
  putSession(input: SessionInput): Promise<{ saved: boolean }>;
  /** The records a saved session pointed at, as the catalogue and verdicts have them now. */
  resolveSession(id: string): Promise<SessionResolution>;
  getQueue(query?: QueueQuery): Promise<QueueResponse>;
  /** Sellers, labels and artists whose name contains the text, to narrow the queue to. */
  searchScopes(text: string): Promise<ScopeSearchResponse>;
  getRelease(id: number): Promise<ReleaseDetail>;
  /** Fetches the release's market data and videos from Discogs; the server stores them. */
  enrichRelease(id: number): Promise<ReleaseDetail>;
  /** Attaches a YouTube link the user found to the release; answers the release with it. */
  attachVideo(releaseId: number, url: string): Promise<ReleaseDetail>;
  /** Saves the release's note apart from any verdict; null removes it. */
  putReleaseNote(releaseId: number, notes: string | null): Promise<{ notes: string | null }>;
  postVerdict(input: VerdictInput): Promise<Verdict>;
  /** Deletes the record's verdict while it is still the expected one; 409 otherwise. */
  deleteVerdict(key: string, expected: ExpectedVerdict): Promise<DeleteVerdictResponse>;
  postTrackVerdict(input: TrackVerdictInput): Promise<TrackVerdictResponse>;
  postListenLog(input: ListenLogInput): Promise<ListenLogResponse>;
  getTwelves(query?: {
    status?: VerdictStatus[];
    applyFilters?: boolean;
  }): Promise<TwelvesResponse>;
  /** Every marked track, newest first. */
  getTrackMarks(): Promise<TrackMarksResponse>;
  getStats(query?: StatsQuery): Promise<Stats>;
  getSettings(): Promise<Config>;
  putSettings(config: Config): Promise<Config>;
  /** Downloads the newest releases dump from data.discogs.com into the dumps folder. */
  startDumpDownload(): Promise<Job>;
  startDumpLoad(input: DumpLoadJobInput): Promise<Job>;
  /** Downloads the newest dump unless the dumps folder has it, then loads it. */
  startDumpUpdate(): Promise<Job>;
  /** The releases dumps in the dumps folder, newest first. */
  getDumps(): Promise<DumpsResponse>;
  /** Deletes a dump from the dumps folder; answers what the folder holds then. */
  deleteDump(name: string): Promise<DumpsResponse>;
  startImport(kind: ImportKind, input?: ImportJobInput): Promise<Job>;
  getJobs(): Promise<JobsResponse>;
  getJob(id: string): Promise<Job>;
  cancelJob(id: string): Promise<{ cancelled: boolean; job: Job }>;
  /** The server writes the note: the release's grail and keep tracks and the record's note. */
  pushToWantlist(releaseId: number): Promise<WantlistPushResponse>;
  removeFromWantlist(releaseId: number): Promise<WantlistPushResponse>;
  /** Whether a token is set and whose it is; asks Discogs once per call. */
  getDiscogsAccount(): Promise<DiscogsAccountResponse>;
  /** Saves the token, or removes the saved one with null; answers the account as the token finds it. */
  setDiscogsToken(token: string | null): Promise<DiscogsAccountResponse>;
  /** Forgets the Discogs account's collection, wantlist and Maybe list, so another can be used. */
  forgetDiscogsData(): Promise<ForgetDiscogsDataResponse>;
  getDiscogsLists(): Promise<DiscogsListsResponse>;
  getBackups(): Promise<BackupsResponse>;
  /** Writes today's backups and a checkpoint now; answers the backups with them. */
  backupNow(): Promise<BackupsResponse>;
  /** What the first run needs: whether it is needed, the newest catalogue, suggestions. */
  getSetup(): Promise<SetupResponse>;
  /** Releases per style and year in the catalogue, for the style picker. */
  getStyles(): Promise<StyleCensus>;
  /** The collection and wantlist sizes and the currency of the connected account. */
  getDiscogsProfile(): Promise<DiscogsProfileResponse>;
  /** Undoes the unfinished first load, so the setup can load other picks. */
  forgetFirstLoad(): Promise<{ deleted: number }>;
  /** The desktop app's file dialog, for a releases dump the user has; only where setup says desktop. */
  chooseDumpFile(): Promise<DumpFileResponse>;
  /** Where the browser downloads an export of the saved decisions. */
  exportUrl(file: ExportFile): string;
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

/** The server refused a write because what it changes changed since the page read it. */
export function isConflict(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 409;
}

/** How long a request may wait for its answer before it fails. */
export interface Timeouts {
  /** Requests the server answers from its own database. */
  localMs: number;
  /**
   * Requests that wait on one Discogs call. The server spaces its Discogs requests, pauses 60 s
   * when the rate limit runs out and backs off on 429, so an answer can take minutes.
   */
  discogsMs: number;
  /** Requests that wait for the user to answer one of the desktop app's native dialogs. */
  dialogMs: number;
}

export const DEFAULT_TIMEOUTS: Timeouts = {
  localMs: 30_000,
  discogsMs: 5 * 60_000,
  dialogMs: 60 * 60_000,
};

function queryString(params: Record<string, string | number | boolean | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined) query.set(key, String(value));
  const encoded = query.toString();
  return encoded === "" ? "" : `?${encoded}`;
}

// One line per Api method, like createAppApi below.
// eslint-disable-next-line max-lines-per-function
export function createHttpApi(baseUrl = "/api", timeouts: Timeouts = DEFAULT_TIMEOUTS): Api {
  const call = httpCaller(baseUrl, timeouts.localMs);
  const callDiscogs = httpCaller(baseUrl, timeouts.discogsMs);
  const callDialog = httpCaller(baseUrl, timeouts.dialogMs);
  return {
    getLatestSession: () => call("GET", "/sessions/latest"),
    putSession: (input) => call("PUT", "/sessions/current", input),
    resolveSession: (id) => call("GET", `/sessions/${encodeURIComponent(id)}/resume`),
    getQueue: ({ filters, scope, ...rest } = {}) =>
      call(
        "GET",
        `/queue${queryString({ ...rest, filters: filtersParam(filters), scope: scopeParam(scope) })}`,
      ),
    searchScopes: (text) => call("GET", `/scopes${queryString({ q: text })}`),
    getRelease: (id) => call("GET", `/releases/${id}`),
    enrichRelease: (id) => callDiscogs("POST", `/releases/${id}/enrich`),
    attachVideo: (releaseId, url) => call("POST", `/releases/${releaseId}/videos`, { url }),
    putReleaseNote: (id, notes) => call("PUT", `/releases/${id}/note`, { notes }),
    postVerdict: (input) => call("POST", "/verdicts", input),
    deleteVerdict: (key, expected) =>
      call(
        "DELETE",
        `/verdicts/${encodeURIComponent(key)}?${new URLSearchParams(expected).toString()}`,
      ),
    postTrackVerdict: (input) => call("POST", "/track-verdicts", input),
    postListenLog: (input) => call("POST", "/listen-log", input),
    getTwelves: (query = {}) =>
      call(
        "GET",
        `/twelves${queryString({ status: query.status?.join(","), applyFilters: query.applyFilters })}`,
      ),
    getTrackMarks: () => call("GET", "/track-marks"),
    getStats: ({ filters, scope } = {}) =>
      call(
        "GET",
        `/stats${queryString({ filters: filtersParam(filters), scope: scopeParam(scope) })}`,
      ),
    getSettings: () => call("GET", "/settings"),
    putSettings: (config) => call("PUT", "/settings", config),
    startDumpDownload: () => call("POST", "/jobs/dump-download"),
    startDumpLoad: (input) => call("POST", "/jobs/dump-load", input),
    startDumpUpdate: () => call("POST", "/jobs/dump-update"),
    getDumps: () => call("GET", "/dumps"),
    deleteDump: (name) => call("DELETE", `/dumps/${encodeURIComponent(name)}`),
    startImport: (kind, input = {}) => call("POST", `/jobs/import/${kind}`, input),
    getJobs: () => call("GET", "/jobs"),
    getJob: (id) => call("GET", `/jobs/${id}`),
    cancelJob: (id) => call("POST", `/jobs/${id}/cancel`),
    pushToWantlist: (releaseId) => callDiscogs("POST", `/discogs/wantlist/${releaseId}`),
    removeFromWantlist: (releaseId) => callDiscogs("DELETE", `/discogs/wantlist/${releaseId}`),
    getDiscogsAccount: () => callDiscogs("GET", "/discogs/account"),
    setDiscogsToken: (token) => callDiscogs("PUT", "/discogs/token", { token }),
    forgetDiscogsData: () => call("DELETE", "/discogs/data"),
    getDiscogsLists: () => callDiscogs("GET", "/discogs/lists"),
    getBackups: () => call("GET", "/backups"),
    backupNow: () => call("POST", "/backups"),
    getSetup: () => call("GET", "/setup"),
    getStyles: () => call("GET", "/styles"),
    getDiscogsProfile: () => callDiscogs("GET", "/discogs/profile"),
    forgetFirstLoad: () => call("DELETE", "/setup/load"),
    chooseDumpFile: () => callDialog("POST", "/desktop/dump-file"),
    exportUrl: (file) => `${baseUrl}/export/${file}`,
  };
}

export const api: Api = createHttpApi();

function httpCaller(baseUrl: string, timeoutMs: number) {
  return async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const { response, text } = await fetchText(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      timeoutMs,
    });
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
}

/** Fetches and reads the body; the timeout covers both, so a stalled answer fails too. */
async function fetchText(
  url: string,
  request: { method: string; headers: HeadersInit; body: string | undefined; timeoutMs: number },
): Promise<{ response: Response; text: string }> {
  const { timeoutMs, ...init } = request;
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    return { response, text: await response.text() };
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError")
      throw new Error(`No answer within ${formatWait(timeoutMs)}`);
    throw error;
  }
}
