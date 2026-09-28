<script lang="ts">
  import { untrack } from "svelte";
  import type { MarkedTrack } from "../../shared/api.ts";
  import { discogsReleaseUrl } from "../../shared/discogs-urls.ts";
  import { formatDay, formatDuration } from "../../shared/display.ts";
  import Stamp from "../components/Stamp.svelte";
  import { STATUS_COPY } from "../keymap.ts";
  import { MARK_COPY, trackKey } from "./model.ts";

  let {
    tracks,
    selectedKey,
    editingKey,
    onselect,
    onsave,
    oncancel,
  }: {
    tracks: MarkedTrack[];
    selectedKey: string | null;
    /** The track whose note is being edited. */
    editingKey: string | null;
    onselect: (key: string) => void;
    onsave: (track: MarkedTrack, notes: string | null) => void;
    oncancel: () => void;
  } = $props();

  let table = $state<HTMLTableElement | null>(null);
  let draft = $state("");

  $effect(() => {
    void selectedKey;
    table?.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
  });

  // E starts the draft from the saved note. The shelf reloads after every save, so the draft
  // follows the key being edited, not the track objects, and a reload leaves the typing alone.
  $effect(() => {
    const key = editingKey;
    if (key === null) return;
    draft = untrack(() => tracks.find((track) => trackKey(track) === key)?.mark.notes ?? "");
  });

  /** The note input appears when E is pressed, so it takes focus as it mounts. */
  const focusOnMount = (input: HTMLInputElement) => input.focus();

  function onNoteKey(event: KeyboardEvent, track: MarkedTrack): void {
    event.stopPropagation();
    if (event.key === "Escape") oncancel();
    if (event.key !== "Enter") return;
    const notes = draft.trim() === "" ? null : draft.trim();
    if (notes === track.mark.notes) oncancel();
    else onsave(track, notes);
  }
</script>

<table class="box" bind:this={table}>
  <caption class="visually-hidden">Marked tracks</caption>
  <thead>
    <tr>
      <th scope="col" class="catno"><span class="visually-hidden">Cat no</span></th>
      <th scope="col" class="pos"><span class="visually-hidden">Position</span></th>
      <th scope="col"><span class="visually-hidden">Track</span></th>
      <th scope="col" class="record"><span class="visually-hidden">Record</span></th>
      <th scope="col" class="mark"><span class="visually-hidden">Mark</span></th>
      <th scope="col" class="day"><span class="visually-hidden">Marked</span></th>
    </tr>
  </thead>
  <tbody>
    {#each tracks as track (trackKey(track))}
      {@const key = trackKey(track)}
      {@const release = track.release}
      {@const isSelected = key === selectedKey}
      <!-- J and K select from the keyboard; the click is the mouse equivalent. -->
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
      <tr class:selected={isSelected} aria-current={isSelected ? "true" : undefined} onclick={() => onselect(key)}>
        <td class="catno">{release?.catno ?? ""}</td>
        <td class="pos">{track.mark.position}</td>
        <td class="track">
          <span class="title">
            {#if track.track?.artistDisplay && track.track.artistDisplay !== release?.artistDisplay}
              <span class="by">{track.track.artistDisplay} –</span>
            {/if}
            {track.track?.title ?? "No longer on the tracklist"}
            <span class="quiet">{formatDuration(track.track?.durationSeconds ?? null)}</span>
          </span>
          {#if editingKey === key}
            <input
              class="note-input"
              bind:value={draft}
              {@attach focusOnMount}
              maxlength="4000"
              aria-label="Note on the track"
              onkeydown={(event) => onNoteKey(event, track)}
              onblur={oncancel}
            />
          {:else if track.mark.notes}
            <p class="note">{track.mark.notes}</p>
          {/if}
        </td>
        <td class="record">
          {#if release}
            <a href={discogsReleaseUrl(release.id)} target="_blank" rel="noopener noreferrer">
              <span class="artist">{release.artistDisplay}</span>
              <span class="quiet">{release.title}</span>
            </a>
            {#if track.verdict}<span class="verdict">{STATUS_COPY[track.verdict.status]}</span>{/if}
          {:else}
            <span class="quiet">Release {track.mark.releaseId} is not in the loaded dump</span>
          {/if}
        </td>
        <td class="mark">
          <Stamp
            text={MARK_COPY[track.mark.mark]}
            tone={track.mark.mark === "candidate" ? "flyer" : "paper"}
            seed={track.mark.releaseId + track.mark.position.length}
            size="sm"
          />
        </td>
        <td class="day quiet">
          <time datetime={track.mark.decidedAt}>{formatDay(track.mark.decidedAt)}</time>
        </td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .box {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  th {
    padding: 0;
  }
  th.catno {
    width: calc(9.5em + 26px);
  }
  th.pos {
    width: calc(3.5em + 20px);
  }
  th.record {
    width: 34%;
  }
  th.mark {
    width: calc(7.5em + 20px);
  }
  th.day {
    width: calc(5em + 26px);
  }
  td {
    padding: 12px 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--groove) 60%, transparent);
    vertical-align: middle;
    cursor: default;
  }
  td:first-child {
    padding-left: 16px;
  }
  td:last-child {
    padding-right: 16px;
  }
  .selected {
    background: var(--sleeve);
  }
  .selected td:first-child {
    box-shadow: inset 3px 0 0 var(--flyer);
  }
  .catno,
  .pos {
    font-weight: 600;
    color: var(--faded);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .selected .catno,
  .selected .pos {
    color: var(--paper);
  }
  .title {
    display: block;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .by {
    color: var(--faded);
    font-weight: 400;
  }
  .quiet {
    color: var(--faded);
    font-weight: 400;
  }
  .note {
    margin-top: 4px;
    color: var(--flyer);
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .note-input {
    width: 100%;
    margin-top: 6px;
    padding: 4px 8px;
    border: 1px solid var(--flyer);
    border-radius: var(--radius);
    background: var(--ground);
  }
  td.record {
    font-size: var(--text-sm);
  }
  .record a {
    display: grid;
    text-decoration: none;
  }
  .record a span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .record a:hover .artist {
    text-decoration: underline;
    text-decoration-color: var(--dust);
    text-underline-offset: 3px;
  }
  .verdict {
    color: var(--dust);
  }
  td.day {
    text-align: right;
    font-size: var(--text-sm);
  }
  @media (max-width: 1100px) {
    th.catno {
      width: calc(8em + 26px);
    }
    .record {
      display: none;
    }
  }
</style>
