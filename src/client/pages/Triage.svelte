<script lang="ts">
  import { untrack } from "svelte";
  import { discogsReleaseUrl } from "../../shared/discogs-urls.ts";
  import { formatCount } from "../../shared/display.ts";
  import type { TrackMark } from "../../shared/types.ts";
  import { youtubeSearchUrl } from "../../shared/youtube.ts";
  import { api } from "../api.ts";
  import Key from "../components/Key.svelte";
  import Stamp from "../components/Stamp.svelte";
  import { hasCommandModifier, isTyping, type TriageStatus, VERDICT_KEYS } from "../keymap.ts";
  import { TriagePlayer } from "../player/triage-player.svelte.ts";
  import { navigate, openExternal } from "../router.svelte.ts";
  import { rinsedCount, settings, stats, ui } from "../stores.svelte.ts";
  import PlayerPanel from "../triage/PlayerPanel.svelte";
  import ReleaseFacts from "../triage/ReleaseFacts.svelte";
  import { TriageSession } from "../triage/session.svelte.ts";
  import Slip from "../triage/Slip.svelte";
  import Tracklist from "../triage/Tracklist.svelte";
  import VerdictBar from "../triage/VerdictBar.svelte";

  let { active }: { active: boolean } = $props();

  const session = new TriageSession();
  const player = new TriagePlayer(api, () => settings.value?.player.startAtFraction ?? 0.5);
  const seekStep = $derived(settings.value?.player.seekStepSeconds ?? 10);
  const startAt = $derived(settings.value?.player.startAtFraction ?? 0.5);
  const detailError = $derived(
    session.current ? (session.detailErrors.get(session.current.id) ?? null) : null,
  );

  // (Re)start the queue once settings are known and after every save: filters may have changed.
  $effect(() => {
    const config = settings.value;
    void settings.version;
    if (config) untrack(() => void session.start(config.queue.limit));
  });

  $effect(() => {
    const detail = session.currentDetail;
    const next = session.nextDetail;
    untrack(() => player.show(detail, next));
  });

  $effect(() => {
    const hidden = !active;
    untrack(() => player.suspend(hidden));
  });

  function judge(status: TriageStatus): void {
    if (session.current) session.judge(status);
  }

  function markPlaying(mark: TrackMark): void {
    const track = player.entry?.track;
    const release = player.release;
    if (!track || !release) {
      session.showFlash("Track marks go on the playing track; nothing is playing.");
      return;
    }
    session.markTrack(release.release.id, track.position, mark);
  }

  /** Returns false when there is nothing to retry, so Enter keeps its usual meaning. */
  function retry(): boolean {
    if (session.status === "error" && settings.value) {
      void session.start(settings.value.queue.limit);
      return true;
    }
    if (session.current && detailError) {
      session.retryDetail(session.current.id);
      return true;
    }
    return false;
  }

  /** Returns true when the key was a triage shortcut. */
  function handle(e: KeyboardEvent): boolean {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const item = session.current;
    if (e.shiftKey && (key === "k" || key === "m" || key === "c")) {
      if (!e.repeat) markPlaying(key === "k" ? "keep" : key === "m" ? "meh" : "candidate");
      return true;
    }
    switch (key) {
      case "ArrowLeft":
        player.seekBy(-seekStep);
        return true;
      case "ArrowRight":
        player.seekBy(seekStep);
        return true;
    }
    // Holding a key down must not judge a run of releases.
    if (e.repeat) return /^[ jknozs1-9radmc]$/.test(key);
    switch (key) {
      case " ":
        player.toggle();
        return true;
      case "j":
        player.nextTrack();
        return true;
      case "k":
        player.previousTrack();
        return true;
      case "o":
        if (item) openExternal(discogsReleaseUrl(item.id));
        return true;
      case "s":
        if (item) openExternal(youtubeSearchUrl(`${item.artistDisplay} ${item.title}`));
        return true;
      case "n":
        session.pass();
        return true;
      case "z":
        session.undo();
        return true;
      case "Enter":
        return retry();
    }
    if (/^[1-9]$/.test(key)) {
      player.jumpTo(Number(key) / 10);
      return true;
    }
    const verdict = VERDICT_KEYS.find((v) => v.key.toLowerCase() === key);
    if (verdict) {
      judge(verdict.status);
      return true;
    }
    return false;
  }

  function onkeydown(e: KeyboardEvent): void {
    if (!active || ui.helpOpen || e.defaultPrevented || isTyping(e) || hasCommandModifier(e)) return;
    if (handle(e)) e.preventDefault();
  }
