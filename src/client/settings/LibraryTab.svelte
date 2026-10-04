<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import type { DumpFile } from "../../shared/api.ts";
  import type { Config } from "../../shared/config.ts";
  import { formatBytes, formatCount, formatDay } from "../../shared/display.ts";
  import { parseInteger } from "../../shared/integer.ts";
  import type { Job } from "../../shared/types.ts";
  import { api } from "../api.ts";
  import Key from "../components/Key.svelte";
  import { errorMessage, stats } from "../stores.svelte.ts";
  import { DumpFiles, dumpUse } from "./dumps.svelte.ts";
  import { joinList, parseList } from "./fields.ts";
  import JobList from "./JobList.svelte";
  import type { SettingsJobs } from "./jobs.svelte.ts";
  import { missingReleasesNote } from "./library.ts";
  import { recentJobs, TAB_JOBS } from "./tabs.ts";

  interface Props {
    draft: Config;
    formId: string;
    onsubmit: (event: SubmitEvent) => void;
    jobs: SettingsJobs;
    startJob: (start: () => Promise<Job>) => Promise<void>;
    cancelJob: (job: Job) => void;
    showFlash: (message: string) => void;
  }

  let { draft = $bindable(), formId, onsubmit, jobs, startJob, cancelJob, showFlash }: Props = $props();
  const id = $props.id();
  const dumpFiles = new DumpFiles();

  let dumpFile = $state("");
  let dumpLimit = $state<number | null>(null);
  let dumpDryRun = $state(false);
  let deletingDump = $state(false);

  /** The server runs one dump download, load or update at a time. */
  const dumpJobRunning = $derived(
    jobs.items.some((job) => job.status === "running" && TAB_JOBS.library.some((type) => type === job.type)),
  );
  const dumpJobs = $derived(recentJobs(jobs.items, TAB_JOBS.library));

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
    if (!confirm(`Delete ${file.name} (${size})? Loading it again means downloading it again.`)) return;
    deletingDump = true;
    try {
      await dumpFiles.delete(file.name);
      if (dumpFile === file.name) dumpFile = dumpFiles.newest?.name ?? "";
      showFlash(`Deleted ${file.name}; ${size} freed.`);
    } catch (error) {
      showFlash(`Not deleted: ${errorMessage(error)}`);
    } finally {
      deletingDump = false;
    }
  }

  function loadDump(): void {
    void startJob(() =>
      api.startDumpLoad({ file: dumpFile.trim(), limit: dumpLimit ?? undefined, dryRun: dumpDryRun }),
    );
  }

  /** Both years or neither: a load either keeps a range of years or every year. */
  function setLoadYears(from: number | null, to: number | null): void {
    draft.universe.loadYears = from !== null && to !== null ? [from, to] : null;
  }
</script>

