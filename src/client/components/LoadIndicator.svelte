<script lang="ts">
  /**
   * The running dump job in the header: a short label linking to where it is shown in full, and a
   * thin bar along the header's lower edge. Without a size to go on, the bar shows no value.
   */
  import { loadStatus } from "../load-status.svelte.ts";

  let { href }: { href: string } = $props();

  const verb = $derived(loadStatus.loading ? "loading" : "fetching");
  const percent = $derived(
    loadStatus.fraction === null ? null : Math.floor(loadStatus.fraction * 100),
  );
  const label = $derived(
    loadStatus.loading ? "Loading the catalogue" : "Downloading the catalogue",
  );
</script>

<a class="indicator" {href} title="{label}; see how it goes">
  <span class="verb">{verb}</span>
  {#if percent !== null}<b>{percent}%</b>{/if}
</a>
<progress
  class="edge"
  aria-label={label}
  max="1"
  value={loadStatus.fraction ?? undefined}
></progress>

<style>
  .indicator {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    text-decoration: none;
    white-space: nowrap;
  }
  .indicator b {
    font-family: var(--display);
    font-weight: 400;
    color: var(--fg-accent);
  }
  .indicator:hover .verb {
    color: var(--fg);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .edge {
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    width: 100%;
    height: 2px;
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--accent-mark);
  }
  .edge::-webkit-progress-bar {
    background: transparent;
  }
  .edge::-webkit-progress-value {
    background: var(--accent-mark);
  }
  .edge::-moz-progress-bar {
    background: var(--accent-mark);
  }
</style>
