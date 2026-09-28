<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { withLabelExcluded } from "../../shared/config.ts";
  import { discogsReleaseUrl } from "../../shared/discogs-urls.ts";
  import { formatCount } from "../../shared/display.ts";
  import type { TrackMark } from "../../shared/types.ts";
  import { youtubeSearchUrl } from "../../shared/youtube.ts";
  import { api } from "../api.ts";
  import Key from "../components/Key.svelte";
  import Stamp from "../components/Stamp.svelte";
  import {
    hasCommandModifier,
    isTyping,
    pastedVideoLink,
    type TriageStatus,
    VERDICT_KEYS,
  } from "../keymap.ts";
  import { TriagePlayer } from "../player/triage-player.svelte.ts";
  import { navigate, openExternal } from "../router.svelte.ts";
  import { errorMessage, settings, stats, ui } from "../stores.svelte.ts";
  import PlayerPanel from "../triage/PlayerPanel.svelte";
  import ReleaseFacts from "../triage/ReleaseFacts.svelte";
  import { TriageSession } from "../triage/session.svelte.ts";
  import Slip from "../triage/Slip.svelte";
  import Tracklist from "../triage/Tracklist.svelte";
  import NoteLine from "../triage/NoteLine.svelte";
  import VerdictBar from "../triage/VerdictBar.svelte";

  let { active }: { active: boolean } = $props();

  const session = new TriageSession(api, { setLabelHidden });

  /** Saves the queue filters with the label left out or let back in; the queue restarts. */
  async function setLabelHidden(label: string, hidden: boolean): Promise<void> {
    const config = settings.value;
    if (!config) throw new Error("the settings have not loaded");
    await settings.save({ ...config, filters: withLabelExcluded(config.filters, label, hidden) });
  }
  onDestroy(() => session.destroy());
  const player = new TriagePlayer(api, () => settings.value?.player.startAtFraction ?? 0.5);
  const seekStep = $derived(settings.value?.player.seekStepSeconds ?? 10);
  const startAt = $derived(settings.value?.player.startAtFraction ?? 0.5);
  const hasMaybeList = $derived((settings.value?.discogs.maybeListId ?? null) !== null);
  const detailError = $derived(
    session.current ? (session.detailErrors.get(session.current.id) ?? null) : null,
  );

  let apiGeneration = api.generation;

  // (Re)start the queue once settings are known and after every save: filters may have changed.
  $effect(() => {
    const config = settings.value;
    void settings.version;
    if (!config) return;
    untrack(() => {
      if (api.generation !== apiGeneration) {
        apiGeneration = api.generation;
        player.forgetHeard();
      }
      void session.start(config.queue.limit, { enrichAhead: config.discogs.enrichAhead });
    });
  });

  // Snoozed records handed over by Twelves.
  $effect(() => {
    const items = ui.snoozedRound;
    if (!items) return;
    untrack(() => {
      ui.snoozedRound = null;
      session.startRound(items);
    });
  });

  let loadingSnoozed = $state(false);

  async function hearSnoozed(): Promise<void> {
    if (loadingSnoozed) return;
    loadingSnoozed = true;
    try {
      session.startRound((await api.getTwelves({ status: ["snoozed"] })).items.toReversed());
    } catch (event) {
      session.showFlash(`The snoozed records did not load: ${errorMessage(event)}`);
    } finally {
      loadingSnoozed = false;
    }
  }

  /** E opened the note on the current record. */
  let editingNote = $state(false);
  const note = $derived(session.current ? session.noteFor(session.current) : null);

  // A verdict or N moves on; a half-written note stays with the record it was for. The key, not
  // the item, decides: enrichment replaces the item with fresh market data.
  const currentKey = $derived(session.current?.triageKey ?? null);
  $effect(() => {
    void currentKey;
    editingNote = false;
  });

  function saveNote(text: string): void {
    if (session.current) session.setNote(session.current, text);
    editingNote = false;
  }

  const snoozedCount = $derived(stats.value?.verdicts.snoozed ?? 0);
  const noReleases = $derived(stats.value !== null && stats.value.universe.releases === 0);
  const nothingMatches = $derived(
    stats.value !== null &&
      stats.value.universe.releases > 0 &&
      stats.value.universe.filteredKeys === 0,
  );

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
    if (!session.current) return;
    if (status === "maybe" && !hasMaybeList) {
      session.showFlash("M needs your Discogs Maybe list: pick it in Settings, under Discogs.");
      return;
    }
    session.judge(status);
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
      const config = settings.value;
      void session.start(config.queue.limit, { enrichAhead: config.discogs.enrichAhead });
      return true;
    }
    if (session.current && detailError) {
      session.retryDetail(session.current.id);
      return true;
    }
    return false;
  }

  const TRACK_MARK_KEYS: Record<string, TrackMark> = { k: "keep", m: "meh", c: "candidate" };
  const ACTIONS: Record<string, () => void> = {
    " ": () => player.toggle(),
    j: () => player.nextTrack(),
    k: () => player.previousTrack(),
    o: () => openReleaseLink("discogs"),
    s: () => openReleaseLink("youtube"),
    n: () => session.pass(),
    z: () => session.undo(),
    x: () => void session.hideLabel(),
    e: () => {
      if (session.current) editingNote = true;
    },
  };

  function openReleaseLink(site: "discogs" | "youtube"): void {
    const item = session.current;
    if (!item) return;
    const url =
      site === "discogs"
        ? discogsReleaseUrl(item.id)
        : youtubeSearchUrl(`${item.artistDisplay} ${item.title}`);
    openExternal(url);
  }

  /** Returns true when the key was a triage shortcut. */
  function handle(event: KeyboardEvent): boolean {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const mark = event.shiftKey ? TRACK_MARK_KEYS[key] : undefined;
    if (mark) {
      if (!event.repeat) markPlaying(mark);
      return true;
    }
    if (key === "ArrowLeft" || key === "ArrowRight") {
      player.seekBy(key === "ArrowLeft" ? -seekStep : seekStep);
      return true;
    }
    // Holding a key down must not judge a run of releases.
    if (event.repeat) return /^[ jknozsex1-9radmc]$/.test(key);
    return runShortcut(key);
  }

  function runShortcut(key: string): boolean {
    const action = ACTIONS[key];
    if (action) {
      action();
      return true;
    }
    if (key === "Enter") return retry();
    if (key === "Escape") {
      if (!session.round) return false;
      session.endRound();
      return true;
    }
    if (/^[1-9]$/.test(key)) {
      player.jumpTo(Number(key) / 10);
      return true;
    }
    const verdict = VERDICT_KEYS.find((verdict) => verdict.key.toLowerCase() === key);
    if (!verdict) return false;
    judge(verdict.status);
    return true;
  }

  /** A YouTube link pasted anywhere on the page belongs to the release on screen. */
  function onpaste(event: ClipboardEvent): void {
    if (!active || ui.helpOpen || !session.current) return;
    const link = pastedVideoLink(event);
    if (link === null) return;
    event.preventDefault();
    void session.attachVideo(link);
  }

  function onkeydown(event: KeyboardEvent): void {
    if (
      !active ||
      ui.helpOpen ||
      event.defaultPrevented ||
      isTyping(event) ||
      hasCommandModifier(event)
    )
      return;
    if (handle(event)) event.preventDefault();
  }
