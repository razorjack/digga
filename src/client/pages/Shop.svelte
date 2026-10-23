<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { discogsListingUrl } from "../../shared/discogs-urls.ts";
  import { formatAge, formatCount, formatPrice } from "../../shared/display.ts";
  import { shortlistTotals } from "../../shared/shopping.ts";
  import { api } from "../api.ts";
  import Key from "../components/Key.svelte";
  import { hasCommandModifier, isControlKey, isInDialog, SHOP_KEYS, shortcutKey } from "../keymap.ts";
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
  const metadata = $derived(current ? [current.release.labelName, current.release.catno, current.release.year, current.release.country, current.release.formatSummary].filter(Boolean).join(" · ") : "");
  const locked = $derived(session.busy || shops.busy || session.loading);
  const totals = $derived(shortlistTotals(session.shop?.items ?? []));
  const sellers = $derived(shops.sellers.map((shop) => shop.id === seller?.id ? seller : shop));
  const shortlist = $derived(session.shop?.items.filter((item) => item.state === "shortlisted") ?? []);
  const unpriced = $derived(shortlist.filter((item) => item.availability !== "available" || item.listing.price === null || item.listing.currency === null).length);
  const views: { value: ShoppingView; label: string }[] = [
    { value: "pending", label: "My wants" },
    { value: "shortlisted", label: "Shortlist" },
    { value: "skipped", label: "Skipped" },
  ];

  onMount(() => {
    void shops.load();
    return () => { closed = true; shops.destroy(); session.destroy(); };
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
    if (ui.helpOpen || event.defaultPrevented || isControlKey(event) || isInDialog(event) || hasCommandModifier(event)) return;
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
      " ": () => player.toggle(), j: () => player.nextTrack(), k: () => player.previousTrack(),
      ArrowLeft: () => player.seekBy(-seek), ArrowRight: () => player.seekBy(seek),
      o: () => { if (current) openExternal(discogsListingUrl(current.listing.id)); },
    };
    return actions[key];
  }

  function shoppingAction(key: string): (() => void) | undefined {
    if (locked) return undefined;
    const actions: Record<string, () => void> = {
      [SHOP_KEYS.keep.toLowerCase()]: () => void session.decide("shortlisted"),
      [SHOP_KEYS.skip.toLowerCase()]: () => void session.decide("skipped"),
      [SHOP_KEYS.undo.toLowerCase()]: () => void session.undo(),
    };
    return actions[key];
  }
</script>

<svelte:window {onkeydown} />

