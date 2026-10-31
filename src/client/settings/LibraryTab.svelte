<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import type { DumpFile } from "../../shared/api.ts";
  import type { Config, ConfigIssue } from "../../shared/config.ts";
  import {
    formatBytes,
    formatCount,
    formatCounted,
    formatDay,
    nounFor,
  } from "../../shared/display.ts";
  import { parseInteger } from "../../shared/integer.ts";
  import type { Job } from "../../shared/types.ts";
  import { api } from "../api.ts";
  import Key from "../components/Key.svelte";
  import { errorMessage, stats } from "../stores.svelte.ts";
  import { DumpFiles, dumpUse } from "./dumps.svelte.ts";
  import { joinList, parseList } from "./fields.ts";
  import JobList from "./JobList.svelte";
  import { SAVE_BEFORE_JOB, type SettingsJobs } from "./jobs.svelte.ts";
  import { missingReleasesNote } from "./library.ts";
  import { problemAt, reportProblem } from "./problems.ts";
  import { recentJobs, TAB_JOBS } from "./tabs.ts";

  interface Props {
    draft: Config;
    unsaved: boolean;
    /** What is wrong with the draft; empty when it can be saved. */
    issues: ConfigIssue[];
    formId: string;
    onsubmit: (event: SubmitEvent) => void;
    jobs: SettingsJobs;
    startJob: (start: () => Promise<Job>) => Promise<void>;
    cancelJob: (job: Job) => void;
    showFlash: (message: string) => void;
  }

  let {
    draft = $bindable(),
    unsaved,
    issues,
    formId,
    onsubmit,
    jobs,
    startJob,
    cancelJob,
    showFlash,
  }: Props = $props();
  const id = $props.id();
  const dumpFiles = new DumpFiles();

  let dumpFile = $state("");
  let dumpLimit = $state<number | null>(null);
  let dumpDryRun = $state(false);
  let deletingDump = $state(false);
  let loadFrom = $state<number | null>(null);
  let loadTo = $state<number | null>(null);

  const loadYearsProblem = $derived(problemAt(issues, "universe.loadYears"));

  $effect(() => {
    const current = draft;
    untrack(() => {
      loadFrom = current.universe.loadYears?.[0] ?? null;
      loadTo = current.universe.loadYears?.[1] ?? null;
    });
  });

  /** The server runs one dump download, load or update at a time. */
  const dumpJobRunning = $derived(
    jobs.items.some(
      (job) => job.status === "running" && TAB_JOBS.library.some((type) => type === job.type),
    ),
  );
  const dumpJobs = $derived(recentJobs(jobs.items, TAB_JOBS.library));
  const canLoadDump = $derived(!unsaved && !dumpJobRunning && dumpFile.trim() !== "");

  // A download adds a dump, so the folder is read again whenever the jobs settle.
  $effect(() => {
    if (jobs.running) return;
    untrack(() => void loadDumpFiles());
  });

  onDestroy(() => dumpFiles.destroy());

  /** Offers the newest dump to load until something is typed. */
  async function loadDumpFiles(): Promise<void> {
    await dumpFiles.load();
    if (dumpFile === "" && dumpFiles.newest) dumpFile = dumpFiles.newest.name;
  }

  async function deleteDump(file: DumpFile): Promise<void> {
    const size = formatBytes(file.bytes);
    if (!confirm(`Delete ${file.name} (${size})? Loading it again means downloading it again.`))
      return;
    deletingDump = true;
    try {
      await dumpFiles.delete(file.name);
      if (dumpFile === file.name) dumpFile = dumpFiles.newest?.name ?? "";
      showFlash(`Deleted ${file.name}, freeing ${size}.`);
    } catch (error) {
      showFlash(`Could not delete it: ${errorMessage(error)}`);
    } finally {
      deletingDump = false;
    }
  }

  function loadDump(): void {
    void startJob(() =>
      api.startDumpLoad({
        file: dumpFile.trim(),
        limit: dumpLimit ?? undefined,
        dryRun: dumpDryRun,
      }),
    );
  }

  /** Both years or neither: a load either keeps a range of years or every year. */
  function setLoadYears(from: number | null, to: number | null): void {
    loadFrom = from;
    loadTo = to;
    draft.universe.loadYears = from !== null && to !== null ? [from, to] : null;
  }
</script>

