<script lang="ts">
  import type { QueueItem, ReleaseDetail } from "../../shared/api.ts";
  import { formatAge, formatCount, formatPrice } from "../../shared/display.ts";
  import Key from "../components/Key.svelte";
  import Stamp from "../components/Stamp.svelte";

  let {
    item,
    detail,
    pricing,
    onprice,
  }: {
    item: QueueItem;
    detail: ReleaseDetail | null;
    /** P asked Discogs for the market data and the answer has not come yet. */
    pricing: boolean;
    onprice: () => void;
  } = $props();

  const catno = $derived(
    item.catno && item.catno.trim().toLowerCase() !== "none" ? item.catno : "no cat",
  );
  const otherLabels = $derived(
    detail
      ? [...new Set(detail.release.labels.map((l) => l.name))].filter((n) => n !== item.labelName)
      : [],
  );
  const genres = $derived(detail ? detail.release.genres.filter((g) => g !== "Electronic") : []);
  const enrichedAt = $derived(item.enrichedAt);
  // The button never keeps focus, so Space always reaches the player.
  const keepFocus = (event: MouseEvent) => event.preventDefault();
  const siblings = $derived(detail?.siblings ?? []);
</script>

<header class="facts">
  <div class="label-line">
    <Stamp text={catno} seed={item.id} size="lg" />
    <p class="label">
      {item.labelName ?? "Unknown label"}
      {#if otherLabels.length > 0}<span class="also">with {otherLabels.join(", ")}</span>{/if}
    </p>
  </div>

  <h1 class="artist">{item.artistDisplay || "Unknown artist"}</h1>
  <p class="title">{item.title}</p>

  <dl class="meta">
    <div>
      <dt class="visually-hidden">Year and country</dt>
      <dd>
        <span class="strong">{item.year ?? "year unknown"}</span>
        {item.country ?? "country unknown"}
      </dd>
    </div>
    <div>
      <dt class="visually-hidden">Format</dt>
      <dd>{item.formatSummary || "format unknown"}</dd>
    </div>
    <div>
      <dt class="visually-hidden">Styles</dt>
      <dd>{[...item.styles, ...genres].join(", ")}</dd>
    </div>
  </dl>

  <div class="market">
    <!-- Keyed by record, so the next record's line is not announced; the answer to P is. -->
    {#key item.id}
      <p role="status" aria-busy={pricing}>
        {#if enrichedAt !== null}
          <span>
            {#if item.lowestPrice !== null}
              <span class="strong">{formatPrice(item.lowestPrice, item.currency)}</span> lowest,
              {formatCount(item.numForSale ?? 0)} for sale
            {:else}
              none for sale
            {/if}
          </span>
          <span>
            <span class="strong">{formatCount(item.communityWant ?? 0)}</span> want
            <span class="strong">{formatCount(item.communityHave ?? 0)}</span> have
          </span>
        {/if}
        {#if pricing}
          <span class="quiet">asking Discogs…</span>
        {:else if enrichedAt !== null}
          <span class="quiet">checked <time datetime={enrichedAt}>{formatAge(enrichedAt)}</time></span>
        {:else}
          <span class="quiet">no price or have/want yet</span>
        {/if}
      </p>
    {/key}
    <button
      type="button"
      tabindex="-1"
      aria-keyshortcuts="P"
      disabled={pricing}
      onmousedown={keepFocus}
      onclick={onprice}
    >
      <Key label="P" size="sm" aria-hidden="true" />
      {enrichedAt === null ? "ask Discogs" : "ask again"}
    </button>
  </div>

  {#if siblings.length > 0}
    <p class="versions">
      {siblings.length === 1 ? "1 other version" : `${siblings.length} other versions`} on this master:
      {siblings
        .slice(0, 3)
        .map((s) => [s.year, s.country, s.formatSummary.split(" (")[0]].filter(Boolean).join(" "))
        .join("; ")}{siblings.length > 3 ? "; …" : ""}
    </p>
  {/if}
</header>

<style>
  .facts {
    display: grid;
    gap: 10px;
    min-width: 0;
  }
  .label-line {
    display: flex;
    align-items: center;
    gap: 18px;
    min-width: 0;
    margin-bottom: 6px;
  }
  .label {
    color: var(--fg-muted);
    font-size: var(--text-md);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .also {
    color: var(--fg-faint);
    margin-left: 0.6em;
  }
  .artist {
    font-size: clamp(26px, 2.6vw, var(--text-3xl));
    line-height: 1.15;
    letter-spacing: 0.01em;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    /* Michroma's descenders reach about 0.08em below a 1.15 line box; the clamp would clip them. */
    padding-bottom: 0.12em;
  }
  .title {
    font-size: clamp(18px, 1.6vw, var(--text-xl));
    font-weight: 500;
    font-stretch: 100%;
    line-height: 1.3;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    column-gap: 28px;
    row-gap: 2px;
    margin: 6px 0 0;
    color: var(--fg-muted);
  }
  .meta dd {
    margin: 0;
  }
  .strong {
    color: var(--fg);
    font-weight: 600;
  }
  .market,
  .market p {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 28px;
    color: var(--fg-muted);
  }
  .quiet {
    color: var(--fg-faint);
    font-size: var(--text-sm);
  }
  .market button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 0;
    background: none;
    padding: 0;
    color: var(--fg-faint);
    font-size: var(--text-sm);
  }
  .market button:disabled {
    opacity: 0.5;
  }
  .versions {
    color: var(--fg-faint);
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
