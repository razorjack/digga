<script lang="ts">
  import { onMount } from "svelte";
  import type { TwelvesItem } from "../../shared/api.ts";
  import { discogsReleaseUrl } from "../../shared/discogs-urls.ts";
  import { formatCount, formatDay, formatPrice } from "../../shared/display.ts";
  import Flash from "../components/Flash.svelte";
  import Key from "../components/Key.svelte";
  import Stamp from "../components/Stamp.svelte";
  import {
    hasCommandModifier,
    isTyping,
    pastedVideoLink,
    STATUS_COPY,
    STATUS_TONE,
  } from "../keymap.ts";
  import { youtubeSearchUrl } from "../../shared/youtube.ts";
  import { navigate, openExternal } from "../router.svelte.ts";
  import { settings, ui } from "../stores.svelte.ts";
  import { TwelvesShelf } from "../twelves/shelf.svelte.ts";
  import TrackTable from "../twelves/TrackTable.svelte";
  import {
    SHELVES,
    SORTS,
    EMPTY,
    JUDGE_KEYS,
    notOnList,
    notOnWantlist,
    trackKey,
  } from "../twelves/model.ts";
  const shelfState = new TwelvesShelf();
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
      shelfState.selectedKey = shelfState.visible[0]!.verdict.key;
  });

  $effect(() => {
    const first = shelfState.visibleTracks[0];
    if (shelfState.selectedTrackIndex === -1 && first) shelfState.selectedTrackKey = trackKey(first);
  });

  const onTracks = $derived(shelfState.shelf === "tracks");

  $effect(() => {
    void shelfState.selectedKey;
    table?.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
  });

  /** Enter on a snoozed record: hear it and the snoozed records after it in Triage. */
  function hearAgain(): void {
    if (shelfState.selected?.verdict.status !== "snoozed") {
      shelfState.showFlash("Enter hears snoozed records again; pick one on the Snoozed shelf (7).");
      return;
    }
    const round = shelfState.visible
      .slice(shelfState.selectedIndex)
      .filter((index) => index.verdict.status === "snoozed" && index.release);
    if (round.length === 0) {
      shelfState.showFlash("This record is not in the loaded dump, so Triage cannot play it.");
      return;
    }
    ui.snoozedRound = round;
    navigate("triage");
  }

  function startEditing(item: TwelvesItem): void {
    editingKey = item.verdict.key;
    noteDraft = item.verdict.notes ?? "";
  }

  /** The note input appears when E is pressed, so it takes focus as it mounts. */
  const focusOnMount = (input: HTMLInputElement) => input.focus();

  function saveNote(item: TwelvesItem): void {
    editingKey = null;
    const notes = noteDraft.trim() === "" ? null : noteDraft.trim();
    if (notes === item.verdict.notes) return;
    shelfState.enqueue(item.verdict.key, (fresh) =>
      shelfState.write(fresh, { notes }, notes ? "Note saved." : "Note removed."),
    );
  }

  const ACTIONS: Record<string, () => void> = {
    j: () => shelfState.move(1),
    ArrowDown: () => shelfState.move(1),
    k: () => shelfState.move(-1),
    ArrowUp: () => shelfState.move(-1),
    s: () => shelfState.cycleSort(),
    "/": () => filterInput?.focus(),
    z: () => shelfState.enqueueTask(() => shelfState.undo()),
    i: () => void shelfState.checkList(),
    Enter: hearAgain,
  };

  function onkeydown(event: KeyboardEvent): void {
    if (
      ui.helpOpen ||
      event.defaultPrevented ||
      isTyping(event) ||
      hasCommandModifier(event) ||
      event.shiftKey
    )
      return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
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
    const link = pastedVideoLink(event);
    if (link === null) return;
    event.preventDefault();
    shelfState.attachVideo(selected, link);
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

<div class="twelves">
  <header class="head">
    <h1>Twelves</h1>
    <p class="lede">
      {formatCount(shelfState.counts.all)} records you want, own, or put aside.
    </p>
  </header>

  <div class="controls">
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
          {option.label}
          <span class="count">{formatCount(shelfState.counts[option.id])}</span>
        </label>
      {/each}
    </fieldset>
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
        {#each SORTS as option (option.id)}
          <label>
            <input type="radio" class="visually-hidden" name="sort" value={option.id} bind:group={shelfState.sort} />
            {option.label}
          </label>
        {/each}
      </fieldset>
    </search>
  </div>

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

  {#if shelfState.shelf === "accepted" || (shelfState.shelf === "all" && shelfState.wantsPending.length > 0)}
    <div class="handoff">
      <p>
        {#if shelfState.wantsPending.length > 0}
          <b>{formatCount(shelfState.wantsPending.length)}</b>
          {shelfState.wantsPending.length === 1 ? "want is" : "wants are"} not on your Discogs wantlist: the push
          failed or was undone. <Key label="A" /> on one tries again.
        {:else}
          Every want here is on your Discogs wantlist.
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
        dump, or Refresh Twelves under Jobs in Settings, brings back the records Discogs has a video for since.
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
    <p class="empty">{shelfState.query ? `Nothing matches “${shelfState.query}”.` : EMPTY.tracks}</p>
  {:else if onTracks}
    <TrackTable
      tracks={shelfState.visibleTracks}
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
    <p class="empty">{shelfState.query ? `Nothing matches “${shelfState.query}”.` : EMPTY[shelfState.shelf]}</p>
  {:else}
    <table class="box" bind:this={table}>
      <caption class="visually-hidden">{shelfLabel}</caption>
      <thead>
        <tr>
          <th scope="col" class="catno"><span class="visually-hidden">Cat no</span></th>
          <th scope="col" class="who"><span class="visually-hidden">Record</span></th>
          <th scope="col" class="where"><span class="visually-hidden">Label, year and country</span></th>
          <th scope="col" class="market"><span class="visually-hidden">Market</span></th>
          <th scope="col" class="verdict"><span class="visually-hidden">Verdict</span></th>
          <th scope="col" class="day"><span class="visually-hidden">Decided</span></th>
        </tr>
      </thead>
      <tbody>
        {#each shelfState.visible as item (item.verdict.key)}
          {@const release = item.release}
          {@const isSelected = item.verdict.key === shelfState.selectedKey}
          <!-- J and K select from the keyboard; the click is the mouse equivalent. -->
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
          <tr
            class:selected={isSelected}
            aria-current={isSelected ? "true" : undefined}
            onclick={() => (shelfState.selectedKey = item.verdict.key)}
          >
            <td class="catno">{release?.catno ?? ""}</td>
            <td class="who">
              {#if release}
                <a href={discogsReleaseUrl(release.id)} target="_blank" rel="noopener noreferrer">
                  <span class="artist">{release.artistDisplay}</span>
                  <span class="title">{release.title}</span>
                </a>
              {:else}
                <span class="title">Not in the loaded dump ({item.verdict.key})</span>
              {/if}
              {#if editingKey === item.verdict.key}
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
              {:else if item.verdict.notes}
                <p class="note">{item.verdict.notes}</p>
              {/if}
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
                text={STATUS_COPY[item.verdict.status]}
                tone={STATUS_TONE[item.verdict.status]}
                seed={release?.id ?? item.verdict.key.length}
                size="sm"
              />
            </td>
            <td class="day quiet">
              <time datetime={item.verdict.decidedAt}>{formatDay(item.verdict.decidedAt)}</time>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

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
      {#if shelfState.shelf === "snoozed" || shelfState.selected?.verdict.status === "snoozed"}
        <span><Key label="Enter" /> hear again</span>
      {/if}
      <span><Key label="Z" /> undo</span>
    </p>
    <Flash message={shelfState.flash} align="end" />
  </footer>
</div>

<style>
  .twelves {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    padding: 32px 40px 0;
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: 28px;
    margin-bottom: 22px;
  }
  .lede {
    color: var(--fg-muted);
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: end;
    gap: 16px 32px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--rule);
  }
  legend {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  label:has(:focus-visible) {
    outline: 2px solid var(--accent-mark);
    outline-offset: 2px;
  }
  .shelves {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 22px;
  }
  .shelves label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 2px solid transparent;
    color: var(--fg-muted);
    cursor: pointer;
  }
  .shelves label:has(:checked) {
    color: var(--fg);
    border-bottom-color: var(--accent-mark);
  }
  .count {
    color: var(--fg-faint);
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 28px;
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
    width: 22em;
  }
  .sort {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }
  .sort label {
    padding: 2px 0;
    color: var(--fg-faint);
    cursor: pointer;
  }
  .sort label:has(:checked) {
    color: var(--fg);
    text-decoration: underline;
    text-decoration-color: var(--accent-mark);
    text-underline-offset: 4px;
  }
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
  th.where {
    width: calc(15em + 20px);
  }
  th.market {
    width: calc(8.5em + 20px);
  }
  th.verdict {
    width: calc(7.5em + 20px);
  }
  th.day {
    width: calc(5em + 26px);
  }
  td {
    padding: 12px 10px;
    border-bottom: 1px solid var(--rule-soft);
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
    background: var(--surface);
  }
  .selected td:first-child {
    box-shadow: inset 3px 0 0 var(--accent-mark);
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
    margin-top: 12px;
    border: 1px dashed var(--rule);
    color: var(--fg-muted);
    font-size: var(--text-sm);
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
    cursor: default;
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
    text-align: right;
    font-size: var(--text-sm);
  }
  .quiet {
    color: var(--fg-muted);
  }
  .empty {
    padding: 40px 0;
    color: var(--fg-muted);
    max-width: 60ch;
  }
  .foot {
    position: sticky;
    bottom: 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 20px;
    margin: auto -40px 0;
    padding: 12px 40px 14px;
    border-top: 1px solid var(--rule);
    background: var(--surface);
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
      width: calc(8em + 26px);
    }
    .where,
    .market {
      display: none;
    }
  }
</style>
