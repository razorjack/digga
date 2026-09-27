<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { BROWSERS, type Browser, type DiscogsListSummary, type Stats } from "../../shared/api.ts";
  import { type Config, QUEUE_STRATEGIES, type QueueStrategy, validateConfig } from "../../shared/config.ts";
  import { formatCount, formatDay } from "../../shared/display.ts";
  import type { Job, JobType } from "../../shared/types.ts";
  import { api } from "../api.ts";
  import Key from "../components/Key.svelte";
  import { errorMessage, settings, stats } from "../stores.svelte.ts";

  const sandbox = api.mode === "sandbox";
  const CURRENCIES = ["EUR", "USD", "GBP", "CAD", "AUD", "JPY", "CHF", "MXN", "BRL", "NZD", "SEK", "ZAR"];
  const STRATEGY_COPY: Record<QueueStrategy, { label: string; hint: string }> = {
    label_sweep: { label: "Label sweep", hint: "label by label, in catalogue order" },
    popular: { label: "Most wanted first", hint: "by Discogs want count; needs enrich" },
    country: { label: "By country", hint: "then label and catalogue number" },
    year: { label: "By year", hint: "oldest first, then label" },
    random: { label: "Shuffled", hint: "a new order each day, stable within the day" },
  };
  const JOB_LABEL: Record<JobType, string> = {
    dump_load: "Load dump",
    import_collection: "Import collection",
    import_wantlist: "Import wantlist",
    import_history: "Import browser history",
    import_list: "Import Maybe list",
    enrich: "Enrich",
  };

  let draft = $state<Config | null>(null);
  let saving = $state(false);
  let flash = $state<string | null>(null);
  let preview = $state<Stats | null>(null);
  let jobs = $state.raw<Job[]>([]);
  let jobsError = $state<string | null>(null);
  let lists = $state.raw<DiscogsListSummary[]>([]);
  let listsState = $state<"idle" | "loading" | "error">("idle");
  let listsError = $state<string | null>(null);
  let enrichAhead = $state(200);
  let historyBrowser = $state<Browser>("brave");
  let dumpFile = $state("");
  let dumpLimit = $state<number | null>(null);
  let dumpDryRun = $state(false);
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let previewTimer: ReturnType<typeof setTimeout> | null = null;

  const saved = $derived(settings.value);
  const dirty = $derived(draft !== null && saved !== null && JSON.stringify(draft) !== JSON.stringify(saved));
  const validation = $derived(draft ? validateConfig(draft) : null);
  const problems = $derived(validation && !validation.ok ? validation.errors : []);
  const running = $derived(jobs.some((j) => j.status === "running" || j.status === "queued"));

  $effect(() => {
    if (saved && draft === null) draft = $state.snapshot(saved);
  });

  // The lists load once the username is known; settings may arrive after this page mounts.
  let listsRequested = false;
  $effect(() => {
    if (!saved?.discogs.username || listsRequested) return;
    listsRequested = true;
    void loadLists();
  });

  // Live count of what the edited filters match, before saving.
  $effect(() => {
    const filters = draft ? $state.snapshot(draft.filters) : null;
    if (!filters || !validation?.ok) return;
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      api
        .getStats({ filters })
        .then((s) => (preview = s))
        .catch(() => (preview = null));
    }, 300);
  });

  $effect(() => {
    if (running && !pollTimer) pollTimer = setInterval(() => void loadJobs(), 1000);
    if (!running && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
      void stats.refresh();
    }
  });

  onMount(() => {
    void loadJobs();
    void stats.refresh();
  });

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
    if (previewTimer) clearTimeout(previewTimer);
  });

  /** Reads the user's Discogs lists for the Maybe list picker (a read, fine in the sandbox). */
  async function loadLists(): Promise<void> {
    listsState = "loading";
    try {
      lists = (await api.getDiscogsLists()).lists;
      listsState = "idle";
      listsError = null;
    } catch (e) {
      listsState = "error";
      listsError = errorMessage(e);
    }
  }

  async function loadJobs(): Promise<void> {
    try {
      jobs = (await api.getJobs()).jobs.slice(0, 12);
      jobsError = null;
    } catch (e) {
      jobsError = errorMessage(e);
    }
  }

  function showFlash(message: string): void {
    flash = message;
    setTimeout(() => {
      if (flash === message) flash = null;
    }, 6000);
  }

  async function save(): Promise<void> {
    if (!draft || !validation?.ok || saving) return;
    saving = true;
    try {
      await settings.save(validation.config);
      draft = $state.snapshot(settings.value!);
      showFlash(sandbox ? "Saved for this session only (sandbox). The queue has reloaded." : "Saved. The queue has reloaded.");
      void stats.refresh();
    } catch (e) {
      showFlash(`Not saved: ${errorMessage(e)}`);
    } finally {
      saving = false;
    }
  }

  function revert(): void {
    if (saved) draft = $state.snapshot(saved);
  }

  async function startJob(start: () => Promise<Job>): Promise<void> {
    try {
      const job = await start();
      showFlash(
        !sandbox
          ? `${JOB_LABEL[job.type]} started.`
          : job.type === "import_list"
            ? "Reading your Discogs Maybe list; its maybes are kept in memory (sandbox)."
            : `${JOB_LABEL[job.type]} simulated (sandbox): nothing is written.`,
      );
      await loadJobs();
    } catch (e) {
      showFlash(`Did not start: ${errorMessage(e)}`);
    }
  }

  async function cancel(job: Job): Promise<void> {
    try {
      await api.cancelJob(job.id);
      await loadJobs();
    } catch (e) {
      showFlash(`Cancel failed: ${errorMessage(e)}`);
    }
  }

  const list = (xs: string[]) => xs.join(", ");
  const parseList = (s: string) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x !== "");
  const numberOrNull = (s: string): number | null => {
    const n = Number.parseInt(s, 10);
    return Number.isNaN(n) ? null : n;
  };

  function jobProgress(job: Job): { text: string; fraction: number | null } {
    const p = (job.progress ?? {}) as Record<string, number | null | string>;
    const n = (k: string) => (typeof p[k] === "number" ? (p[k] as number) : 0);
    switch (job.type) {
      case "dump_load":
        return {
          text: `scanned ${formatCount(n("scanned"))}, matched ${formatCount(n("matched"))}`,
          fraction: null,
        };
      case "enrich":
        return {
          text: `${formatCount(n("done"))} of ${formatCount(n("total"))}${n("failed") ? `, ${n("failed")} failed` : ""}`,
          fraction: n("total") > 0 ? n("done") / n("total") : null,
        };
      case "import_history":
        return {
          text: `${formatCount(n("discogsUrls"))} Discogs links, ${formatCount(n("keys"))} releases`,
          fraction: null,
        };
      default:
        return {
          text: `page ${n("page")}${p.pages ? ` of ${n("pages")}` : ""}, ${formatCount(n("processed"))} items`,
          fraction: p.pages ? n("page") / n("pages") : null,
        };
    }
  }

  function elapsed(job: Job): string {
    if (!job.startedAt) return "";
    const end = job.finishedAt ? Date.parse(job.finishedAt) : Date.now();
    const s = Math.max(0, Math.round((end - Date.parse(job.startedAt)) / 1000));
    return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
  }

  function onkeydown(e: KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void save();
    }
  }
