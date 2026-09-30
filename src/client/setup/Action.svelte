<script lang="ts">
  /** A setup button with its key; `primary` fills it with the flyer, like a verdict key. */
  import type { Snippet } from "svelte";
  import Key from "../components/Key.svelte";

  let {
    children,
    keys = null,
    primary = false,
    type = "button",
    disabled = false,
    onclick,
  }: {
    children: Snippet;
    /** The key cap shown, and declared with aria-keyshortcuts. */
    keys?: string | null;
    primary?: boolean;
    type?: "button" | "submit";
    disabled?: boolean;
    onclick?: () => void;
  } = $props();

</script>

<button {type} class:primary {disabled} aria-keyshortcuts={keys ?? undefined} {onclick}>
  {@render children()}
  {#if keys}<Key label={keys} size="sm" aria-hidden="true" />{/if}
</button>

<style>
  button {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: transparent;
    color: var(--fg);
    font-size: var(--text-md);
  }
  button:hover:not(:disabled) {
    border-color: var(--fg-muted);
  }
  .primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--on-accent);
    font-family: var(--display);
    font-size: var(--text-sm);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .primary:hover:not(:disabled) {
    border-color: var(--accent);
    filter: brightness(1.06);
  }
  .primary :global(.key) {
    border-color: var(--on-accent);
    color: var(--on-accent);
  }
  button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
</style>
