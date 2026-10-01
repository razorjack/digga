<script lang="ts">
  import { formatCount } from "../../shared/display.ts";
  import Key from "../components/Key.svelte";
  import type { Page } from "./model.ts";

  let {
    page,
    noun,
    onturn,
  }: {
    page: Page<unknown>;
    /** What the shelf lists, such as "records". */
    noun: string;
    onturn: (turn: -1 | 1) => void;
  } = $props();

  // Buttons never keep focus, so Enter and the letter keys keep reaching the shelf.
  const keepFocus = (event: MouseEvent) => event.preventDefault();
</script>

<nav class="pager" aria-label="Shelf pages">
  <button
    type="button"
    tabindex="-1"
    aria-keyshortcuts="ArrowLeft"
    aria-label="Previous page"
    disabled={page.index === 0}
    onmousedown={keepFocus}
    onclick={() => onturn(-1)}
  >
    <Key label="←" size="sm" aria-hidden="true" />
  </button>
  <span>{formatCount(page.first)}–{formatCount(page.last)} of {formatCount(page.total)} {noun}</span>
  <button
    type="button"
    tabindex="-1"
    aria-keyshortcuts="ArrowRight"
    aria-label="Next page"
    disabled={page.index === page.count - 1}
    onmousedown={keepFocus}
    onclick={() => onturn(1)}
  >
    <Key label="→" size="sm" aria-hidden="true" />
  </button>
</nav>

<style>
  .pager {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    white-space: nowrap;
  }
  button {
    display: inline-flex;
    border: 0;
    background: none;
    padding: 0;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
