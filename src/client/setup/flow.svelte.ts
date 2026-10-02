import type {
  Browser,
  DiscogsAccountResponse,
  DiscogsProfileResponse,
  SetupResponse,
} from "../../shared/api.ts";
import type { Config } from "../../shared/config.ts";
import type { StyleCensus } from "../../shared/style-census.ts";
import { DOWNLOAD_RETRIED_ERROR, type Job } from "../../shared/types.ts";
import { api } from "../api.ts";
import { loadStatus } from "../load-status.svelte.ts";
import { errorMessage, settings, stats, ui } from "../stores.svelte.ts";
import {
  checksumRetryNote,
  DIG_THRESHOLD,
  loadYearsFor,
  stoppedDownloadMessage,
  type YearSpan,
} from "./model.ts";
import type { SetupStep } from "./steps.ts";

export interface Picks {
  styles: string[];
  /** The years to dig. */
  span: YearSpan;
  /** The years to load, the dug ones and some on each side (loadYearsFor). */
  loadYears: YearSpan;
  vinylOnly: boolean;
}

const POLL_MS = 1000;
/** "Records to dig" costs a count over the library, so it is asked less often. */
const STATS_EVERY_MS = 3000;

const isRunning = (job: Job | null) => job?.status === "running" || job?.status === "queued";

/**
 * The first run, step by step (docs/FIRST_RUN.md). It owns the jobs the setup starts and polls
 * them while they run; opening it again finds them and resumes at the first step not done.
 */
export class SetupFlow {
  step = $state<SetupStep>("catalogue");
  setup = $state.raw<SetupResponse | null>(null);
  census = $state.raw<StyleCensus | null>(null);
  account = $state.raw<DiscogsAccountResponse | null>(null);
  profile = $state.raw<DiscogsProfileResponse | null>(null);
  download = $state.raw<Job | null>(null);
  load = $state.raw<Job | null>(null);
  imports = $state.raw<Job[]>([]);
  error = $state<string | null>(null);
  busy = $state(false);
  /** The load waits for the imports, so its coverage pass knows the user's labels. */
  waitingForImports = $state(false);
  /** The dump was deleted from the READY TO DIG screen. */
  dumpDeleted = $state(false);
  /** What step 3 confirmed, in this visit or an earlier one; step 3 starts from it. */
  picks = $state.raw<Picks | null>(null);

  importsRunning = $derived(this.imports.some(isRunning));
  loadRunning = $derived(isRunning(this.load));
  /** This visit has seen the load run or fail, so it shows how the load ends. */
  #followed = $state(false);
  followsLoad = $derived(this.#followed || this.loadRunning);
  loadDone = $derived(this.load?.status === "done");
  /** The dump the setup fetches; the download names it once found, the listing before. */
  dumpFile = $derived(
    (this.download?.type === "dump_download" ? this.download.progress?.file : null) ??
      this.setup?.catalogue.newest?.file ??
      null,
  );
  canDig = $derived(this.loadDone || (stats.value?.remaining ?? 0) >= DIG_THRESHOLD);
  /** Why and where the download stopped, while it has not started again. */
  downloadStopped = $derived(stoppedDownloadMessage(this.download));
  /** The download did not match Discogs' checksum and runs once more by itself. */
  checksumRetry = $derived(checksumRetryNote(this.download));
  /**
   * The load has stopped and waits for the user. A load whose download is running once more
   * after a checksum mismatch does not: the setup starts it again on the new download.
   */
  loadStopped = $derived(
    (this.load?.status === "failed" || this.load?.status === "cancelled") &&
      !(awaitsRetriedDownload(this.load) && this.download?.status !== "failed"),
  );
  #timer: ReturnType<typeof setTimeout> | null = null;
  #statsAt = 0;
  #closed = false;

  /** Reads what the server has and resumes at `requested` when it can, else the first step not done. */
  async open(requested: SetupStep | null = null): Promise<void> {
    try {
      const [setup, { jobs }, account, config] = await Promise.all([
        api.getSetup(),
        api.getJobs(),
        api.getDiscogsAccount().catch(() => null),
        settings.value ?? api.getSettings(),
      ]);
      this.setup = setup;
      this.account = account;
      this.picks = confirmedPicks(config);
      this.#adoptJobs(jobs);
      this.step = this.#resumeStep(requested);
      await this.#loadAgainAfterRetry();
      if (account?.username || account?.tokenUsername) void this.#loadProfile();
      if (this.step === "sound" || this.step === "crate") void this.#loadCensus();
      this.#poll();
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  close(): void {
    this.#closed = true;
    if (this.#timer) clearTimeout(this.#timer);
  }

  goTo(step: SetupStep): void {
    this.error = null;
    this.step = step;
    if (step === "sound") void this.#loadCensus();
  }

  /** Step 1: the download starts, and runs behind the next two steps. */
  async fetchCatalogue(): Promise<void> {
    await this.#act(async () => {
      const fetching = this.setup?.catalogue.newest?.downloaded || isRunning(this.download);
      if (!fetching) this.download = await api.startDumpDownload();
      void loadStatus.check();
      this.goTo("discogs");
      this.#poll();
    });
  }

  /** After the download stopped, on steps 2 and 3: it starts again from the first byte. */
  async restartDownload(): Promise<void> {
    await this.#act(async () => {
      await this.#downloadAgainIfStopped();
      this.#poll();
    });
  }

