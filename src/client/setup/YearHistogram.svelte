<script lang="ts">
  /**
   * Releases per year as bars, the chosen years in ink and the rest faint, and the releases
   * without a year as a bar of their own. `filled` draws a second count over the first, such as
   * what a running load has kept against what the census expects. Decoration: the year fields and
   * the estimate carry the numbers, so it is hidden from assistive technology.
   */
  import type { YearSpan } from "./model.ts";

  let {
    counts,
    undated = 0,
    span,
    filled = null,
    filledUndated = 0,
  }: {
    counts: Map<number, number>;
    undated?: number;
    span: YearSpan | null;
    filled?: Map<number, number> | null;
    filledUndated?: number;
  } = $props();

  const WIDTH = 800;
  const HEIGHT = 96;
  const GAP = 2;

  const years = $derived(visibleYears(counts, filled));
  const peak = $derived(
    Math.max(1, undated, filledUndated, ...counts.values(), ...(filled?.values() ?? [])),
  );
  const slot = $derived(WIDTH / (years.length + 2));

  /**
   * The years from the first to the last with a hundredth of the busiest year's releases, so a
   * stray early release does not stretch the chart, and the gaps between them show.
   */
  function visibleYears(base: Map<number, number>, over: Map<number, number> | null): number[] {
    const total = (year: number) => (base.get(year) ?? 0) + (over?.get(year) ?? 0);
    const all = [...new Set([...base.keys(), ...(over?.keys() ?? [])])];
    const busiest = Math.max(0, ...all.map(total));
    const known = all.filter((year) => busiest > 0 && total(year) >= busiest / 100);
    if (known.length === 0) return [];
    const first = Math.min(...known);
    const last = Math.max(...known);
    return Array.from({ length: last - first + 1 }, (_, index) => first + index);
  }

  const height = (count: number) => (count / peak) * (HEIGHT - 4);
  const inSpan = (year: number) => span !== null && year >= span[0] && year <= span[1];
</script>

{#if years.length > 0}
  <svg viewBox="0 0 {WIDTH} {HEIGHT}" preserveAspectRatio="none" aria-hidden="true">
    {#each years as year, index (year)}
      {@const count = counts.get(year) ?? 0}
      {@const x = index * slot}
      <rect
        class:chosen={inSpan(year)}
        class:outline={filled !== null}
        x={x + GAP / 2}
        y={HEIGHT - height(count)}
        width={slot - GAP}
        height={height(count)}
      />
      {#if filled}
        {@const got = filled.get(year) ?? 0}
        <rect
          class="fill"
          class:chosen={inSpan(year)}
          x={x + GAP / 2}
          y={HEIGHT - height(got)}
          width={slot - GAP}
          height={height(got)}
        />
      {/if}
    {/each}
    <rect
      class="undated"
      class:outline={filled !== null}
      x={(years.length + 1) * slot + GAP / 2}
      y={HEIGHT - height(undated)}
      width={slot - GAP}
      height={height(undated)}
    />
    {#if filled}
      <rect
        class="fill undated"
        x={(years.length + 1) * slot + GAP / 2}
        y={HEIGHT - height(filledUndated)}
        width={slot - GAP}
        height={height(filledUndated)}
      />
    {/if}
  </svg>
  <div class="axis" aria-hidden="true" style:--slot="{100 / (years.length + 2)}%">
    <span>{years[0]}</span>
    <span class="last">{years.at(-1)}</span>
    <span class="no-year">?</span>
  </div>
{/if}

<style>
  svg {
    display: block;
    width: 100%;
    height: 96px;
  }
  .axis {
    position: relative;
    height: 16px;
    color: var(--fg-faint);
    font-size: var(--text-2xs);
  }
  .axis span {
    position: absolute;
    top: 2px;
  }
  .axis .last {
    right: calc(var(--slot) * 2);
  }
  .axis .no-year {
    right: 0;
    width: var(--slot);
    text-align: center;
  }
  rect {
    fill: var(--rule);
  }
  rect.chosen {
    fill: var(--fg-muted);
  }
  rect.outline {
    fill: none;
    stroke: var(--rule);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  rect.outline.chosen {
    stroke: var(--fg-faint);
  }
  rect.fill {
    fill: var(--fg-faint);
  }
  rect.fill.chosen {
    fill: var(--accent-mark);
  }
  rect.undated:not(.outline, .fill) {
    fill: var(--rule);
  }
</style>
