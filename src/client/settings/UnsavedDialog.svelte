<script lang="ts">
  let {
    open,
    problem,
    onsave,
    ondiscard,
    onkeep,
  }: {
    open: boolean;
    /** Why the draft cannot be saved, which leaves Discard and Keep editing. */
    problem: string | null;
    onsave: () => void;
    ondiscard: () => void;
    onkeep: () => void;
  } = $props();

  const id = $props.id();

  /** The native modal traps focus and turns Esc into a cancel, which keeps editing. */
  function syncOpen(dialog: HTMLDialogElement): void {
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }

  /** Each button closes the dialog first, so its action runs with the page keys working again. */
  function closeWith(action: () => void): (event: MouseEvent) => void {
    return (event) => {
      (event.currentTarget as HTMLElement).closest("dialog")?.close();
      action();
    };
  }
</script>

<dialog
  aria-labelledby="{id}-title"
  aria-describedby="{id}-text"
  {@attach syncOpen}
  oncancel={onkeep}
>
  <h2 id="{id}-title">Unsaved settings</h2>
  <p id="{id}-text">
    {problem ? `These changes cannot be saved: ${problem}` : "Save your changes before leaving?"}
  </p>
  <div class="actions">
    <button type="button" class="secondary" onclick={closeWith(onkeep)} aria-keyshortcuts="Escape">
      Keep editing
    </button>
    <button type="button" class="secondary" onclick={closeWith(ondiscard)}>Discard</button>
    {#if !problem}
      <!-- In a modal dialog autofocus picks what showModal() focuses, as the HTML spec intends. -->
      <!-- svelte-ignore a11y_autofocus -->
      <button type="button" class="primary" onclick={closeWith(onsave)} autofocus>Save</button>
    {/if}
  </div>
</dialog>

<style>
  dialog {
    width: min(440px, calc(100% - 48px));
    padding: 24px 28px;
    border: 1px solid var(--rule);
    background: var(--surface);
    color: inherit;
  }
  dialog::backdrop {
    background: color-mix(in srgb, var(--bg) 82%, transparent);
  }
  h2 {
    font-size: var(--text-lg);
  }
  p {
    margin-top: 10px;
    color: var(--fg-muted);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 24px;
  }
</style>
