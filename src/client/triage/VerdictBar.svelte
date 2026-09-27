<script lang="ts">
  import Key from "../components/Key.svelte";
  import { type TriageStatus, VERDICT_KEYS } from "../keymap.ts";

  let {
    disabled,
    onjudge,
    onpass,
    onundo,
    onhelp,
  }: {
    disabled: boolean;
    onjudge: (status: TriageStatus) => void;
    onpass: () => void;
    onundo: () => void;
    onhelp: () => void;
  } = $props();

  const main = VERDICT_KEYS.filter((v) => v.status !== "no_audio");
  const noAudio = VERDICT_KEYS.find((v) => v.status === "no_audio")!;
  // Buttons never keep focus, so Space always reaches the player instead of the last button clicked.
  const keepFocus = (e: MouseEvent) => e.preventDefault();
</script>

<nav class="bar" aria-label="Verdicts">
  <div class="verdicts">
    {#each main as v (v.status)}
      <button
        type="button"
        class="verdict {v.tone}"
        tabindex="-1"
        {disabled}
        onmousedown={keepFocus}
        onclick={() => onjudge(v.status)}
      >
        <Key label={v.key} primary size="lg" />
        <span class="copy">{v.copy}</span>
        <span class="hint">{v.hint}</span>
      </button>
    {/each}
  </div>
  <div class="aside">
    <button type="button" tabindex="-1" onmousedown={keepFocus} onclick={onpass}>
      <Key label="N" /> next
    </button>
    <button
      type="button"
      tabindex="-1"
      {disabled}
      onmousedown={keepFocus}
      onclick={() => onjudge(noAudio.status)}
    >
      <Key label={noAudio.key} />
      {noAudio.copy}
    </button>
    <button type="button" tabindex="-1" onmousedown={keepFocus} onclick={onundo}>
      <Key label="Z" /> undo
    </button>
    <button type="button" tabindex="-1" onmousedown={keepFocus} onclick={onhelp}>
      <Key label="?" /> keys
    </button>
  </div>
</nav>

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
    border-top: 1px solid var(--groove);
    background: var(--sleeve);
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
    color: var(--faded);
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
    border: 1px solid var(--groove);
    border-radius: var(--radius);
    background: var(--ground);
    color: var(--paper);
    text-align: left;
  }
  .verdict :global(.key) {
    grid-row: 1 / span 2;
  }
  .verdict:not(:disabled):hover {
    border-color: var(--faded);
  }
  .copy {
    font-family: var(--display);
    font-size: var(--text-lg);
    line-height: 1.1;
  }
  .flyer .copy {
    color: var(--flyer);
  }
  .hint {
    color: var(--dust);
    font-size: var(--text-xs);
  }
  .aside {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px 18px;
    font-size: var(--text-sm);
  }
  .aside button:not(:disabled):hover {
    color: var(--paper);
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
