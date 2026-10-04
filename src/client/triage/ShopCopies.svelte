<script lang="ts">
  import type { ShopListing } from "../../shared/api.ts";
  import { formatPrice } from "../../shared/display.ts";
  import { type GradeTone, listingGrade, type SellerCopies } from "../../shared/listings.ts";
  import Stamp from "../components/Stamp.svelte";
  import type { StampTone } from "../keymap.ts";

  let { copies }: { copies: SellerCopies } = $props();

  /** A seller rarely has more; the rest are on Discogs. */
  const SHOWN = 3;
  const STAMP_TONES: Record<GradeTone, StampTone> = { top: "accent", fair: "plain", worn: "muted" };

  const shown = $derived(copies.listings.slice(0, SHOWN));
  const hidden = $derived(copies.listings.length - shown.length);

  function priceOf(listing: ShopListing): string {
    return listing.price === null ? "no price" : formatPrice(listing.price, listing.currency);
  }
</script>

<section class="copies" aria-labelledby="seller-copies">
  <h2 id="seller-copies">{copies.username} sells</h2>
  {#if copies.listings.length === 0}
    <p class="quiet">No price or grading yet: read the shop again in Settings, under Discogs.</p>
  {:else}
    <ul>
      {#each shown as listing (listing.id)}
        {@const grade = listingGrade(listing)}
        <li>
          <span class="price">{priceOf(listing)}</span>
          <span class="grade">
            <span aria-hidden="true">
              <Stamp text={grade.text} tone={grade.tone ? STAMP_TONES[grade.tone] : "plain"} seed={listing.id} size="sm" />
            </span>
            <span class="visually-hidden">{grade.spoken}</span>
          </span>
          {#if listing.comments}
            <span class="comment" title={listing.comments}>{listing.comments}</span>
          {/if}
        </li>
      {/each}
    </ul>
    {#if hidden > 0}
      <p class="quiet">and {hidden === 1 ? "1 more copy" : `${hidden} more copies`} on Discogs</p>
    {/if}
  {/if}
</section>

<style>
  .copies {
    display: grid;
    gap: 6px;
    padding-left: 12px;
    box-shadow: inset 3px 0 0 var(--accent-mark);
    min-width: 0;
  }
  h2 {
    color: var(--fg-faint);
    font-size: var(--text-xs);
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  ul {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr);
    align-items: center;
    column-gap: 16px;
    row-gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    align-items: center;
  }
  .price {
    color: var(--fg);
    font-size: var(--text-lg);
    font-weight: 600;
    text-align: right;
  }
  .grade {
    justify-self: start;
  }
  .comment {
    color: var(--fg-muted);
    font-size: var(--text-sm);
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }
  .quiet {
    color: var(--fg-faint);
    font-size: var(--text-sm);
  }
</style>
