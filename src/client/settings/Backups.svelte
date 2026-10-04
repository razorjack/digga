<script lang="ts">
  import { onMount } from "svelte";
  import type { BackupsResponse } from "../../shared/api.ts";
  import { formatAge, formatBytes, formatDay } from "../../shared/display.ts";
  import { api } from "../api.ts";
  import { errorMessage, settings } from "../stores.svelte.ts";

  const id = $props.id();
  let backups = $state<BackupsResponse | null>(null);
  let error = $state<string | null>(null);
  let saving = $state(false);
  /** How the last "Back up now" went. */
  let message = $state<string | null>(null);

  const latest = $derived(backups?.backups[0] ?? null);
  const latestDecisions = $derived(backups?.decisions.backups[0] ?? null);
  const latestCheckpoint = $derived(backups?.checkpoints.backups[0] ?? null);

  onMount(() => {
    api.getBackups().then(
      (response) => (backups = response),
      (failure: unknown) => (error = errorMessage(failure)),
    );
  });

  async function backUpNow(): Promise<void> {
    saving = true;
    message = null;
    try {
      backups = await api.backupNow();
      message = "Backup saved.";
    } catch (failure) {
      message = `Backup failed: ${errorMessage(failure)}`;
    } finally {
      saving = false;
    }
  }
</script>

<section aria-labelledby="{id}-title">
  <h2 id="{id}-title">Backups and exports</h2>
  <div>
    <button type="button" class="secondary" disabled={saving} aria-busy={saving} onclick={() => void backUpNow()}>Back up now</button>
  </div>
  <p role="status">{message ?? ""}</p>
  {#if error}
    <p>Backups did not load: {error}</p>
  {:else if backups}
    {#if backups.failure}
      <p class="problem">
        A scheduled backup failed <time datetime={backups.failure.at}>{formatAge(backups.failure.at)}</time>:
        {backups.failure.message}. Digga tries again every fifteen minutes; <b>Back up now</b> tries at once.
      </p>
    {/if}
    <p>
      <b>Your decisions</b>:
      {#if latestDecisions}
        last backed up <time datetime={latestDecisions.day}>{formatDay(`${latestDecisions.day}T00:00:00`)}</time>
        ({formatBytes(latestDecisions.bytes)}).
      {:else}
        no backup yet.
      {/if}
      Once a day Digga writes your verdicts, notes, track marks, listening and decision histories, saved sessions, attached links and settings, to <code>decisions-YYYY-MM-DD.json.gz</code>, and keeps the last
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
      Digga copies it once a day while the server runs and keeps the last {backups.kept}. To restore one, stop the
      server and run <code>npm run digga -- restore</code> with the file; it keeps the database it replaces.
    </p>
    <p>
      Every fifteen minutes and when the server stops cleanly, changed personal data gets a checkpoint.
      Digga keeps the last {backups.checkpoints.kept} in addition to the daily backups.
      {#if latestCheckpoint}
        Latest checkpoint: <code>{latestCheckpoint.day}</code>.
      {/if}
      Schema upgrades first save a separate <code>before-migration</code> database copy, which restores the same way.
      Use <code>restore &lt;file&gt; --config</code> to restore settings as well.
    </p>
    <p>All backups are in <code>{backups.directory}</code>.</p>
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
  p {
    color: var(--fg-muted);
    max-width: 80ch;
  }
  a {
    color: var(--fg);
    text-underline-offset: 3px;
  }
</style>
