<script lang="ts">
  import { onMount } from "svelte";
  import type { BackupsResponse } from "../../shared/api.ts";
  import { formatBytes, formatDay } from "../../shared/display.ts";
  import { api } from "../api.ts";
  import { errorMessage, settings } from "../stores.svelte.ts";

  let backups = $state<BackupsResponse | null>(null);
  let error = $state<string | null>(null);

  const latest = $derived(backups?.backups[0] ?? null);
  const latestDecisions = $derived(backups?.decisions.backups[0] ?? null);

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
      <b>Your decisions</b>:
      {#if latestDecisions}
        last backed up <time datetime={latestDecisions.day}>{formatDay(`${latestDecisions.day}T00:00:00`)}</time>
        ({formatBytes(latestDecisions.bytes)}).
      {:else}
        no backup yet.
      {/if}
      Once a day Digga writes what only you made here, your verdicts with their notes, track marks, the tunes you
      heard and the links you attached, to <code>decisions-YYYY-MM-DD.json.gz</code>, and keeps the last
      {backups.decisions.kept}. Days when nothing changed add none. <code>npm run digga -- restore</code> with
      the file brings them back into a library loaded from a dump.
    </p>
    <p>
      <b>The database</b>:
      {#if latest}
        last copied <time datetime={latest.day}>{formatDay(`${latest.day}T00:00:00`)}</time>
        ({formatBytes(latest.bytes)}).
      {:else}
        no copy yet.
      {/if}
      Digga copies it once a day when the server starts and keeps the last {backups.kept}. To restore one, stop the
      server and copy it over <code>{backups.databaseFile}</code>.
    </p>
    <p>Both are in <code>{backups.directory}</code>.</p>
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
  b {
    color: var(--fg);
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
