<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    type Config,
    type ConfigIssue,
    type HiddenLabel,
    hiddenLabelsFromNames,
    QUEUE_STRATEGIES,
    type QueueStrategy,
  } from "../../shared/config.ts";
  import { formatCount } from "../../shared/display.ts";
  import { parseInteger } from "../../shared/integer.ts";
  import Key from "../components/Key.svelte";
  import { joinList, parseLines, parseList } from "./fields.ts";
  import { FilterPreview } from "./preview.svelte.ts";
  import { problemAt, reportProblem } from "./problems.ts";

  interface Props {
    draft: Config;
    /** What is wrong with the draft; empty when it can be saved. */
    issues: ConfigIssue[];
    formId: string;
    onsubmit: (event: SubmitEvent) => void;
  }

  let { draft = $bindable(), issues, formId, onsubmit }: Props = $props();
  const id = $props.id();
  const filterPreview = new FilterPreview();

  const STRATEGY_COPY: Record<QueueStrategy, { label: string; hint: string }> = {
    label_sweep: { label: "Label sweep", hint: "label by label, in catalogue order" },
    country: { label: "By country", hint: "then label and catalogue number" },
    year: { label: "By year", hint: "oldest first, then label" },
    random: { label: "Shuffled", hint: "a new order each day, stable within the day" },
  };

  const batchProblem = $derived(problemAt(issues, "queue.limit"));
  const seekProblem = $derived(problemAt(issues, "player.seekStepSeconds"));
  const startAtPercent = $derived(Math.round(draft.player.startAtFraction * 100));

  $effect(() => {
    const filters = issues.length === 0 ? $state.snapshot(draft.filters) : null;
    filterPreview.update(filters);
  });

  onDestroy(() => filterPreview.destroy());

  const hiddenLabelLines = (labels: HiddenLabel[]) => labels.map((label) => label.name).join("\n");

  /** A line that still names a hidden label keeps its Discogs id. */
  function setHiddenLabels(text: string): void {
    draft.filters.excludeLabels = hiddenLabelsFromNames(parseLines(text), draft.filters.excludeLabels);
  }

  /** Every style checked is stored as null, so a style added to the universe is dug too. */
  function setStyleFilter(style: string, checked: boolean): void {
    const all = draft.universe.styles;
    const current = draft.filters.styles ?? all;
    const next = checked ? [...current, style] : current.filter((kept) => kept !== style);
    draft.filters.styles = next.length === all.length ? null : next;
  }
</script>

