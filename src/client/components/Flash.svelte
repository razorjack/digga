<script lang="ts">
  /**
   * A one-line status message in the accent. The paragraph stays in the DOM while empty: a live
   * region inserted together with its text is usually not announced.
   */
  let {
    message,
    align = "start",
    label,
  }: {
    message: string | null;
    align?: "start" | "end";
    /** Names the region where a page has several status regions. */
    label?: string;
  } = $props();
</script>

<p class="flash {align}" role="status" aria-label={label}>{message ?? ""}</p>

<style>
  .flash {
    min-height: 1.4em;
    color: var(--fg-accent);
    font-size: var(--text-sm);
  }
  .end {
    text-align: right;
  }
</style>
