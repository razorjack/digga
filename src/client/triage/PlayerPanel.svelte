<script lang="ts">
  import { onMount } from "svelte";
  import type { QueueItem, ReleaseDetail } from "../../shared/api.ts";
  import { formatDuration } from "../../shared/display.ts";
  import Key from "../components/Key.svelte";
  import type { TriagePlayer } from "../player/triage-player.svelte.ts";

  let {
    player,
    item,
    detail,
    detailError,
    startAtFraction,
    seekStepSeconds,
  }: {
    player: TriagePlayer;
    item: QueueItem | null;
    detail: ReleaseDetail | null;
    detailError: string | null;
    startAtFraction: number;
    seekStepSeconds: number;
  } = $props();

  let hostA = $state<HTMLDivElement | null>(null);
  let hostB = $state<HTMLDivElement | null>(null);

  onMount(() => {
    if (hostA && hostB) void player.mount([hostA, hostB]);
    return () => player.destroy();
  });

  const mine = $derived(detail !== null && player.release?.release.id === detail.release.id);
  const entry = $derived(mine ? player.entry : null);
  const videoCount = $derived(detail?.videos.length ?? item?.videoCount ?? 0);
  const failedAll = $derived(
    detail !== null &&
      detail.videos.length > 0 &&
      detail.videos.every((v) => !v.embeddable || player.failed.has(v.videoId)),
  );

  type Overlay =
    | { kind: "message"; title: string; body?: string }
    | { kind: "gesture" }
    | { kind: "no_audio"; title: string };

  const overlay = $derived.by((): Overlay | null => {
    if (!item) return { kind: "message", title: "Nothing to play." };
    if (detailError) return { kind: "message", title: "The release did not load.", body: detailError };
    if (player.status === "unavailable")
      return { kind: "message", title: "The YouTube player is unavailable.", body: player.notice ?? undefined };
    if (!detail) return { kind: "message", title: "Loading the release…" };
    if (videoCount === 0) return { kind: "no_audio", title: "No videos on this release." };
    if (failedAll || (mine && player.status === "no_audio"))
      return {
        kind: "no_audio",
        title:
          videoCount === 1
            ? "Its only video won't play here."
            : `None of its ${videoCount} videos will play here.`,
      };
    if (player.status === "starting") return { kind: "message", title: "Starting the player…" };
    if (mine && player.status === "needs_gesture") return { kind: "gesture" };
    return null;
  });

  const progress = $derived(player.duration > 0 ? Math.min(1, player.time / player.duration) : 0);
  const statusCopy = $derived(
    {
      starting: "starting",
      idle: "",
      loading: "cueing up",
      playing: "playing",
      paused: "paused",
      ended: "end of the tracks",
      no_audio: "no audio",
      needs_gesture: "waiting for Space",
      unavailable: "player unavailable",
    }[player.status],
  );

  function seekFromBar(e: MouseEvent): void {
    const bar = e.currentTarget as HTMLElement;
    const rect = bar.getBoundingClientRect();
    player.jumpTo(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
  }
</script>

<section class="player" aria-label="Player">
  <div class="frame">
    <div class="deck" class:shown={player.active === 0} bind:this={hostA}></div>
    <div class="deck" class:shown={player.active === 1} bind:this={hostB}></div>
    {#if overlay}
      <div class="overlay" class:solid={overlay.kind !== "gesture"}>
        {#if overlay.kind === "gesture"}
          <p class="big"><Key label="Space" primary size="lg" /> start listening</p>
          <p class="small">The browser holds back sound until you press a key here.</p>
        {:else if overlay.kind === "no_audio"}
          <p class="title">{overlay.title}</p>
          <p class="options">
            <span><Key label="S" /> search YouTube</span>
            <span><Key label="D" /> no audio, off the queue</span>
          </p>
          <p class="small">Verdict keys still work.</p>
        {:else}
          <p class="title">{overlay.title}</p>
          {#if overlay.body}<p class="small">{overlay.body}</p>{/if}
        {/if}
      </div>
    {/if}
  </div>

  <div class="now">
    <p class="track">
      {#if entry?.track}
        <span class="pos">{entry.track.position}</span>{entry.track.title}
      {:else if entry}
        {entry.video.title}
      {:else}
        <span class="quiet">Nothing playing</span>
      {/if}
    </p>
    <p class="time">
      <span class="state">{statusCopy}</span>
      {formatDuration(player.time)}<span class="quiet">&nbsp;/ {formatDuration(player.duration)}</span>
    </p>
  </div>

  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="bar"
    role="slider"
    tabindex="-1"
    aria-label="Position in the track"
    aria-valuemin={0}
    aria-valuemax={Math.round(player.duration)}
    aria-valuenow={Math.round(player.time)}
    onclick={seekFromBar}
  >
    <div class="fill" style:width="{progress * 100}%"></div>
    <div class="start" style:left="{startAtFraction * 100}%" title="Start point"></div>
  </div>

  <div class="keys">
    <span><Key label="Space" /> play</span>
    <span><Key label="J" /><Key label="K" /> track</span>
    <span><Key label="←" /><Key label="→" /> {seekStepSeconds} s</span>
    <span><Key label="1–9" /> jump</span>
    <span><Key label="O" /> discogs</span>
  </div>

  <p class="notice" aria-live="polite">{player.notice ?? ""}</p>
</section>

<style>
  .player {
    display: grid;
    gap: 10px;
  }
  .frame {
    position: relative;
    aspect-ratio: 16 / 9;
    background: var(--sleeve);
    border: 1px solid var(--groove);
    overflow: hidden;
  }
  .deck {
    position: absolute;
    inset: 0;
    opacity: 0;
    pointer-events: none;
  }
  .deck.shown {
    opacity: 1;
  }
  /* The embed never takes focus or clicks: every control is a key or a button here. */
  .deck :global(iframe) {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    pointer-events: none;
  }
  .overlay {
    position: absolute;
    inset: 0;
    display: grid;
    align-content: center;
    justify-items: start;
    gap: 12px;
    padding: 28px;
    background: color-mix(in srgb, var(--ground) 70%, transparent);
  }
  .overlay.solid {
    background: var(--sleeve);
  }
  .title {
    font-family: var(--display);
    font-size: var(--text-lg);
    line-height: 1.3;
  }
  .big {
    display: flex;
    align-items: center;
    gap: 14px;
    font-family: var(--display);
    font-size: var(--text-xl);
  }
  .small {
    color: var(--faded);
    font-size: var(--text-sm);
  }
  .options {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 24px;
  }
  .options span,
  .keys span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .now {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 16px;
    min-width: 0;
  }
  .track {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .pos {
    color: var(--flyer);
    margin-right: 0.8em;
  }
  .time {
    flex: none;
    color: var(--paper);
  }
  .state {
    color: var(--faded);
    margin-right: 1em;
  }
  .quiet {
    color: var(--dust);
  }
  .bar {
    position: relative;
    height: 14px;
    cursor: pointer;
  }
  .bar::before {
    content: "";
    position: absolute;
    inset: 5px 0;
    background: var(--groove);
  }
  .fill {
    position: absolute;
    left: 0;
    top: 5px;
    bottom: 5px;
    background: var(--flyer);
  }
  .start {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--paper);
    opacity: 0.6;
  }
  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 18px;
    color: var(--faded);
    font-size: var(--text-sm);
  }
  .notice {
    min-height: 1.4em;
    color: var(--flyer);
    font-size: var(--text-sm);
  }
</style>
