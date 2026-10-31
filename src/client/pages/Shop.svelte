<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { discogsListingUrl } from "../../shared/discogs-urls.ts";
  import { formatAge, formatCount, formatCounted, formatPrice } from "../../shared/display.ts";
  import { type GradeTone, listingGrade } from "../../shared/listings.ts";
  import { type ShoppingItem, shortlistTotals } from "../../shared/shopping.ts";
  import { api } from "../api.ts";
  import Key from "../components/Key.svelte";
  import Stamp from "../components/Stamp.svelte";
  import {
    hasCommandModifier,
    isControlKey,
    isInDialog,
    SHOP_KEYS,
    shortcutKey,
    type StampTone,
  } from "../keymap.ts";
  import { TriagePlayer } from "../player/triage-player.svelte.ts";
  import { getAnchor, navigate, openExternal } from "../router.svelte.ts";
  import { ShoppingSession, type ShoppingView } from "../shopping/session.svelte.ts";
  import { ShoppingShops } from "../shopping/shops.svelte.ts";
  import { settings, ui } from "../stores.svelte.ts";
  import PlayerPanel from "../triage/PlayerPanel.svelte";
  import Tracklist from "../triage/Tracklist.svelte";

  const session = new ShoppingSession(api);
  const shops = new ShoppingShops(api);
  const player = new TriagePlayer(api, {
    startAtFraction: () => settings.value?.player.startAtFraction ?? 0.5,
    skipHeard: () => false,
  });
  let username = $state("");
  let closed = false;
  const anchor = $derived(getAnchor());
  const current = $derived(session.current);
  const seller = $derived(session.shop?.seller ?? null);
  const pressing = $derived(
    current
      ? [current.release.year, current.release.country, current.release.formatSummary]
          .filter(Boolean)
          .join(" · ")
      : "",
  );
  const grade = $derived(current ? listingGrade(current.listing) : null);
  const locked = $derived(session.busy || shops.busy || session.loading);
  const totals = $derived(shortlistTotals(session.shop?.items ?? []));
  const sellers = $derived(shops.sellers.map((shop) => (shop.id === seller?.id ? seller : shop)));
  const shortlist = $derived(
    session.shop?.items.filter((item) => item.state === "shortlisted") ?? [],
  );
  const unpriced = $derived(
    shortlist.filter(
      (item) =>
        item.availability !== "available" ||
        item.listing.price === null ||
        item.listing.currency === null,
    ).length,
  );
  const partial = $derived(seller !== null && seller.listingsRead < seller.listings);
  const reviewing = $derived(session.view === "shortlisted");
  const views: { value: ShoppingView; label: string }[] = [
    { value: "pending", label: "To review" },
    { value: "shortlisted", label: "Shortlist" },
    { value: "skipped", label: "Skipped" },
  ];
  const STAMP_TONES: Record<GradeTone, StampTone> = { top: "accent", fair: "plain", worn: "muted" };

  function viewCount(view: ShoppingView): number {
    return session.shop?.items.filter((item) => item.state === view).length ?? 0;
  }

  function copyPrice(item: ShoppingItem): string {
    return item.listing.price === null
      ? "Price unavailable"
      : formatPrice(item.listing.price, item.listing.currency);
  }

  onMount(() => {
    void shops.load();
    return () => {
      closed = true;
      shops.destroy();
      session.destroy();
    };
  });

  $effect(() => {
    const id = Number(anchor);
    if (Number.isSafeInteger(id) && id > 0) untrack(() => void session.open(id));
  });

  $effect(() => {
    const detail = session.detail;
    untrack(() => player.show(detail, null, "found"));
  });

  async function readShop(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    session.message = "";
    const id = await shops.read("seller", username.trim());
    if (!closed && id !== null) {
      selectSeller(String(id));
      username = "";
    }
  }

  function selectSeller(id: string): void {
    if (anchor === id) void session.open(Number(id));
    else navigate("shop", id);
  }

  async function refresh(kind: "seller" | "wantlist"): Promise<void> {
    const selected = seller;
    const view = session.view;
    const selectedId = session.selectedId;
    session.message = "";
    await shops.read(kind, kind === "seller" ? selected?.username : undefined);
    if (closed || shops.error || !selected) return;
    await session.open(selected.id);
    if (closed) return;
    session.switchView(view);
    if (session.items.some((item) => item.listing.id === selectedId)) session.select(selectedId);
  }

  const keepFocus = (event: MouseEvent) => event.preventDefault();

  function onkeydown(event: KeyboardEvent): void {
    if (
      ui.helpOpen ||
      event.defaultPrevented ||
      isControlKey(event) ||
      isInDialog(event) ||
      hasCommandModifier(event)
    )
      return;
    const key = shortcutKey(event);
    if (key === null) return;
    const action = playbackAction(key) ?? shoppingAction(key);
    if (!action) return;
    event.preventDefault();
    if (!event.repeat || key === "ArrowLeft" || key === "ArrowRight") action();
  }

  function playbackAction(key: string): (() => void) | undefined {
    if (/^[1-9]$/.test(key)) return () => player.jumpTo(Number(key) / 10);
    const seek = settings.value?.player.seekStepSeconds ?? 10;
    const actions: Record<string, () => void> = {
      " ": () => player.toggle(),
      j: () => player.nextTrack(),
      k: () => player.previousTrack(),
      ArrowLeft: () => player.seekBy(-seek),
      ArrowRight: () => player.seekBy(seek),
      o: () => {
        if (current) openExternal(discogsListingUrl(current.listing.id));
      },
    };
    return actions[key];
  }

  function shoppingAction(key: string): (() => void) | undefined {
    if (locked) return undefined;
    const actions: Record<string, () => void> = {
      [SHOP_KEYS.keep.toLowerCase()]: () => void session.decide("shortlisted"),
      [SHOP_KEYS.skip.toLowerCase()]: () => void session.decide("skipped"),
      [SHOP_KEYS.undo.toLowerCase()]: () => void session.undo(),
      [SHOP_KEYS.refreshAudio.toLowerCase()]: () => void session.refreshAudio(),
    };
    return actions[key];
  }