</script>

<svelte:window {onkeydown} />

<div class="settings">
  <header class="head">
    <h1>Settings</h1>
    <p class="lede">
      Filters and order change the queue as soon as you save.
      {#if sandbox}In the sandbox, saved settings last until the page reloads and jobs are simulated.{/if}
    </p>
  </header>

  {#if !draft}
    <p class="quiet">{settings.error ? `Settings did not load: ${settings.error}` : "Loading…"}</p>
  {:else}
    <section class="library">
      <h2>Library</h2>
      {#if stats.value}
        {@const s = stats.value}
        <p>
          <b>{formatCount(s.universe.releases)}</b> releases loaded
          {s.dump.date ? `from the ${formatDay(s.dump.date)} dump` : s.dump.loadedAt ? "from a dump of unknown date" : "(no dump loaded yet)"},
          grouped into <b>{formatCount(s.universe.keys)}</b> records.
        </p>
        <p>
          <b>{formatCount(s.universe.filteredKeys)}</b> match your saved filters;
          <b>{formatCount(s.remaining)}</b> are still to dig.
          <b>{formatCount(s.heardTracks)}</b> {s.heardTracks === 1 ? "tune" : "tunes"} heard.
        </p>
        <p class="quiet">
          want {formatCount(s.verdicts.accepted)}, grail {formatCount(s.verdicts.candidate)}, maybe {formatCount(s.verdicts.maybe)},
          skip {formatCount(s.verdicts.rejected)}, snooze {formatCount(s.verdicts.snoozed)}, no audio {formatCount(s.verdicts.no_audio)};
          Discogs wantlist {formatCount(s.verdicts.wantlist)}, owned {formatCount(s.verdicts.collection)}, seen {formatCount(s.verdicts.seen)}
        </p>
      {/if}
    </section>

    <form
      class="form"
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <section>
        <h2>What to dig</h2>
        <p class="hint">Query-time filters: they narrow the loaded releases without reloading anything.</p>
        <div class="fields">
          <div class="field">
            <span class="name">Years</span>
            <div class="inline">
              <input
                type="number"
                inputmode="numeric"
                aria-label="From year"
                value={draft.filters.yearFrom ?? ""}
                oninput={(e) => (draft!.filters.yearFrom = numberOrNull(e.currentTarget.value))}
              />
              <span class="quiet">to</span>
              <input
                type="number"
                inputmode="numeric"
                aria-label="To year"
                value={draft.filters.yearTo ?? ""}
                oninput={(e) => (draft!.filters.yearTo = numberOrNull(e.currentTarget.value))}
              />
              <label class="check">
                <input type="checkbox" bind:checked={draft.filters.includeUnknownYear} />
                include releases without a year
              </label>
            </div>
          </div>
          <label class="field">
            <span class="name">Formats</span>
            <input
              value={list(draft.filters.formats)}
              onchange={(e) => (draft!.filters.formats = parseList(e.currentTarget.value))}
              placeholder="any format"
            />
            <span class="hint">Discogs format names, comma separated: Vinyl, CD, Cassette. Empty means any.</span>
          </label>
          <label class="field">
            <span class="name">Countries</span>
            <input
              value={list(draft.filters.countries)}
              onchange={(e) => (draft!.filters.countries = parseList(e.currentTarget.value))}
              placeholder="any country"
            />
            <span class="hint">As Discogs writes them: UK, Germany, US. Empty means any.</span>
          </label>
          {#if draft.universe.styles.length > 1}
            <div class="field">
              <span class="name">Styles</span>
              <div class="inline wrap">
                {#each draft.universe.styles as style (style)}
                  <label class="check">
                    <input
                      type="checkbox"
                      checked={draft.filters.styles === null || draft.filters.styles.includes(style)}
                      onchange={(e) => {
                        const all = draft!.universe.styles;
                        const current = draft!.filters.styles ?? all;
                        const next = e.currentTarget.checked
                          ? [...current, style]
                          : current.filter((s) => s !== style);
                        draft!.filters.styles = next.length === all.length ? null : next;
                      }}
                    />
                    {style}
                  </label>
                {/each}
              </div>
            </div>
          {/if}
        </div>
        <p class="preview" aria-live="polite">
          {#if preview}
            These filters match <b>{formatCount(preview.universe.filteredKeys)}</b> records,
            <b>{formatCount(preview.remaining)}</b> still to dig.
          {/if}
        </p>
      </section>

      <section>
        <h2>Order</h2>
        <div class="options">
          {#each QUEUE_STRATEGIES as strategy (strategy)}
            <label class="option">
              <input type="radio" name="strategy" value={strategy} bind:group={draft.queue.strategy} />
              <span>{STRATEGY_COPY[strategy].label}</span>
              <span class="hint">{STRATEGY_COPY[strategy].hint}</span>
            </label>
          {/each}
        </div>
        <label class="field narrow">
          <span class="name">Batch</span>
          <input type="number" min="1" max="5000" bind:value={draft.queue.limit} />
          <span class="hint">Releases fetched per queue request.</span>
        </label>
      </section>

      <section>
        <h2>Player</h2>
        <div class="fields">
          <label class="field">
            <span class="name">Start at</span>
            <div class="inline">
              <input type="range" min="0" max="0.95" step="0.05" bind:value={draft.player.startAtFraction} />
              <span>{Math.round(draft.player.startAtFraction * 100)}% into each track</span>
            </div>
          </label>
          <label class="field narrow">
            <span class="name">Seek step</span>
            <input type="number" min="1" max="120" bind:value={draft.player.seekStepSeconds} />
            <span class="hint">Seconds per <Key label="←" size="sm" /> <Key label="→" size="sm" />.</span>
          </label>
        </div>
      </section>

      <section>
        <h2>Discogs</h2>
        <div class="fields">
          <label class="field">
            <span class="name">Username</span>
            <input bind:value={draft.discogs.username} autocomplete="off" spellcheck="false" />
            <span class="hint">Collection and wantlist imports read this account. The token lives in .env.</span>
          </label>
          <label class="field narrow">
            <span class="name">Currency</span>
            <select bind:value={draft.discogs.currency}>
              {#each CURRENCIES as c (c)}<option value={c}>{c}</option>{/each}
            </select>
            <span class="hint">For lowest prices from enrich.</span>
          </label>
          <div class="field">
            <span class="name">Maybe list</span>
            <div class="inline wrap">
              <select
                aria-label="Maybe list"
                value={draft.discogs.maybeListId === null ? "" : String(draft.discogs.maybeListId)}
                onchange={(e) =>
                  (draft!.discogs.maybeListId =
                    e.currentTarget.value === "" ? null : Number(e.currentTarget.value))}
              >
                <option value="">None: no M verdict</option>
                {#each lists as l (l.id)}
                  <option value={String(l.id)}>{l.name}{l.public ? "" : " (private)"}</option>
                {/each}
                {#if draft.discogs.maybeListId !== null && !lists.some((l) => l.id === draft!.discogs.maybeListId)}
                  <option value={String(draft.discogs.maybeListId)}>List {draft.discogs.maybeListId}</option>
                {/if}
              </select>
              <button
                type="button"
                class="secondary"
                disabled={listsState === "loading" || draft.discogs.username === ""}
                onclick={() => void loadLists()}
              >
                {listsState === "loading" ? "Reading lists…" : lists.length > 0 ? "Reload lists" : "Read my lists"}
              </button>
            </div>
            <span class="hint">
              {#if listsState === "error"}
                Lists did not load: {listsError}.
              {:else}
                The Discogs list you keep maybes on. Once it is set, M files a release as maybe; the
                Discogs API cannot add to lists, so Twelves shows which ones still need adding there.
              {/if}
            </span>
          </div>
        </div>
      </section>

      <section>
        <h2>Universe</h2>
        <p class="hint">What the dump loader keeps. Changes apply to the next dump load.</p>
        <div class="fields">
          <label class="field">
            <span class="name">Styles</span>
            <input
              value={list(draft.universe.styles)}
              onchange={(e) => (draft!.universe.styles = parseList(e.currentTarget.value))}
            />
            <span class="hint">Exact Discogs style names, comma separated: Drum n Bass, Jungle.</span>
          </label>
          <div class="field">
            <span class="name">Load years</span>
            <div class="inline">
              <input
                type="number"
                aria-label="Load from year"
                value={draft.universe.loadYears?.[0] ?? ""}
                oninput={(e) => {
                  const from = numberOrNull(e.currentTarget.value);
                  const to = draft!.universe.loadYears?.[1] ?? null;
                  draft!.universe.loadYears = from !== null && to !== null ? [from, to] : null;
                }}
              />
              <span class="quiet">to</span>
              <input
                type="number"
                aria-label="Load to year"
                value={draft.universe.loadYears?.[1] ?? ""}
                oninput={(e) => {
                  const to = numberOrNull(e.currentTarget.value);
                  const from = draft!.universe.loadYears?.[0] ?? null;
                  draft!.universe.loadYears = from !== null && to !== null ? [from, to] : null;
                }}
              />
              <span class="hint">Leave either empty to load every year.</span>
            </div>
          </div>
        </div>
      </section>

      <div class="savebar">
        <p class="status" aria-live="polite">
          {#if problems.length > 0}
            <span class="problem">{problems[0]}</span>
          {:else if flash}
            <span class="flash">{flash}</span>
          {:else if dirty}
            Unsaved changes.
          {:else}
            <span class="quiet">All saved.</span>
          {/if}
        </p>
        <button type="button" class="secondary" disabled={!dirty} onclick={revert}>Revert</button>
        <button type="submit" class="primary" disabled={!dirty || problems.length > 0 || saving}>
          Save settings <span class="kbd">⌘S</span>
        </button>
      </div>
    </form>

    <section class="jobs">
      <h2>Jobs</h2>
      <p class="hint">
        {sandbox
          ? "Sandbox: these buttons simulate the jobs so you can see their progress. The CLI runs them for real."
          : "Jobs run on the server; closing this page does not stop them."}
      </p>
      <div class="job-actions">
        <div class="job">
          <p><b>Enrich</b> fetches price, have/want and fresh videos for the next records in the queue.</p>
          <div class="inline">
            <input type="number" min="1" max="5000" bind:value={enrichAhead} aria-label="Records to enrich" />
            <button type="button" class="secondary" onclick={() => startJob(() => api.startEnrich({ ahead: enrichAhead }))}>
              Enrich next {formatCount(enrichAhead || 0)}
            </button>
          </div>
        </div>
        <div class="job">
          <p><b>Import</b> seeds verdicts from Discogs and from browser history.</p>
          <div class="inline wrap">
            <button type="button" class="secondary" onclick={() => startJob(() => api.startImport("collection"))}>Collection</button>
            <button type="button" class="secondary" onclick={() => startJob(() => api.startImport("wantlist"))}>Wantlist</button>
            <select bind:value={historyBrowser} aria-label="Browser">
              {#each BROWSERS as b (b)}<option value={b}>{b}</option>{/each}
            </select>
            <button type="button" class="secondary" onclick={() => startJob(() => api.startImport("history", { browser: historyBrowser }))}>
              History
            </button>
            <button
              type="button"
              class="secondary"
              disabled={(saved?.discogs.maybeListId ?? null) === null}
              onclick={() => startJob(() => api.startImport("list"))}
            >
              Maybe list
            </button>
          </div>
        </div>
        <div class="job">
          <p><b>Load dump</b> streams a Discogs releases dump from <code>data/dumps/</code> or an absolute path.</p>
          <div class="inline wrap">
            <input class="file" bind:value={dumpFile} placeholder="discogs_20260901_releases.xml.gz" aria-label="Dump file" />
            <input
              type="number"
              min="1"
              placeholder="limit"
              aria-label="Limit"
              value={dumpLimit ?? ""}
              oninput={(e) => (dumpLimit = numberOrNull(e.currentTarget.value))}
            />
            <label class="check"><input type="checkbox" bind:checked={dumpDryRun} /> dry run</label>
            <button
              type="button"
              class="secondary"
              disabled={dumpFile.trim() === ""}
              onclick={() =>
                startJob(() =>
                  api.startDumpLoad({ file: dumpFile.trim(), limit: dumpLimit ?? undefined, dryRun: dumpDryRun }),
                )}
            >
              Load
            </button>
          </div>
        </div>
      </div>

      {#if jobsError}
        <p class="quiet">Jobs did not load: {jobsError}</p>
      {:else if jobs.length === 0}
        <p class="quiet">No jobs yet.</p>
      {:else}
        <ol class="job-list">
          {#each jobs as job (job.id)}
            {@const progress = jobProgress(job)}
            <li class="job-row {job.status}">
              <span class="job-name">{JOB_LABEL[job.type]}</span>
              <span class="job-status">{job.status}</span>
              <span class="job-progress">
                {#if job.status === "running" && progress.fraction !== null}
                  <span class="meter"><span style:width="{progress.fraction * 100}%"></span></span>
                {/if}
                {progress.text}{job.error ? `: ${job.error}` : ""}
              </span>
              <span class="quiet">{job.createdAt ? `${formatDay(job.createdAt)}, ${elapsed(job)}` : ""}</span>
              <span>
                {#if job.status === "running"}
                  <button type="button" class="link" onclick={() => cancel(job)}>Cancel</button>
                {/if}
              </span>
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  {/if}
</div>

<style>
  .settings {
    padding: 32px 40px 0;
  }
  .head,
  .library,
  .form > section,
  .jobs {
    max-width: 940px;
  }
  .head {
    display: grid;
    gap: 8px;
    margin-bottom: 28px;
  }
  h1 {
    font-family: var(--display);
    font-weight: 400;
    font-size: var(--text-2xl);
  }
  h2 {
    font-family: var(--display);
    font-weight: 400;
    font-size: var(--text-lg);
    margin-bottom: 6px;
  }
  .lede,
  .quiet {
    color: var(--faded);
  }
  section {
    display: grid;
    gap: 12px;
    padding: 24px 0;
    border-top: 1px solid var(--groove);
  }
  .library p {
    color: var(--faded);
  }
  b {
    color: var(--paper);
    font-weight: 600;
  }
  .hint {
    color: var(--dust);
    font-size: var(--text-sm);
  }
  .fields {
    display: grid;
    gap: 16px;
  }
  .field {
    display: grid;
    grid-template-columns: 9em minmax(0, 1fr);
    align-items: center;
    column-gap: 20px;
    row-gap: 4px;
  }
  .field > .hint {
    grid-column: 2;
  }
  .field.narrow > input,
  .field.narrow > select {
    width: 8em;
  }
  .name {
    color: var(--faded);
  }
  .inline {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .wrap {
    flex-wrap: wrap;
  }
  input,
  select {
    padding: 6px 9px;
    border: 1px solid var(--groove);
    border-radius: var(--radius);
    background: var(--ground);
  }
  input::placeholder {
    color: var(--dust);
  }
  input[type="number"] {
    width: 7em;
  }
  input[type="range"] {
    width: 16em;
    padding: 0;
    border: 0;
    accent-color: var(--flyer);
  }
  input[type="checkbox"],
  input[type="radio"] {
    accent-color: var(--flyer);
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--faded);
  }
  .options {
    display: grid;
    gap: 8px;
  }
  .option {
    display: grid;
    grid-template-columns: auto 12em 1fr;
    align-items: baseline;
    gap: 12px;
  }
  .preview {
    min-height: 1.45em;
    color: var(--faded);
  }
  .savebar {
    position: sticky;
    bottom: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 14px;
    margin: 0 -40px;
    padding: 12px 40px;
    border-top: 1px solid var(--groove);
    background: var(--sleeve);
  }
  .status {
    margin-right: auto;
  }
  .problem,
  .flash {
    color: var(--flyer);
  }
  button.primary,
  button.secondary {
    padding: 7px 14px;
    border-radius: var(--radius);
    font-weight: 600;
  }
  button.primary {
    border: 1px solid var(--flyer);
    background: var(--flyer);
    color: var(--flyer-ink);
  }
  button.secondary {
    border: 1px solid var(--groove);
    background: var(--ground);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .kbd {
    margin-left: 6px;
    font-weight: 400;
    opacity: 0.7;
  }
  .jobs {
    padding-bottom: 48px;
  }
  .job-actions {
    display: grid;
    gap: 18px;
  }
  .job {
    display: grid;
    gap: 8px;
  }
  .job p {
    color: var(--faded);
  }
  code {
    font-family: inherit;
    color: var(--paper);
  }
  .file {
    width: 26em;
  }
  .job-list {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    display: grid;
  }
  .job-row {
    display: grid;
    grid-template-columns: 13em 6em minmax(0, 1fr) 11em 4em;
    align-items: center;
    gap: 16px;
    padding: 8px 0;
    border-bottom: 1px solid color-mix(in srgb, var(--groove) 60%, transparent);
    font-size: var(--text-sm);
  }
  .job-status {
    color: var(--faded);
  }
  .running .job-status {
    color: var(--flyer);
  }
  .failed .job-status {
    color: var(--paper);
    text-decoration: line-through;
  }
  .job-progress {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    color: var(--faded);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .meter {
    flex: none;
    width: 80px;
    height: 4px;
    background: var(--groove);
  }
  .meter span {
    display: block;
    height: 100%;
    background: var(--flyer);
  }
  button.link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--paper);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
</style>
