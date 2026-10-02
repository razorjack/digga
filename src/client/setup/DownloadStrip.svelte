<script lang="ts">
  /** The download at the foot of steps 2 and 3, which it runs behind. */
  import { formatBytes } from "../../shared/display.ts";
  import type { Job } from "../../shared/types.ts";
  import { transferLeft } from "./model.ts";

  let { download }: { download: Job } = $props();

  const progress = $derived(download.type === "dump_download" ? download.progress : null);
  const fraction = $derived(
    progress?.totalBytes ? progress.receivedBytes / progress.totalBytes : undefined,
  );
  const left = $derived(
    progress?.totalBytes && download.startedAt
      ? transferLeft(progress.receivedBytes, progress.totalBytes, download.startedAt)
      : null,
  );
</script>

<aside class="strip" aria-label="Download">
  <span class="label">Fetching the catalogue</span>
  <progress max="1" value={fraction} aria-label="Catalogue downloaded"></progress>
  <span class="numbers">
    {#if progress?.totalBytes}
      {formatBytes(progress.receivedBytes)} of {formatBytes(progress.totalBytes)}{left ? ` · ${left}` : ""}
    {:else}
      finding the newest catalogue
    {/if}
  </span>
</aside>

<style>
  .strip {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 12px 40px;
    border-top: 1px solid var(--rule);
    background: var(--surface);
    font-size: var(--text-sm);
    color: var(--fg-muted);
  }
  .label {
    color: var(--fg);
    white-space: nowrap;
  }
  progress {
    flex: 1;
    height: 6px;
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
  .numbers {
    white-space: nowrap;
  }
</style>