</script>

<svelte:window {onkeydown} />

<div class="shop">
  <header class="bar">
    <div class="seller">
      <h1>Shop my wants</h1>
      <select
        aria-label="Seller"
        value={seller?.id ?? ""}
        disabled={locked}
        onchange={(event) => selectSeller(event.currentTarget.value)}
      >
        <option value="" disabled>Choose a saved shop</option>
        {#each sellers as shop (shop.id)}
          <option value={shop.id}>{shop.username} · {formatCounted(shop.wants, "want")}</option>
        {/each}
      </select>
      {#if seller}
        <p class="quiet">
          read <time datetime={seller.readAt}>{formatAge(seller.readAt)}</time>
          {#if partial}<span class="warning"
              >· {formatCount(seller.listingsRead)} of {formatCount(seller.listings)} listings, some wants
              may be missing</span
            >{/if}
        </p>
        <button type="button" class="text" disabled={locked} onclick={() => void refresh("seller")}
          >Refresh shop</button
        >
      {/if}
    </div>
    <div class="sources">
      <form onsubmit={readShop}>
        <label for="shopping-username">Read a seller’s shop</label>
        <input
          id="shopping-username"
          bind:value={username}
          placeholder="Discogs username"
          required
          autocomplete="off"
          spellcheck="false"
          disabled={locked}
        />
        <button type="submit" disabled={locked || !username.trim()}>Read shop</button>
      </form>
      <button
        type="button"
        class="text"
        disabled={locked || !settings.value?.discogs.username}
        onclick={() => void refresh("wantlist")}>Refresh my wantlist</button
      >
    </div>
  </header>

  <div class="workspace" class:started={seller !== null}>
    {#if seller}
      <div class="copies">
        <fieldset class="views">
          <legend class="visually-hidden">Shopping view</legend>
          {#each views as view (view.value)}
            <label>
              <input
                type="radio"
                name="shopping-view"
                value={view.value}
                checked={session.view === view.value}
                disabled={locked}
                onchange={() => session.switchView(view.value)}
              />
              {view.label} <span class="count figures">{viewCount(view.value)}</span>
            </label>
          {/each}
        </fieldset>

        <aside aria-label="Shopping copies">
          <ul>
            {#each session.items as item (item.listing.id)}
              <li>
                <button
                  type="button"
                  aria-current={current?.listing.id === item.listing.id ? "true" : undefined}
                  disabled={locked}
                  onmousedown={keepFocus}
                  onclick={() => session.select(item.listing.id)}
                >
                  <span class="artist">{item.release.artistDisplay}</span>
                  <span class="price" class:figures={item.listing.price !== null}
                    >{copyPrice(item)}</span
                  >
                  <span class="title">{item.release.title}</span>
                  <span class="catno figures"
                    >{item.release.catno ?? `release ${item.release.id}`}</span
                  >
                  {#if item.availability !== "available"}<span class="warning"
                      >{item.availability === "unknown"
                        ? "Availability unknown"
                        : "No longer listed"}</span
                    >{/if}
                </button>
              </li>
            {/each}
          </ul>
          {#if session.items.length === 0}
            <p class="quiet">
              {session.view === "pending"
                ? "No unreviewed matching copies. Refresh your wantlist or shop, review your shortlist, or revisit skipped copies."
                : "No copies here yet."}
            </p>
          {/if}
        </aside>

        <div class="subtotal" role="group" aria-label="Shortlist subtotal">
          <p><b>{shortlist.length} shortlisted</b></p>
          {#if shortlist.length > 0}
            {#each totals as total (total.currency)}<p class="amount figures">
                {formatPrice(total.amount, total.currency)}
              </p>{/each}
            <p class="quiet">
              before shipping and taxes{unpriced > 0
                ? `, ${formatCounted(unpriced, "copy", "copies")} not counted`
                : ""}
            </p>
            <p class="quiet">Open each copy on Discogs to buy it.</p>
          {/if}
        </div>
      </div>
    {/if}

    <section class="review" aria-label="Shopping review" aria-busy={session.busy}>
      <div class="desk">
        {#if session.loading}
          <p class="state quiet">Loading shop…</p>
        {:else if !seller}
          <div class="state">
            <h2>Start with a seller</h2>
            <p>
              Hear a seller’s copies of your wantlist, then review your shortlist before buying.
            </p>
            {#if sellers.length > 0}
              <ul class="saved" aria-label="Saved shops">
                {#each sellers as shop (shop.id)}
                  <li>
                    <button
                      type="button"
                      disabled={locked}
                      onclick={() => selectSeller(String(shop.id))}
                    >
                      <span class="name">{shop.username}</span>
                      <span class="quiet"
                        >{formatCounted(shop.wants, "want")} · {shop.shortlisted} shortlisted · read
                        <time datetime={shop.readAt}>{formatAge(shop.readAt)}</time></span
                      >
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
            <p class="quiet">
              Choose a saved shop or read one by Discogs username. Matches are the exact pressings
              on your Discogs wantlist; digging filters and verdicts do not apply.
            </p>
            <p class="quiet">
              <a href="#/settings/discogs">Connect your Discogs account</a> if you have not imported your
              wantlist yet.
            </p>
            {#if shops.error}<button type="button" onclick={() => void shops.load()}
                >Reload saved shops</button
              >{/if}
          </div>
        {:else if !current}
          <div class="state">
            <h2>
              {reviewing && session.items.length > 0
                ? "Review complete"
                : "Ready for another pass?"}
            </h2>
            <p class="quiet">
              Your decisions are saved. Skipping a copy leaves your wantlist unchanged.
            </p>
            <button
              type="button"
              disabled={locked}
              onclick={() => session.switchView("shortlisted")}>Review shortlist</button
            >
          </div>
        {/if}

        <div class="listening" hidden={!current}>
          <div class="record">
            {#if current}
              <div
                class="facts"
                data-release-id={current.release.id}
                data-listing-id={current.listing.id}
              >
                <header class="identity">
                  <div class="label-line">
                    {#if current.release.catno}<Stamp
                        text={current.release.catno}
                        seed={current.release.id}
                        size="lg"
                      />{/if}
                    <p class="label">{current.release.labelName ?? "Unknown label"}</p>
                  </div>
                  <h2>{current.release.artistDisplay}</h2>
                  <p class="title">{current.release.title}</p>
                  <p class="quiet">{pressing}</p>
                </header>

                <div class="copy">
                  <p class="eyebrow">{seller?.username}’s copy</p>
                  <div class="offer">
                    <strong>{copyPrice(current)}</strong>
                    {#if grade}
                      <span aria-hidden="true"
                        ><Stamp
                          text={grade.text}
                          tone={grade.tone ? STAMP_TONES[grade.tone] : "plain"}
                          seed={current.listing.id}
                        /></span
                      >
                      <span class="visually-hidden">{grade.spoken}</span>
                    {/if}
                    <a
                      href={discogsListingUrl(current.listing.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-keyshortcuts="O">View copy on Discogs</a
                    >
                  </div>
                  {#if current.listing.comments}<p class="comment">
                      {current.listing.comments}
                    </p>{/if}
                  {#if current.priceChanged}<p class="warning">
                      Price changed since your decision: previously {current.savedPrice === null
                        ? "unknown"
                        : formatPrice(current.savedPrice, current.savedCurrency)}.
                    </p>{/if}
                  {#if current.availability !== "available"}<p class="warning">
                      {current.availability === "unknown"
                        ? "This copy was not found in the partial inventory. Check availability on Discogs."
                        : "This copy is no longer in the seller’s inventory. Your saved selection remains here."}
                    </p>{/if}
                </div>
              </div>
            {/if}

            <div class="tracks">
              {#if session.detail}<Tracklist
                  detail={session.detail}
                  {player}
                  onplay={(index) => player.playEntry(index)}
                />{/if}
              <div class="track-tools">
                <button
                  type="button"
                  class="text"
                  disabled={locked || session.refreshingAudio || !current}
                  aria-busy={session.refreshingAudio}
                  aria-keyshortcuts={SHOP_KEYS.refreshAudio}
                  onmousedown={keepFocus}
                  onclick={() => void session.refreshAudio()}
                >
                  <Key label={SHOP_KEYS.refreshAudio} size="sm" aria-hidden="true" />
                  {session.refreshingAudio ? "Refreshing audio…" : "Refresh audio"}
                </button>
                {#if session.detailError}<button
                    type="button"
                    class="text"
                    onclick={() => session.select(session.selectedId)}>Retry release</button
                  >{/if}
              </div>
            </div>
          </div>

          <div class="side">
            <PlayerPanel
              {player}
              item={current?.release ?? null}
              detail={session.detail}
              detailError={session.detailError}
              mode="shopping"
              startAtFraction={settings.value?.player.startAtFraction ?? 0.5}
              seekStepSeconds={settings.value?.player.seekStepSeconds ?? 10}
            />
          </div>
        </div>
      </div>

      <footer class:idle={!seller}>
        {#if seller}
          <div class="actions">
            <button
              type="button"
              class="decision accent"
              disabled={!current || locked}
              onmousedown={keepFocus}
              aria-keyshortcuts={SHOP_KEYS.keep}
              onclick={() => void session.decide("shortlisted")}
            >
              <Key label={SHOP_KEYS.keep} primary size="lg" aria-hidden="true" />
              <span>{reviewing ? "Keep & next" : "Shortlist & next"}</span>
            </button>
            <button
              type="button"
              class="decision"
              disabled={!current || locked}
              onmousedown={keepFocus}
              aria-keyshortcuts={SHOP_KEYS.skip}
              onclick={() => void session.decide("skipped")}
            >
              <Key label={SHOP_KEYS.skip} primary size="lg" aria-hidden="true" />
              <span>{reviewing ? "Remove & next" : "Skip & next"}</span>
            </button>
            <button
              type="button"
              class="text"
              disabled={locked || session.history.length === 0}
              onmousedown={keepFocus}
              aria-keyshortcuts={SHOP_KEYS.undo}
              onclick={() => void session.undo()}
            >
              <Key label={SHOP_KEYS.undo} aria-hidden="true" /> undo
            </button>
          </div>
        {/if}
        <div class="messages">
          <p class="error" role="alert">{shops.error || session.error || ""}</p>
          <p role="status">{session.message || shops.message}</p>
        </div>
      </footer>
    </section>
  </div>
</div>

<style>
  button {
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--fg);
    padding: 6px 10px;
  }
  button:disabled {
    color: var(--fg-faint);
  }
  button:not(:disabled):hover {
    border-color: var(--fg-muted);
  }
  button.text {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 0;
    background: none;
    padding: 4px 0;
    color: var(--fg-muted);
  }
  button.text:not(:disabled):hover {
    color: var(--fg);
  }
  button.text:disabled {
    opacity: 0.5;
  }
  .quiet {
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .warning,
  .error {
    color: var(--fg-accent);
  }
  .shop {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  /* One row: which shop, then where the shops and the wants come from. */
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px 32px;
    padding: 12px 24px;
    border-bottom: 1px solid var(--rule);
    font-size: var(--text-sm);
  }
  .seller,
  .sources,
  form {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 16px;
    min-width: 0;
  }
  form {
    gap: 8px;
  }
  h1 {
    font-family: var(--display);
    font-size: var(--text-md);
    margin-right: 8px;
  }
  select {
    flex: none;
    width: 20em;
    max-width: 100%;
  }
  .bar button.text {
    color: var(--fg);
  }
  label {
    color: var(--fg-muted);
  }
  input {
    width: 12em;
  }

  .workspace {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }
  .workspace.started {
    grid-template-columns: 300px minmax(0, 1fr);
  }

  .copies {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-right: 1px solid var(--rule);
    background: var(--surface);
  }
  .views {
    display: flex;
    gap: 2px;
    margin: 0;
    padding: 12px;
    border: 0;
    border-bottom: 1px solid var(--rule);
    font-size: var(--text-sm);
  }
  .views label {
    position: relative;
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: baseline;
    gap: 6px;
    padding: 6px 4px;
    border-radius: var(--radius);
    color: var(--fg-muted);
    white-space: nowrap;
  }
  .views label:has(:checked) {
    background: var(--bg);
    color: var(--fg);
    box-shadow: inset 0 -2px 0 var(--accent-mark);
  }
  .views label:has(:focus-visible) {
    outline: 2px solid var(--accent-mark);
    outline-offset: 1px;
  }
  .views label:has(:disabled) {
    opacity: 0.6;
  }
  .views input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
  }
  .count {
    color: var(--fg-faint);
    font-size: var(--text-xs);
  }
  aside {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 0;
  }
  aside > p {
    margin: 12px 16px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li button {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 2px 12px;
    width: 100%;
    padding: 10px 16px;
    border: 0;
    border-radius: 0;
    background: transparent;
    text-align: left;
    font-size: var(--text-sm);
  }
  li button[aria-current] {
    background: var(--bg);
    box-shadow: inset 3px 0 0 var(--accent-mark);
  }
  li button:disabled {
    color: inherit;
  }
  .artist,
  .name {
    font-weight: 600;
  }
  .price {
    text-align: right;
  }
  .title,
  .catno {
    color: var(--fg-muted);
  }
  .catno {
    text-align: right;
    font-size: var(--text-xs);
    align-self: center;
  }
  li .warning {
    grid-column: 1 / -1;
    font-size: var(--text-xs);
  }
  .subtotal {
    display: grid;
    gap: 2px;
    padding: 14px 16px 16px;
    border-top: 1px solid var(--rule);
    font-size: var(--text-sm);
  }
  .amount {
    font-size: var(--text-xl);
    font-weight: 600;
    margin-block: 2px 4px;
  }

  .review {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .desk {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 28px 32px 20px;
  }
  .state {
    display: grid;
    justify-items: start;
    gap: 14px;
    max-width: 60ch;
  }
  .saved {
    display: grid;
    gap: 8px;
    width: 100%;
    margin-block: 8px;
  }
  .saved button {
    display: grid;
    gap: 2px;
    width: 100%;
    padding: 10px 14px;
    text-align: left;
    background: var(--surface);
  }
  .state h2 {
    font-family: var(--display);
    font-size: var(--text-xl);
    line-height: 1.3;
  }
  .listening {
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(280px, 1fr);
    gap: 40px;
  }
  .listening[hidden] {
    display: none;
  }
  .record,
  .facts {
    display: grid;
    align-content: start;
    gap: var(--space-heading);
    min-width: 0;
  }
  .identity {
    display: grid;
    gap: 8px;
    min-width: 0;
  }
  .label-line {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 4px;
    min-width: 0;
  }
  .label {
    color: var(--fg-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .identity h2 {
    font-family: var(--display);
    font-size: clamp(22px, 2.2vw, var(--text-2xl));
    line-height: 1.2;
    overflow-wrap: anywhere;
  }
  .identity .title {
    color: var(--fg);
    font-size: var(--text-lg);
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .copy {
    display: grid;
    gap: 8px;
    padding-left: 14px;
    box-shadow: inset 3px 0 0 var(--accent-mark);
  }
  .eyebrow {
    color: var(--fg-faint);
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .offer {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 20px;
  }
  .offer strong {
    font-size: var(--text-xl);
    font-weight: 600;
  }
  .offer a {
    font-size: var(--text-sm);
    color: var(--fg-muted);
  }
  .comment {
    color: var(--fg-muted);
    font-size: var(--text-sm);
    white-space: pre-wrap;
    max-width: 70ch;
  }
  .copy .warning {
    font-size: var(--text-sm);
  }
  .tracks {
    display: grid;
    gap: 8px;
    min-width: 0;
  }
  .track-tools {
    display: flex;
    gap: 20px;
    font-size: var(--text-sm);
  }
  .side {
    min-width: 0;
  }

  footer {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px 24px;
    padding: 14px 32px 16px;
    border-top: 1px solid var(--rule);
    background: var(--surface);
  }
  .actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
  }
  .decision {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    padding: 8px 18px 8px 8px;
    background: var(--bg);
  }
  .decision span {
    font-family: var(--display);
    font-size: var(--text-md);
  }
  .decision:disabled {
    opacity: 0.4;
    color: var(--fg);
  }
  .accent span {
    color: var(--fg-accent);
  }
  .actions .text {
    margin-left: 14px;
    font-size: var(--text-sm);
  }
  .messages {
    font-size: var(--text-sm);
    text-align: right;
    color: var(--fg-muted);
  }

  footer.idle {
    border-top: 0;
    background: none;
  }

  @media (max-width: 1080px) {
    .listening {
      grid-template-columns: minmax(0, 1fr);
      gap: 28px;
    }
  }
  @media (max-width: 800px) {
    .shop {
      height: auto;
      min-height: 100%;
    }
    .workspace.started {
      grid-template-columns: minmax(0, 1fr);
    }
    .copies {
      border-right: 0;
      border-bottom: 1px solid var(--rule);
    }
    aside {
      max-height: 240px;
    }
    .desk {
      padding: 20px;
    }
    footer {
      padding: 12px 20px;
    }
  }
</style>
