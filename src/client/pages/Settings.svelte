<script lang="ts">
  import { jobProgress, elapsed, JOB_LABEL } from "../../shared/job-display.ts";
  import { onDestroy, onMount, untrack } from "svelte";
  import type { Attachment } from "svelte/attachments";
  import { BROWSERS, type Browser } from "../../shared/api.ts";
  import {
    type Config,
    QUEUE_STRATEGIES,
    type QueueStrategy,
    validateConfig,
  } from "../../shared/config.ts";
  import { formatCount, formatDay } from "../../shared/display.ts";
  import type { Job } from "../../shared/types.ts";
  import { api } from "../api.ts";
  import Key from "../components/Key.svelte";
  import { getAnchor } from "../router.svelte.ts";
  import { errorMessage, settings, stats } from "../stores.svelte.ts";

  import { FilterPreview } from "../settings/preview.svelte.ts";
  import { SettingsJobs } from "../settings/jobs.svelte.ts";
  import { DiscogsSettings } from "../settings/discogs.svelte.ts";
  import { parseInteger } from "../../shared/integer.ts";
  const id = $props.id();
  const filterPreview = new FilterPreview();
  const jobState = new SettingsJobs();
  const discogs = new DiscogsSettings();
  let flashTimer: ReturnType<typeof setTimeout> | null = null;

  const CURRENCIES = [
    "EUR",
    "USD",
    "GBP",
    "CAD",
    "AUD",
    "JPY",
    "CHF",
    "MXN",
    "BRL",
    "NZD",
    "SEK",
    "ZAR",
  ];
  const STRATEGY_COPY: Record<QueueStrategy, { label: string; hint: string }> = {
    label_sweep: { label: "Label sweep", hint: "label by label, in catalogue order" },
    popular: { label: "Most wanted first", hint: "by Discogs want count; needs enrich" },
    country: { label: "By country", hint: "then label and catalogue number" },
    year: { label: "By year", hint: "oldest first, then label" },
    random: { label: "Shuffled", hint: "a new order each day, stable within the day" },
  };

  let draft = $state<Config | null>(null);
  let saving = $state(false);
  let flash = $state<string | null>(null);
  let enrichAhead = $state(200);
  let historyBrowser = $state<Browser>("brave");
  let dumpFile = $state("");
  let dumpLimit = $state<number | null>(null);
  let dumpDryRun = $state(false);
  let switching = $state(false);
  let modeEl = $state<HTMLElement | null>(null);
  let modeButton = $state<HTMLButtonElement | null>(null);
  let form = $state<HTMLFormElement | null>(null);

  const saved = $derived(settings.value);
  const dirty = $derived(
    draft !== null && saved !== null && JSON.stringify(draft) !== JSON.stringify(saved),
  );
  const validation = $derived(draft ? validateConfig(draft) : null);
  const problems = $derived(validation && !validation.ok ? validation.errors : []);
  const issues = $derived(validation && !validation.ok ? validation.issues : []);
  const startAtPercent = $derived(Math.round((draft?.player.startAtFraction ?? 0) * 100));
  /** The header's sandbox link points here. */
  const highlighted = $derived(getAnchor() === "sandbox");

  $effect(() => {
    if (saved && draft === null) draft = $state.snapshot(saved);
  });

  $effect(() => {
    const username = saved?.discogs.username;
    if (username) void discogs.loadLists();
  });

  $effect(() => {
    const filters = draft && validation?.ok ? $state.snapshot(draft.filters) : null;
    filterPreview.update(filters);
  });

  $effect(() => {
    void settings.version;
    void settings.sandbox;
    untrack(() => void jobState.load());
  });

  $effect(() => {
    if (!highlighted || !modeEl) return;
    modeEl.scrollIntoView({ block: "nearest" });
    modeButton?.focus({ preventScroll: true });
  });

  onMount(() => {
    void discogs.loadAccount();
    void stats.refresh();
  });

  onDestroy(() => {
    jobState.destroy();
    filterPreview.destroy();
    discogs.destroy();
    if (flashTimer) clearTimeout(flashTimer);
  });

  /** Saved at once, outside the form: the mode decides whether the next verdict is kept. */
  async function setSandbox(on: boolean): Promise<void> {
    if (!saved || switching) return;
    switching = true;
    try {
      await settings.save({ ...$state.snapshot(saved), sandbox: on });
      if (draft) draft.sandbox = on;
      showFlash(
        on
          ? "Back in the sandbox: verdicts stay in this tab again."
          : "Sandbox off: verdicts are saved from now on.",
      );
    } catch (event) {
      showFlash(`The sandbox did not switch: ${errorMessage(event)}`);
    } finally {
      switching = false;
    }
  }

  function showFlash(message: string): void {
    flash = message;
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      if (flash === message) flash = null;
    }, 6000);
  }

  async function save(): Promise<void> {
    if (!draft || !validation?.ok || saving) return;
    saving = true;
    const username = saved?.discogs.username;
    try {
      await settings.save(validation.config);
      draft = $state.snapshot(settings.value!);
      showFlash("Saved. The queue has reloaded.");
      void stats.refresh();
      if (settings.value?.discogs.username !== username) void discogs.loadAccount();
    } catch (event) {
      showFlash(`Not saved: ${errorMessage(event)}`);
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
        settings.sandbox && job.type === "import_list"
          ? "Reading your Discogs Maybe list; its maybes stay in this tab (sandbox)."
          : `${JOB_LABEL[job.type]} started.`,
      );
      await jobState.load();
    } catch (event) {
      showFlash(`Did not start: ${errorMessage(event)}`);
    }
  }

  async function cancel(job: Job): Promise<void> {
    try {
      await jobState.cancel(job);
    } catch (event) {
      showFlash(`Cancel failed: ${errorMessage(event)}`);
    }
  }

  /**
   * Reports the config problem at `path` on its field: the constraint validation API drives
   * `:user-invalid` and blocks submission, `aria-invalid` tells assistive technology.
   */
  function reportProblem(path: string): Attachment<HTMLInputElement> {
    return (input) => {
      const message = issues.find((issue) => issue.path === path)?.message ?? "";
      input.setCustomValidity(message);
      if (message) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    };
  }

  const list = (xs: string[]) => xs.join(", ");
  const parseList = (text: string) =>
    text
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x !== "");
  const numberOrNull = (text: string): number | null => {
    return parseInteger(text);
  };

  function onkeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      form?.requestSubmit();
    }
  }
