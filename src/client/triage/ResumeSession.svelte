<script lang="ts">
  import { formatDay, formatTime } from "../../shared/display.ts";
  import type { SessionCheckpoint } from "./checkpoint.svelte.ts";

  let { checkpoint }: { checkpoint: SessionCheckpoint } = $props();
  const savedAt = $derived.by(() => {
    const updatedAt = checkpoint.pending?.updatedAt;
    return updatedAt ? `${formatDay(updatedAt)}, ${formatTime(updatedAt)}` : "";
  });
</script>

{#if checkpoint.pending}
  <section class="resume" aria-label="Resume digging session" aria-busy={checkpoint.restoring}>
    <div class="copy">
      <p class="title">
        Continue your session from <time datetime={checkpoint.pending.updatedAt}>{savedAt}</time>?
      </p>
      <p class="detail">Resume restores its filters, scope, passed records and playback position.</p>
    </div>
    <div class="actions">
      <button
        type="button"
        class="primary"
        disabled={checkpoint.restoring}
        onclick={() => void checkpoint.resume()}
      >
        Resume session
      </button>
      <button type="button" disabled={checkpoint.restoring} onclick={() => checkpoint.startFresh()}>
        Start fresh
      </button>
    </div>
  </section>
{/if}
<p class="checkpoint" role="status" aria-label="Session checkpoint">{checkpoint.message}</p>

<style>
  .resume {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 16px 32px;
    padding: 18px 40px;
    border-bottom: 1px solid var(--rule);
    background: var(--surface);
    box-shadow: inset 3px 0 0 var(--accent-mark);
  }
  .title {
    color: var(--fg);
    font-size: var(--text-md);
    font-weight: 600;
  }
  .detail {
    margin-top: 4px;
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .actions {
    display: flex;
    flex: none;
    gap: 12px;
  }
  button {
    padding: 7px 14px;
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--fg);
    font-weight: 600;
  }
  button.primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--on-accent);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .checkpoint {
    padding: 0 40px;
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
</style>
