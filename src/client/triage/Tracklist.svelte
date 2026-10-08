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

  const MARK_COPY: Record<TrackMark, string> = { keep: "keep", meh: "meh", candidate: "grail" };

  const entries = $derived(buildPlaylist(detail));
  const strays = $derived(
    entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.track === null),
  );
  const blockedPositions = $derived(
    new Set(
      detail.videos
        .filter((v) => !v.embeddable && v.matchedPosition !== null)
        .map((v) => v.matchedPosition!),
    ),
  );
  const mine = $derived(player.release?.release.id === detail.release.id);
  const currentIndex = $derived(mine ? player.current : null);
  /** The current entry plays, or waits: cued before Space, loading or paused. */
  const currentState = $derived(player.status === "playing" ? "playing" : "cued");
  const releaseArtist = $derived(detail.release.artistDisplay);

  let list = $state<HTMLOListElement | null>(null);

  $effect(() => {
    void currentIndex;
    list?.querySelector("[aria-current]")?.scrollIntoView({ block: "nearest" });
  });

  type VideoState = "playing" | "cued" | "video" | "failed" | "blocked" | "none";

  function videoState(position: string): VideoState {
    const index = entryForPosition(entries, position);
    if (index === null) return blockedPositions.has(position) ? "blocked" : "none";
    if (index === currentIndex) return currentState;
    const entry = entries[index]!;
    const allFailed = entries
      .filter((e) => e.track?.position === position)
      .every((entry) => player.failed.has(entry.video.videoId));
    return allFailed || player.failed.has(entry.video.videoId) ? "failed" : "video";
  }

  function strayState(index: number, failed: boolean): "playing" | "cued" | "failed" | "video" {
    if (index === currentIndex) return currentState;
    return failed ? "failed" : "video";
  }

  const isCurrent = (state: VideoState) => state === "playing" || state === "cued";

  const GLYPH = { playing: "▶", cued: "●", video: "●", failed: "×", blocked: "×", none: "" } as const;
  const HINT = {
    playing: "playing",
    cued: "cued",
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
      {@const heard = track.heard || (player.heardKeys.has(track.heardKey) && !heardNow)}
      <li data-position={track.position} class="row {state}" class:heard={heard && !isCurrent(state)}>
        <button
          type="button"
          tabindex="-1"
          disabled={index === null || state === "failed"}
          aria-current={isCurrent(state) ? "true" : undefined}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => index !== null && onplay(index)}
        >
          <span class="pos">{track.position}</span>
          <span class="glyph" title={HINT[state]}>
            <span aria-hidden="true">{GLYPH[state]}</span><span class="visually-hidden">{HINT[state]}</span>
          </span>
          <span class="name">
            {#if track.artistDisplay && track.artistDisplay !== releaseArtist}
              <span class="by">{track.artistDisplay} –</span>
            {/if}
            {track.title}
          </span>
          <span class="tags">
            {#if heard && !heardNow}<span class="note">heard</span>{/if}
            {#if heardNow && !isCurrent(state)}<span class="note">played</span>{/if}
            {#if state === "failed" || state === "blocked"}<span class="note">no embed</span>{/if}
            {#if track.mark}<Stamp text={MARK_COPY[track.mark]} tone={track.mark === "meh" ? "muted" : "accent"} size="sm" seed={track.seq + detail.release.id} />{/if}
          </span>
          <span class="dur">{formatDuration(track.durationSeconds)}</span>
        </button>
      </li>
    {/if}
  {/each}
  {#if strays.length > 0}
    <li class="heading strays">Other videos</li>
    {#each strays as { entry, index } (entry.video.videoId)}
      {@const failed = player.failed.has(entry.video.videoId)}
      {@const stray = strayState(index, failed)}
      <li data-video-id={entry.video.videoId} class="row" class:failed>
        <button
          type="button"
          tabindex="-1"
          disabled={failed}
          aria-current={isCurrent(stray) ? "true" : undefined}
          onmousedown={(ev) => ev.preventDefault()}
          onclick={() => onplay(index)}
        >
          <span class="pos"></span>
          <span class="glyph" title={HINT[stray]}>
            <span aria-hidden="true">{GLYPH[stray]}</span><span class="visually-hidden">{HINT[stray]}</span>
          </span>
          <span class="name">{entry.video.title || entry.video.videoId}</span>
          <span class="tags">{#if failed}<span class="note">no embed</span>{/if}</span>
          <span class="dur">{formatDuration(entry.video.durationSeconds)}</span>
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
    border-top: 1px solid var(--rule);
    scrollbar-width: thin;
    scrollbar-color: var(--rule) transparent;
  }
  .heading {
    padding: 14px 0 4px 3.9em;
    color: var(--fg-faint);
    font-size: var(--text-sm);
  }
  /* Other videos are not the record's sides, so they start a list of their own. */
  .heading.strays {
    padding-top: var(--space-block);
  }
  .row button {
    display: grid;
    grid-template-columns: 3.4em 1.6em minmax(0, 1fr) auto 3.6em;
    align-items: baseline;
    width: 100%;
    padding: 7px 0;
    border: 0;
    border-bottom: 1px solid var(--rule-soft);
    background: none;
    text-align: left;
    line-height: 1.35;
  }
  .row button:disabled {
    cursor: default;
  }
  .row button:not(:disabled):hover .name {
    text-decoration: underline;
    text-decoration-color: var(--fg-faint);
    text-underline-offset: 3px;
  }
  /* Indented to clear the current row's accent bar, so the position does not shift. */
  .pos {
    padding-left: 12px;
    color: var(--fg-muted);
    font-weight: 600;
  }
  .glyph {
    color: var(--fg-muted);
    font-size: 0.8em;
  }
  .none .glyph,
  .none .name {
    color: var(--fg-muted);
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .by {
    color: var(--fg-muted);
  }
  .tags {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-left: 12px;
  }
  .note {
    color: var(--fg-faint);
    font-size: var(--text-sm);
  }
  .dur {
    color: var(--fg-muted);
    text-align: right;
  }
  .heard .pos,
  .heard .name,
  .heard .by,
  .heard .glyph,
  .heard .dur {
    color: var(--fg-faint);
  }
  .failed .glyph,
  .blocked .glyph {
    color: var(--fg-faint);
  }
  button[aria-current="true"] {
    box-shadow: inset 3px 0 0 var(--accent-mark);
  }
  button[aria-current="true"] .glyph {
    color: var(--fg-accent);
  }
  button[aria-current="true"] .name {
    color: var(--fg);
    font-weight: 600;
  }
</style>