</script>

<svelte:window {onkeydown} {onpaste} />

<div class="triage">
  <!-- The live region stays in the DOM so the banner is announced when a round starts. -->
  <div aria-live="polite">
    {#if session.round}
      <p class="round">
        <span>
          Hearing snoozed records again: <b>{formatCount(session.upcoming.length)}</b> of
          {formatCount(session.round.total)} left. A verdict replaces the snooze; <Key label="N" size="sm" /> leaves it.
        </span>
        <button type="button" aria-keyshortcuts="Escape" onclick={() => session.endRound()}>
          <Key label="Esc" size="sm" aria-hidden="true" /> back to the queue
        </button>
      </p>
    {/if}
  </div>
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
      {:else if session.finished && noReleases}
        <div class="state">
          <p class="headline">No releases loaded yet.</p>
          <p class="quiet">
            Digga digs a Discogs releases dump. Download the latest
            <code>discogs_YYYYMMDD_releases.xml.gz</code> from data.discogs.com into
            <code>data/dumps/</code>, then load it with
            <code>npm run digga -- dump load data/dumps/…</code> or from Jobs in settings. The styles and
            years it keeps are under Universe.
          </p>
          <p class="actions">
            <button type="button" aria-keyshortcuts="," onclick={() => navigate("settings")}>
              <Key label="," aria-hidden="true" /> settings
            </button>
          </p>
        </div>
      {:else if session.finished && nothingMatches}
        <div class="state">
          <p class="headline">Your filters match no records.</p>
          <p class="quiet">
            {formatCount(stats.value?.universe.keys ?? 0)} records are loaded. Widen the years, formats or
            countries in settings{settings.value?.filters.skipWithoutVideos
              ? ", or let in releases without videos"
              : ""}.
          </p>
          <p class="actions">
            <button type="button" aria-keyshortcuts="," onclick={() => navigate("settings")}>
              <Key label="," aria-hidden="true" /> settings
            </button>
          </p>
        </div>
      {:else if session.finished}
        <div class="state finished">
          <Stamp text="all dug" tone="accent" size="xl" seed={1} slam />
          <p class="headline">Every release under your filters has a verdict.</p>
          <p class="quiet">
            {stats.value ? `${formatCount(stats.value.dug)} dug so far.` : ""}
            Widen the years, formats or countries in settings to dig further.
          </p>
          <p class="actions">
            {#if session.passed.length > 0}
              <button type="button" aria-keyshortcuts="N" onclick={() => session.goRound()}>
                <Key label="N" primary aria-hidden="true" /> go round the {formatCount(session.passed.length)} you passed
              </button>
            {/if}
            {#if snoozedCount > 0}
              <button type="button" disabled={loadingSnoozed} onclick={() => void hearSnoozed()}>
                hear the {formatCount(snoozedCount)} snoozed again
              </button>
            {/if}
            <button type="button" aria-keyshortcuts="," onclick={() => navigate("settings")}>
              <Key label="," aria-hidden="true" /> settings
            </button>
          </p>
        </div>
      {:else if session.current}
        <div class="head">
          <ReleaseFacts
            item={session.current}
            detail={session.currentDetail}
            enriching={(settings.value?.discogs.enrichAhead ?? 0) > 0}
          />
          {#if note || editingNote}
            <NoteLine {note} editing={editingNote} onsave={saveNote} oncancel={() => (editingNote = false)} />
          {/if}
        </div>
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
        nextVideos={session.nextDetail?.videos.length ?? null}
        nextReady={player.nextReady}
        sandbox={settings.sandbox}
        inRound={session.round !== null}
      />
      <p class="flash" role="status">{session.flash ?? ""}</p>
    </aside>
  </div>

  <VerdictBar
    disabled={!session.current}
    {hasMaybeList}
    onjudge={judge}
    onpass={() => session.pass()}
    onhidelabel={() => void session.hideLabel()}
    onundo={() => session.undo()}
    onhelp={() => (ui.helpOpen = true)}
  />
</div>

<style>
  .triage {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .round {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 10px 40px;
    border-bottom: 1px solid var(--rule);
    background: var(--surface);
    box-shadow: inset 3px 0 0 var(--accent);
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .round b {
    color: var(--fg);
    font-weight: 600;
  }
  .round button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex: none;
    border: 0;
    background: none;
    padding: 0;
  }
  .desk {
    flex: 1;
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
  .head {
    display: grid;
    gap: 12px;
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
    color: var(--fg-muted);
    max-width: 60ch;
  }
  code {
    font-family: inherit;
    color: var(--fg);
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
  .actions button:disabled {
    opacity: 0.5;
  }
  .flash {
    min-height: 1.4em;
    color: var(--accent);
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
