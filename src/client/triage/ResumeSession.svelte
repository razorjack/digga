<script lang="ts">
  import type { SessionCheckpoint } from "./checkpoint.svelte.ts";
  let { checkpoint }: { checkpoint: SessionCheckpoint } = $props();
  const savedAt = $derived(
    checkpoint.pending ? new Date(checkpoint.pending.updatedAt).toLocaleString() : "",
  );
</script>

{#if checkpoint.pending}
  <section class="resume" aria-label="Resume digging session" aria-busy={checkpoint.restoring}>
    <p>
      Continue your session from <time datetime={checkpoint.pending.updatedAt}>{savedAt}</time>?
      Resume restores its filters, scope, passed records, and playback position.
    </p>
    <div>
      <button type="button" disabled={checkpoint.restoring} onclick={() => void checkpoint.resume()}>Resume session</button>
      <button type="button" disabled={checkpoint.restoring} onclick={() => checkpoint.startFresh()}>Start fresh</button>
    </div>
  </section>
{/if}
<p class="checkpoint" role="status" aria-label="Session checkpoint">{checkpoint.message}</p>

<style>
  button {
    padding: 7px 14px;
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--fg);
    font-weight: 600;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .resume {
    border-bottom: 1px solid var(--rule);
    padding: 12px 0;
    margin-bottom: 16px;
  }
  .resume div {
    display: flex;
    gap: 12px;
    margin-top: 10px;
  }
  .checkpoint {
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
</style>
