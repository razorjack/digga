<script lang="ts">
  import { api } from "../api.ts";
</script>

<h1>Settings</h1>
<p class="todo">TODO: design session - see docs/DESIGN_BRIEF.md (read-only for now; edit digga.config.json)</p>

{#await Promise.all([api.getSettings(), api.getStats(), api.getJobs()])}
  <p>Loading…</p>
{:then [settings, stats, jobs]}
  <h2>Stats</h2>
  <pre>{JSON.stringify(stats, null, 2)}</pre>
  <h2>Config</h2>
  <pre>{JSON.stringify(settings, null, 2)}</pre>
  <h2>Jobs</h2>
  <pre>{JSON.stringify(jobs.jobs, null, 2)}</pre>
{:catch e}
  <p>Error: {e instanceof Error ? e.message : String(e)}</p>
{/await}
