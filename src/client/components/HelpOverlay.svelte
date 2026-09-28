<script lang="ts">
  import Key from "./Key.svelte";
  import type { KeyGroup } from "../keymap.ts";

  let { open, groups, onclose }: { open: boolean; groups: KeyGroup[]; onclose: () => void } =
    $props();

  const id = $props.id();

  /** The native modal traps focus, closes on Esc and returns focus to where it was. */
  function syncOpen(dialog: HTMLDialogElement): void {
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }

  /**
   * The browser returns focus to the element focused before the dialog opened. Opened from a
   * shortcut, nothing was, so focus would stay on the hidden close button.
   */
  function releaseFocus(event: Event & { currentTarget: HTMLDialogElement }): void {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && event.currentTarget.contains(focused)) focused.blur();
    onclose();
  }

  /** For browsers without `closedby`: a click on the backdrop targets the dialog itself. */
  function closeOnBackdrop(event: MouseEvent & { currentTarget: HTMLDialogElement }): void {
    if (event.target === event.currentTarget) event.currentTarget.close();
  }
</script>

<dialog
  aria-labelledby="{id}-title"
  closedby="any"
  {@attach syncOpen}
  onclose={releaseFocus}
  onclick={closeOnBackdrop}
>
  <div class="panel">
    <div class="head">
      <h2 id="{id}-title">Keys</h2>
      <form method="dialog">
        <button aria-keyshortcuts="Escape"><Key label="Esc" /> close</button>
      </form>
    </div>
    <div class="groups">
      {#each groups as group (group.title)}
        <section>
          <h3>{group.title}</h3>
          <dl>
            {#each group.keys as k (k.label)}
              <div class="row">
                <dt>
                  {#each k.keys as key, i (i)}
                    {#if key === "…"}<span class="ellipsis">…</span>{:else}<Key label={key} />{/if}
                  {/each}
                </dt>
                <dd>{k.label}</dd>
              </div>
            {/each}
          </dl>
        </section>
      {/each}
    </div>
  </div>
</dialog>

<style>
  dialog {
    width: min(1120px, calc(100% - 48px));
    max-width: none;
    max-height: calc(100% - 48px);
    padding: 0;
    border: 1px solid var(--groove);
    background: var(--sleeve);
    color: inherit;
  }
  dialog::backdrop {
    background: color-mix(in srgb, var(--ground) 82%, transparent);
  }
  .panel {
    padding: 28px 32px 32px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
  }
  h2 {
    font-family: var(--display);
    font-weight: 400;
    font-size: var(--text-xl);
  }
  .head button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 0;
    background: none;
    color: var(--faded);
  }
  .groups {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 28px 40px;
  }
  h3 {
    margin-bottom: 10px;
    color: var(--faded);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  dl {
    margin: 0;
    display: grid;
    gap: 8px;
  }
  .row {
    display: grid;
    grid-template-columns: 6.5em 1fr;
    align-items: center;
    gap: 12px;
  }
  dt {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  dd {
    margin: 0;
    font-size: var(--text-sm);
  }
  .ellipsis {
    color: var(--dust);
  }
</style>
