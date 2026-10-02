<script lang="ts">
  /** Where the download stopped and why, at the foot of steps 2 and 3, where its strip was. */
  import Action from "./Action.svelte";

  let {
    message,
    busy,
    onrestart,
  }: {
    /** null while the download runs or has finished. */
    message: string | null;
    busy: boolean;
    onrestart: () => void;
  } = $props();
</script>

<!-- The alert is in the page before its text, so screen readers announce it. -->
<div class="foot" role="alert">
  {#if message}
    <aside class="stopped" aria-label="Download stopped">
      <p>{message}</p>
      <Action primary onclick={onrestart} disabled={busy}>Start again</Action>
    </aside>
  {/if}
</div>

<style>
  .foot {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
  }
  .stopped {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    padding: 12px 40px;
    border-top: 1px solid var(--rule);
    border-left: 3px solid var(--accent-mark);
    background: var(--surface);
    font-size: var(--text-sm);
  }
  @media (max-width: 860px) {
    .stopped {
      padding: 12px 20px;
    }
  }
</style>
