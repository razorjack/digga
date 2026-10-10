<script lang="ts">
  import { onMount } from "svelte";
  import type { TwelvesItem } from "../../shared/api.ts";
  import { discogsReleaseUrl } from "../../shared/discogs-urls.ts";
  import { formatCount, formatDay, formatPrice } from "../../shared/display.ts";
  import { type ReplayRequest, replayItemOf, replayTrack } from "../../shared/replay.ts";
  import Art from "../components/Art.svelte";
  import Flash from "../components/Flash.svelte";
  import Key from "../components/Key.svelte";
  import Stamp from "../components/Stamp.svelte";
  import {
    hasCommandModifier,
    isTyping,
    NOT_A_VIDEO_LINK,
    pastedLink,
    shortcutKey,
    STATUS_COPY,
    STATUS_TONE,
  } from "../keymap.ts";
  import { youtubeSearchUrl } from "../../shared/youtube.ts";
  import { navigate, openExternal } from "../router.svelte.ts";
  import { settings, ui } from "../stores.svelte.ts";
  import { TwelvesShelf } from "../twelves/shelf.svelte.ts";
  import Pager from "../twelves/Pager.svelte";
  import TrackTable from "../twelves/TrackTable.svelte";
  import "../twelves/box.css";
  import {
    SHELVES,
    SORTS,
    EMPTY,
    JUDGE_KEYS,
    columnSort,
    notOnList,
    notOnWantlist,
    recordStamp,
    trackKey,
  } from "../twelves/model.ts";
  const shelfState = new TwelvesShelf();
  /** Wants and grails go to the Discogs wantlist; their shelves say whether all of them got there. */
  const showWantlistHandoff = $derived(
    shelfState.shelf === "accepted" ||
      shelfState.shelf === "candidate" ||
      (shelfState.shelf === "all" && shelfState.wantsPending.length > 0),
  );
  onMount(() => {
    void shelfState.load();
    return () => shelfState.destroy();
  });
  let editingKey = $state<string | null>(null);

  let noteDraft = $state("");

  let filterInput = $state<HTMLInputElement | null>(null);

  let table = $state<HTMLTableElement | null>(null);

  const hasMaybeList = $derived((settings.value?.discogs.maybeListId ?? null) !== null);
  const shelfLabel = $derived(SHELVES.find((option) => option.id === shelfState.shelf)!.label);

  $effect(() => {
    if (shelfState.selectedIndex === -1 && shelfState.visible.length > 0)
      shelfState.selectedKey = shelfState.visible[0]!.key;
  });

  $effect(() => {
    const first = shelfState.visibleTracks[0];
    if (shelfState.selectedTrackIndex === -1 && first) shelfState.selectedTrackKey = trackKey(first);
  });

  const onTracks = $derived(shelfState.shelf === "tracks");
  const page = $derived(onTracks ? shelfState.trackPage : shelfState.page);

  $effect(() => {
    void shelfState.selectedKey;
    table?.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
  });

  /** Enter: hear the selected marked track, or the selected record and those after it, in Triage. */
  function hearAgain(): void {
    const request = shelfState.shelf === "tracks" ? selectedTrackReplay() : selectedRecordsReplay();
    if (!request) return;
    ui.replay = request;
    navigate("triage");
  }

  function selectedTrackReplay(): ReplayRequest | null {
    const track = shelfState.selectedTrack;
    if (!track?.release) {
      shelfState.showFlash("This track's release is not in the loaded dump.");
      return null;
    }
    return replayTrack(track);
  }

  function selectedRecordsReplay(): ReplayRequest | null {
    const items = shelfState.visible.slice(shelfState.selectedIndex).filter((item) => item.release);
    if (items.length === 0) {
      shelfState.showFlash("This record is not in the loaded dump, so Triage cannot play it.");
      return null;
    }
    return { items: items.map(replayItemOf) };
  }

  function startEditing(item: TwelvesItem): void {
    editingKey = item.key;
    noteDraft = item.note ?? "";
  }

  /** The note input appears when E is pressed, so it takes focus as it mounts. */
  const focusOnMount = (input: HTMLInputElement) => input.focus();

  function saveNote(item: TwelvesItem): void {
    editingKey = null;
    const notes = noteDraft.trim() === "" ? null : noteDraft.trim();
    if (notes !== item.note) shelfState.saveNote(item, notes);
  }

  const ACTIONS: Record<string, () => void> = {
    j: () => shelfState.move(1),
    ArrowDown: () => shelfState.move(1),
    k: () => shelfState.move(-1),
    ArrowUp: () => shelfState.move(-1),
    ArrowLeft: () => shelfState.turnPage(-1),
    ArrowRight: () => shelfState.turnPage(1),
    s: () => shelfState.cycleSort(),
    "/": () => filterInput?.focus(),
    z: () => shelfState.enqueueTask(() => shelfState.undo()),
    i: () => void shelfState.checkList(),
    Enter: hearAgain,
  };

  function onkeydown(event: KeyboardEvent): void {
    if (ui.helpOpen || event.defaultPrevented || isTyping(event) || hasCommandModifier(event)) return;
    const key = shortcutKey(event);
    if (key === null) return;
    if (event.repeat && !["j", "k", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) {
      event.preventDefault();
      return;
    }
    if (runShortcut(key)) event.preventDefault();
  }

  function runShortcut(key: string): boolean {
    const shelfIndex = /^[1-9]$/.test(key) ? Number(key) - 1 : -1;
    if (shelfIndex >= 0) {
      shelfState.shelf = SHELVES[shelfIndex]!.id;
      return true;
    }
    const action = ACTIONS[key];
    if (action) {
      action();
      return true;
    }
    return selectedShortcut(key);
  }

  function selectedShortcut(key: string): boolean {
    if (onTracks) return trackShortcut(key);
    const selected = shelfState.selected;
    if (!selected) return false;
    if (key === "o" && selected.release) {
      openExternal(discogsReleaseUrl(selected.release.id));
      return true;
    }
    if (key === "y" && selected.release) {
      openExternal(youtubeSearchUrl(`${selected.release.artistDisplay} ${selected.release.title}`));
      return true;
    }
    if (key === "e") {
      startEditing(selected);
      return true;
    }
    const verdict = JUDGE_KEYS[key];
    if (!verdict) return false;
    shelfState.rejudge(selected, verdict);
    return true;
  }

  function trackShortcut(key: string): boolean {
    const track = shelfState.selectedTrack;
    if (!track) return false;
    if (key === "o" && track.release) {
      openExternal(discogsReleaseUrl(track.release.id));
      return true;
    }
    if (key === "e") {
      editingKey = trackKey(track);
      return true;
    }
    if (!JUDGE_KEYS[key]) return false;
    shelfState.showFlash("Track marks change in Triage, on the playing track.");
    return true;
  }

  /** A copied YouTube link goes on the selected record's release. */
  function onpaste(event: ClipboardEvent): void {
    const selected = shelfState.selected;
    if (ui.helpOpen || onTracks || !selected) return;
    const link = pastedLink(event);
    if (link === null) return;
    event.preventDefault();
    if (link.isVideo) shelfState.attachVideo(selected, link.url);
    else shelfState.showFlash(NOT_A_VIDEO_LINK);
  }

  function onFilterKey(event: KeyboardEvent): void {
    if (event.key === "Escape" || event.key === "Enter") {
      if (event.key === "Escape") shelfState.query = "";
      (event.currentTarget as HTMLInputElement).blur();
      event.preventDefault();
    }
  }
</script>

<svelte:window {onkeydown} {onpaste} />

{#snippet emptyShelf()}
  {#if shelfState.query}
    <p class="empty">Nothing matches “{shelfState.query}”.</p>
  {:else}
    <div class="empty">
      <Art name="crate" size={160} />
      <p>{EMPTY[shelfState.shelf]}</p>
    </div>
  {/if}
{/snippet}

<div class="twelves">
  <aside class="sidebar">
    <h1>Twelves</h1>
    <fieldset class="shelves">
      <legend class="visually-hidden">Shelf</legend>
      {#each SHELVES as option, index (option.id)}
        <label>
          <input
            type="radio"
            class="visually-hidden"
            name="shelf"
            value={option.id}
            aria-keyshortcuts={String(index + 1)}
            bind:group={shelfState.shelf}
          />
          <Key label={String(index + 1)} size="sm" aria-hidden="true" />
          <span class="shelf-label">{option.label}</span>
          <span class="count">{formatCount(shelfState.counts[option.id])}</span>
        </label>
      {/each}
    </fieldset>
  </aside>

  <div class="pane">
  <search class="tools">
    <label class="filter">
      <Key label="/" size="sm" />
      <input
        type="search"
        bind:this={filterInput}
        bind:value={shelfState.query}
        onkeydown={onFilterKey}
        placeholder="artist, title, label, cat no"
        aria-label="Filter"
        aria-keyshortcuts="/"
      />
    </label>
    <fieldset class="sort" aria-keyshortcuts="S">
      <legend><Key label="S" size="sm" aria-hidden="true" /> sort</legend>
      <div class="segments">
        {#each SORTS as option (option.id)}
          <label>
            <input type="radio" class="visually-hidden" name="sort" value={option.id} bind:group={shelfState.sort} />
            {option.label}
          </label>
        {/each}
      </div>
    </fieldset>
  </search>

  <div class="shelf">
  {#if shelfState.shelf === "maybe" || (shelfState.shelf === "all" && shelfState.pending > 0)}
    <div class="handoff">
      {#if !hasMaybeList}
        <p>Pick your Discogs Maybe list in Settings, under Discogs, to keep this shelf in step with it.</p>
      {:else}
        <p>
          {#if shelfState.pending > 0}
            <b>{formatCount(shelfState.pending)}</b>
            {shelfState.pending === 1 ? "maybe is" : "maybes are"} not on your Discogs Maybe list yet. The Discogs
            API cannot add to lists: <Key label="O" /> opens the release, where "Add to list" is one
            click.
          {:else}
            Every maybe here is on your Discogs Maybe list.
          {/if}
        </p>
        <button
          type="button"
          class="check"
          disabled={shelfState.checking}
          aria-keyshortcuts="I"
          onclick={() => void shelfState.checkList()}
        >
          <Key label="I" aria-hidden="true" />
          {shelfState.checking ? "Reading your Discogs Maybe list…" : "check the list again"}
        </button>
      {/if}
    </div>
  {/if}

  {#if showWantlistHandoff}
    <div class="handoff">
      <p>
        {#if shelfState.wantsPending.length > 0}
          <b>{formatCount(shelfState.wantsPending.length)}</b>
          {shelfState.wantsPending.length === 1 ? "record is" : "records are"} not on your Discogs wantlist.
          <Key label="A" /> on a want or <Key label="C" /> on a grail adds it.
        {:else}
          Everything here is on your Discogs wantlist.
        {/if}
      </p>
      {#if shelfState.wantsPending.length > 1}
        <button type="button" class="check" disabled={shelfState.pushing} onclick={() => shelfState.enqueueTask(() => shelfState.addToWantlist(shelfState.wantsPending))}>
          {shelfState.pushing ? "Adding…" : `add all ${formatCount(shelfState.wantsPending.length)}`}
        </button>
      {/if}
    </div>
  {/if}

  {#if shelfState.shelf === "no_audio" && shelfState.counts.no_audio > 0}
    <div class="handoff">
      <p>
        None of these records had a video that would play. <Key label="Y" /> searches YouTube; copy a video's
        link there and press <Key label="⌘V" /> here to attach it, and the record goes back to the queue. A newer
        dump brings back the records Discogs has a video for since.
      </p>
    </div>
  {/if}

  {#if shelfState.shelf === "snoozed" && shelfState.counts.snoozed > 0}
    <div class="handoff">
      <p>
        <Key label="Enter" /> hears the snoozed records again in Triage, from the selected one. A verdict
        replaces the snooze; <Key label="N" /> leaves it.
      </p>
    </div>
  {/if}

  {#if shelfState.loading}
    <p class="empty">Loading…</p>
  {:else if shelfState.error}
    <p class="empty">Twelves did not load: {shelfState.error}</p>
  {:else if onTracks && shelfState.visibleTracks.length === 0}
    {@render emptyShelf()}
  {:else if onTracks}
    <TrackTable
      tracks={shelfState.trackPage.items}
      sort={shelfState.sort}
      selectedKey={shelfState.selectedTrackKey}
      {editingKey}
      onselect={(key) => (shelfState.selectedTrackKey = key)}
      onsave={(track, notes) => {
        editingKey = null;
        shelfState.saveTrackNote(track, notes);
      }}
      oncancel={() => (editingKey = null)}
    />
  {:else if shelfState.visible.length === 0}
    {@render emptyShelf()}
  {:else}
    <table class="box" bind:this={table}>
      <caption class="visually-hidden">
        {shelfLabel}{#if page.count > 1}, {formatCount(page.first)} to {formatCount(page.last)} of {formatCount(page.total)}{/if}
      </caption>
      <thead>
        <tr>
          <th scope="col" class="catno">Cat no</th>
          <th scope="col" class="who" aria-sort={columnSort(shelfState.sort, "record")}>Record</th>
          <th scope="col" class="where" aria-sort={columnSort(shelfState.sort, "label")}>
            Label<span class="visually-hidden">, year and country</span>
          </th>
          <th scope="col" class="market" aria-sort={columnSort(shelfState.sort, "market")}>Market</th>
          <th scope="col" class="verdict">Verdict</th>
          <th scope="col" class="day" aria-sort={columnSort(shelfState.sort, "decided")}>Decided</th>
        </tr>
      </thead>
      <tbody>
        {#each shelfState.page.items as item (item.key)}
          {@const release = item.release}
          {@const isSelected = item.key === shelfState.selectedKey}
          {@const stamp = recordStamp(item)}
          <!-- J and K select from the keyboard; the click is the mouse equivalent. -->
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
          <tr
            class:selected={isSelected}
            aria-current={isSelected ? "true" : undefined}
            data-triage-key={item.key}
            data-release-id={release?.id}
            onclick={() => (shelfState.selectedKey = item.key)}
          >
            <td class="catno">{release?.catno ?? ""}</td>
            <td class="who">
              {#if release}
                <a href={discogsReleaseUrl(release.id)} target="_blank" rel="noopener noreferrer">
                  <span class="artist">{release.artistDisplay}</span>
                  <span class="title">{release.title}</span>
                </a>
              {:else}
                <span class="title">Not in the loaded dump ({item.key})</span>
              {/if}
              {#if editingKey === item.key}
                <input
                  class="note-input"
                  bind:value={noteDraft}
                  {@attach focusOnMount}
                  maxlength="4000"
                  aria-label="Note"
                  onkeydown={(event) => {
                    if (event.key === "Enter") saveNote(item);
                    if (event.key === "Escape") editingKey = null;
                    event.stopPropagation();
                  }}
                  onblur={() => (editingKey = null)}
                />
              {:else if item.note}
                <p class="note">{item.note}</p>
              {/if}
              {#each item.pressingNotes as pressing (pressing.releaseId)}
                <p class="note">
                  {pressing.notes} <span class="quiet">(on {pressing.catno ?? "another pressing"})</span>
                </p>
              {/each}
              {#if notOnList(item)}
                <p class="pending">not on your Discogs Maybe list yet</p>
              {:else if notOnWantlist(item)}
                <p class="pending">not on your Discogs wantlist</p>
              {/if}
            </td>
            <td class="where">
              {#if release}
                <span>{release.labelName ?? ""}</span>
                <span class="quiet">{[release.year, release.country].filter(Boolean).join(" ")}</span>
              {/if}
            </td>
            <td class="market">
              {#if release?.enrichedAt}
                <span>{release.lowestPrice !== null ? formatPrice(release.lowestPrice, release.currency) : "none for sale"}</span>
                <span class="quiet">{formatCount(release.communityWant ?? 0)} want</span>
              {:else}
                <span class="quiet">no market data</span>
              {/if}
            </td>
            <td class="verdict">
              <Stamp
                text={STATUS_COPY[stamp]}
                tone={STATUS_TONE[stamp]}
                seed={release?.id ?? item.key.length}
                size="sm"
              />
            </td>
            <td class="day quiet">
              <time datetime={item.since}>{formatDay(item.since)}</time>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  </div>

  <footer class="foot">
    <p class="hints">
      <span><Key label="J" /><Key label="K" /> move</span>
      <span><Key label="O" /> discogs</span>
      <span><Key label="E" /> note</span>
      {#if !onTracks}
        <span><Key label="A" /><Key label="M" /><Key label="C" /><Key label="R" /><Key label="L" /> re-judge</span>
        <span><Key label="I" /> check Maybe list</span>
      {/if}
      {#if shelfState.shelf === "no_audio"}
        <span><Key label="Y" /> youtube</span>
        <span><Key label="⌘V" /> attach a link</span>
      {/if}
      <span><Key label="Enter" /> hear again</span>
      <span><Key label="Z" /> undo</span>
    </p>
    <div class="status">
      <Flash message={shelfState.flash} align="end" />
      {#if page.count > 1}
        <Pager {page} noun={onTracks ? "tracks" : "records"} onturn={(turn) => shelfState.turnPage(turn)} />
      {/if}
    </div>
  </footer>
  </div>
</div>

<style>
  /* A split view: the shelves in a sidebar, the shelf beside them between its tools and its keys. */
  .twelves {
    display: grid;
    grid-template-columns: 19em minmax(0, 1fr);
    height: 100%;
  }
  .sidebar {
    display: grid;
    align-content: start;
    gap: 16px;
    min-height: 0;
    padding: 24px 12px;
    overflow-y: auto;
    border-right: 1px solid var(--rule);
    background: var(--surface);
    user-select: none;
  }
  .sidebar h1 {
    padding-inline: 12px;
    font-size: var(--text-lg);
  }
  label:has(:focus-visible) {
    outline: 2px solid var(--accent-mark);
    outline-offset: -2px;
  }
  .shelves {
    display: grid;
    gap: 2px;
  }
  .shelves label {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 6px 12px;
    color: var(--fg-muted);
  }
  .shelf-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .shelves label:has(:checked) {
    background: var(--bg);
    box-shadow: inset 3px 0 0 var(--accent-mark);
    color: var(--fg);
  }
  .count {
    margin-left: auto;
    color: var(--fg-faint);
    font-size: var(--text-sm);
  }
  .shelves label:has(:checked) .count {
    color: var(--fg-muted);
  }
  .pane {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    min-width: 0;
    min-height: 0;
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 28px;
    padding: 12px 24px;
    border-bottom: 1px solid var(--rule);
    font-size: var(--text-sm);
    color: var(--fg-muted);
  }
  .filter {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .filter input {
    appearance: textfield;
    width: 21em;
  }
  .sort {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    user-select: none;
  }
  .sort legend {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .segments {
    display: flex;
  }
  .segments label {
    padding: 3px 10px;
    border: 1px solid var(--rule);
    color: var(--fg-muted);
  }
  .segments label + label {
    border-left: 0;
  }
  .segments label:first-child {
    border-radius: var(--radius) 0 0 var(--radius);
  }
  .segments label:last-child {
    border-radius: 0 var(--radius) var(--radius) 0;
  }
  .segments label:has(:checked) {
    background: var(--surface);
    box-shadow: inset 0 -2px 0 var(--accent-mark);
    color: var(--fg);
  }
  /* The notices and the records scroll between the tools and the keys. */
  .shelf {
    min-height: 0;
    padding: 0 24px 24px;
    overflow-y: auto;
  }
  /* Column widths count characters of the rows' text; the headers' own text is smaller. */
  th.catno {
    width: calc(9.5 * var(--text-md) + 26px);
  }
  th.where {
    width: calc(15 * var(--text-md) + 20px);
  }
  th.market {
    width: calc(8.5 * var(--text-md) + 20px);
  }
  th.verdict {
    width: calc(7.5 * var(--text-md) + 20px);
  }
  th.day {
    width: calc(5 * var(--text-md) + 26px);
  }
  .catno {
    font-weight: 600;
    color: var(--fg-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .selected .catno {
    color: var(--fg);
  }
  .who a {
    display: grid;
    text-decoration: none;
  }
  .artist,
  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .artist {
    font-weight: 600;
  }
  .title {
    color: var(--fg-muted);
  }
  .who a:hover .artist {
    text-decoration: underline;
    text-decoration-color: var(--fg-faint);
    text-underline-offset: 3px;
  }
  .note {
    margin-top: 4px;
    color: var(--fg-accent);
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pending {
    margin-top: 4px;
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .pending::before {
    content: "○ " / "";
    color: var(--fg-accent);
  }
  .handoff {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px 28px;
    padding: 12px 16px;
    margin-block: 16px 4px;
    border: 1px dashed var(--rule);
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  /* A notice sits apart from the records below it, closer to the next notice. */
  .handoff + .handoff {
    margin-top: var(--space-item);
  }
  .handoff p {
    max-width: 90ch;
  }
  .handoff b {
    color: var(--fg);
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 0;
    background: none;
    color: var(--fg);
    padding: 0;
  }
  .check:disabled {
    color: var(--fg-muted);
  }
  .note-input {
    width: 100%;
    margin-top: 6px;
    border-color: var(--accent-mark);
  }
  td.where,
  td.market {
    font-size: var(--text-sm);
  }
  .where span,
  .market span {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  td.day {
    font-size: var(--text-sm);
  }
  .quiet {
    color: var(--fg-muted);
  }
  .empty {
    display: grid;
    justify-items: start;
    gap: 20px;
    padding: 40px 0;
    color: var(--fg-muted);
    max-width: 60ch;
  }
  .foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 20px;
    padding: 12px 24px 14px;
    border-top: 1px solid var(--rule);
    background: var(--surface);
    user-select: none;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 28px;
  }
  .hints {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 20px;
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .hints span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  @media (max-width: 1100px) {
    th.catno {
      width: calc(8 * var(--text-md) + 26px);
    }
    .where,
    .market {
      display: none;
    }
  }
</style>
