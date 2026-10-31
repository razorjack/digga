<script lang="ts">
  import { onMount } from "svelte";
  import type { BackupSummary, BackupsResponse } from "../../shared/api.ts";
  import { formatAge, formatBytes, formatDay } from "../../shared/display.ts";
  import { api } from "../api.ts";
  import Art from "../components/Art.svelte";
  import { errorMessage } from "../stores.svelte.ts";
  import { checkpointTime } from "./backups.ts";

  const id = $props.id();
  let backups = $state<BackupsResponse | null>(null);
  let error = $state<string | null>(null);
  let saving = $state(false);
  /** How the last "Back up now" went. */
  let message = $state<string | null>(null);

  const latestCheckpoint = $derived(backups?.checkpoints.backups[0] ?? null);
  const checkpointAt = $derived(latestCheckpoint ? checkpointTime(latestCheckpoint.day) : null);

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

{#snippet dailyRow(name: string, latest: BackupSummary | undefined, kept: number)}
  <tr>
    <th scope="row">{name}</th>
    {#if latest}
      <td><time datetime={latest.day}>{formatDay(`${latest.day}T00:00:00`)}</time></td>
      <td>{formatBytes(latest.bytes)}</td>
    {:else}
      <td>none yet</td>
      <td></td>
    {/if}
    <td>last {kept}</td>
  </tr>
{/snippet}

<section aria-labelledby="{id}-title">
  <h2 id="{id}-title">Backups</h2>
  {#if error}
    <p>Could not read the backups: {error}</p>
  {:else if backups}
    {#if backups.failure}
      <p class="problem">
        A scheduled backup failed <time datetime={backups.failure.at}
          >{formatAge(backups.failure.at)}</time
        >:
        {backups.failure.message}. Digga tries again every 15 minutes, or you can press
        <b>Back up now</b>.
      </p>
    {/if}
    <div class="vault">
      <div class="block">
        <table class="backups">
          <caption class="visually-hidden">The newest backup of each kind</caption>
          <thead>
            <tr>
              <th scope="col"><span class="visually-hidden">Backup</span></th>
              <th scope="col">Latest</th>
              <th scope="col">Size</th>
              <th scope="col">Keeps</th>
            </tr>
          </thead>
          <tbody>
            {@render dailyRow(
              "Your decisions",
              backups.decisions.backups[0],
              backups.decisions.kept,
            )}
            {@render dailyRow("The database", backups.backups[0], backups.kept)}
            <tr>
              <th scope="row">Recent changes</th>
              {#if latestCheckpoint}
                <td>
                  {#if checkpointAt}<time datetime={checkpointAt}>{formatAge(checkpointAt)}</time
                    >{:else}{latestCheckpoint.day}{/if}
                </td>
                <td>{formatBytes(latestCheckpoint.bytes)}</td>
              {:else}
                <td>none yet</td>
                <td></td>
              {/if}
              <td>last {backups.checkpoints.kept}</td>
            </tr>
          </tbody>
        </table>
        <p class="hint">In <code>{backups.directory}</code>.</p>
      </div>
      <Art name="safe" size={128} />
    </div>
  {/if}
  <div class="inline">
    <button
      type="button"
      class="secondary"
      disabled={saving}
      aria-busy={saving}
      onclick={() => void backUpNow()}
    >
      Back up now
    </button>
    <p role="status">{message ?? ""}</p>
  </div>
  <details>
    <summary>What each backup holds, and how to restore it</summary>
    <p>
      <b>Your decisions</b>: once a day, Digga writes your verdicts, notes, track marks, listening
      and decision histories, saved sessions, attached links and settings to
      <code>decisions-YYYY-MM-DD.json.gz</code>. Days when nothing changed add none. To bring them
      back into a library rebuilt from the catalogue, run
      <code>npm run digga -- restore</code> with the file. Add <code>--config</code> to restore the settings
      too.
    </p>
    <p>
      <b>The database</b>: copied once a day while Digga runs. To restore a copy, quit Digga and run
      <code>npm run digga -- restore</code> with the file. Digga keeps the database it replaces.
      Before an update changes the database's structure, Digga also saves a
      <code>before-migration</code> copy, which restores the same way.
    </p>
    <p>
      <b>Recent changes</b>: every 15 minutes, and when Digga quits, Digga saves what changed since
      the last save, on top of the daily backups.
    </p>
  </details>
</section>

<section aria-labelledby="{id}-exports-title">
  <h2 id="{id}-exports-title">Exports</h2>
  <p>
    Download your data:
    <a href={api.exportUrl("decisions.json")} download>verdicts and track marks (JSON)</a>,
    <a href={api.exportUrl("verdicts.csv")} download>verdicts (CSV)</a>,
    <a href={api.exportUrl("track-marks.csv")} download>track marks (CSV)</a>.
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
  .vault {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 24px 72px;
  }
  .backups {
    max-width: 46em;
    border-collapse: collapse;
  }
  .backups th,
  .backups td {
    padding: 6px 24px 6px 0;
    font-weight: inherit;
    text-align: left;
  }
  .backups thead th {
    color: var(--fg-faint);
    font-size: var(--text-sm);
  }
  .backups tbody th {
    color: var(--fg);
  }
  .backups td {
    color: var(--fg-muted);
  }
  .backups tbody tr {
    border-top: 1px solid var(--rule-soft);
  }
</style>
