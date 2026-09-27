<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api.ts";
  import type { QueueResponse, ReleaseDetail } from "../../shared/api.ts";

  let queue = $state<QueueResponse | null>(null);
  let detail = $state<ReleaseDetail | null>(null);
  let error = $state<string | null>(null);

  async function load(): Promise<void> {
    try {
      queue = await api.getQueue();
      const first = queue.items[0];
      detail = first ? await api.getRelease(first.id) : null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  onMount(() => {
    void load();
  });
</script>

<h1>Triage</h1>
<p class="todo">TODO: design session - see docs/DESIGN_BRIEF.md (no player, no keys yet)</p>

{#if error}
  <p>Error: {error}</p>
{:else if !queue}
  <p>Loading queue…</p>
{:else}
  <p>{queue.remaining.toLocaleString()} to go · strategy {queue.strategy} · showing {queue.items.length}</p>
  {#if detail}
    <h2>Up next: {detail.release.artistDisplay} - {detail.release.title}</h2>
    <pre>{JSON.stringify(detail, null, 2)}</pre>
  {/if}
  <h2>Queue</h2>
  <table>
    <thead>
      <tr><th>id</th><th>key</th><th>artist</th><th>title</th><th>label</th><th>catno</th><th>year</th><th>country</th><th>videos</th></tr>
    </thead>
    <tbody>
      {#each queue.items as item (item.id)}
        <tr>
          <td>{item.id}</td><td>{item.triageKey}</td><td>{item.artistDisplay}</td><td>{item.title}</td>
          <td>{item.labelName ?? ""}</td><td>{item.catno ?? ""}</td><td>{item.year ?? "?"}</td><td>{item.country ?? ""}</td><td>{item.videoCount}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
