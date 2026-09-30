<script lang="ts">
  /**
   * Discogs styles to pick from, with their sizes: a search across genres, the picks as stamps,
   * styles often tagged with them, and every genre's styles as checkboxes.
   */
  import { untrack } from "svelte";
  import { formatCount } from "../../shared/display.ts";
  import type { StyleCensus } from "../../shared/style-census.ts";
  import { styleGroups, togetherWith } from "./model.ts";

  let {
    census,
    picks = $bindable(),
    search = $bindable(null),
  }: {
    census: StyleCensus;
    picks: string[];
    /** The search field, where the step reports a missing pick. */
    search?: HTMLInputElement | null;
  } = $props();

  /** Matches shown for a search; a few letters can match hundreds of styles. */
  const MATCHES_SHOWN = 40;

  let query = $state("");

  // The first picks, the suggested ones, set the genre order once, so the genres do not jump while
  // styles are picked.
  let orderPicks = $state(untrack(() => picks));
  const groups = $derived(styleGroups(census, query, orderPicks));
  const matches = $derived(groups.flatMap((group) => group.styles).slice(0, MATCHES_SHOWN));
  const together = $derived(togetherWith(census, picks));
  const sizes = $derived(new Map(census.styles.map((style) => [style.name, style.releases])));

  $effect(() => {
    if (untrack(() => orderPicks.length) === 0 && picks.length > 0) orderPicks = picks;
  });

  function toggle(name: string, on: boolean): void {
    picks = on ? [...picks.filter((pick) => pick !== name), name] : picks.filter((pick) => pick !== name);
    search?.setCustomValidity("");
  }

  /** Enter picks the first match and clears the search, instead of submitting the step. */
  function onSearchKey(event: KeyboardEvent): void {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const first = matches.find((style) => !picks.includes(style.name));
    if (!first || query.trim() === "") return;
    toggle(first.name, true);
    query = "";
  }
</script>

<div class="picker">
  <label class="find" for="style-search">Find a style</label>
  <input
    id="style-search"
    type="search"
    placeholder="jungle, deep house, hard bop…"
    autocomplete="off"
    aria-describedby="style-search-hint"
    bind:value={query}
    bind:this={search}
    onkeydown={onSearchKey}
  />
  <p class="hint" id="style-search-hint">Enter picks the first match. Pick as many as you like.</p>

  {#if picks.length > 0}
    <ul class="picked" aria-label="Picked styles">
      {#each picks as pick (pick)}
        <li>
          <span class="name">{pick}</span>
          <span class="count">{formatCount(sizes.get(pick) ?? 0)}</span>
          <button type="button" aria-label="Remove {pick}" onclick={() => toggle(pick, false)}>×</button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if together.length > 0}
    <p class="together">
      Often tagged with {picks.length === 1 ? "it" : "these"}:
      {#each together as name (name)}
        <button type="button" class="add" onclick={() => toggle(name, true)}>+ {name}</button>
      {/each}
    </p>
  {/if}

  {#if query.trim() !== ""}
    <fieldset class="matches">
      <legend class="visually-hidden">Styles matching “{query}”</legend>
      {#each matches as style (style.name)}
        <label>
          <input
            type="checkbox"
            checked={picks.includes(style.name)}
            onchange={(event) => toggle(style.name, event.currentTarget.checked)}
          />
          {style.name}
          <span class="count">{formatCount(style.releases)}</span>
          <span class="genre">{style.genre}</span>
        </label>
      {:else}
        <p class="hint">No style is called that on Discogs.</p>
      {/each}
    </fieldset>
  {:else}
    <div class="genres">
      {#each groups as group (group.genre)}
        <details>
          <summary>
            {group.genre}
            <span class="count">{group.styles.length} styles</span>
          </summary>
          <fieldset>
            <legend class="visually-hidden">{group.genre} styles</legend>
            {#each group.styles as style (style.name)}
              <label>
                <input
                  type="checkbox"
                  checked={picks.includes(style.name)}
                  onchange={(event) => toggle(style.name, event.currentTarget.checked)}
                />
                {style.name}
                <span class="count">{formatCount(style.releases)}</span>
              </label>
            {/each}
          </fieldset>
        </details>
      {/each}
    </div>
  {/if}
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .find {
    color: var(--fg);
  }
  input[type="search"] {
    max-width: 28em;
    font-size: var(--text-md);
  }
  input[type="search"]:user-invalid {
    border-color: var(--accent-mark);
  }
  .hint {
    color: var(--fg-faint);
    font-size: var(--text-sm);
  }
  .picked {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin: 4px 0;
    padding: 0;
    list-style: none;
  }
  .picked li {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 4px 4px 4px 10px;
    border: 2px solid var(--fg-accent);
    border-radius: 3px;
    color: var(--fg-accent);
    font-family: var(--display);
    font-size: var(--text-sm);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    filter: url(#ink-fine);
  }
  .picked .count {
    font-family: var(--mono);
    font-size: var(--text-2xs);
    text-transform: none;
    color: var(--fg-muted);
  }
  .picked button {
    padding: 0 6px;
    border: 0;
    background: none;
    color: var(--fg-accent);
    font-size: var(--text-lg);
    line-height: 1;
  }
  .together {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8px;
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .add {
    padding: 2px 8px;
    border: 1px dashed var(--rule);
    border-radius: var(--radius);
    background: none;
    color: var(--fg);
    font-size: var(--text-sm);
  }
  .add:hover {
    border-color: var(--accent-mark);
  }
  .genres {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--rule-soft);
  }
  details {
    border-bottom: 1px solid var(--rule-soft);
  }
  summary {
    padding: 8px 0;
    cursor: pointer;
  }
  fieldset {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 4px 20px;
    padding: 4px 0 14px;
  }
  .matches {
    padding-top: 0;
  }
  fieldset label {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: var(--text-sm);
  }
  .count,
  .genre {
    color: var(--fg-faint);
    font-size: var(--text-2xs);
  }
  input[type="checkbox"] {
    accent-color: var(--accent);
  }
</style>
