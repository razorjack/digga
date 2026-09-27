<script lang="ts">
  import type { ReleaseDetail } from "../../shared/api.ts";
  import { formatDuration } from "../../shared/display.ts";
  import { buildPlaylist, entryForPosition } from "../../shared/playlist.ts";
  import type { TrackMark } from "../../shared/types.ts";
  import Stamp from "../components/Stamp.svelte";
  import type { TriagePlayer } from "../player/triage-player.svelte.ts";

  let {
    detail,
    player,
    onplay,
  }: { detail: ReleaseDetail; player: TriagePlayer; onplay: (entry: number) => void } = $props();

  const MARK_COPY: Record<TrackMark, string> = { keep: "keep", meh: "meh", candidate: "bo!" };

  const entries = $derived(buildPlaylist(detail));
  const strays = $derived(
    entries.map((e, i) => ({ e, i })).filter(({ e }) => e.track === null),
  );
  const blockedPositions = $derived(
    new Set(
      detail.videos
        .filter((v) => !v.embeddable && v.matchedPosition !== null)
        .map((v) => v.matchedPosition!),
    ),
  );
  const mine = $derived(player.release?.release.id === detail.release.id);
  const playingIndex = $derived(mine ? player.current : null);
  const releaseArtist = $derived(detail.release.artistDisplay);

  let list = $state<HTMLOListElement | null>(null);

  $effect(() => {
    void playingIndex;
    list?.querySelector(".playing")?.scrollIntoView({ block: "nearest" });
  });

  function videoState(position: string): "playing" | "video" | "failed" | "blocked" | "none" {
    const index = entryForPosition(entries, position);
    if (index === null) return blockedPositions.has(position) ? "blocked" : "none";
    if (index === playingIndex) return "playing";
    const entry = entries[index]!;
    const allFailed = entries
      .filter((e) => e.track?.position === position)
      .every((e) => player.failed.has(e.video.videoId));
    return allFailed || player.failed.has(entry.video.videoId) ? "failed" : "video";
  }

  const GLYPH = { playing: "▶", video: "●", failed: "×", blocked: "×", none: "" } as const;
  const HINT = {
    playing: "playing",
    video: "has a video",
    failed: "video would not play",
    blocked: "video blocks embedding",
    none: "no video",
  } as const;
</script>

<ol class="tracklist" bind:this={list} aria-label="Tracklist">
  {#each detail.tracks as track (track.seq)}
    {#if track.position === ""}
      <li class="heading">{track.title}</li>
    {:else}
      {@const state = videoState(track.position)}
      {@const index = entryForPosition(entries, track.position)}
      {@const heardNow = mine && player.heardNow.has(track.position)}
      <li
        class="row {state}"
        class:heard={track.heard && state !== "playing"}
        class:playing={state === "playing"}
      >
        <button
          type="button"
          tabindex="-1"
          disabled={index === null || state === "failed"}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => index !== null && onplay(index)}
        >
          <span class="pos">{track.position}</span>
          <span class="glyph" title={HINT[state]}>{GLYPH[state]}<span class="visually-hidden">{HINT[state]}</span></span>
          <span class="name">
            {#if track.artistDisplay && track.artistDisplay !== releaseArtist}
              <span class="by">{track.artistDisplay} –</span>
            {/if}
            {track.title}
          </span>
          <span class="tags">
            {#if track.heard && !heardNow}<span class="note">heard</span>{/if}
            {#if heardNow && state !== "playing"}<span class="note">played</span>{/if}
            {#if state === "failed" || state === "blocked"}<span class="note">no embed</span>{/if}
            {#if track.mark}<Stamp text={MARK_COPY[track.mark]} tone={track.mark === "meh" ? "dust" : "flyer"} size="sm" seed={track.seq + detail.release.id} />{/if}
          </span>
          <span class="dur">{formatDuration(track.durationSeconds)}</span>
        </button>
      </li>
    {/if}
  {/each}
  {#if strays.length > 0}
    <li class="heading">Other videos</li>
    {#each strays as { e, i } (e.video.videoId)}
      {@const playing = i === playingIndex}
      {@const failed = player.failed.has(e.video.videoId)}
      <li class="row" class:playing class:failed>
        <button
          type="button"
          tabindex="-1"
          disabled={failed}
          onmousedown={(ev) => ev.preventDefault()}
          onclick={() => onplay(i)}
        >
          <span class="pos"></span>
          <span class="glyph">{playing ? "▶" : failed ? "×" : "●"}</span>
          <span class="name">{e.video.title || e.video.videoId}</span>
          <span class="tags">{#if failed}<span class="note">no embed</span>{/if}</span>
          <span class="dur">{formatDuration(e.video.durationSeconds)}</span>
        </button>
      </li>
    {/each}
  {/if}
</ol>

<style>
  .tracklist {
    list-style: none;
    margin: 0;
    padding: 0 8px 0 0;
    overflow-y: auto;
    min-height: 0;
    border-top: 1px solid var(--groove);
    scrollbar-width: thin;
    scrollbar-color: var(--groove) transparent;
  }
  .heading {
    padding: 14px 0 4px 3.9em;
    color: var(--dust);
    font-size: var(--text-sm);
  }
  .row button {
    display: grid;
    grid-template-columns: 3.4em 1.6em minmax(0, 1fr) auto 3.6em;
    align-items: baseline;
    width: 100%;
    padding: 7px 0;
    border: 0;
    border-bottom: 1px solid color-mix(in srgb, var(--groove) 55%, transparent);
    background: none;
    text-align: left;
    line-height: 1.35;
  }
  .row button:disabled {
    cursor: default;
  }
  .row button:not(:disabled):hover .name {
    text-decoration: underline;
    text-decoration-color: var(--dust);
    text-underline-offset: 3px;
  }
  .pos {
    color: var(--faded);
    font-weight: 600;
  }
  .glyph {
    color: var(--faded);
    font-size: 0.8em;
  }
  .none .glyph,
  .none .name {
    color: var(--faded);
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .by {
    color: var(--faded);
  }
  .tags {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-left: 12px;
  }
  .note {
    color: var(--dust);
    font-size: var(--text-sm);
  }
  .dur {
    color: var(--faded);
    text-align: right;
  }
  .heard .pos,
  .heard .name,
  .heard .by,
  .heard .glyph,
  .heard .dur {
    color: var(--dust);
  }
  .failed .glyph,
  .blocked .glyph {
    color: var(--dust);
  }
  .playing button {
    box-shadow: inset 3px 0 0 var(--flyer);
  }
  .playing .pos {
    padding-left: 12px;
  }
  .playing .glyph {
    color: var(--flyer);
  }
  .playing .name {
    color: var(--paper);
    font-weight: 600;
  }
</style>
