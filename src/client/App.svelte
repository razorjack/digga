<script lang="ts">
  import { getRoute, navigate, ROUTES } from "./router.svelte.ts";
  import Settings from "./pages/Settings.svelte";
  import Triage from "./pages/Triage.svelte";
  import Twelves from "./pages/Twelves.svelte";

  const route = $derived(getRoute());
</script>

<nav>
  <strong>Digga</strong>
  {#each ROUTES as r (r.route)}
    <button type="button" aria-current={route === r.route ? "page" : undefined} onclick={() => navigate(r.route)}>
      {r.label}
    </button>
  {/each}
</nav>

<main>
  {#if route === "twelves"}
    <Twelves />
  {:else if route === "settings"}
    <Settings />
  {:else}
    <Triage />
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    background: #141414;
    color: #e6e2dc;
    font-family: system-ui, sans-serif;
    line-height: 1.4;
  }
  :global(pre) {
    white-space: pre-wrap;
    word-break: break-word;
  }
  :global(table) {
    border-collapse: collapse;
  }
  :global(td),
  :global(th) {
    border: 1px solid #333;
    padding: 0.2rem 0.5rem;
    text-align: left;
  }
  :global(.todo) {
    color: #c8b400;
  }
  nav {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid #333;
  }
  nav button {
    background: #222;
    color: inherit;
    border: 1px solid #444;
    padding: 0.2rem 0.6rem;
    cursor: pointer;
  }
  nav button[aria-current="page"] {
    border-color: #e6e2dc;
  }
  main {
    padding: 1rem;
  }
</style>