<section class="library" aria-labelledby="{id}-library-title">
  <h2 id="{id}-library-title">Library</h2>
  {#if stats.value}
    {@const summary = stats.value}
    <p>
      <b>{formatCount(summary.universe.releases)}</b> releases loaded
      {#if summary.dump.date}from the <time datetime={summary.dump.date}>{formatDay(summary.dump.date)}</time> dump{:else if summary.dump.loadedAt}from a dump of unknown date{:else}(no dump loaded yet){/if},
      grouped into <b>{formatCount(summary.universe.keys)}</b> records.
    </p>
    {#if summary.dump.lastLoad}
      {@const load = summary.dump.lastLoad}
      {@const missing = missingReleasesNote(load.missing)}
      <p>
        The last load{#if load.finishedAt}, on <time datetime={load.finishedAt}>{formatDay(load.finishedAt)}</time>,{/if}
        added <b>{formatCount(load.added)}</b> {load.added === 1 ? "release" : "releases"}{#if load.coverage > 0}, {formatCount(load.coverage)} of them in other styles for their label or artist{/if}.
        {#if load.toDig > 0}
          <b>{formatCount(load.toDig)}</b> records among them are still to dig; <Key label="F" size="sm" /> in Triage offers them.
        {/if}
        {#if missing}{missing}{/if}
      </p>
    {/if}
    <p>
      <b>{formatCount(summary.universe.filteredKeys)}</b> match your saved filters;
      <b>{formatCount(summary.remaining)}</b> are still to dig.
      <b>{formatCount(summary.heardTracks)}</b> {summary.heardTracks === 1 ? "tune" : "tunes"} heard.
    </p>
    <p class="quiet">
      want {formatCount(summary.verdicts.accepted)}, grail {formatCount(summary.verdicts.candidate)}, maybe {formatCount(summary.verdicts.maybe)},
      skip {formatCount(summary.verdicts.rejected)}, snooze {formatCount(summary.verdicts.snoozed)}, no audio {formatCount(summary.verdicts.no_audio)};
      Discogs wantlist {formatCount(summary.discogs.wantlist)}, owned {formatCount(summary.discogs.collection)}, seen {formatCount(summary.verdicts.seen)}
    </p>
  {/if}
</section>

<form id={formId} {onsubmit}>
  <section>
    <h2>Universe</h2>
    <p class="hint">What the dump loader keeps. Changes apply to the next dump load.</p>
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
            oninput={(event) =>
              setLoadYears(parseInteger(event.currentTarget.value), draft.universe.loadYears?.[1] ?? null)}
          />
          <span class="quiet">to</span>
          <input
            type="number"
            aria-label="Load to year"
            aria-describedby="{id}-load-years-hint"
            value={draft.universe.loadYears?.[1] ?? ""}
            oninput={(event) =>
              setLoadYears(draft.universe.loadYears?.[0] ?? null, parseInteger(event.currentTarget.value))}
          />
          <span class="hint" id="{id}-load-years-hint">Leave either empty to load every year.</span>
        </div>
      </fieldset>
      <fieldset class="field">
        <legend class="name">Coverage</legend>
        <label class="check">
          <input type="checkbox" aria-describedby="{id}-coverage-hint" bind:checked={draft.universe.coverage} />
          also other styles from the labels and artists you want
        </label>
        <span class="hint" id="{id}-coverage-hint">
          When at least a third of the label's or artist's releases in the load years carry one of the styles above.
        </span>
      </fieldset>
    </div>
  </section>
</form>

<section aria-labelledby="{id}-dump-title">
  <h2 id="{id}-dump-title">Dump</h2>
  <p class="quiet">
    Discogs publishes every release once a month, over 10 GB compressed. Update downloads the newest
    dump and loads it; <Key label="F" size="sm" /> in Triage then offers what it added.
  </p>
  <div class="inline wrap">
    <button type="button" class="secondary" disabled={dumpJobRunning} onclick={() => startJob(() => api.startDumpUpdate())}>
      Update from the newest dump
    </button>
    <button type="button" class="secondary" disabled={dumpJobRunning} onclick={() => startJob(() => api.startDumpDownload())}>
      Download only
    </button>
  </div>
  {#if dumpFiles.error}
    <p class="quiet">The dumps folder did not load: {dumpFiles.error}.</p>
  {:else if dumpFiles.value && dumpFiles.newest}
    {@const newest = dumpFiles.newest}
    <ul class="dumps" aria-label="Dumps in the folder">
      {#each dumpFiles.value.files as file (file.name)}
        <li>
          <span>{file.name}</span>
          <span class="quiet">{formatBytes(file.bytes)}, {dumpUse(file, newest, stats.value?.dump.date ?? null)}</span>
          <button type="button" class="link" disabled={dumpJobRunning || deletingDump} onclick={() => void deleteDump(file)}>
            Delete<span class="visually-hidden"> {file.name}</span>
          </button>
        </li>
      {/each}
    </ul>
  {:else if dumpFiles.value}
    <p class="quiet">No dump downloaded yet.</p>
  {/if}
  <div class="inline wrap">
    <input class="file" list="{id}-dump-files" bind:value={dumpFile} placeholder="file name or absolute path" aria-label="Dump file" />
    <datalist id="{id}-dump-files">
      {#each dumpFiles.value?.files ?? [] as file (file.name)}
        <option value={file.name}>{formatBytes(file.bytes)}</option>
      {/each}
    </datalist>
    <input
      type="number"
      min="1"
      placeholder="limit"
      aria-label="Limit"
      value={dumpLimit ?? ""}
      oninput={(event) => (dumpLimit = parseInteger(event.currentTarget.value))}
    />
    <label class="check"><input type="checkbox" bind:checked={dumpDryRun} /> dry run</label>
    <button type="button" class="secondary" disabled={dumpJobRunning || dumpFile.trim() === ""} onclick={loadDump}>
      Load
    </button>
  </div>
  <JobList jobs={dumpJobs} error={jobs.error} oncancel={cancelJob} />
  <details>
    <summary>How updates, downloads and loads work</summary>
    <p>
      Update downloads the newest dump into {#if dumpFiles.value}<code>{dumpFiles.value.directory}</code>{:else}the
        dumps folder{/if} unless it is there, checks it against the checksum Discogs publishes, and loads it. Download
      only and Load do one step each. Load also takes an absolute path, and a limit and a dry run for trying a file.
    </p>
    <p>
      A dump that is loaded, or older than one that is, can go: Digga reads a dump only while it loads it.
    </p>
  </details>
</section>

<style>
  .library p {
    color: var(--fg-muted);
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