<form id={formId} {onsubmit}>
  <section>
    <header>
      <h2>What to dig</h2>
      <p>They narrow the loaded releases; the queue follows as soon as you save.</p>
    </header>
    <div class="fields">
      <fieldset class="field">
        <legend class="name">Years</legend>
        <div class="inline wrap">
          <input
            type="number"
            aria-label="From year"
            value={draft.filters.yearFrom ?? ""}
            oninput={(event) => (draft.filters.yearFrom = parseInteger(event.currentTarget.value))}
          />
          <span class="quiet">to</span>
          <input
            type="number"
            aria-label="To year"
            value={draft.filters.yearTo ?? ""}
            oninput={(event) => (draft.filters.yearTo = parseInteger(event.currentTarget.value))}
          />
          <label class="check">
            <input type="checkbox" bind:checked={draft.filters.includeUnknownYear} />
            include releases without a year
          </label>
          <label class="check">
            <input
              type="checkbox"
              aria-describedby="{id}-undated-hint"
              disabled={draft.filters.includeUnknownYear}
              bind:checked={draft.filters.includeUnknownYearOnCoverage}
            />
            or only those on labels and by artists you want
          </label>
        </div>
        <span class="hint" id="{id}-undated-hint">The labels and artists of the records you want or own.</span>
      </fieldset>
      <div class="field">
        <label class="name" for="{id}-formats">Formats</label>
        <input
          id="{id}-formats"
          aria-describedby="{id}-formats-hint"
          value={joinList(draft.filters.formats)}
          onchange={(event) => (draft.filters.formats = parseList(event.currentTarget.value))}
          placeholder="any format"
        />
        <span class="hint" id="{id}-formats-hint">
          Discogs format names, comma separated: Vinyl, CD, Cassette. Empty means any.
        </span>
      </div>
      <div class="field">
        <label class="name" for="{id}-countries">Countries</label>
        <input
          id="{id}-countries"
          aria-describedby="{id}-countries-hint"
          value={joinList(draft.filters.countries)}
          onchange={(event) => (draft.filters.countries = parseList(event.currentTarget.value))}
          placeholder="any country"
        />
        <span class="hint" id="{id}-countries-hint">As Discogs writes them: UK, Germany, US. Empty means any.</span>
      </div>
      <fieldset class="field">
        <legend class="name">Format details</legend>
        <div class="inline wrap">
          <input
            aria-label="Only with"
            aria-describedby="{id}-descriptions-hint"
            value={joinList(draft.filters.includeDescriptions)}
            onchange={(event) => (draft.filters.includeDescriptions = parseList(event.currentTarget.value))}
            placeholder="only with: any"
          />
          <input
            aria-label="Leave out"
            aria-describedby="{id}-descriptions-hint"
            value={joinList(draft.filters.excludeDescriptions)}
            onchange={(event) => (draft.filters.excludeDescriptions = parseList(event.currentTarget.value))}
            placeholder="leave out: none"
          />
        </div>
        <span class="hint" id="{id}-descriptions-hint">
          Discogs format descriptions, comma separated: 12", EP, Promo, Test Pressing.
        </span>
      </fieldset>
      <div class="field">
        <label class="name" for="{id}-labels">Hidden labels</label>
        <textarea
          id="{id}-labels"
          rows="3"
          aria-describedby="{id}-labels-hint"
          value={hiddenLabelLines(draft.filters.excludeLabels)}
          onchange={(event) => setHiddenLabels(event.currentTarget.value)}
          placeholder="none"
        ></textarea>
        <span class="hint" id="{id}-labels-hint">
          One per line, as Discogs writes it; Not On Label also hides self-releases. <Key label="X" size="sm" /> in
          Triage adds one.
        </span>
      </div>
      <fieldset class="field">
        <legend class="name">Skip</legend>
        <div class="skips">
          <label class="check">
            <input type="checkbox" aria-describedby="{id}-videos-hint" bind:checked={draft.filters.skipWithoutVideos} />
            releases without videos
          </label>
          <span class="hint" id="{id}-videos-hint">No playable YouTube video on any pressing; a newer dump may add one.</span>
          <label class="check">
            <input type="checkbox" aria-describedby="{id}-history-hint" bind:checked={draft.filters.skipHistory} />
            records opened before
          </label>
          <span class="hint" id="{id}-history-hint">Turn off to dig the records you only opened on Discogs.</span>
          <label class="check">
            <input type="checkbox" aria-describedby="{id}-heard-hint" bind:checked={draft.player.skipHeard} />
            tunes heard before
          </label>
          <span class="hint" id="{id}-heard-hint">When a record starts and when moving on; any track can still be picked.</span>
        </div>
      </fieldset>
      {#if draft.universe.styles.length > 1}
        <fieldset class="field">
          <legend class="name">Styles</legend>
          <div class="inline wrap">
            {#each draft.universe.styles as style (style)}
              <label class="check">
                <input
                  type="checkbox"
                  checked={draft.filters.styles === null || draft.filters.styles.includes(style)}
                  onchange={(event) => setStyleFilter(style, event.currentTarget.checked)}
                />
                {style}
              </label>
            {/each}
          </div>
        </fieldset>
      {/if}
    </div>
    <output class="preview">
      {#if filterPreview.value}
        These filters match <b>{formatCount(filterPreview.value.universe.filteredKeys)}</b> records,
        <b>{formatCount(filterPreview.value.remaining)}</b> still to dig.
      {/if}
    </output>
  </section>

  <section>
    <h2 id="{id}-order">Order</h2>
    <fieldset class="options" aria-labelledby="{id}-order">
      {#each QUEUE_STRATEGIES as strategy (strategy)}
        <div class="option">
          <input
            type="radio"
            id="{id}-{strategy}"
            name="strategy"
            value={strategy}
            aria-describedby="{id}-{strategy}-hint"
            bind:group={draft.queue.strategy}
          />
          <label for="{id}-{strategy}">{STRATEGY_COPY[strategy].label}</label>
          <span class="hint" id="{id}-{strategy}-hint">
            {STRATEGY_COPY[strategy].hint}
          </span>
        </div>
      {/each}
    </fieldset>
    <div class="field narrow">
      <label class="name" for="{id}-batch">Batch</label>
      <input
        type="number"
        id="{id}-batch"
        min="1"
        max="5000"
        aria-describedby="{id}-batch-hint {id}-batch-problem"
        bind:value={draft.queue.limit}
        {@attach reportProblem(issues, "queue.limit")}
      />
      <span class="hint" id="{id}-batch-hint">Releases fetched per queue request.</span>
      <span class="hint problem" id="{id}-batch-problem" hidden={!batchProblem}>{batchProblem}</span>
    </div>
  </section>

  <section>
    <h2>Player</h2>
    <div class="fields">
      <div class="field">
        <label class="name" for="{id}-start">Start at</label>
        <div class="inline">
          <input
            type="range"
            id="{id}-start"
            min="0"
            max="0.95"
            step="0.05"
            aria-valuetext="{startAtPercent}% into each track"
            bind:value={draft.player.startAtFraction}
          />
          <span>{startAtPercent}% into each track</span>
        </div>
      </div>
      <div class="field narrow">
        <label class="name" for="{id}-seek">Seek step</label>
        <input
          type="number"
          id="{id}-seek"
          min="1"
          max="120"
          aria-describedby="{id}-seek-hint {id}-seek-problem"
          bind:value={draft.player.seekStepSeconds}
          {@attach reportProblem(issues, "player.seekStepSeconds")}
        />
        <span class="hint" id="{id}-seek-hint">Seconds per <Key label="←" size="sm" /> <Key label="→" size="sm" />.</span>
        <span class="hint problem" id="{id}-seek-problem" hidden={!seekProblem}>{seekProblem}</span>
      </div>
    </div>
  </section>
</form>

<style>
  .options {
    display: grid;
    gap: 8px;
  }
  .option {
    display: grid;
    grid-template-columns: auto 12em 1fr;
    align-items: baseline;
    gap: 12px;
  }
  .skips {
    display: grid;
    row-gap: 2px;
  }
  .skips .hint {
    margin: 0 0 8px 26px;
  }
  .skips .hint:last-child {
    margin-bottom: 0;
  }
  .option label {
    cursor: pointer;
  }
  .preview {
    display: block;
    min-height: 1.45em;
    color: var(--fg-muted);
  }
</style>