  /** Step 2: keeps the token when Discogs accepts it, and reads the account's sizes. */
  async connect(token: string): Promise<boolean> {
    let connected = false;
    await this.#act(async () => {
      this.account = await api.setDiscogsToken(token);
      connected = true;
      await Promise.all([this.#loadProfile(), settings.load()]);
    });
    return connected;
  }

  /** Step 2 without a token: a public collection and wantlist can be read by username. */
  async useUsername(username: string): Promise<boolean> {
    let found = false;
    await this.#act(async () => {
      await this.#saveSettings({ username });
      this.profile = await api.getDiscogsProfile();
      found = true;
    });
    return found;
  }

  /** Step 2: starts the chosen imports and moves on while they run. */
  async continueFromDiscogs(choice: { seeds: boolean; browser: Browser | null; currency: string }) {
    await this.#act(async () => {
      if (this.profile) await this.#saveSettings({ currency: choice.currency });
      const started: Job[] = [];
      if (choice.seeds && this.profile) {
        started.push(await api.startImport("collection"));
        started.push(await api.startImport("wantlist"));
      }
      if (choice.browser)
        started.push(await api.startImport("history", { browser: choice.browser }));
      this.imports = started;
      this.goTo("sound");
      this.#poll();
    });
  }

  /** Step 3: saves the picks, digs for real, and starts the load once the imports are in. */
  async fillCrate(picks: Picks): Promise<void> {
    await this.#act(async () => {
      await this.#saveSettings({ picks });
      this.picks = picks;
      await this.#downloadAgainIfStopped();
      this.step = "crate";
      this.waitingForImports = this.importsRunning;
      if (!this.waitingForImports) await this.#startLoad();
      this.#poll();
    });
  }

  /** The load starts now; the coverage pass then misses the labels of the imports still running. */
  async startWithoutImports(): Promise<void> {
    this.waitingForImports = false;
    await this.#act(() => this.#startLoad());
  }

  /** After an interruption: the download again unless the dump is whole, then the load. */
  async pickUp(): Promise<void> {
    await this.#act(async () => {
      this.setup = await api.getSetup();
      if (!this.setup.catalogue.newest?.downloaded && !isRunning(this.download))
        this.download = await api.startDumpDownload();
      await this.#startLoad();
      this.#poll();
    });
  }

  /** Stops the load, forgets what it added, and goes back to the picks; the download goes on. */
  async changePicks(): Promise<void> {
    await this.#act(async () => {
      if (this.load && isRunning(this.load)) {
        await api.cancelJob(this.load.id);
        await this.#waitUntilStopped(this.load.id);
      }
      await api.forgetFirstLoad();
      this.load = null;
      void stats.refresh();
      this.goTo("sound");
    });
  }

  /** Five records in the sandbox before digging for real; Triage ends the round. */
  async practice(): Promise<boolean> {
    let started = false;
    await this.#act(async () => {
      await this.#saveSettings({ sandbox: true });
      ui.practice = { judged: 0 };
      started = true;
    });
    return started;
  }

  async deleteDump(): Promise<void> {
    const file = this.dumpFile;
    if (!file) return;
    await this.#act(async () => {
      await api.deleteDump(file);
      this.dumpDeleted = true;
    });
  }

  #adoptJobs(jobs: Job[]): void {
    const newest = (type: Job["type"]) => jobs.find((job) => job.type === type) ?? null;
    this.download = newest("dump_download");
    this.load = newest("dump_load");
    // A load that ended before this visit belongs to it only when the library still needs one.
    this.#followed = this.load !== null && this.load.status !== "done";
    this.imports = jobs.filter((job) => job.type.startsWith("import_") && isRunning(job));
  }

  /**
   * Where to resume, from what the server has: the load's screen once there is a load, the step
   * asked for once the catalogue is coming, step 3 once its picks were confirmed, and the first
   * step otherwise. A catalogue that was in the dumps folder before any download is step 1's
   * news, unless the address or the confirmed picks say the user went past it.
   */
  #resumeStep(requested: SetupStep | null): SetupStep {
    if (this.load) return "crate";
    const fetched =
      isRunning(this.download) || this.download?.status === "done" || this.downloadStopped !== null;
    const inFolder = this.setup?.catalogue.newest?.downloaded === true;
    if (!fetched && !inFolder) return "catalogue";
    if (requested === "sound" || requested === "discogs") return requested;
    if (this.picks) return "sound";
    return fetched ? "discogs" : "catalogue";
  }

  /** A stopped download starts again, so a load has a dump to read; Discogs cannot resume one. */
  async #downloadAgainIfStopped(): Promise<void> {
    if (this.downloadStopped === null) return;
    this.download = await api.startDumpDownload();
    loadStatus.follow(this.download);
  }

  /**
   * The download threw away the file a load was reading, to download it once more, so a new load
   * reads the new download from the start; the releases the first one kept stay.
   */
  async #loadAgainAfterRetry(): Promise<void> {
    if (!this.load || !awaitsRetriedDownload(this.load)) return;
    if (!isRunning(this.download) && this.download?.status !== "done") return;
    await this.#startLoad();
  }

  async #startLoad(): Promise<void> {
    const file = this.dumpFile;
    if (!file) throw new Error("Digga does not know which catalogue to load yet");
    this.load = await api.startDumpLoad({ file });
    this.#followed = true;
    void loadStatus.check();
  }

  async #saveSettings(change: SettingsChange): Promise<void> {
    const current = settings.value ?? (await api.getSettings());
    await settings.save(withChange($state.snapshot(current) as Config, change));
  }

  async #loadProfile(): Promise<void> {
    try {
      this.profile = await api.getDiscogsProfile();
    } catch {
      this.profile = null;
    }
  }

  async #loadCensus(): Promise<void> {
    if (this.census) return;
    try {
      this.census = await api.getStyles();
    } catch (error) {
      this.error = `The styles did not load: ${errorMessage(error)}`;
    }
  }

  /** Follows the running jobs every second, and the records to dig every few. */
  #poll(): void {
    if (this.#timer) clearTimeout(this.#timer);
    if (this.#closed) return;
    const watched = [this.download, this.load, ...this.imports].filter(isRunning);
    if (watched.length === 0 && !this.waitingForImports) return;
    this.#timer = setTimeout(() => void this.#refresh(), POLL_MS);
  }

  async #refresh(): Promise<void> {
    try {
      const importsWereRunning = this.importsRunning;
      await Promise.all([this.#refreshJobs(), this.#refreshStats()]);
      await this.#loadAgainAfterRetry();
      if (importsWereRunning && !this.importsRunning) await this.#afterImports();
    } catch (error) {
      this.error = errorMessage(error);
    }
    this.#poll();
  }

  async #refreshJobs(): Promise<void> {
    const asked = { download: this.download, load: this.load, imports: this.imports };
    const fetch = async (job: Job | null) => (job && isRunning(job) ? api.getJob(job.id) : job);
    const [download, load, ...imports] = await Promise.all(
      [asked.download, asked.load, ...asked.imports].map(fetch),
    );
    // A job started or dropped while the answers were on their way replaces the one asked about.
    if (this.download === asked.download) this.download = download ?? null;
    if (this.load === asked.load) this.load = load ?? null;
    if (this.loadRunning) this.#followed = true;
    if (this.imports === asked.imports)
      this.imports = imports.filter((job): job is Job => job !== null);
  }

  async #refreshStats(): Promise<void> {
    if (!this.loadRunning && !this.loadDone) return;
    if (Date.now() - this.#statsAt < STATS_EVERY_MS && !this.loadDone) return;
    this.#statsAt = Date.now();
    await stats.refresh();
  }

  /** The suggestions come from the imports, and a load that waited for them can start. */
  async #afterImports(): Promise<void> {
    this.setup = await api.getSetup();
    if (!this.waitingForImports) return;
    this.waitingForImports = false;
    await this.#startLoad();
  }

  async #waitUntilStopped(id: string): Promise<void> {
    for (let tries = 0; tries < 60; tries += 1) {
      if (!isRunning(await api.getJob(id))) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  async #act(action: () => Promise<void>): Promise<void> {
    this.busy = true;
    this.error = null;
    try {
      await action();
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.busy = false;
    }
  }
}

