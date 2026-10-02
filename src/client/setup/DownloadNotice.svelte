<script lang="ts">
  /**
   * What happened to the download, at the foot of steps 2 and 3: where and why it stopped, with
   * "Start again", or that it runs once more after a checksum mismatch.
   */
  import Action from "./Action.svelte";

  let {
    message,
    canRestart,
    busy,
    onrestart,
  }: {
    /** null while the download runs or has finished as it should. */
    message: string | null;
    canRestart: boolean;
    busy: boolean;
    onrestart: () => void;
  } = $props();
</script>

<!-- The alert is in the page before its text, so screen readers announce it. -->
<div role="alert">
  {#if message}
    <div class="notice">
      <p>{message}</p>
      {#if canRestart}
        <Action primary onclick={onrestart} disabled={busy}>Start again</Action>
      {/if}
    </div>
  {/if}
</div>

<style>
  .notice {
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
    .notice {
      padding: 12px 20px;
    }
  }
</style>
