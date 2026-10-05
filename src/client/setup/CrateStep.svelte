<script lang="ts">
  /**
   * Step 4: the download and the load, what the load keeps as it goes, and "Start digging" once
   * enough records wait; then READY TO DIG.
   */
  import { formatBytes, formatCount } from "../../shared/display.ts";
  import { UNDATED_YEAR, type DumpLoadProgress, type KeptRelease } from "../../shared/types.ts";
  import Key from "../components/Key.svelte";
  import Stamp from "../components/Stamp.svelte";
  import { hasCommandModifier, isTyping } from "../keymap.ts";
  import { navigate } from "../router.svelte.ts";
  import { settings, stats } from "../stores.svelte.ts";
  import Action from "./Action.svelte";
  import type { SetupFlow } from "./flow.svelte.ts";
  import { DIG_THRESHOLD, stoppedLoadMessage, transferLeft, yearHistogram } from "./model.ts";
  import ProgressRow from "./ProgressRow.svelte";
  import YearHistogram from "./YearHistogram.svelte";

  let { flow }: { flow: SetupFlow } = $props();

  const download = $derived(flow.download?.type === "dump_download" ? flow.download : null);
  const downloadProgress = $derived(download?.progress ?? null);
  const loadProgress = $derived<DumpLoadProgress | null>(
    flow.load?.type === "dump_load" ? flow.load.progress : null,
  );
  const stopped = $derived(flow.loadStopped);
  const toDig = $derived(stats.value?.remaining ?? 0);
  const picks = $derived(settings.value?.universe.styles ?? []);
  const span = $derived<[number, number] | null>(
    settings.value?.filters.yearFrom != null && settings.value.filters.yearTo != null
      ? [settings.value.filters.yearFrom, settings.value.filters.yearTo]
      : null,
  );
  /** What the census expects the load to keep: the picks in the load years. */
  const expected = $derived(expectedYears());
  const kept = $derived(keptByYear(loadProgress));
  const readFraction = $derived(
    loadProgress?.bytesRead != null && loadProgress.totalBytes
      ? loadProgress.bytesRead / loadProgress.totalBytes
      : null,
  );

  function expectedYears(): Map<number, number> | null {
    if (!flow.census) return null;
    const loadYears = settings.value?.universe.loadYears ?? null;
    const years = yearHistogram(flow.census, picks);
    if (!loadYears) return years;
    return new Map([...years].filter(([year]) => year >= loadYears[0] && year <= loadYears[1]));
  }

  function keptByYear(progress: DumpLoadProgress | null): Map<number, number> {
    const years = new Map<number, number>();
    for (const [year, count] of Object.entries(progress?.keptByYear ?? {}))
      if (year !== UNDATED_YEAR) years.set(Number(year), count);
    return years;
  }

  function downloadText(): string {
    if (!downloadProgress || downloadProgress.phase === "finding") return "finding the newest catalogue";
    if (downloadProgress.alreadyDownloaded) return "downloaded before";
    if (downloadProgress.phase === "done") return `${formatBytes(downloadProgress.receivedBytes)}, checked`;
    const total = downloadProgress.totalBytes;
    if (!total) return formatBytes(downloadProgress.receivedBytes);
    const left = download?.startedAt ? transferLeft(downloadProgress.receivedBytes, total, download.startedAt) : null;
    return `${formatBytes(downloadProgress.receivedBytes)} of ${formatBytes(total)}${left ? ` · ${left}` : ""}`;
  }

  function readText(): string {
    if (flow.loadDone) return "done";
    if (readFraction === null || !flow.load?.startedAt) return "starting";
    const left = transferLeft(readFraction, 1, flow.load.startedAt);
    return `${Math.floor(readFraction * 100)}%${left ? ` · ${left}` : ""}`;
  }

  /** The catalogue number, as on the record; Discogs writes "none" when there is none. */
  function stampOf(release: KeptRelease): string | null {
    const catno = release.catno?.trim() ?? "";
    return catno !== "" && catno.toLowerCase() !== "none" ? catno : release.label;
  }

  function startDigging(): void {
    if (flow.canDig) navigate("triage");
  }

  function onkeydown(event: KeyboardEvent): void {
    if (isTyping(event) || hasCommandModifier(event) || event.repeat) return;
    if (event.key.toLowerCase() !== "t" && event.key !== "Enter") return;
    if (event.key === "Enter" && event.target instanceof HTMLButtonElement) return;
    event.preventDefault();
    startDigging();
  }