/** The load stopped because its download is downloading once more after a checksum mismatch. */
function awaitsRetriedDownload(load: Job): boolean {
  return load.status === "failed" && load.error === DOWNLOAD_RETRIED_ERROR;
}

export interface SettingsChange {
  sandbox?: boolean;
  username?: string;
  currency?: string;
  picks?: Picks;
}

/** The config after a setup step: the account's name or currency, or the picks, dug for real. */
export function withChange(config: Config, change: SettingsChange): Config {
  const next = structuredClone(config);
  if (change.sandbox !== undefined) next.sandbox = change.sandbox;
  if (change.username) next.discogs.username = change.username;
  if (change.currency) next.discogs.currency = change.currency;
  if (!change.picks) return next;
  const { styles, span, loadYears, vinylOnly } = change.picks;
  next.sandbox = false;
  next.setup.picksConfirmed = true;
  next.universe.styles = styles;
  next.universe.loadYears = loadYears;
  next.filters = {
    ...next.filters,
    styles: null,
    yearFrom: span[0],
    yearTo: span[1],
    formats: vinylOnly ? ["Vinyl"] : [],
  };
  return next;
}

/** The picks step 3 wrote to the config; null until it has, as in a new config or one the CLI made. */
export function confirmedPicks(config: Config): Picks | null {
  const { yearFrom, yearTo, formats } = config.filters;
  if (!config.setup.picksConfirmed || yearFrom === null || yearTo === null) return null;
  const span: YearSpan = [yearFrom, yearTo];
  return {
    styles: config.universe.styles,
    span,
    loadYears: config.universe.loadYears ?? loadYearsFor(span),
    vinylOnly: formats.length === 1 && formats[0] === "Vinyl",
  };
}
