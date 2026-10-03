<script lang="ts">
  import Key from "../components/Key.svelte";

  let {
    note,
    editing,
    onsave,
    oncancel,
  }: {
    note: string | null;
    editing: boolean;
    onsave: (text: string) => void;
    oncancel: () => void;
  } = $props();
  const id = $props.id();

  /** The input appears when E is pressed, so it takes focus, with the note, as it mounts. */
  function startEditing(input: HTMLInputElement): void {
    input.value = note ?? "";
    input.focus();
  }

  function onkeydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }): void {
    if (event.key === "Enter") onsave(event.currentTarget.value);
    if (event.key === "Escape") oncancel();
  }
</script>

<div class="note-line">
  {#if editing}
    <input
      {@attach startEditing}
      maxlength="4000"
      aria-label="Note on this record"
      aria-describedby="{id}-hint"
      placeholder="what you heard, where, when"
      {onkeydown}
      onblur={oncancel}
    />
    <span class="hint" id="{id}-hint"><Key label="Enter" size="sm" /> save note</span>
  {:else if note}
    <p class="note"><Key label="E" size="sm" /> <span>{note}</span></p>
  {/if}
</div>

<style>
  .note-line {
    display: flex;
    align-items: center;
    gap: 14px;
    min-width: 0;
  }
  input {
    flex: 1;
    min-width: 0;
    border-color: var(--accent-mark);
  }
  .hint {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: none;
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .note {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    color: var(--fg-accent);
  }
  .note span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