</script>

<svelte:window {onkeydown} />

<section class="step" aria-labelledby="crate-title">
  {#if flow.nothingMatches}
    <h1 id="crate-title">Nothing in the catalogue matches these picks</h1>
    <p class="lead">
      Digga read every release and kept none in these styles and years. Pick others, and the load reads the catalogue
      again from the file it has.
    </p>
    <div class="actions">
      <Action primary onclick={() => void flow.changePicks()} disabled={flow.busy}>Change your picks</Action>
    </div>
  {:else if flow.loadDone}
    <div class="ready">
      <Stamp text="ready to dig" tone="accent" size="xl" seed={4} slam />
      <h1 id="crate-title" class="headline">
        The catalogue is in: {formatCount(stats.value?.universe.releases ?? loadProgress?.upserted ?? 0)} releases,
        {formatCount(toDig)} records to dig.
      </h1>
    </div>
  {:else}
    <h1 id="crate-title">Fill the crate</h1>
    <p class="lead">Digga reads every release on Discogs and keeps the ones in your sound.</p>
  {/if}

  {#if flow.waitingForImports}
    <div class="notice">
      <p>Reading your collection and wantlist first, so the load also keeps other records on your labels.</p>
      <Action onclick={() => void flow.startWithoutImports()}>Start without it</Action>
    </div>
  {/if}

  <!-- The alert is in the page before its text, so screen readers announce it. -->
  <div role="alert">
    {#if flow.checksumRetry}
      <div class="notice">
        <p>{flow.checksumRetry}</p>
        <p class="quiet">What loaded so far stays; the load reads the new download from the start.</p>
      </div>
    {:else if stopped && flow.downloadStopped}
      <div class="notice">
        <p>{flow.downloadStopped}</p>
        <p class="quiet">
          What loaded so far stays, and so does anything you dug. Starting again downloads the catalogue and reads it
          from the start.
        </p>
        <div class="actions">
          <Action primary onclick={() => void flow.pickUp()} disabled={flow.busy}>Start again</Action>
          <Action onclick={() => void flow.changePicks()} disabled={flow.busy}>Change your picks</Action>
        </div>
      </div>
    {:else if stopped}
      <div class="notice">
        <p>{stoppedLoadMessage(flow.load)}</p>
        <p class="quiet">
          What loaded so far stays, and so does anything you dug. Picking up reads the catalogue from the start, and
          downloads it again if it was not whole.
        </p>
        <div class="actions">
          <Action primary onclick={() => void flow.pickUp()} disabled={flow.busy}>Pick up</Action>
          <Action onclick={() => void flow.changePicks()} disabled={flow.busy}>Change your picks</Action>
        </div>
      </div>
    {/if}
  </div>

  <div class="progress">
    {#if download && !flow.loadDone}
      <ProgressRow
        label="Download"
        fraction={downloadProgress?.totalBytes ? downloadProgress.receivedBytes / downloadProgress.totalBytes : null}
        text={downloadText()}
      />
    {/if}
    <ProgressRow label="Read" fraction={flow.loadDone ? 1 : readFraction} text={readText()} />
    <p class="counts">
      <span><b>{formatCount((loadProgress?.matched ?? 0) + (loadProgress?.coverage ?? 0))}</b> releases kept</span>
      <span><b>{formatCount(toDig)}</b> records to dig</span>
      {#if toDig > 0}
        <span class="quiet">At 20 seconds a record, that is {Math.max(1, Math.round((toDig * 20) / 3600))} hours. Pace yourself.</span>
      {/if}
    </p>
  </div>

  {#if expected}
    <figure class="crate">
      <YearHistogram
        counts={expected}
        {span}
        filled={kept}
        undated={flow.census?.styles.filter((style) => picks.includes(style.name)).reduce((sum, style) => sum + style.undated, 0) ?? 0}
        filledUndated={loadProgress?.keptByYear[UNDATED_YEAR] ?? 0}
      />
      <figcaption>What Digga expects in outline, what it has kept in ink.</figcaption>
    </figure>
  {/if}

  {#if loadProgress?.latest && !flow.loadDone}
    {@const latest = loadProgress.latest}
    {@const stamp = stampOf(latest)}
    <p class="pulled">
      <span class="label">Just pulled</span>
      {#if stamp}<Stamp text={stamp} size="md" seed={latest.id} />{/if}
      <span class="release">{latest.artist} – {latest.title}</span>
      {#if latest.year}<span class="quiet">{latest.year}</span>{/if}
    </p>
  {/if}

  <div class="outcome">
    <!-- In the page before its text, so screen readers announce it. -->
    <p class="problem" role="alert">{flow.error ?? ""}</p>
    {#if !flow.nothingMatches}
      <div class="actions">
        <Action primary keys="T" shortcuts="T Enter" onclick={startDigging} disabled={!flow.canDig}>
          Start digging
        </Action>
        {#if !flow.canDig && !stopped}
          <span class="quiet">ready at {formatCount(DIG_THRESHOLD)} records</span>
        {/if}
        {#if flow.loadRunning}
          <button type="button" class="link" onclick={() => void flow.changePicks()} disabled={flow.busy}>
            Change your picks
          </button>
        {/if}
      </div>
    {/if}
  </div>

  {#if !flow.nothingMatches}
    {#if !settings.sandbox && flow.account?.tokenUsername}
      <p class="quiet">A want goes on your Discogs wantlist when you press <kbd>A</kbd>. <kbd>Z</kbd> takes it off again.</p>
    {/if}

    <div class="keys">
      <span class="quiet">Keys while you dig:</span>
      <span><Key label="Space" size="sm" /> listen</span>
      <span><Key label="R" size="sm" primary /> skip</span>
      <span><Key label="A" size="sm" primary /> want</span>
      <span><Key label="C" size="sm" primary /> grail</span>
      <span><Key label="N" size="sm" /> next</span>
      <span><Key label="Z" size="sm" /> undo</span>
      <span><Key label="?" size="sm" /> all</span>
    </div>
  {/if}

  {#if flow.loadDone}
    {#if flow.dumpFile && !flow.dumpDeleted}
      <div class="dump">
        <p class="quiet">
          The catalogue file uses {downloadProgress ? formatBytes(downloadProgress.receivedBytes) : "about 10 GB"} in
          the dumps folder. Keep it to change your styles without downloading again this month.
        </p>
        <Action onclick={() => void flow.deleteDump()} disabled={flow.busy}>Delete it</Action>
      </div>
    {:else if flow.dumpDeleted}
      <p class="quiet">The catalogue file is deleted.</p>
    {/if}
  {:else}
    <p class="quiet">Closing this page does not stop the load while Digga's server runs.</p>
  {/if}
</section>

<style>
  .step {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  h1 {
    font-size: var(--text-3xl);
    line-height: 1.15;
  }
  .lead {
    color: var(--fg-muted);
  }
  .ready {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 24px;
  }
  .headline {
    font-size: var(--text-lg);
  }
  .notice {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
    padding: 14px 18px;
    border-left: 3px solid var(--accent-mark);
    background: var(--surface);
  }
  .progress {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .counts {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8px 28px;
    margin-top: 6px;
    color: var(--fg-muted);
  }
  .counts b {
    font-family: var(--display);
    font-weight: 400;
    font-size: var(--text-xl);
    color: var(--fg);
    margin-right: 0.3em;
  }
  .crate {
    margin: 0;
  }
  figcaption {
    margin-top: 4px;
    color: var(--fg-faint);
    font-size: var(--text-2xs);
  }
  .pulled {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 14px;
    min-height: 44px;
  }
  .pulled .label {
    color: var(--fg-faint);
    font-size: var(--text-sm);
  }
  .release {
    font-family: var(--display);
    font-size: var(--text-md);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;
  }
  .keys {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 18px;
    padding-top: 16px;
    border-top: 1px solid var(--rule-soft);
    font-size: var(--text-sm);
  }
  .keys span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .dump {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;
  }
  .quiet {
    color: var(--fg-faint);
    font-size: var(--text-sm);
  }
  .problem {
    color: var(--fg-accent);
  }
  .outcome {
    display: flex;
    flex-direction: column;
  }
  .outcome .problem:not(:empty) {
    margin-bottom: 24px;
  }
  kbd {
    font-family: var(--mono);
    font-weight: 600;
    color: var(--fg-accent);
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--fg-faint);
    font-size: var(--text-sm);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
</style>
