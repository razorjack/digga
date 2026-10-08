<script lang="ts">
  /** Step 3: the styles and years the load keeps and Triage digs, with what they come to. */
  import { tick, untrack } from "svelte";
  import { formatBytes, formatCount, nounFor } from "../../shared/display.ts";
  import Action from "./Action.svelte";
  import type { SetupFlow } from "./flow.svelte.ts";
  import {
    defaultYearSpan,
    estimateCatalogue,
    loadYearsFor,
    roundEstimate,
    suggestedStyles,
    yearHistogram,
    type YearSpan,
  } from "./model.ts";
  import StylePicker from "./StylePicker.svelte";
  import YearHistogram from "./YearHistogram.svelte";

  let { flow }: { flow: SetupFlow } = $props();

  const names = new Intl.ListFormat("en-GB", { type: "conjunction" });

  // Nothing is chosen twice: picks confirmed earlier come back as they were, before any suggestion.
  const confirmed = untrack(() => flow.picks);
  let picks = $state<string[]>(confirmed ? [...confirmed.styles] : []);
  let chosenSpan = $state<YearSpan | null>(confirmed?.span ?? null);
  let chosenLoadYears = $state<YearSpan | null>(confirmed?.loadYears ?? null);
  let vinylOnly = $state(confirmed?.vinylOnly ?? true);
  let search = $state<HTMLInputElement | null>(null);
  let styleProblem = $state("");
  let suggestionsApplied = confirmed !== null;

  const census = $derived(flow.census);
  const seeds = $derived(flow.setup?.seeds ?? { releases: 0, styles: [] });
  const suggested = $derived(census ? suggestedStyles(census, seeds) : []);
  const span = $derived(chosenSpan ?? (census ? defaultYearSpan(census, seeds, picks) : null));
  const loadYears = $derived(chosenLoadYears ?? (span ? loadYearsFor(span) : null));
  const histogram = $derived(census ? yearHistogram(census, picks) : new Map<number, number>());
  const undated = $derived(
    census?.styles.filter((style) => picks.includes(style.name)).reduce((sum, style) => sum + style.undated, 0) ??
      0,
  );
  const estimate = $derived(
    census && span && loadYears && picks.length > 0
      ? estimateCatalogue(census, picks, { span, vinylOnly, loadYears })
      : null,
  );
  const estimatedReleases = $derived(estimate ? roundEstimate(estimate.releases) : 0);

  // The imports' styles are the first picks, once, as they arrive.
  $effect(() => {
    if (suggestionsApplied || suggested.length === 0 || picks.length > 0) return;
    suggestionsApplied = true;
    picks = suggested.map((style) => style.name);
  });

  function setYear(index: 0 | 1, value: string): void {
    const year = Number.parseInt(value, 10);
    if (!span || Number.isNaN(year)) return;
    chosenSpan = index === 0 ? [year, span[1]] : [span[0], year];
  }

  function setLoadYear(index: 0 | 1, value: string): void {
    const year = Number.parseInt(value, 10);
    if (!loadYears || Number.isNaN(year)) return;
    chosenLoadYears = index === 0 ? [year, loadYears[1]] : [loadYears[0], year];
  }

  async function fill(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (picks.length === 0) {
      styleProblem = "Pick at least one style";
      // The field's description holds the message once the page shows it.
      await tick();
      search?.reportValidity();
      return;
    }
    if (!span || !loadYears) return;
    void flow.fillCrate({ styles: picks, span, loadYears, vinylOnly });
  }
</script>

