<script lang="ts">
  import { onMount } from "svelte";
  import type { BackupsResponse } from "../../shared/api.ts";
  import { formatBytes, formatDay } from "../../shared/display.ts";
  import { api } from "../api.ts";
  import { errorMessage, settings } from "../stores.svelte.ts";

  let backups = $state<BackupsResponse | null>(null);
  let error = $state<string | null>(null);

  const latest = $derived(backups?.backups[0] ?? null);

  onMount(() => {
    api.getBackups().then(
      (response) => (backups = response),
      (failure: unknown) => (error = errorMessage(failure)),
    );
  });
</script>

<section class="data">
  <h2>Backups and exports</h2>
  {#if error}
    <p>Backups did not load: {error}</p>
  {:else if backups}
    <p>
      {#if latest}
        Last backup <time datetime={latest.day}>{formatDay(`${latest.day}T00:00:00`)}</time>
        ({formatBytes(latest.bytes)}).
      {:else}
        No backup yet.
      {/if}
      Digga copies its database once a day when the server starts and keeps the last {backups.kept},
      in <code>{backups.directory}</code>. To restore one, stop the server and copy it over
      <code>digga.sqlite</code>.
    </p>
  {/if}
  <p>
    Export what is saved:
    <a href={api.exportUrl("decisions.json")} download>verdicts and track marks (JSON)</a>,
    <a href={api.exportUrl("verdicts.csv")} download>verdicts (CSV)</a>,
    <a href={api.exportUrl("track-marks.csv")} download>track marks (CSV)</a>.
    {#if settings.sandbox}The sandbox verdicts in this tab are not saved, so they are not in them.{/if}
  </p>
</section>

<style>
  .data {
    display: grid;
    gap: 12px;
    max-width: 940px;
    padding: 24px 0;
    border-top: 1px solid var(--rule);
  }
  h2 {
    margin-bottom: 6px;
  }
  p {
    color: var(--fg-muted);
    max-width: 80ch;
  }
  code {
    font-family: inherit;
    color: var(--fg);
    overflow-wrap: anywhere;
  }
  a {
    color: var(--fg);
    text-underline-offset: 3px;
  }
</style>
