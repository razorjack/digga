<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { type HiddenLabel, withLabelExcluded } from "../../shared/config.ts";
  import { discogsReleaseUrl } from "../../shared/discogs-urls.ts";
  import { formatCount, nounFor } from "../../shared/display.ts";
  import { sellerCopies } from "../../shared/listings.ts";
  import { newRecordsScope, SCOPE_NOUN, scopesOfRelease } from "../../shared/scope.ts";
  import { replayItemOf } from "../../shared/replay.ts";
  import type { TrackMark } from "../../shared/types.ts";
  import { youtubeSearchUrl } from "../../shared/youtube.ts";
  import { api } from "../api.ts";
  import Art from "../components/Art.svelte";
  import Flash from "../components/Flash.svelte";
  import Key from "../components/Key.svelte";
  import Stamp from "../components/Stamp.svelte";
  import {
    hasCommandModifier,
    isTyping,
    pastedVideoLink,
    shortcutKey,
    trackMarkForKey,
    type TriageStatus,
    VERDICT_KEYS,
  } from "../keymap.ts";
  import { TriagePlayer } from "../player/triage-player.svelte.ts";
  import { navigate, openExternal } from "../router.svelte.ts";
  import { errorMessage, settings, stats, ui } from "../stores.svelte.ts";
  import PlayerPanel from "../triage/PlayerPanel.svelte";
  import ReleaseFacts from "../triage/ReleaseFacts.svelte";
  import ScopePicker from "../triage/ScopePicker.svelte";
  import ShopCopies from "../triage/ShopCopies.svelte";
  import { loadStatus } from "../load-status.svelte.ts";
  import { SessionCheckpoint } from "../triage/checkpoint.svelte.ts";
  import ResumeSession from "../triage/ResumeSession.svelte";
  import { type Round, TriageSession } from "../triage/session.svelte.ts";
  import Slip from "../triage/Slip.svelte";
  import { endOfQueueHeadline } from "../triage/end-of-queue.ts";
  import Tracklist from "../triage/Tracklist.svelte";
  import NoteLine from "../triage/NoteLine.svelte";
  import VerdictBar from "../triage/VerdictBar.svelte";

  let { active }: { active: boolean } = $props();

  const session = new TriageSession(api, { setLabelHidden });

  /** Saves the queue filters with the label left out or let back in; the queue restarts. */
  async function setLabelHidden(label: HiddenLabel, hidden: boolean): Promise<void> {
    const config = settings.value;
    if (!config) throw new Error("the settings have not loaded");
    await settings.save({ ...config, filters: withLabelExcluded(config.filters, label, hidden) });
  }
  onDestroy(() => session.destroy());
  const player = new TriagePlayer(api, {
    startAtFraction: () => settings.value?.player.startAtFraction ?? 0.5,
    skipHeard: () => settings.value?.player.skipHeard ?? true,
  });
  const checkpoint = new SessionCheckpoint(api, session, player, settings);
  onDestroy(() => checkpoint.destroy());

  $effect(() => {
    if (active) return checkpoint.autosave();
  });

  const ROUND_TITLES: Record<Round["kind"], string> = {
    snoozed: "Hearing snoozed records again:",
    replay: "Replaying Twelves:",
  };

  const seekStep = $derived(settings.value?.player.seekStepSeconds ?? 10);
  const startAt = $derived(settings.value?.player.startAtFraction ?? 0.5);
  const hasMaybeList = $derived((settings.value?.discogs.maybeListId ?? null) !== null);
  const detailError = $derived(
    session.current ? (session.detailErrors.get(session.current.id) ?? null) : null,
  );

  /** Bumped by each queue restart; only the latest one opens the session checkpoint. */
  let restartGeneration = 0;
  const settingsLoaded = $derived(settings.value !== null);
  /** The queue starts from the settings, so without them there is nothing to dig. */
  const settingsFailed = $derived(settings.value === null && settings.error !== null);

  // (Re)start the queue once settings are known and after every save: filters may have changed.
  // The config is read untracked, so a color scheme change, which keeps the version, does not.
  $effect(() => {
    void settings.version;
    if (!settingsLoaded) return;
    untrack(() => {
      const config = settings.value;
      if (!config) return;
      // A resume saves the session's settings and reloads the queue itself.
      if (checkpoint.restoring) return;
      const generation = ++restartGeneration;
      void session.start(config.queue.limit).then(() => {
        if (generation === restartGeneration) void checkpoint.open();
      });
    });
  });

  // While a load adds records, the end of the queue asks again every 10 seconds, and once more
  // when the load ends, which brings the coverage releases last.
  $effect(() => {
    if (!loadStatus.loading || !session.finished) return;
    const timer = setInterval(() => void session.lookAgain(), 10_000);
    return () => {
      clearInterval(timer);
      void session.lookAgain();
    };
  });

  // Records, or a marked track to play from its saved moment, handed over by Twelves.
  $effect(() => {
    const request = ui.replay;
    if (!request) return;
    untrack(() => {
      ui.replay = null;
      if (request.playback) player.restorePlayback(request.playback);
      session.startRound(request.items);
      player.show(session.currentDetail, session.nextDetail, session.videosChange);
    });
  });

  let loadingSnoozed = $state(false);

  async function hearSnoozed(): Promise<void> {
    if (loadingSnoozed) return;
    loadingSnoozed = true;
    try {
      const snoozed = await api.getTwelves({ status: ["snoozed"] });
      session.startRound(snoozed.items.map(replayItemOf).toReversed());
    } catch (event) {
      session.showFlash(`The snoozed records did not load: ${errorMessage(event)}`);
    } finally {
      loadingSnoozed = false;
    }
  }

  /** E opened the note on the current record. */
  let editingNote = $state(false);
  const note = $derived(session.current ? session.noteFor(session.current) : null);
  /** The newest note written on another pressing of the record, shown when this one has none. */
  const pressingNote = $derived(session.currentDetail?.pressingNotes[0] ?? null);

  // A verdict or N moves on; a half-written note stays with the record it was for. The key, not
  // the item, decides: P replaces the item with fresh market data.
  const currentKey = $derived(session.current?.triageKey ?? null);
  $effect(() => {
    void currentKey;
    editingNote = false;
  });

  function saveNote(text: string): void {
    if (session.current) session.setNote(session.current, text);
    editingNote = false;
  }

  /** F opened the picker of a label, artist or seller to dig. */
  let pickingScope = $state(false);
  const recordScopes = $derived(
    session.currentDetail
      ? scopesOfRelease(session.currentDetail.release, session.currentDetail.tracks)
      : [],
  );
  const copies = $derived(sellerCopies(session.scope, session.currentDetail));
  const scopeRemaining = $derived(stats.value?.scopeRemaining ?? null);
  const newRecords = $derived(newRecordsScope(stats.value?.dump.lastLoad ?? null));

  /** Esc ends a round of snoozed records first, then a dig. */
  function leaveRoundOrScope(): boolean {
    if (session.round) {
      session.endRound();
      return true;
    }
    if (!session.scope) return false;
    void session.setScope(null);
    return true;
  }

  const snoozedCount = $derived(stats.value?.verdicts.snoozed ?? 0);
  const noReleases = $derived(stats.value !== null && stats.value.universe.releases === 0);
  const loadedRecords = $derived(stats.value?.universe.keys ?? 0);
  const nothingMatches = $derived(
    stats.value !== null &&
      stats.value.universe.releases > 0 &&
      stats.value.universe.filteredKeys === 0,
  );

  $effect(() => {
    const detail = session.currentDetail;
    const next = session.nextDetail;
    const change = session.videosChange;
    untrack(() => player.show(detail, next, change));
  });

  $effect(() => {
    const hidden = !active;
    untrack(() => player.suspend(hidden));
  });

  // Shown again: Twelves may have sent records back to the queue. A page shown from the start
  // has only just read it.
  let wasHidden = false;
  $effect(() => {
    if (!active) {
      wasHidden = true;
      return;
    }
    if (!wasHidden) return;
    wasHidden = false;
    untrack(() => void session.readAgain());
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
    const entry = player.entry;
    const release = player.release;
    if (!entry?.track || !release) {
      session.showFlash("Track marks go on the playing track; nothing is playing.");
      return;
    }
    const moment = { videoId: entry.video.videoId, atSeconds: Math.round(player.time * 10) / 10 };
    session.markTrack(release.release.id, entry.track, mark, moment);
  }

  /** Returns false when there is nothing to retry, so Enter keeps its usual meaning. */
  function retry(): boolean {
    if (settingsFailed) {
      void settings.retry();
      return true;
    }
    if (session.status === "error" && settings.value) {
      const config = settings.value;
      void session.start(config.queue.limit);
      return true;
    }
    if (session.current && detailError) {
      session.retryDetail(session.current.id);
      return true;
    }
    return false;
  }

  const ACTIONS: Record<string, () => void> = {
    " ": () => player.toggle(),
    j: () => player.nextTrack(),
    k: () => player.previousTrack(),
    o: () => openReleaseLink("discogs"),
    s: () => openReleaseLink("youtube"),
    p: () => void session.price(),
    n: () => session.pass(),
    z: () => session.undo(),
    x: () => void session.hideLabel(),
    e: () => {
      if (session.current) editingNote = true;
    },
    f: () => {
      pickingScope = true;
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
    const mark = event.shiftKey ? trackMarkForKey(event.key.toLowerCase()) : null;
    if (mark) {
      if (!event.repeat) markPlaying(mark);
      return true;
    }
    const key = shortcutKey(event);
    if (key === null) return false;
    if (key === "ArrowLeft" || key === "ArrowRight") {
      player.seekBy(key === "ArrowLeft" ? -seekStep : seekStep);
      return true;
    }
    // Holding a key down must not judge a run of releases.
    if (event.repeat) return /^[ jknozspexf1-9radmc]$/.test(key);
    return runShortcut(key);
  }

  function runShortcut(key: string): boolean {
    const action = ACTIONS[key];
    if (action) {
      action();
      return true;
    }
    if (key === "Enter") return retry();
    if (key === "Escape") return leaveRoundOrScope();
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
    if (!active || ui.helpOpen || pickingScope || !session.current) return;
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
  <ResumeSession {checkpoint} />
  <!-- The live region stays in the DOM so a banner is announced when a round or a scope starts. -->
  <div aria-live="polite">
    {#if session.round}
      <p class="banner">
        <span>
          {ROUND_TITLES[session.round.kind]} <b>{formatCount(session.upcoming.length)}</b> of
          {formatCount(session.round.total)} left. Only a verdict key changes the saved decision; <Key label="N" size="sm" /> leaves it.
        </span>
        <button type="button" aria-keyshortcuts="Escape" onclick={() => session.endRound()}>
          <Key label="Esc" size="sm" aria-hidden="true" /> back to the queue
        </button>
      </p>
    {:else if session.scope}
      <p class="banner">
        <span>
          Digging {SCOPE_NOUN[session.scope.kind]} <b>{session.scope.name}</b>{#if scopeRemaining !== null}:
            <b>{formatCount(scopeRemaining)}</b> left under your filters{/if}.
        </span>
        <button type="button" aria-keyshortcuts="Escape" onclick={() => void session.setScope(null)}>
          <Key label="Esc" size="sm" aria-hidden="true" /> back to the whole queue
        </button>
      </p>
    {/if}
  </div>
  <p class="quiet" role="status" aria-label="Note save status">{session.noteStatus ?? ""}</p>
  <div class="desk">
    <div class="record">
      {#if settingsFailed}
        <div class="state">
          <h1 class="headline">The settings did not load.</h1>
          <p class="quiet">{settings.error}</p>
          <p class="quiet">The queue starts from your settings. Check that the server runs, then try again.</p>
          <p class="actions">
            <button
              type="button"
              aria-keyshortcuts="Enter"
              aria-busy={settings.loading}
              onclick={() => void settings.retry()}
            >
              <Key label="Enter" primary aria-hidden="true" /> try again
            </button>
          </p>
        </div>
      {:else if session.status === "error"}
        <div class="state">
          <h1 class="headline">The queue did not load.</h1>
          <p class="quiet">{session.error}</p>
          <p class="quiet">
            Check that the server runs (<code>npm run digga -- serve</code>), then press
            <Key label="Enter" /> to try again.
          </p>
        </div>
      {:else if session.finished && loadStatus.loading}
        <div class="state">
          <Art name="press" size={160} />
          <h1 class="headline">You have dug everything loaded so far.</h1>
          <p class="quiet">
            {loadStatus.fraction === null ? "The catalogue is loading" : `${Math.floor(loadStatus.fraction * 100)}% of the catalogue is read`};
            records join the queue as they arrive, and the next one shows here.
          </p>
        </div>
      {:else if session.finished && noReleases}
        <div class="state">
          <Art name="press" size={160} />
          <h1 class="headline">No releases loaded yet.</h1>
          <p class="quiet">
            Digga digs a Discogs releases dump. In settings, under Library, "Update from the newest dump"
            downloads the latest one, over 10 GB, and loads it. The styles and years it keeps are under
            Universe beside it.
          </p>
          <p class="actions">
            <button type="button" aria-keyshortcuts="," onclick={() => navigate("settings", "library")}>
              <Key label="," aria-hidden="true" /> settings
            </button>
          </p>
        </div>
      {:else if session.finished && nothingMatches}
        <div class="state">
          <h1 class="headline">Your filters match no records.</h1>
          <p class="quiet">
            {formatCount(loadedRecords)} {nounFor(loadedRecords, "record is", "records are")} loaded. Widen the years, formats or
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
      {:else if session.finished && session.scope}
        <div class="state">
          <h1 class="headline">Nothing is left to dig from {SCOPE_NOUN[session.scope.kind]} {session.scope.name}.</h1>
          <p class="quiet">
            Under your filters, that is: widen the years, formats or countries in settings to dig further.
          </p>
          <p class="actions">
            {#if session.passed.length > 0}
              <button type="button" aria-keyshortcuts="N" onclick={() => session.goRound()}>
                <Key label="N" aria-hidden="true" /> go round the {formatCount(session.passed.length)} you passed
              </button>
            {/if}
            <button type="button" aria-keyshortcuts="Escape" onclick={() => void session.setScope(null)}>
              <Key label="Esc" primary aria-hidden="true" /> back to the whole queue
            </button>
          </p>
        </div>
      {:else if session.finished}
        <div class="state finished">
          <Stamp text="all dug" tone="accent" size="xl" seed={1} slam />
          <h1 class="headline">{endOfQueueHeadline(session.passed.length)}</h1>
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
            pricing={session.pricing.has(session.current.id)}
            onprice={() => void session.price()}
          />
          {#if note || pressingNote || editingNote}
            <NoteLine {note} {pressingNote} editing={editingNote} onsave={saveNote} oncancel={() => (editingNote = false)} />
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
      {#if copies}
        <ShopCopies {copies} />
      {/if}
      <Slip
        slip={session.slip}
        next={session.next}
        nextVideos={session.nextDetail?.videos.length ?? null}
        nextReady={player.nextReady}
        inRound={session.round !== null}
        busy={session.slipBusy}
      />
      <Flash message={session.flash} label="Triage messages" />
    </aside>
  </div>

  <VerdictBar
    disabled={!session.current}
    {hasMaybeList}
    onjudge={judge}
    onpass={() => session.pass()}
    onhidelabel={() => void session.hideLabel()}
    onpickscope={() => (pickingScope = true)}
    onundo={() => session.undo()}
    onhelp={() => (ui.helpOpen = true)}
  />

  <ScopePicker
    open={pickingScope}
    {recordScopes}
    {newRecords}
    onpick={(scope) => void session.setScope(scope)}
    onclose={() => (pickingScope = false)}
  />
</div>

<style>
  .triage {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 10px 40px;
    border-bottom: 1px solid var(--rule);
    background: var(--surface);
    box-shadow: inset 3px 0 0 var(--accent-mark);
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .banner b {
    color: var(--fg);
    font-weight: 600;
  }
  .banner button {
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
