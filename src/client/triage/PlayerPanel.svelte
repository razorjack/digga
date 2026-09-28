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
  let hostC = $state<HTMLDivElement | null>(null);

  onMount(() => {
    if (hostA && hostB && hostC) void player.mount([hostA, hostB, hostC]);
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
    if (detailError)
      return { kind: "message", title: "The release did not load.", body: detailError };
    if (player.status === "unavailable")
      return {
        kind: "message",
        title: "The YouTube player is unavailable.",
        body: player.notice ?? undefined,
      };
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

  const position = $derived(`${formatDuration(player.time)} of ${formatDuration(player.duration)}`);

  function seek(event: Event & { currentTarget: HTMLInputElement }): void {
    player.jumpTo(event.currentTarget.valueAsNumber / player.duration);
  }
</script>

<section class="player" aria-label="Player">
  <div class="frame">
    <!-- Inert: Tab or a click would move focus into the embed, and its keys never reach Digga. -->
    <div class="deck" class:shown={player.active === 0} inert bind:this={hostA}></div>
    <div class="deck" class:shown={player.active === 1} inert bind:this={hostB}></div>
    <div class="deck" class:shown={player.active === 2} inert bind:this={hostC}></div>
    {#if overlay}
      <div class="overlay" class:solid={overlay.kind !== "gesture"}>
        {#if overlay.kind === "gesture"}
          <p class="big"><Key label="Space" primary size="lg" /> start listening</p>
          <p class="small">The browser holds back sound until you press a key here.</p>
        {:else if overlay.kind === "no_audio"}
          <p class="title">{overlay.title}</p>
          <p class="options">
            <span><Key label="S" /> search YouTube</span>
            <span><Key label="⌘V" /> paste a YouTube link to play it</span>
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

  <div class="seek">
    <input
      type="range"
      min="0"
      max={Math.round(player.duration)}
      value={Math.floor(player.time)}
      disabled={player.duration <= 0}
      aria-label="Position in the track"
      aria-valuetext={position}
      style:--progress="{progress * 100}%"
      oninput={seek}
    />
    <div class="start" style:left="{startAtFraction * 100}%"></div>
  </div>

  <div class="keys">
    <span><Key label="Space" /> play</span>
    <span><Key label="J" /><Key label="K" /> track</span>
    <span><Key label="←" /><Key label="→" /> {seekStepSeconds} s</span>
    <span><Key label="1–9" /> jump</span>
    <span><Key label="O" /> discogs</span>
    <span><Key label="E" /> note</span>
  </div>

  <p class="notice" role="status">{player.notice ?? ""}</p>
</section>

<style>
  .player {
    display: grid;
    gap: 10px;
  }
  .frame {
    position: relative;
    aspect-ratio: 16 / 9;
    background: var(--surface);
    border: 1px solid var(--rule);
    overflow: hidden;
  }
  .deck {
    position: absolute;
    inset: 0;
    opacity: 0;
  }
  .deck.shown {
    opacity: 1;
  }
  .deck :global(iframe) {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
  }
  .overlay {
    position: absolute;
    inset: 0;
    display: grid;
    align-content: center;
    justify-items: start;
    gap: 12px;
    padding: 28px;
    background: color-mix(in srgb, var(--bg) 70%, transparent);
  }
  .overlay.solid {
    background: var(--surface);
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
    color: var(--fg-muted);
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
    color: var(--fg-accent);
    margin-right: 0.8em;
  }
  .time {
    flex: none;
    color: var(--fg);
  }
  .state {
    color: var(--fg-muted);
    margin-right: 1em;
  }
  .quiet {
    color: var(--fg-faint);
  }
  .seek {
    position: relative;
  }
  /* A plain bar: the played part in the accent over the rule color, and no thumb. */
  .seek input {
    display: block;
    width: 100%;
    height: 14px;
    margin: 0;
    appearance: none;
    background:
      linear-gradient(var(--accent-mark), var(--accent-mark)) 0 50% / var(--progress) 4px no-repeat,
      linear-gradient(var(--rule), var(--rule)) 0 50% / 100% 4px no-repeat;
    cursor: pointer;
  }
  .seek input:disabled {
    cursor: default;
  }
  .seek input::-webkit-slider-thumb {
    appearance: none;
    width: 0;
    height: 14px;
  }
  .seek input::-moz-range-thumb {
    width: 0;
    height: 14px;
    border: 0;
    background: none;
  }
  .seek input::-moz-range-track {
    background: none;
  }
  .start {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--fg);
    opacity: 0.6;
    pointer-events: none;
  }
  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 18px;
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .notice {
    min-height: 1.4em;
    color: var(--fg-accent);
    font-size: var(--text-sm);
  }
</style>
