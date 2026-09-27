<script lang="ts">
  import { api } from "../api.ts";
</script>

<h1>Twelves</h1>
<p class="todo">TODO: design session - see docs/DESIGN_BRIEF.md</p>

{#await api.getTwelves()}
  <p>Loading…</p>
{:then twelves}
  <p>{twelves.items.length} items with status {twelves.statuses.join(", ")}</p>
  <table>
    <thead>
      <tr><th>status</th><th>key</th><th>artist</th><th>title</th><th>label</th><th>catno</th><th>year</th><th>decided</th><th>notes</th></tr>
    </thead>
    <tbody>
      {#each twelves.items as item (item.verdict.key)}
        <tr>
          <td>{item.verdict.status}</td><td>{item.verdict.key}</td>
          <td>{item.release?.artistDisplay ?? ""}</td><td>{item.release?.title ?? "(release not loaded)"}</td>
          <td>{item.release?.labelName ?? ""}</td><td>{item.release?.catno ?? ""}</td><td>{item.release?.year ?? ""}</td>
          <td>{item.verdict.decidedAt}</td><td>{item.verdict.notes ?? ""}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{:catch e}
  <p>Error: {e instanceof Error ? e.message : String(e)}</p>
{/await}
