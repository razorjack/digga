<script lang="ts">
  /** The end of a practice round: the sandbox's verdicts go, and digging for real starts. */
  import Key from "../components/Key.svelte";

  let { open, ondig }: { open: boolean; ondig: () => void } = $props();

  function syncOpen(dialog: HTMLDialogElement): void {
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }

  // Esc closes the dialog natively; either way the round is over, so it digs for real.
</script>

<dialog aria-labelledby="practice-done-title" {@attach syncOpen} onclose={ondig}>
  <form method="dialog">
    <h2 id="practice-done-title">That's digging.</h2>
    <p>
      Your practice verdicts are gone, and those records come round again. From now on Digga keeps every verdict.
    </p>
    <!-- svelte-ignore a11y_autofocus: the dialog opens from a key press, and Enter should dig. -->
    <button autofocus aria-keyshortcuts="Enter">
      Dig for real <Key label="Enter" size="sm" aria-hidden="true" />
    </button>
  </form>
</dialog>

<style>
  dialog {
    max-width: 30em;
    padding: 28px 32px;
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--fg);
  }
  dialog::backdrop {
    background: color-mix(in srgb, var(--bg) 70%, transparent);
  }
  form {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }
  h2 {
    font-size: var(--text-xl);
  }
  p {
    color: var(--fg-muted);
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--on-accent);
    font-family: var(--display);
    font-size: var(--text-sm);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  button :global(.key) {
    border-color: var(--on-accent);
    color: var(--on-accent);
  }
</style>