<div class="shop">
  <header class="heading">
    <div>
      <h1>Shop my wants</h1>
      <p>Hear a seller’s copies of your wantlist, then review your shortlist before buying.</p>
    </div>
    <a href="#/twelves">Back to Twelves</a>
  </header>

  <div class="shop-tools">
    <label>Seller
      <select aria-label="Seller" value={seller?.id ?? ""} disabled={locked} onchange={(event) => selectSeller(event.currentTarget.value)}>
        <option value="" disabled>Choose a saved shop</option>
        {#each sellers as shop (shop.id)}
          <option value={shop.id}>{shop.username} · {shop.wants} wants · {shop.shortlisted} shortlisted</option>
        {/each}
      </select>
    </label>
    <form onsubmit={readShop}>
      <label for="shopping-username">Read a seller’s shop</label>
      <input id="shopping-username" bind:value={username} placeholder="Discogs username" required autocomplete="off" spellcheck="false" disabled={locked} />
      <button type="submit" disabled={locked || !username.trim()}>Read shop</button>
    </form>
    <button type="button" disabled={locked || !settings.value?.discogs.username} onclick={() => void refresh("wantlist")}>Refresh my wantlist</button>
  </div>

  <p class="notice" role="status">{session.message || shops.message}</p>
  <p class="error" role="alert">{shops.error || session.error || ""}</p>

  {#if seller}
    <div class="scope">
      <p><b>{seller.username}</b> · {formatCount(seller.wants)} matching wants · read {formatAge(seller.readAt)}. Exact pressings; digging filters do not apply.</p>
      <button type="button" disabled={locked} onclick={() => void refresh("seller")}>Refresh shop</button>
    </div>
    {#if seller.listingsRead < seller.listings}
      <p class="notice">Partial inventory: {formatCount(seller.listingsRead)} of {formatCount(seller.listings)} listings read. Some wants may be missing; absent shortlisted copies have unknown availability.</p>
    {/if}
    <div class="review-tools">
      <fieldset>
        <legend class="visually-hidden">Shopping view</legend>
        {#each views as view (view.value)}
          <label>
            <input type="radio" name="shopping-view" value={view.value} checked={session.view === view.value} disabled={locked} onchange={() => session.switchView(view.value)} />
            {view.label} <span>{session.shop?.items.filter((item) => item.state === view.value).length ?? 0}</span>
          </label>
        {/each}
      </fieldset>
      <p aria-label="Shortlist subtotal">
        <b>{shortlist.length} shortlisted</b>
        {#each totals as total (total.currency)} · {formatPrice(total.amount, total.currency)}{/each}
        <span class="quiet"> · before shipping and taxes{unpriced > 0 ? ` · ${unpriced} copies excluded from subtotal` : ""}</span>
      </p>
    </div>
  {/if}

  <div class="workspace">
    <aside aria-label="Shopping copies">
      {#if session.loading}<p>Loading shop…</p>
      {:else if !seller}
        <h2>Start with a seller</h2>
        <p>Choose a shop you already read, or enter a Discogs username above.</p>
        <p>Your Discogs wantlist supplies the matches. <a href="#/settings/discogs">Connect your Discogs account</a> if you have not imported it yet.</p>
        <button type="button" onclick={() => void shops.load()}>Reload saved shops</button>
      {:else}
        <h2>{views.find((view) => view.value === session.view)?.label}</h2>
        <ul>
          {#each session.items as item (item.listing.id)}
            <li>
              <button type="button" aria-current={current?.listing.id === item.listing.id ? "true" : undefined} disabled={locked} onmousedown={keepFocus} onclick={() => session.select(item.listing.id)}>
                <span class="artist">{item.release.artistDisplay}</span>
                <span>{item.release.title}</span>
                <span class="copy-price">{item.listing.price === null ? "Price unavailable" : formatPrice(item.listing.price, item.listing.currency)} · {item.release.catno ?? `release ${item.release.id}`}</span>
                {#if item.availability !== "available"}<span class="quiet">{item.availability === "unknown" ? "Availability unknown" : "No longer listed"}</span>{/if}
              </button>
            </li>
          {/each}
        </ul>
        {#if session.items.length === 0}
          <p>{session.view === "pending" ? "No unreviewed matching copies. Refresh your wantlist or shop, review your shortlist, or revisit skipped copies." : "No copies here yet."}</p>
        {/if}
      {/if}
    </aside>

    <section class="listening" aria-label="Shopping review" aria-busy={session.busy}>
      <div class="review-content">
      {#if current}
        <header class="record" data-release-id={current.release.id} data-listing-id={current.listing.id}>
          <p class="quiet">{metadata}</p>
          <h2>{current.release.artistDisplay}</h2>
          <p class="record-title">{current.release.title}</p>
          <div class="copy">
            <strong>{current.listing.price === null ? "Price unavailable" : formatPrice(current.listing.price, current.listing.currency)}</strong>
            <p>Media: {current.listing.mediaCondition ?? "Not graded"}<br />Sleeve: {current.listing.sleeveCondition ?? "Not graded"}</p>
            <a href={discogsListingUrl(current.listing.id)} target="_blank" rel="noopener noreferrer" aria-keyshortcuts="O">View copy on Discogs</a>
          </div>
          {#if current.listing.comments}<p class="comment">{current.listing.comments}</p>{/if}
          {#if current.priceChanged}<p class="warning">Price changed since your decision: previously {current.savedPrice === null ? "unknown" : formatPrice(current.savedPrice, current.savedCurrency)}.</p>{/if}
          {#if current.availability !== "available"}<p class="warning">{current.availability === "unknown" ? "This copy was not found in the partial inventory. Check availability on Discogs." : "This copy is no longer in the seller’s inventory. Your saved selection remains here."}</p>{/if}
        </header>
      {:else if seller && !session.loading}
        <div class="empty">
          <h2>{session.view === "shortlisted" && session.items.length > 0 ? "Review complete" : "Ready for another pass?"}</h2>
          <p>Your decisions are saved. Skipping a copy leaves your wantlist unchanged.</p>
          <button type="button" disabled={locked} onclick={() => session.switchView("shortlisted")}>Review shortlist</button>
        </div>
      {/if}

      <div class="audio" hidden={!current}>
        <PlayerPanel {player} item={current?.release ?? null} detail={session.detail} detailError={session.detailError} mode="shopping" startAtFraction={settings.value?.player.startAtFraction ?? 0.5} seekStepSeconds={settings.value?.player.seekStepSeconds ?? 10} />
        <div class="tracks">
          {#if session.detail}<Tracklist detail={session.detail} {player} onplay={(index) => player.playEntry(index)} />{/if}
          {#if session.detailError}<button type="button" onclick={() => session.select(session.selectedId)}>Retry release</button>{/if}
        </div>
      </div>
      </div>
      <footer>
        <div class="actions">
          <button type="button" class="primary" disabled={!current || locked} onmousedown={keepFocus} aria-keyshortcuts={SHOP_KEYS.keep} onclick={() => void session.decide("shortlisted")}><Key label={SHOP_KEYS.keep} /> {session.view === "shortlisted" ? "Keep & next" : "Shortlist & next"}</button>
          <button type="button" disabled={!current || locked} onmousedown={keepFocus} aria-keyshortcuts={SHOP_KEYS.skip} onclick={() => void session.decide("skipped")}><Key label={SHOP_KEYS.skip} /> {session.view === "shortlisted" ? "Remove & next" : "Skip & next"}</button>
          <button type="button" disabled={locked || session.history.length === 0} onmousedown={keepFocus} aria-keyshortcuts={SHOP_KEYS.undo} onclick={() => void session.undo()}><Key label={SHOP_KEYS.undo} /> Undo</button>
        </div>
        <p class="quiet">Saved in Digga. Open the chosen copies on Discogs to add them to your cart and buy.</p>
      </footer>
    </section>
  </div>
</div>

<style>
  button { border: 1px solid var(--rule); border-radius: var(--radius); background: var(--surface); color: var(--fg); padding: 6px 10px; }
  button:disabled { color: var(--fg-faint); }
  button:not(:disabled):hover { border-color: var(--fg-muted); }
  .shop { height: 100%; display: flex; flex-direction: column; overflow: auto; }
  .heading, .shop-tools, .scope, .review-tools { display: flex; align-items: center; flex-wrap: wrap; gap: 12px 24px; padding: 12px 24px; border-bottom: 1px solid var(--rule); }
  .heading { justify-content: space-between; padding-block: 20px; }
  h1 { font-family: var(--display); font-size: var(--text-lg); }
  .heading p, .quiet, .scope, aside p { color: var(--fg-muted); font-size: var(--text-sm); }
  .heading p { margin-top: 8px; }
  .shop-tools { background: var(--surface); font-size: var(--text-sm); }
  .shop-tools label, form { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
  input { width: 18em; }
  select { max-width: 28em; }
  .notice:not(:empty), .error:not(:empty) { padding: 8px 24px; font-size: var(--text-sm); }
  .error, .warning { color: var(--fg-accent); }
  .scope { justify-content: space-between; }
  fieldset { display: flex; gap: 16px; border: 0; }
  fieldset label { display: flex; gap: 6px; align-items: center; }
  fieldset input { width: auto; accent-color: var(--accent-mark); }
  fieldset label:has(:checked) { color: var(--fg-accent); }
  .review-tools { justify-content: space-between; font-size: var(--text-sm); }
  .workspace { display: grid; grid-template-columns: 280px minmax(0, 1fr); flex: 1; min-height: 0; }
  aside { padding: 20px 12px; border-right: 1px solid var(--rule); overflow: auto; background: var(--surface); }
  aside h2, aside > p { margin: 0 12px 16px; }
  aside h2 { font-size: var(--text-sm); }
  ul { list-style: none; margin: 0; padding: 0; }
  li button { display: grid; gap: 4px; width: 100%; text-align: left; background: transparent; border: 0; padding: 12px; font-size: var(--text-sm); }
  li button[aria-current] { background: var(--bg); box-shadow: inset 3px 0 0 var(--accent-mark); }
  .artist { font-weight: 600; }
  .copy-price { margin-top: 4px; color: var(--fg-accent); }
  .listening { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .review-content { flex: 1; min-height: 0; overflow: auto; padding: 24px; }
  .record { margin-bottom: 20px; }
  .record h2 { font-family: var(--display); font-size: var(--text-xl); margin-block: 12px 4px; }
  .record-title { font-size: var(--text-lg); }
  .copy { display: flex; align-items: center; flex-wrap: wrap; gap: 16px 28px; margin-top: 20px; padding-left: 14px; box-shadow: inset 3px 0 0 var(--accent-mark); }
  .copy strong { font-size: var(--text-xl); }
  .copy p, .copy a, .comment, .warning { font-size: var(--text-sm); }
  .comment, .warning { margin-top: 12px; white-space: pre-wrap; }
  .audio { display: grid; grid-template-columns: minmax(280px, 480px) minmax(240px, 1fr); gap: 24px; }
  .audio[hidden] { display: none; }
  .tracks { min-width: 0; }
  .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
  .actions button { display: flex; align-items: center; gap: 8px; }
  .primary { background: var(--accent); color: var(--on-accent); }
  footer { flex: none; padding: 14px 24px; background: var(--surface); border-top: 1px solid var(--rule); }
  .empty { padding-block: 24px; display: grid; justify-items: start; gap: 16px; }
  @media (max-width: 1200px) { .audio { grid-template-columns: 1fr; } }
  @media (max-width: 800px) { .workspace { grid-template-columns: 1fr; } aside { max-height: 220px; } .shop { overflow: auto; } .workspace { min-height: auto; } }
</style>