<form class="step" aria-labelledby="sound-title" onsubmit={fill}>
  <h1 id="sound-title">Pick your sound</h1>
  <p class="lead">
    Digga keeps the releases in these styles and years. You can change both later in Settings and load again.
  </p>

  {#if suggested.length > 0 && !confirmed}
    <p class="suggested">
      Your Discogs records are mostly <b>{names.format(suggested.map((style) => style.name))}</b>, so
      {suggested.length === 1 ? "it is" : "they are"} picked. Change them as you like.
    </p>
  {/if}

  {#if census}
    <fieldset class="styles">
      <legend>Styles</legend>
      <StylePicker {census} bind:picks bind:search bind:problem={styleProblem} />
    </fieldset>

    <fieldset class="years">
      <legend>Years</legend>
      {#if span}
        <div class="range">
          <label>
            from
            <input
              type="number"
              inputmode="numeric"
              min="1900"
              max={span[1]}
              value={span[0]}
              onchange={(event) => setYear(0, event.currentTarget.value)}
            />
          </label>
          <label>
            to
            <input
              type="number"
              inputmode="numeric"
              min={span[0]}
              max="2100"
              value={span[1]}
              onchange={(event) => setYear(1, event.currentTarget.value)}
            />
          </label>
        </div>
        <YearHistogram counts={histogram} {undated} {span} />
        {#if loadYears}
          <details class="load-years">
            <summary>
              Digga loads {loadYears[0]}–{loadYears[1]}, some years either side, so you can widen the range later
              without loading again.
            </summary>
            <div class="range">
              <label>
                load from
                <input
                  type="number"
                  inputmode="numeric"
                  max={span[0]}
                  value={loadYears[0]}
                  onchange={(event) => setLoadYear(0, event.currentTarget.value)}
                />
              </label>
              <label>
                <span class="visually-hidden">load</span>
                to
                <input
                  type="number"
                  inputmode="numeric"
                  min={span[1]}
                  value={loadYears[1]}
                  onchange={(event) => setLoadYear(1, event.currentTarget.value)}
                />
              </label>
            </div>
            <p class="hint">Releases without a year, the last bar, are always kept.</p>
          </details>
        {/if}
      {:else}
        <p class="hint">Pick a style to see its years.</p>
      {/if}
      <label class="vinyl">
        <input type="checkbox" bind:checked={vinylOnly} />
        Vinyl only
      </label>
    </fieldset>

    <p class="estimate" role="status">
      {#if estimate && span}
        About <b>{formatCount(estimatedReleases)}</b> {nounFor(estimatedReleases, "release")}, {formatBytes(estimate.bytes)};
        {formatCount(roundEstimate(estimate.dug))} of them from {span[0]}–{span[1]}{vinylOnly ? " on vinyl" : ""}.
        The load reads all {formatCount(roundEstimate(census.releases))} releases on Discogs whatever you pick, so it
        takes 15 to 20 minutes either way.
      {/if}
    </p>
  {:else}
    <p class="hint" aria-busy="true">Counting Discogs' styles…</p>
  {/if}

  <div class="outcome">
    <p class="problem" role="alert">{flow.error ?? ""}</p>

    <div class="actions">
      <Action primary type="submit" keys="Enter" disabled={flow.busy || !census}>Fill the crate</Action>
      <button type="button" class="back" onclick={() => flow.goTo("discogs")}>Back</button>
    </div>
  </div>
</form>

<style>
  .step {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  h1 {
    font-size: var(--text-2xl);
    line-height: 1.15;
  }
  .lead {
    max-width: 46em;
    color: var(--fg-muted);
  }
  .suggested {
    padding: 12px 16px;
    border-left: 3px solid var(--accent-mark);
    background: var(--surface);
  }
  .suggested b {
    font-weight: 600;
    color: var(--fg-accent);
  }
  fieldset.styles,
  fieldset.years {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  legend {
    float: none;
    margin-bottom: 10px;
    font-family: var(--display);
    font-size: var(--text-lg);
  }
  .range {
    display: flex;
    gap: 24px;
  }
  .range label {
    display: inline-flex;
    align-items: baseline;
    gap: 10px;
    color: var(--fg-muted);
  }
  .range input {
    width: 6em;
    font-size: var(--text-lg);
    font-family: var(--display);
  }
  input:user-invalid {
    border-color: var(--accent-mark);
  }
  .load-years summary {
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .load-years[open] summary {
    margin-bottom: 10px;
  }
  .load-years .range input {
    font-size: var(--text-md);
  }
  .vinyl {
    display: inline-flex;
    align-items: baseline;
    gap: 10px;
  }
  .vinyl input {
    accent-color: var(--accent);
  }
  .estimate {
    min-height: 3em;
    max-width: 46em;
    color: var(--fg-muted);
  }
  .estimate b {
    font-family: var(--display);
    font-weight: 400;
    font-size: var(--text-lg);
    color: var(--fg);
  }
  .hint {
    color: var(--fg-faint);
    font-size: var(--text-sm);
  }
  .problem {
    color: var(--fg-accent);
  }
  .outcome {
    display: flex;
    flex-direction: column;
  }
  .outcome .problem:not(:empty) {
    margin-bottom: 24px;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .back {
    padding: 0;
    border: 0;
    background: none;
    color: var(--fg-faint);
    font-size: var(--text-sm);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
</style>