</script>

<svelte:window {onkeydown} />

<div class="triage">
  <div class="desk">
    <div class="record">
      {#if session.status === "error"}
        <div class="state">
          <p class="headline">The queue did not load.</p>
          <p class="quiet">{session.error}</p>
          <p class="quiet">
            Check that the server runs (<code>npm run digga -- serve</code>), then press
            <Key label="Enter" /> to try again.
          </p>
        </div>
      {:else if session.finished}
        <div class="state finished">
          <Stamp text="rinsed" tone="flyer" size="xl" seed={1} slam />
          <p class="headline">Every release under your filters has a verdict.</p>
          <p class="quiet">
            {stats.value ? `${formatCount(rinsedCount(stats.value))} rinsed so far.` : ""}
            Widen the years, formats or countries in settings to dig further.
          </p>
          <p class="actions">
            {#if session.passed.length > 0}
              <button type="button" onclick={() => session.goRound()}>
                <Key label="N" primary /> go round the {formatCount(session.passed.length)} you passed
              </button>
            {/if}
            <button type="button" onclick={() => navigate("settings")}><Key label="," /> settings</button>
          </p>
        </div>
      {:else if session.current}
        <ReleaseFacts item={session.current} detail={session.currentDetail} />
        {#if session.currentDetail}
          <Tracklist detail={session.currentDetail} {player} onplay={(i) => player.playEntry(i)} />
        {:else if detailError}
          <p class="state quiet">
            The tracklist did not load: {detailError}. <Key label="Enter" /> tries again.
          </p>
        {:else}
          <p class="state quiet">Loading the tracklist…</p>
        {/if}
      {:else}
        <p class="state quiet">Loading the queue…</p>
      {/if}
    </div>

    <aside class="side">
      <PlayerPanel
        {player}
        item={session.current}
        detail={session.currentDetail}
        {detailError}
        startAtFraction={startAt}
        seekStepSeconds={seekStep}
      />
      <Slip
        slip={session.slip}
        next={session.next}
        nextReady={player.nextReady}
        sandbox={api.mode === "sandbox"}
      />
      <p class="flash" aria-live="assertive">{session.flash ?? ""}</p>
    </aside>
  </div>

  <VerdictBar
    disabled={!session.current}
    onjudge={judge}
    onpass={() => session.pass()}
    onundo={() => session.undo()}
    onhelp={() => (ui.helpOpen = true)}
  />
</div>

<style>
  .triage {
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    height: 100%;
  }
  .desk {
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(360px, 1fr);
    gap: 48px;
    padding: 32px 40px 16px;
    min-height: 0;
  }
  .record {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 24px;
    min-height: 0;
    min-width: 0;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: none;
  }
  .state {
    display: grid;
    align-content: start;
    justify-items: start;
    gap: 14px;
    padding-top: 24px;
  }
  .finished {
    gap: 22px;
    padding-top: 56px;
  }
  .headline {
    font-family: var(--display);
    font-size: var(--text-xl);
    line-height: 1.3;
    max-width: 24em;
  }
  .quiet {
    color: var(--faded);
    max-width: 60ch;
  }
  code {
    font-family: inherit;
    color: var(--paper);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 28px;
  }
  .actions button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 0;
    background: none;
    padding: 0;
  }
  .flash {
    min-height: 1.4em;
    color: var(--flyer);
    font-size: var(--text-sm);
  }
  @media (max-width: 980px) {
    .triage {
      height: auto;
      min-height: 100%;
    }
    .desk {
      grid-template-columns: minmax(0, 1fr);
      gap: 28px;
      padding: 20px;
    }
    .side {
      overflow: visible;
    }
  }
</style>
