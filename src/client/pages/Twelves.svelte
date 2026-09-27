<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { TwelvesItem } from "../../shared/api.ts";
  import { discogsReleaseUrl } from "../../shared/discogs-urls.ts";
  import { formatCount, formatDay, formatPrice } from "../../shared/display.ts";
  import type { ImportProgress, Verdict, VerdictStatus } from "../../shared/types.ts";
  import { isTriageSource } from "../../shared/verdict-rank.ts";
  import { api } from "../api.ts";
  import Key from "../components/Key.svelte";
  import Stamp from "../components/Stamp.svelte";
  import { hasCommandModifier, isTyping, STATUS_COPY, STATUS_TONE } from "../keymap.ts";
  import { openExternal } from "../router.svelte.ts";
  import { errorMessage, settings, stats, ui } from "../stores.svelte.ts";

  type ShelfId =
    | "all"
    | "accepted"
    | "wantlist"
    | "collection"
    | "maybe"
    | "candidate"
    | "snoozed";
  type SortId = "newest" | "label" | "artist" | "year" | "price" | "want";

  const SHELVES: { id: ShelfId; label: string }[] = [
    { id: "all", label: "Everything" },
    { id: "accepted", label: "Want" },
    { id: "wantlist", label: "Discogs wantlist" },
    { id: "collection", label: "Owned" },
    { id: "maybe", label: "Maybe" },
    { id: "candidate", label: "Grail" },
    { id: "snoozed", label: "Snoozed" },
  ];
  const STATUSES: VerdictStatus[] = [
    "accepted",
    "wantlist",
    "collection",
    "maybe",
    "candidate",
    "snoozed",
  ];
  const SORTS: { id: SortId; label: string }[] = [
    { id: "newest", label: "newest" },
    { id: "label", label: "label" },
    { id: "artist", label: "artist" },
    { id: "year", label: "year" },
    { id: "price", label: "price" },
    { id: "want", label: "most wanted" },
  ];
  const EMPTY: Record<ShelfId, string> = {
    all: "Nothing here yet. Press A on a release in Triage, or import your Discogs wantlist and collection.",
    accepted: "Nothing wanted yet. Press A on a release in Triage.",
    wantlist: "No wantlist imported. Run npm run digga -- import wantlist.",
    collection: "No collection imported. Run npm run digga -- import collection.",
    maybe: "No maybes. Press M in Triage for a release that belongs on your Discogs Maybe list.",
    candidate: "No grails yet. Press C in Triage for the one you've been hunting.",
    snoozed: "Nothing snoozed. Press L in Triage to hear a release again later.",
  };
  /** Only triage verdicts can be re-judged here; seeds describe the Discogs account. */
  const JUDGE_KEYS: Record<string, VerdictStatus> = {
    a: "accepted",
    m: "maybe",
    c: "candidate",
    r: "rejected",
    l: "snoozed",
  };
  const TRIAGE_STATUSES = new Set<VerdictStatus>([
    "accepted",
    "maybe",
    "candidate",
    "rejected",
    "snoozed",
  ]);

  let items = $state.raw<TwelvesItem[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let shelf = $state<ShelfId>("all");
  let sort = $state<SortId>("newest");
  let query = $state("");
  let selectedKey = $state<string | null>(null);
  let editingKey = $state<string | null>(null);
  let noteDraft = $state("");
  let flash = $state<string | null>(null);
  let undoStack = $state.raw<Verdict[]>([]);
  let filterInput = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLOListElement | null>(null);
  let checking = $state(false);

  const hasMaybeList = $derived((settings.value?.discogs.maybeListId ?? null) !== null);
  /** A maybe decided in Digga that has not shown up on the Discogs list yet. */
  const notOnList = (i: TwelvesItem) =>
    i.verdict.status === "maybe" && isTriageSource(i.verdict.source);
  const pending = $derived(items.filter(notOnList).length);

  const counts = $derived(
    Object.fromEntries(
      SHELVES.map((s) => [
        s.id,
        s.id === "all" ? items.length : items.filter((i) => i.verdict.status === s.id).length,
      ]),
    ) as Record<ShelfId, number>,
  );

  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  const nullsLast = (a: number | null, b: number | null, dir: 1 | -1) =>
    a === null ? (b === null ? 0 : 1) : b === null ? -1 : (a - b) * dir;

  const visible = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const list = items.filter((i) => {
      if (shelf !== "all" && i.verdict.status !== shelf) return false;
      if (q === "") return true;
      const r = i.release;
      return [r?.artistDisplay, r?.title, r?.labelName, r?.catno, i.verdict.notes]
        .filter(Boolean)
        .some((s) => s!.toLowerCase().includes(q));
    });
    const by = (i: TwelvesItem) => i.release;
    return list.toSorted((a, b) => {
      switch (sort) {
        case "newest":
          return b.verdict.decidedAt.localeCompare(a.verdict.decidedAt);
        case "label":
          return (
            collator.compare(by(a)?.labelName ?? "~", by(b)?.labelName ?? "~") ||
            collator.compare(by(a)?.catno ?? "", by(b)?.catno ?? "")
          );
        case "artist":
          return collator.compare(by(a)?.artistDisplay ?? "~", by(b)?.artistDisplay ?? "~");
        case "year":
          return nullsLast(by(a)?.year ?? null, by(b)?.year ?? null, 1);
        case "price":
          return nullsLast(by(a)?.lowestPrice ?? null, by(b)?.lowestPrice ?? null, 1);
        case "want":
          return nullsLast(by(a)?.communityWant ?? null, by(b)?.communityWant ?? null, -1);
      }
    });
  });

  const selectedIndex = $derived(visible.findIndex((i) => i.verdict.key === selectedKey));
  const selected = $derived(selectedIndex === -1 ? null : visible[selectedIndex]!);

  async function load(): Promise<void> {
    try {
      const res = await api.getTwelves({ status: STATUSES });
      items = res.items;
      error = null;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });

  $effect(() => {
    if (selectedIndex === -1 && visible.length > 0) selectedKey = visible[0]!.verdict.key;
  });

  $effect(() => {
    void selectedKey;
    listEl?.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
  });

  function showFlash(message: string): void {
    flash = message;
    setTimeout(() => {
      if (flash === message) flash = null;
    }, 5000);
  }

  async function write(previous: Verdict, next: Partial<Verdict>, message: string): Promise<void> {
    // If the record leaves this shelf, the selection moves to its neighbour, not to the top.
    const index = visible.findIndex((i) => i.verdict.key === previous.key);
    const neighbour = (visible[index + 1] ?? visible[index - 1])?.verdict.key ?? null;
    try {
      await api.postVerdict({
        key: previous.key,
        status: next.status ?? previous.status,
        source: next.source ?? previous.source,
        notes: next.notes === undefined ? previous.notes : next.notes,
        releaseId: previous.releaseId,
      });
      undoStack = [...undoStack, previous];
      showFlash(message);
      await load();
      if (!visible.some((i) => i.verdict.key === selectedKey)) selectedKey = neighbour;
      void stats.refresh();
    } catch (e) {
      showFlash(`Not saved: ${errorMessage(e)}`);
    }
  }

  async function undo(): Promise<void> {
    const previous = undoStack.at(-1);
    if (!previous) {
      showFlash("Nothing to undo.");
      return;
    }
    undoStack = undoStack.slice(0, -1);
    try {
      await api.postVerdict({
        key: previous.key,
        status: previous.status,
        source: previous.source,
        notes: previous.notes,
        releaseId: previous.releaseId,
      });
      selectedKey = previous.key;
      showFlash("Undone.");
      await load();
      void stats.refresh();
    } catch (e) {
      showFlash(`Undo failed: ${errorMessage(e)}`);
    }
  }

  function rejudge(item: TwelvesItem, status: VerdictStatus): void {
    if (!TRIAGE_STATUSES.has(item.verdict.status)) {
      showFlash("Wantlist and owned records come from Discogs; change them there.");
      return;
    }
    if (item.verdict.status === status) return;
    const name = item.release ? `${item.release.artistDisplay} – ${item.release.title}` : item.verdict.key;
    void write(item.verdict, { status, source: "triage" }, `${name}: ${STATUS_COPY[status]}. Z undoes it.`);
  }

  async function startEditing(item: TwelvesItem): Promise<void> {
    editingKey = item.verdict.key;
    noteDraft = item.verdict.notes ?? "";
    await tick();
    document.querySelector<HTMLInputElement>(".note-input")?.focus();
  }

  function saveNote(item: TwelvesItem): void {
    editingKey = null;
    const notes = noteDraft.trim() === "" ? null : noteDraft.trim();
    if (notes === item.verdict.notes) return;
    void write(item.verdict, { notes }, notes ? "Note saved." : "Note removed.");
  }

  function move(delta: number): void {
    if (visible.length === 0) return;
    const i = Math.min(visible.length - 1, Math.max(0, (selectedIndex === -1 ? 0 : selectedIndex) + delta));
    selectedKey = visible[i]!.verdict.key;
  }

  /** Reads the Discogs Maybe list again, so maybes added there by hand lose their marker. */
  async function checkList(): Promise<void> {
    if (checking) return;
    if (!hasMaybeList) {
      showFlash("Pick your Discogs Maybe list in Settings first.");
      return;
    }
    checking = true;
    try {
      let job = await api.startImport("list");
      while (job.status === "running" || job.status === "queued") {
        await new Promise((resolve) => setTimeout(resolve, 500));
        job = await api.getJob(job.id);
      }
      if (job.status !== "done") throw new Error(job.error ?? `the check ended as ${job.status}`);
      const p = job.progress as ImportProgress;
      await load();
      void stats.refresh();
      showFlash(
        `Your Discogs Maybe list has ${formatCount(p.processed)} records; ${formatCount(p.verdictsWritten)} changed here.`,
      );
    } catch (e) {
      showFlash(`The list check failed: ${errorMessage(e)}`);
    } finally {
      checking = false;
    }
  }

  function cycleSort(): void {
    const i = SORTS.findIndex((s) => s.id === sort);
    sort = SORTS[(i + 1) % SORTS.length]!.id;
  }

  function onkeydown(e: KeyboardEvent): void {
    if (ui.helpOpen || e.defaultPrevented || isTyping(e) || hasCommandModifier(e) || e.shiftKey) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const shelfIndex = /^[1-7]$/.test(key) ? Number(key) - 1 : -1;
    if (shelfIndex >= 0) shelf = SHELVES[shelfIndex]!.id;
    else if (key === "j" || key === "ArrowDown") move(1);
    else if (key === "k" || key === "ArrowUp") move(-1);
    else if (key === "s") cycleSort();
    else if (key === "/") filterInput?.focus();
    else if (key === "z") void undo();
    else if (key === "i") void checkList();
    else if (key === "o" && selected?.release) openExternal(discogsReleaseUrl(selected.release.id));
    else if (key === "e" && selected) void startEditing(selected);
    else if (JUDGE_KEYS[key] && selected) rejudge(selected, JUDGE_KEYS[key]);
    else return;
    e.preventDefault();
  }

  function onFilterKey(e: KeyboardEvent): void {
    if (e.key === "Escape" || e.key === "Enter") {
      if (e.key === "Escape") query = "";
      (e.currentTarget as HTMLInputElement).blur();
      e.preventDefault();
    }
  }
