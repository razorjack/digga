<script lang="ts">
  import { elapsed, JOB_LABEL, jobProgress } from "../../shared/job-display.ts";
  import { formatDay } from "../../shared/display.ts";
  import type { Job } from "../../shared/types.ts";

  interface Props {
    jobs: Job[];
    /** Why the jobs are missing, when they did not load. */
    error: string | null;
    oncancel: (job: Job) => void;
  }

  let { jobs, error, oncancel }: Props = $props();
  const id = $props.id();
</script>

{#if error || jobs.length > 0}
  <div class="field jobs">
    <span class="name" id="{id}-jobs">Recent jobs</span>
    {#if error}
      <p class="quiet">Jobs did not load: {error}</p>
    {:else}
      <table class="job-list" aria-labelledby="{id}-jobs">
        <thead>
          <tr>
            <th scope="col" class="job-name"><span class="visually-hidden">Job</span></th>
            <th scope="col" class="job-status"><span class="visually-hidden">Status</span></th>
            <th scope="col"><span class="visually-hidden">Progress</span></th>
            <th scope="col" class="job-started"><span class="visually-hidden">Started, duration</span></th>
            <th scope="col" class="job-action"><span class="visually-hidden">Action</span></th>
          </tr>
        </thead>
        <tbody>
          {#each jobs as job (job.id)}
            {@const progress = jobProgress(job)}
            <tr class={job.status} data-job-id={job.id}>
              <th scope="row" class="job-name" id="{id}-job-{job.id}">{JOB_LABEL[job.type]}</th>
              <td class="job-status">{job.status}</td>
              <td class="job-progress">
                {#if job.status === "running" && progress.fraction !== null}
                  <progress class="meter" value={progress.fraction} aria-labelledby="{id}-job-{job.id}"></progress>
                {/if}
                {progress.text}{job.error ? `: ${job.error}` : ""}
              </td>
              <td class="job-started">
                {#if job.createdAt}
                  <time datetime={job.createdAt}>{formatDay(job.createdAt)}</time>, {elapsed(job)}
                {/if}
              </td>
              <td>
                {#if job.status === "running"}
                  <button type="button" class="link" onclick={() => oncancel(job)}>Cancel</button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
{/if}

<style>
  /*
   * The table's first row is its hidden header, so a baseline would put the name above the
   * first job; the name starts at the job's cell padding instead.
   */
  .field.jobs {
    align-items: start;
  }
  .field.jobs > .name {
    padding-top: 8px;
  }
  .quiet {
    color: var(--fg-muted);
  }
  .job-list {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: var(--text-sm);
  }
  .job-list th,
  .job-list td {
    padding: 8px;
    font-weight: inherit;
    text-align: left;
    vertical-align: middle;
  }
  .job-list thead th {
    padding: 0;
  }
  .job-list tbody > tr > :first-child {
    padding-left: 0;
  }
  .job-list tbody > tr > :last-child {
    padding-right: 0;
  }
  .job-list tbody tr {
    border-bottom: 1px solid var(--rule-soft);
  }
  th.job-name {
    width: calc(13em + 8px);
  }
  th.job-status {
    width: calc(6em + 16px);
  }
  th.job-started {
    width: calc(19ch + 16px);
  }
  td.job-started {
    color: var(--fg-muted);
    white-space: nowrap;
  }
  th.job-action {
    width: calc(4em + 8px);
  }
  .job-status {
    color: var(--fg-muted);
  }
  .running .job-status {
    color: var(--fg-accent);
  }
  .failed .job-status {
    color: var(--fg);
    text-decoration: line-through;
  }
  .job-progress {
    color: var(--fg-muted);
    overflow-wrap: anywhere;
  }
  .meter {
    margin-right: 10px;
    vertical-align: middle;
    width: 80px;
    height: 4px;
    border: 0;
    appearance: none;
    background: var(--rule);
  }
  .meter::-webkit-progress-bar {
    background: var(--rule);
  }
  .meter::-webkit-progress-value {
    background: var(--accent-mark);
  }
  .meter::-moz-progress-bar {
    background: var(--accent-mark);
  }
</style>
