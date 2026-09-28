<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";

  /**
   * A key cap. `primary` keys (verdicts) are filled with the accent; the rest are outlined.
   * Inside a control that declares `aria-keyshortcuts`, pass `aria-hidden` so the cap stays out
   * of the control's name.
   */
  let {
    label,
    primary = false,
    size = "md",
    ...attributes
  }: {
    label: string;
    primary?: boolean;
    size?: "sm" | "md" | "lg";
  } & Pick<HTMLAttributes<HTMLElement>, "aria-hidden"> = $props();
</script>

<kbd class="key {size}" class:primary {...attributes}>{label}</kbd>

<style>
  .key {
    display: inline-grid;
    place-items: center;
    min-width: 1.9em;
    height: 1.9em;
    padding: 0 0.4em;
    border: 1px solid var(--groove);
    border-radius: var(--radius);
    color: var(--faded);
    font-family: var(--mono);
    font-size: var(--text-xs);
    font-stretch: 100%;
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
  }
  .sm {
    font-size: 10px;
  }
  .lg {
    font-size: var(--text-md);
    min-width: 2em;
    height: 2em;
  }
  .primary {
    border-color: var(--flyer);
    background: var(--flyer);
    color: var(--flyer-ink);
  }
</style>