</script>

<svelte:window {onkeydown} />

<div class="settings">
  <header class="head">
    <h1>Settings</h1>
    <p class="lede">Filters and order change the queue as soon as you save.</p>
  </header>

  {#if !draft}
    <p class="quiet">{settings.error ? `Settings did not load: ${settings.error}` : "Loading…"}</p>
  {:else}
    <section class="mode" class:highlight={highlighted} id="sandbox" bind:this={modeEl}>
      <h2>Sandbox</h2>
      {#if settings.sandbox}
        <p>
          <b>On.</b> Verdicts, notes, track marks and heard tunes stay in this browser tab until it reloads,
          and nothing is sent to Discogs. Settings and jobs are saved as usual.
        </p>
        <p class="quiet">
          Turn it off to dig for real: every verdict is saved, and <Key label="A" size="sm" /> adds the release to
          your Discogs wantlist{#if !discogs.tokenProblem && discogs.account?.tokenUsername} ({discogs.account.tokenUsername}){/if}.
          What you did in the sandbox is dropped.
        </p>
        {#if discogs.tokenProblem}
          <p class="problem">
            Before you do: {discogs.tokenProblem}. Verdicts are saved either way, but wants will not reach the Discogs
            wantlist.
          </p>
        {/if}
        <div class="inline">
          <button
            type="button"
            class="primary"
            bind:this={modeButton}
            disabled={switching}
            onclick={() => void setSandbox(false)}
          >
            {switching ? "Switching…" : "Turn off the sandbox"}
          </button>
        </div>
      {:else}
        <p>
          <b>Off.</b> Verdicts are saved, and <Key label="A" size="sm" /> adds the release to your Discogs wantlist;
          <Key label="Z" size="sm" /> right after takes it off again.
        </p>
        <p class="quiet">The sandbox keeps verdicts in this tab only, for trying the flow without consequences.</p>
        <div class="inline">
          <button
            type="button"
            class="secondary"
            bind:this={modeButton}
            disabled={switching}
            onclick={() => void setSandbox(true)}
          >
            {switching ? "Switching…" : "Back to the sandbox"}
          </button>
        </div>
      {/if}
    </section>

    <section class="library">
      <h2>Library</h2>
      {#if stats.value}
        {@const summary = stats.value}
        <p>
          <b>{formatCount(summary.universe.releases)}</b> releases loaded
          {#if summary.dump.date}from the {formatDay(summary.dump.date)} dump{:else if summary.dump.loadedAt}from a dump of unknown date{:else}(no dump loaded yet){/if},
          grouped into <b>{formatCount(summary.universe.keys)}</b> records.
        </p>
        <p>
          <b>{formatCount(summary.universe.filteredKeys)}</b> match your saved filters;
          <b>{formatCount(summary.remaining)}</b> are still to dig.
          <b>{formatCount(summary.heardTracks)}</b> {summary.heardTracks === 1 ? "tune" : "tunes"} heard.
        </p>
        <p class="quiet">
          want {formatCount(summary.verdicts.accepted)}, grail {formatCount(summary.verdicts.candidate)}, maybe {formatCount(summary.verdicts.maybe)},
          skip {formatCount(summary.verdicts.rejected)}, snooze {formatCount(summary.verdicts.snoozed)}, no audio {formatCount(summary.verdicts.no_audio)};
          Discogs wantlist {formatCount(summary.verdicts.wantlist)}, owned {formatCount(summary.verdicts.collection)}, seen {formatCount(summary.verdicts.seen)}
        </p>
      {/if}
    </section>

    <form
      class="form"
      bind:this={form}
      onsubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <section>
        <h2>What to dig</h2>
        <p class="hint">Query-time filters: they narrow the loaded releases without reloading anything.</p>
        <div class="fields">
          <fieldset class="field">
            <legend class="name">Years</legend>
            <div class="inline">
              <input
                type="number"
                aria-label="From year"
                value={draft.filters.yearFrom ?? ""}
                oninput={(event) => (draft!.filters.yearFrom = numberOrNull(event.currentTarget.value))}
              />
              <span class="quiet">to</span>
              <input
                type="number"
                aria-label="To year"
                value={draft.filters.yearTo ?? ""}
                oninput={(event) => (draft!.filters.yearTo = numberOrNull(event.currentTarget.value))}
              />
              <label class="check">
                <input type="checkbox" bind:checked={draft.filters.includeUnknownYear} />
                include releases without a year
              </label>
            </div>
          </fieldset>
          <div class="field">
            <label class="name" for="{id}-formats">Formats</label>
            <input
              id="{id}-formats"
              aria-describedby="{id}-formats-hint"
              value={list(draft.filters.formats)}
              onchange={(event) => (draft!.filters.formats = parseList(event.currentTarget.value))}
              placeholder="any format"
            />
            <span class="hint" id="{id}-formats-hint">
              Discogs format names, comma separated: Vinyl, CD, Cassette. Empty means any.
            </span>
          </div>
          <div class="field">
            <label class="name" for="{id}-countries">Countries</label>
            <input
              id="{id}-countries"
              aria-describedby="{id}-countries-hint"
              value={list(draft.filters.countries)}
              onchange={(event) => (draft!.filters.countries = parseList(event.currentTarget.value))}
              placeholder="any country"
            />
            <span class="hint" id="{id}-countries-hint">As Discogs writes them: UK, Germany, US. Empty means any.</span>
          </div>
          <fieldset class="field">
            <legend class="name">Videos</legend>
            <label class="check">
              <input
                type="checkbox"
                aria-describedby="{id}-videos-hint"
                bind:checked={draft.filters.skipWithoutVideos}
              />
              skip releases without videos
            </label>
            <span class="hint" id="{id}-videos-hint">
              Leaves out releases with no playable YouTube video on Discogs. A newer dump brings back those
              that got one since.
            </span>
          </fieldset>
          {#if draft.universe.styles.length > 1}
            <fieldset class="field">
              <legend class="name">Styles</legend>
              <div class="inline wrap">
                {#each draft.universe.styles as style (style)}
                  <label class="check">
                    <input
                      type="checkbox"
                      checked={draft.filters.styles === null || draft.filters.styles.includes(style)}
                      onchange={(event) => {
                        const all = draft!.universe.styles;
                        const current = draft!.filters.styles ?? all;
                        const next = event.currentTarget.checked
                          ? [...current, style]
                          : current.filter((summary) => summary !== style);
                        draft!.filters.styles = next.length === all.length ? null : next;
                      }}
                    />
                    {style}
                  </label>
                {/each}
              </div>
            </fieldset>
          {/if}
        </div>
        <output class="preview">
          {#if filterPreview.value}
            These filters match <b>{formatCount(filterPreview.value.universe.filteredKeys)}</b> records,
            <b>{formatCount(filterPreview.value.remaining)}</b> still to dig.
          {/if}
        </output>
      </section>

      <section>
        <h2 id="{id}-order">Order</h2>
        <fieldset class="options" aria-labelledby="{id}-order">
          {#each QUEUE_STRATEGIES as strategy (strategy)}
            <div class="option">
              <input
                type="radio"
                id="{id}-{strategy}"
                name="strategy"
                value={strategy}
                aria-describedby="{id}-{strategy}-hint"
                bind:group={draft.queue.strategy}
              />
              <label for="{id}-{strategy}">{STRATEGY_COPY[strategy].label}</label>
              <span class="hint" id="{id}-{strategy}-hint">{STRATEGY_COPY[strategy].hint}</span>
            </div>
          {/each}
        </fieldset>
        <div class="field narrow">
          <label class="name" for="{id}-batch">Batch</label>
          <input
            type="number"
            id="{id}-batch"
            min="1"
            max="5000"
            aria-describedby="{id}-batch-hint"
            bind:value={draft.queue.limit}
            {@attach reportProblem("queue.limit")}
          />
          <span class="hint" id="{id}-batch-hint">Releases fetched per queue request.</span>
        </div>
      </section>

      <section>
        <h2>Player</h2>
        <div class="fields">
          <div class="field">
            <label class="name" for="{id}-start">Start at</label>
            <div class="inline">
              <input
                type="range"
                id="{id}-start"
                min="0"
                max="0.95"
                step="0.05"
                aria-valuetext="{startAtPercent}% into each track"
                bind:value={draft.player.startAtFraction}
              />
              <span>{startAtPercent}% into each track</span>
            </div>
          </div>
          <div class="field narrow">
            <label class="name" for="{id}-seek">Seek step</label>
            <input
              type="number"
              id="{id}-seek"
              min="1"
              max="120"
              aria-describedby="{id}-seek-hint"
              bind:value={draft.player.seekStepSeconds}
              {@attach reportProblem("player.seekStepSeconds")}
            />
            <span class="hint" id="{id}-seek-hint">Seconds per <Key label="←" size="sm" /> <Key label="→" size="sm" />.</span>
          </div>
        </div>
      </section>

      <section>
        <h2>Discogs</h2>
        <div class="fields">
          <div class="field">
            <label class="name" for="{id}-username">Username</label>
            <input
              id="{id}-username"
              aria-describedby="{id}-username-hint"
              bind:value={draft.discogs.username}
              autocomplete="off"
              spellcheck="false"
            />
            <span class="hint" id="{id}-username-hint">
              Collection and wantlist imports read this account. The token lives in .env.
            </span>
          </div>
          <div class="field">
            <span class="name">Token</span>
            <p class:problem={discogs.tokenProblem !== null}>
              {#if discogs.accountError}
                Not checked: {discogs.accountError}.
              {:else if !discogs.account}
                Checking…
              {:else if !discogs.account.hasToken}
                No DISCOGS_TOKEN in .env.
              {:else if discogs.tokenProblem}
                {discogs.tokenProblem[0]!.toUpperCase() + discogs.tokenProblem.slice(1)}.
              {:else}
                Works for {discogs.account.tokenUsername}.
              {/if}
            </p>
            <span class="hint">
              A personal access token from discogs.com/settings/developers, in .env as DISCOGS_TOKEN. Pushes to your
              wantlist and reads of private lists need it.
            </span>
          </div>
          <div class="field narrow">
            <label class="name" for="{id}-currency">Currency</label>
            <select id="{id}-currency" aria-describedby="{id}-currency-hint" bind:value={draft.discogs.currency}>
              {#each CURRENCIES as c (c)}<option value={c}>{c}</option>{/each}
            </select>
            <span class="hint" id="{id}-currency-hint">For lowest prices from enrich.</span>
          </div>
          <div class="field">
            <label class="name" for="{id}-maybe-list">Maybe list</label>
            <div class="inline wrap">
              <select
                id="{id}-maybe-list"
                aria-describedby="{id}-maybe-list-hint"
                value={draft.discogs.maybeListId === null ? "" : String(draft.discogs.maybeListId)}
                onchange={(event) =>
                  (draft!.discogs.maybeListId =
                    event.currentTarget.value === "" ? null : Number(event.currentTarget.value))}
              >
                <option value="">None: no M verdict</option>
                {#each discogs.lists as l (l.id)}
                  <option value={String(l.id)}>{l.name}{l.public ? "" : " (private)"}</option>
                {/each}
                {#if draft.discogs.maybeListId !== null && !discogs.lists.some((l) => l.id === draft!.discogs.maybeListId)}
                  <option value={String(draft.discogs.maybeListId)}>List {draft.discogs.maybeListId}</option>
                {/if}
              </select>
              <button
                type="button"
                class="secondary"
                disabled={discogs.listsState === "loading" || draft.discogs.username === ""}
                onclick={() => void discogs.loadLists()}
              >
                {#if discogs.listsState === "loading"}Reading lists…{:else if discogs.lists.length > 0}Reload lists{:else}Read my lists{/if}
              </button>
            </div>
            <span class="hint" id="{id}-maybe-list-hint">
              {#if discogs.listsState === "error"}
                Lists did not load: {discogs.listsError}.
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
          <div class="field">
            <label class="name" for="{id}-universe-styles">Styles</label>
            <input
              id="{id}-universe-styles"
              aria-describedby="{id}-universe-styles-hint"
              value={list(draft.universe.styles)}
              onchange={(event) => (draft!.universe.styles = parseList(event.currentTarget.value))}
            />
            <span class="hint" id="{id}-universe-styles-hint">
              Exact Discogs style names, comma separated: Drum n Bass, Jungle.
            </span>
          </div>
          <fieldset class="field">
            <legend class="name">Load years</legend>
            <div class="inline">
              <input
                type="number"
                aria-label="Load from year"
                aria-describedby="{id}-load-years-hint"
                value={draft.universe.loadYears?.[0] ?? ""}
                oninput={(event) => {
                  const from = numberOrNull(event.currentTarget.value);
                  const to = draft!.universe.loadYears?.[1] ?? null;
                  draft!.universe.loadYears = from !== null && to !== null ? [from, to] : null;
                }}
              />
              <span class="quiet">to</span>
              <input
                type="number"
                aria-label="Load to year"
                aria-describedby="{id}-load-years-hint"
                value={draft.universe.loadYears?.[1] ?? ""}
                oninput={(event) => {
                  const to = numberOrNull(event.currentTarget.value);
                  const from = draft!.universe.loadYears?.[0] ?? null;
                  draft!.universe.loadYears = from !== null && to !== null ? [from, to] : null;
                }}
              />
              <span class="hint" id="{id}-load-years-hint">Leave either empty to load every year.</span>
            </div>
          </fieldset>
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
        Jobs run on the server, in the sandbox too, since they set Digga up rather than dig. Closing this page does
        not stop them.{settings.sandbox ? " Only the Maybe list import stays in this tab in the sandbox." : ""}
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
              oninput={(event) => (dumpLimit = numberOrNull(event.currentTarget.value))}
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

      {#if jobState.error}
        <p class="quiet">Jobs did not load: {jobState.error}</p>
      {:else if jobState.items.length === 0}
        <p class="quiet">No jobs yet.</p>
      {:else}
        <table class="job-list">
          <caption class="visually-hidden">Recent jobs</caption>
          <thead>
            <tr>
              <th scope="col" class="job-name"><span class="visually-hidden">Job</span></th>
              <th scope="col" class="job-status"><span class="visually-hidden">Status</span></th>
              <th scope="col"><span class="visually-hidden">Progress</span></th>
              <th scope="col" class="job-started"><span class="visually-hidden">Started, duration</span></th>
              <th scope="col" class="job-action"><span class="visually-hidden">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {#each jobState.items as job (job.id)}
              {@const progress = jobProgress(job)}
              <tr class={job.status}>
                <th scope="row" class="job-name" id="{id}-job-{job.id}">{JOB_LABEL[job.type]}</th>
                <td class="job-status">{job.status}</td>
                <td class="job-progress">
                  {#if job.status === "running" && progress.fraction !== null}
                    <progress class="meter" value={progress.fraction} aria-labelledby="{id}-job-{job.id}"></progress>
                  {/if}
                  {progress.text}{job.error ? `: ${job.error}` : ""}
                </td>
                <td class="quiet">{job.createdAt ? `${formatDay(job.createdAt)}, ${elapsed(job)}` : ""}</td>
                <td>
                  {#if job.status === "running"}
                    <button type="button" class="link" onclick={() => cancel(job)}>Cancel</button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>
  {/if}
</div>

<style>
  .settings {
    padding: 32px 40px 0;
  }
  .head,
  .mode,
  .library,
  .form > section,
  .jobs {
    max-width: 940px;
  }
  .mode p {
    max-width: 72ch;
  }
  .mode.highlight {
    max-width: calc(940px + 23px);
    margin-left: -23px;
    padding-left: 20px;
    padding-right: 20px;
    background: var(--sleeve);
    box-shadow: inset 3px 0 0 var(--flyer);
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
  fieldset {
    min-inline-size: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
  /* A floated legend lays out as an ordinary grid item instead of sitting in the border. */
  legend {
    float: left;
    padding: 0;
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
  input:user-invalid {
    border-color: var(--flyer);
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
  .option label {
    cursor: pointer;
  }
  .preview {
    display: block;
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
    width: 100%;
    margin-top: 8px;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: var(--text-sm);
  }
  .job-list th,
  .job-list td {
    padding: 8px;
    font-weight: inherit;
    text-align: left;
    vertical-align: middle;
  }
  .job-list thead th {
    padding: 0;
  }
  .job-list tbody > tr > :first-child {
    padding-left: 0;
  }
  .job-list tbody > tr > :last-child {
    padding-right: 0;
  }
  .job-list tbody tr {
    border-bottom: 1px solid color-mix(in srgb, var(--groove) 60%, transparent);
  }
  th.job-name {
    width: calc(13em + 8px);
  }
  th.job-status {
    width: calc(6em + 16px);
  }
  th.job-started {
    width: calc(11em + 16px);
  }
  th.job-action {
    width: calc(4em + 8px);
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
    color: var(--faded);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .meter {
    margin-right: 10px;
    vertical-align: middle;
    width: 80px;
    height: 4px;
    border: 0;
    appearance: none;
    background: var(--groove);
  }
  .meter::-webkit-progress-bar {
    background: var(--groove);
  }
  .meter::-webkit-progress-value {
    background: var(--flyer);
  }
  .meter::-moz-progress-bar {
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
