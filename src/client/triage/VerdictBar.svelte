<script lang="ts">
  import Key from "../components/Key.svelte";
  import { type TriageStatus, VERDICT_KEYS } from "../keymap.ts";

  let {
    disabled,
    hasMaybeList,
    onjudge,
    onpass,
    onhidelabel,
    onpickscope,
    onundo,
    onhelp,
  }: {
    disabled: boolean;
    hasMaybeList: boolean;
    onjudge: (status: TriageStatus) => void;
    onpass: () => void;
    onhidelabel: () => void;
    onpickscope: () => void;
    onundo: () => void;
    onhelp: () => void;
  } = $props();

  const judged = $derived(
    VERDICT_KEYS.filter((v) => v.group === "judge" && (hasMaybeList || !v.needsMaybeList)),
  );
  const deferred = VERDICT_KEYS.filter((v) => v.group === "defer");
  // Buttons never keep focus, so Space always reaches the player instead of the last button clicked.
  const keepFocus = (e: MouseEvent) => e.preventDefault();
</script>

<div class="bar" role="group" aria-label="Verdicts">
  <div class="verdicts">
    {#each judged as v (v.status)}
      <button
        type="button"
        class="verdict {v.tone}"
        tabindex="-1"
        {disabled}
        aria-keyshortcuts={v.key}
        onmousedown={keepFocus}
        onclick={() => onjudge(v.status)}
      >
        <Key label={v.key} primary size="lg" aria-hidden="true" />
        <span class="copy">{v.copy}</span>
        <span class="hint">{v.hint}</span>
      </button>
    {/each}
  </div>
  <div class="aside">
    <button type="button" tabindex="-1" aria-keyshortcuts="N" onmousedown={keepFocus} onclick={onpass}>
      <Key label="N" aria-hidden="true" /> next
    </button>
    {#each deferred as v (v.status)}
      <button
        type="button"
        tabindex="-1"
        {disabled}
        aria-keyshortcuts={v.key}
        onmousedown={keepFocus}
        onclick={() => onjudge(v.status)}
      >
        <Key label={v.key} aria-hidden="true" />
        {v.copy}
      </button>
    {/each}
    <button
      type="button"
      tabindex="-1"
      {disabled}
      aria-keyshortcuts="X"
      onmousedown={keepFocus}
      onclick={onhidelabel}
    >
      <Key label="X" aria-hidden="true" /> hide label
    </button>
    <button type="button" tabindex="-1" aria-keyshortcuts="F" onmousedown={keepFocus} onclick={onpickscope}>
      <Key label="F" aria-hidden="true" /> dig label, artist or seller
    </button>
    <button type="button" tabindex="-1" aria-keyshortcuts="Z" onmousedown={keepFocus} onclick={onundo}>
      <Key label="Z" aria-hidden="true" /> undo
    </button>
    <button type="button" tabindex="-1" aria-keyshortcuts="?" onmousedown={keepFocus} onclick={onhelp}>
      <Key label="?" aria-hidden="true" /> keys
    </button>
  </div>
</div>

<style>
  .bar {
    position: sticky;
    bottom: 0;
    z-index: 2;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 14px 40px 16px;
    border-top: 1px solid var(--rule);
    background: var(--surface);
  }
  .verdicts {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    min-width: 0;
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 0;
    background: none;
    color: var(--fg-muted);
    padding: 6px 4px;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .verdict {
    display: grid;
    grid-template-columns: auto auto;
    grid-template-rows: auto auto;
    column-gap: 12px;
    align-items: center;
    padding: 8px 18px 8px 8px;
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--fg);
    text-align: left;
  }
  .verdict :global(.key) {
    grid-row: 1 / span 2;
  }
  .verdict:not(:disabled):hover {
    border-color: var(--fg-muted);
  }
  .copy {
    font-family: var(--display);
    font-size: var(--text-lg);
    line-height: 1.1;
  }
  .accent .copy {
    color: var(--fg-accent);
  }
  .hint {
    color: var(--fg-faint);
    font-size: var(--text-xs);
  }
  .aside {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px 14px;
    font-size: var(--text-sm);
  }
  .aside button:not(:disabled):hover {
    color: var(--fg);
  }
  @media (max-width: 1180px) {
    .hint {
      display: none;
    }
  }
  @media (max-width: 980px) {
    .bar {
      padding: 10px 20px;
    }
  }
</style>