<section class="library" aria-labelledby="{id}-library-title">
  <h2 id="{id}-library-title">Library</h2>
  {#if stats.value}
    {@const summary = stats.value}
    <dl class="fields summary">
      <div class="field">
        <dt class="name" id="{id}-catalogue">Catalogue</dt>
        <dd>
          <ul class="counts" aria-labelledby="{id}-catalogue">
            <li>
              <b>{formatCount(summary.universe.releases)}</b>
              {nounFor(summary.universe.releases, "release")}
            </li>
            <li>
              <b>{formatCount(summary.universe.keys)}</b>
              {nounFor(summary.universe.keys, "record")}
            </li>
            <li><b>{formatCount(summary.universe.filteredKeys)}</b> match your saved filters</li>
            <li><b>{formatCount(summary.remaining)}</b> still to dig</li>
            <li>
              <b>{formatCount(summary.heardTracks)}</b>
              {nounFor(summary.heardTracks, "tune")} heard
            </li>
          </ul>
        </dd>
      </div>
      <div class="field">
        <dt class="name" id="{id}-decisions">Decisions</dt>
        <dd>
          <ul class="counts small" aria-labelledby="{id}-decisions">
            <li><b>{formatCount(summary.verdicts.accepted)}</b> want</li>
            <li><b>{formatCount(summary.verdicts.candidate)}</b> grail</li>
            <li><b>{formatCount(summary.verdicts.maybe)}</b> maybe</li>
            <li><b>{formatCount(summary.verdicts.rejected)}</b> skip</li>
            <li><b>{formatCount(summary.verdicts.snoozed)}</b> snooze</li>
            <li><b>{formatCount(summary.verdicts.no_audio)}</b> no audio</li>
            {#if summary.verdicts.seen > 0}
              <li><b>{formatCount(summary.verdicts.seen)}</b> from browser history</li>
            {/if}
            <li><b>{formatCount(summary.discogs.wantlist)}</b> on the Discogs wantlist</li>
            <li><b>{formatCount(summary.discogs.collection)}</b> owned</li>
          </ul>
        </dd>
      </div>
      <div class="field">
        <dt class="name">Last load</dt>
        <dd>
          <p class="quiet">
            {#if summary.dump.date}Loaded from the <time datetime={summary.dump.date}
                >{formatDay(summary.dump.date)}</time
              > catalogue.{:else if summary.dump.loadedAt}Loaded from a catalogue of unknown date.{:else}No
              catalogue loaded yet.{/if}
            {#if summary.dump.lastLoad}
              {@const load = summary.dump.lastLoad}
              {@const missing = missingReleasesNote(load.missing)}
              The last load{#if load.finishedAt}, on <time datetime={load.finishedAt}
                  >{formatDay(load.finishedAt)}</time
                >,{/if}
              added {formatCounted(load.added, "release")}{#if load.coverage > 0}, including {formatCount(
                  load.coverage,
                )} in other styles from related labels and artists{/if}.
              {#if load.toDig > 0}
                Of these, {formatCount(load.toDig)}
                {nounFor(load.toDig, "record is", "records are")} still to dig. Press <Key
                  label="F"
                  size="sm"
                /> in Triage to dig just those.
              {/if}
              {#if missing}{missing}{/if}
            {/if}
          </p>
        </dd>
      </div>
    </dl>
  {/if}
</section>

<form id={formId} {onsubmit}>
  <section>
    <header>
      <h2>What to load</h2>
      <p>
        These settings decide which releases future loads keep. Removing a style or narrowing the
        years does not remove records already loaded. To narrow the queue, use the filters on the
        Digging tab.
      </p>
    </header>
    <div class="fields">
      <div class="field">
        <label class="name" for="{id}-universe-styles">Styles</label>
        <input
          id="{id}-universe-styles"
          aria-describedby="{id}-universe-styles-hint"
          value={joinList(draft.universe.styles)}
          onchange={(event) => (draft.universe.styles = parseList(event.currentTarget.value))}
        />
        <span class="hint" id="{id}-universe-styles-hint">
          Exact Discogs style names, comma separated.
        </span>
      </div>
      <fieldset class="field">
        <legend class="name">Load years</legend>
        <div class="inline">
          <input
            type="number"
            aria-label="Load from year"
            aria-describedby="{id}-load-years-hint"
            max={loadTo}
            value={loadFrom ?? ""}
            oninput={(event) => setLoadYears(parseInteger(event.currentTarget.value), loadTo)}
          />
          <span class="quiet">to</span>
          <input
            type="number"
            aria-label="Load to year"
            aria-describedby="{id}-load-years-hint {id}-load-years-problem"
            min={loadFrom}
            value={loadTo ?? ""}
            oninput={(event) => setLoadYears(loadFrom, parseInteger(event.currentTarget.value))}
            {@attach reportProblem(issues, "universe.loadYears")}
          />
          <span class="hint" id="{id}-load-years-hint">Leave either empty to load every year.</span>
        </div>
        <span class="hint problem" id="{id}-load-years-problem" hidden={!loadYearsProblem}>
          {loadYearsProblem}
        </span>
      </fieldset>
      <fieldset class="field">
        <legend class="name">Related releases</legend>
        <label class="check">
          <input
            type="checkbox"
            aria-describedby="{id}-coverage-hint"
            bind:checked={draft.universe.coverage}
          />
          Also load other styles from labels and artists you want or own
        </label>
        <span class="hint" id="{id}-coverage-hint">
          Only for a label or artist with at least a third of its releases in the load years in one
          of the styles above.
        </span>
      </fieldset>
    </div>
  </section>
</form>

<section aria-labelledby="{id}-dump-title">
  <header>
    <h2 id="{id}-dump-title">Catalogue</h2>
    <p role="status" id="{id}-job-settings">{unsaved ? SAVE_BEFORE_JOB : ""}</p>
    <p>
      Discogs publishes its whole catalogue once a month, over 10 GB compressed. “Update the
      catalogue” downloads the newest one and loads it. Then press <Key label="F" size="sm" /> in Triage
      to dig what it added.
    </p>
  </header>
  <div class="fields">
    <fieldset class="field">
      <legend class="name">From Discogs</legend>
      <div class="inline wrap">
        <button
          type="button"
          class="secondary"
          disabled={unsaved || dumpJobRunning}
          aria-describedby={unsaved ? `${id}-job-settings` : undefined}
          onclick={() => startJob(() => api.startDumpUpdate())}
        >
          Update the catalogue
        </button>
        <button
          type="button"
          class="secondary"
          disabled={unsaved || dumpJobRunning}
          aria-describedby={unsaved ? `${id}-job-settings` : undefined}
          onclick={() => startJob(() => api.startDumpDownload())}
        >
          Download only
        </button>
      </div>
    </fieldset>
    <div class="field">
      <span class="name">Downloaded</span>
      {#if dumpFiles.error}
        <p class="quiet">Could not read the catalogue folder: {dumpFiles.error}.</p>
      {:else if dumpFiles.value && dumpFiles.newest}
        {@const newest = dumpFiles.newest}
        <ul class="dumps" aria-label="Catalogue files in the folder">
          {#each dumpFiles.value.files as file (file.name)}
            <li>
              <span>{file.name}</span>
              <span class="quiet"
                >{formatBytes(file.bytes)}, {dumpUse(
                  file,
                  newest,
                  stats.value?.dump.date ?? null,
                )}</span
              >
              <button
                type="button"
                class="link"
                disabled={dumpJobRunning || deletingDump}
                onclick={() => void deleteDump(file)}
              >
                Delete<span class="visually-hidden"> {file.name}</span>
              </button>
            </li>
          {/each}
        </ul>
      {:else if dumpFiles.value}
        <p class="quiet">None yet.</p>
      {/if}
    </div>
    <fieldset class="field">
      <legend class="name">From a file</legend>
      <div class="inline wrap">
        <input
          class="file"
          list="{id}-dump-files"
          bind:value={dumpFile}
          placeholder="file name or full path"
          aria-label="Catalogue file"
        />
        <datalist id="{id}-dump-files">
          {#each dumpFiles.value?.files ?? [] as file (file.name)}
            <option value={file.name}>{formatBytes(file.bytes)}</option>
          {/each}
        </datalist>
        <input
          type="number"
          min="1"
          placeholder="all"
          aria-label="Releases to load"
          value={dumpLimit ?? ""}
          oninput={(event) => (dumpLimit = parseInteger(event.currentTarget.value))}
        />
        <label class="check"
          ><input type="checkbox" bind:checked={dumpDryRun} /> Trial run, saves nothing</label
        >
        <button
          type="button"
          class="secondary"
          disabled={!canLoadDump}
          aria-describedby={unsaved ? `${id}-job-settings` : undefined}
          onclick={loadDump}
        >
          Load
        </button>
      </div>
    </fieldset>
    <JobList jobs={dumpJobs} error={jobs.error} oncancel={cancelJob} />
  </div>
  <details>
    <summary>How updates, downloads and loads work</summary>
    <p>
      “Update the catalogue” downloads the newest catalogue into {#if dumpFiles.value}<code
          >{dumpFiles.value.directory}</code
        >{:else}the catalogue folder{/if} unless it is already there, checks it against Discogs' checksum
      and loads it. “Download only” and “Load” each do one of those steps. “Load” also takes a full path,
      a number of releases to load and a trial run, for testing a file.
    </p>
    <p>
      You can delete a file once it is loaded, or once a newer one is. Digga reads a file only while
      loading it.
    </p>
  </details>
</section>

<style>
  /* The section spaces the list from its heading; only the browser's other margins go. */
  .summary {
    margin-bottom: 0;
  }
  .summary dd {
    margin: 0;
  }
  .counts {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 28px;
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .counts b {
    margin-right: 0.3em;
    font-family: var(--display);
    font-size: var(--text-lg);
    font-weight: 400;
  }
  .counts.small {
    gap: 6px 20px;
  }
  .counts.small b {
    font-family: inherit;
    font-size: inherit;
    font-weight: 600;
  }
  .file {
    width: 26em;
  }
  .dumps {
    display: grid;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .dumps li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 16px;
  }
</style>
