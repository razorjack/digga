<script lang="ts">
  /**
   * The running dump job in the toolbar: a short label linking to where it is shown in full, and a
   * small meter beside it. Without a size to go on, the meter shows no value.
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

<span class="job">
  <a class="indicator" {href} title="{label}; see how it goes">
    <span class="verb">{verb}</span>
    {#if percent !== null}<b>{percent}%</b>{/if}
  </a>
  <progress aria-label={label} max="1" value={loadStatus.fraction ?? undefined}></progress>
</span>

<style>
  .job {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }
  .indicator {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    text-decoration: none;
    white-space: nowrap;
    cursor: default;
    -webkit-user-drag: none;
  }
  .indicator b {
    font-family: var(--display);
    font-weight: 400;
    color: var(--fg-accent);
  }
  .indicator:hover .verb {
    color: var(--fg);
  }
  progress {
    width: 64px;
    height: 3px;
    appearance: none;
    border: 0;
    background: var(--rule);
    color: var(--accent-mark);
  }
  progress::-webkit-progress-bar {
    background: var(--rule);
  }
  progress::-webkit-progress-value {
    background: var(--accent-mark);
  }
  progress::-moz-progress-bar {
    background: var(--accent-mark);
  }
</style>
