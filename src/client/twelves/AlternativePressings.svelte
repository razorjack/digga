<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import {
    alternativesEnabled,
    type AddAlternativesInput,
    type AlternativeAdditions,
    type AlternativeOptions,
  } from "../../shared/alternative-pressings.ts";
  import type { TwelvesItem } from "../../shared/api.ts";
  import { discogsReleaseUrl } from "../../shared/discogs-urls.ts";
  import { formatSummary } from "../../shared/formats.ts";
  import { AlternativesPreviewState } from "./alternatives.svelte.ts";

  let {
    items,
    initialOptions,
    write,
    onclose,
  }: {
    items: TwelvesItem[];
    initialOptions: AlternativeOptions;
    write: (inputs: AddAlternativesInput[]) => Promise<AlternativeAdditions[]>;
    onclose: () => void;
  } = $props();
  const id = $props.id();
  const preview = new AlternativesPreviewState();
  let options = $state<AlternativeOptions>(untrack(() => ({ ...initialOptions })));
  let previewOptions = $state<AlternativeOptions>(untrack(() => ({ ...initialOptions })));
  const selectedCount = $derived(
    preview.entries.reduce((count, entry) => count + entry.selected.length, 0),
  );
  const started = $derived(preview.inputs.length > 0);
  const optionsChanged = $derived(
    options.whiteLabels !== previewOptions.whiteLabels ||
      options.promos !== previewOptions.promos ||
      options.testPressings !== previewOptions.testPressings,
  );
  const busy = $derived(preview.reading || preview.writing);
  onDestroy(() => preview.destroy());

  function open(dialog: HTMLDialogElement): void {
    dialog.showModal();
    untrack(read);
  }

  function read(): void {
    previewOptions = { ...options };
    void preview.read(items, previewOptions);
  }

  function candidateStatus(
    candidate: import("../../shared/alternative-pressings.ts").PressingCandidate,
  ): string {
    if (candidate.onWantlist) return "Already on your imported wantlist.";
    if (candidate.match === "matching") return "Matching credited tracks and mix titles.";
    return "Review: different or incomplete tracklist.";
  }

  function preventCloseWhileWriting(event: Event): void {
    if (preview.writing) event.preventDefault();
  }
</script>

<dialog {@attach open} aria-labelledby="{id}-title" {onclose} oncancel={preventCloseWhileWriting}>
  <header>
    <h2 id="{id}-title">Add alternative pressings</h2>
    <form method="dialog">
      <button disabled={preview.writing} aria-keyshortcuts="Escape">Close</button>
    </form>
  </header>
  <p>
    Keep your existing wants and add selected vinyl pressings of the same Discogs master. Matching
    tracks are selected; review different or incomplete tracklists yourself.
  </p>
  <fieldset disabled={busy || started}>
    <legend>Include</legend>
    <label><input type="checkbox" bind:checked={options.whiteLabels} /> White labels</label>
    <label><input type="checkbox" bind:checked={options.promos} /> Promos</label>
    <label><input type="checkbox" bind:checked={options.testPressings} /> Test pressings</label>
    <button type="button" disabled={!alternativesEnabled(options)} onclick={read}
      >Refresh preview</button
    >
  </fieldset>
  <p role="status">
    {optionsChanged ? "Refresh the preview to apply these format choices." : preview.progress}
  </p>
  {#each preview.errors as error (error)}<p class="problem">{error}</p>{/each}
  {#each preview.entries as entry (entry.preview.source.id)}
    <section aria-label={entry.preview.source.title}>
      <h3>{entry.preview.source.artist} – {entry.preview.source.title}</h3>
      <details>
        <summary>Original tracklist</summary>
        <ol>
          {#each entry.preview.source.tracks as track, index (index)}<li>
              {track.position}
              {track.title}
            </li>{/each}
        </ol>
      </details>
      {#if entry.preview.source.masterId === null}
        <p>This release has no Discogs master. Automatic alternatives cannot be identified.</p>
      {:else if entry.preview.candidates.length === 0}
        <p>No alternative pressings found for these formats.</p>
      {/if}
      {#each entry.preview.candidates as candidate (candidate.release.id)}
        <div class="candidate">
          <label>
            <input
              type="checkbox"
              value={candidate.release.id}
              bind:group={entry.selected}
              disabled={busy || started || candidate.onWantlist}
              aria-describedby="{id}-candidate-{candidate.release.id}"
            />
            {candidate.release.title} ({candidate.release.id})
          </label>
          <p id="{id}-candidate-{candidate.release.id}">
            {formatSummary(candidate.release.formats)} · {candidate.release.catno ??
              "No catalogue number"} · {candidate.release.country ?? "Unknown country"} · {candidate
              .release.year ?? "Unknown year"}.
            {candidateStatus(candidate)}
          </p>
          <details>
            <summary>Tracklist and Discogs release</summary>
            <a
              href={discogsReleaseUrl(candidate.release.id)}
              target="_blank"
              rel="noopener noreferrer">Open release {candidate.release.id} on Discogs</a
            >
            <ol>
              {#each candidate.release.tracks as track, index (index)}<li>
                  {track.position}
                  {track.artists.map((artist) => artist.name).join(", ")} – {track.title}
                </li>{/each}
            </ol>
          </details>
        </div>
      {/each}
      {#each entry.preview.errors as failure (failure.releaseId)}<p class="problem">
          Could not check release {failure.releaseId}: {failure.error}
        </p>{/each}
    </section>
  {/each}
  {#each preview.results as result (result.operationId)}
    <p>{result.added.length} added; {result.existing.length} already wanted.</p>
    {#each result.errors as failure, index (index)}<p class="problem">
        Release {failure.releaseId}: {failure.error}
      </p>{/each}
  {/each}
  <footer>
    <button
      type="button"
      disabled={busy || optionsChanged || selectedCount === 0}
      onclick={() => void preview.add(previewOptions, write)}
    >
      {started ? "Retry additions" : `Add ${selectedCount} selected pressings`}
    </button>
  </footer>
</dialog>

<style>
  dialog {
    width: min(850px, calc(100% - 48px));
    max-height: calc(100% - 48px);
    padding: 24px;
    color: var(--fg);
    background: var(--surface);
    border: 1px solid var(--rule);
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 55%);
  }
  header,
  fieldset {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }
  header {
    justify-content: space-between;
  }
  p,
  fieldset,
  section,
  footer {
    margin-top: 16px;
  }
  label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  section {
    border-top: 1px solid var(--rule);
    padding-top: 16px;
  }
  .candidate {
    margin-top: 12px;
    padding: 12px;
    border: 1px solid var(--rule);
  }
  .candidate p {
    margin: 8px 0;
    color: var(--fg-muted);
  }
  ol {
    padding-left: 24px;
  }
  details {
    margin-top: 8px;
  }
  .problem {
    color: var(--fg-accent);
  }
</style>