</script>

<svelte:window {onkeydown} />

<div class="twelves">
  <header class="head">
    <h1>Twelves</h1>
    <p class="lede">
      {formatCount(counts.all)} records you want, own, or put aside.
    </p>
  </header>

  <div class="controls">
    <div class="shelves" role="tablist" aria-label="Shelves">
      {#each SHELVES as s, i (s.id)}
        <button
          type="button"
          role="tab"
          aria-selected={shelf === s.id}
          onclick={() => (shelf = s.id)}
        >
          <Key label={String(i + 1)} size="sm" />
          {s.label}
          <span class="count">{formatCount(counts[s.id])}</span>
        </button>
      {/each}
    </div>
    <div class="tools">
      <label class="filter">
        <Key label="/" size="sm" />
        <input
          bind:this={filterInput}
          bind:value={query}
          onkeydown={onFilterKey}
          placeholder="artist, title, label, cat no"
          aria-label="Filter"
        />
      </label>
      <div class="sort">
        <Key label="S" size="sm" /> sort
        {#each SORTS as s (s.id)}
          <button type="button" aria-pressed={sort === s.id} onclick={() => (sort = s.id)}>{s.label}</button>
        {/each}
      </div>
    </div>
  </div>

  {#if shelf === "maybe" || (shelf === "all" && pending > 0)}
    <div class="handoff">
      {#if !hasMaybeList}
        <p>Pick your Discogs Maybe list in Settings, under Discogs, to keep this shelf in step with it.</p>
      {:else}
        <p>
          {#if pending > 0}
            <b>{formatCount(pending)}</b>
            {pending === 1 ? "maybe is" : "maybes are"} not on your Discogs Maybe list yet. The Discogs
            API cannot add to lists: <Key label="O" /> opens the release, where "Add to list" is one
            click.
          {:else}
            Every maybe here is on your Discogs Maybe list.
          {/if}
        </p>
        <button type="button" class="check" disabled={checking} onclick={() => void checkList()}>
          <Key label="I" />
          {checking ? "Reading your Discogs Maybe list…" : "check the list again"}
        </button>
      {/if}
    </div>
  {/if}

  {#if loading}
    <p class="empty">Loading…</p>
  {:else if error}
    <p class="empty">Twelves did not load: {error}</p>
  {:else if visible.length === 0}
    <p class="empty">{query ? `Nothing matches “${query}”.` : EMPTY[shelf]}</p>
  {:else}
    <ol class="box" bind:this={listEl}>
      {#each visible as item (item.verdict.key)}
        {@const r = item.release}
        {@const isSelected = item.verdict.key === selectedKey}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
        <li
          class="card"
          class:selected={isSelected}
          aria-current={isSelected ? "true" : undefined}
          onclick={() => (selectedKey = item.verdict.key)}
        >
          <span class="catno">{r?.catno ?? ""}</span>
          <div class="who">
            {#if r}
              <a href={discogsReleaseUrl(r.id)} target="_blank" rel="noopener noreferrer">
                <span class="artist">{r.artistDisplay}</span>
                <span class="title">{r.title}</span>
              </a>
            {:else}
              <span class="title">Not in the loaded dump ({item.verdict.key})</span>
            {/if}
            {#if editingKey === item.verdict.key}
              <input
                class="note-input"
                bind:value={noteDraft}
                maxlength="4000"
                aria-label="Note"
                onkeydown={(e) => {
                  if (e.key === "Enter") saveNote(item);
                  if (e.key === "Escape") editingKey = null;
                  e.stopPropagation();
                }}
                onblur={() => (editingKey = null)}
              />
            {:else if item.verdict.notes}
              <p class="note">{item.verdict.notes}</p>
            {/if}
            {#if notOnList(item)}
              <p class="pending">not on your Discogs Maybe list yet</p>
            {/if}
          </div>
          <div class="where">
            {#if r}
              <span>{r.labelName ?? ""}</span>
              <span class="quiet">{[r.year, r.country].filter(Boolean).join(" ")}</span>
            {/if}
          </div>
          <div class="market">
            {#if r?.enrichedAt}
              <span>{r.lowestPrice !== null ? formatPrice(r.lowestPrice, r.currency) : "none for sale"}</span>
              <span class="quiet">{formatCount(r.communityWant ?? 0)} want</span>
            {:else}
              <span class="quiet">no market data</span>
            {/if}
          </div>
          <div class="verdict">
            <Stamp
              text={STATUS_COPY[item.verdict.status]}
              tone={STATUS_TONE[item.verdict.status]}
              seed={r?.id ?? item.verdict.key.length}
              size="sm"
            />
          </div>
          <span class="day quiet">{formatDay(item.verdict.decidedAt)}</span>
        </li>
      {/each}
    </ol>
  {/if}

  <footer class="foot">
    <p class="hints">
      <span><Key label="J" /><Key label="K" /> move</span>
      <span><Key label="O" /> discogs</span>
      <span><Key label="E" /> note</span>
      <span><Key label="A" /><Key label="M" /><Key label="C" /><Key label="R" /><Key label="L" /> re-judge</span>
      <span><Key label="I" /> check Maybe list</span>
      <span><Key label="Z" /> undo</span>
    </p>
    <p class="flash" aria-live="polite">{flash ?? ""}</p>
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
  h1 {
    font-family: var(--display);
    font-weight: 400;
    font-size: var(--text-2xl);
  }
  .lede {
    color: var(--faded);
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: end;
    gap: 16px 32px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--groove);
  }
  .shelves {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 22px;
  }
  .shelves button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    border: 0;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--faded);
  }
  .shelves button[aria-selected="true"] {
    color: var(--paper);
    border-bottom-color: var(--flyer);
  }
  .count {
    color: var(--dust);
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 28px;
    font-size: var(--text-sm);
    color: var(--faded);
  }
  .filter {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .filter input {
    width: 22em;
    padding: 5px 8px;
    border: 1px solid var(--groove);
    border-radius: var(--radius);
    background: var(--ground);
  }
  .filter input::placeholder {
    color: var(--dust);
  }
  .sort {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }
  .sort button {
    border: 0;
    background: none;
    padding: 2px 0;
    color: var(--dust);
  }
  .sort button[aria-pressed="true"] {
    color: var(--paper);
    text-decoration: underline;
    text-decoration-color: var(--flyer);
    text-underline-offset: 4px;
  }
  .box {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .card {
    display: grid;
    grid-template-columns: 9.5em minmax(0, 1fr) minmax(0, 15em) 8.5em 7.5em 5em;
    align-items: center;
    gap: 20px;
    padding: 12px 16px;
    border-bottom: 1px solid color-mix(in srgb, var(--groove) 60%, transparent);
    cursor: default;
  }
  .card.selected {
    background: var(--sleeve);
    box-shadow: inset 3px 0 0 var(--flyer);
  }
  .catno {
    font-weight: 600;
    color: var(--faded);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .selected .catno {
    color: var(--paper);
  }
  .who {
    min-width: 0;
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
    color: var(--faded);
  }
  .who a:hover .artist {
    text-decoration: underline;
    text-decoration-color: var(--dust);
    text-underline-offset: 3px;
  }
  .note {
    margin-top: 4px;
    color: var(--flyer);
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pending {
    margin-top: 4px;
    color: var(--faded);
    font-size: var(--text-sm);
  }
  .pending::before {
    content: "○ ";
    color: var(--flyer);
  }
  .handoff {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px 28px;
    padding: 12px 16px;
    margin-top: 12px;
    border: 1px dashed var(--groove);
    color: var(--faded);
    font-size: var(--text-sm);
  }
  .handoff p {
    max-width: 90ch;
  }
  .handoff b {
    color: var(--paper);
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 0;
    background: none;
    color: var(--paper);
    padding: 0;
  }
  .check:disabled {
    color: var(--faded);
    cursor: default;
  }
  .note-input {
    width: 100%;
    margin-top: 6px;
    padding: 4px 8px;
    border: 1px solid var(--flyer);
    border-radius: var(--radius);
    background: var(--ground);
  }
  .where,
  .market {
    display: grid;
    min-width: 0;
    font-size: var(--text-sm);
  }
  .where span,
  .market span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .verdict {
    display: grid;
    justify-items: start;
  }
  .day {
    text-align: right;
    font-size: var(--text-sm);
  }
  .quiet {
    color: var(--faded);
  }
  .empty {
    padding: 40px 0;
    color: var(--faded);
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
    border-top: 1px solid var(--groove);
    background: var(--sleeve);
  }
  .hints {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 20px;
    color: var(--faded);
    font-size: var(--text-sm);
  }
  .hints span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .flash {
    color: var(--flyer);
    font-size: var(--text-sm);
    text-align: right;
  }
  @media (max-width: 1100px) {
    .card {
      grid-template-columns: 8em minmax(0, 1fr) 7.5em 5em;
    }
    .where,
    .market {
      display: none;
    }
  }
</style>
