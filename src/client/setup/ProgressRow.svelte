<script lang="ts">
  /** One job's progress: its name, a native bar, and the numbers beside it. */
  let { label, fraction, text }: { label: string; fraction: number | null; text: string } =
    $props();

  const id = $props.id();
</script>

<div class="row">
  <span class="label" id="{id}-label">{label}</span>
  <progress
    max="1"
    value={fraction ?? undefined}
    aria-labelledby="{id}-label"
    aria-describedby="{id}-text"
  ></progress>
  <span class="text" id="{id}-text">{text}</span>
</div>

<style>
  .row {
    display: grid;
    grid-template-columns: 90px 1fr minmax(180px, auto);
    align-items: center;
    gap: 16px;
  }
  .label {
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  progress {
    width: 100%;
    height: 10px;
    appearance: none;
    border: 0;
    background: var(--rule-soft);
    color: var(--accent-mark);
  }
  progress::-webkit-progress-bar {
    background: var(--rule-soft);
  }
  progress::-webkit-progress-value {
    background: var(--accent-mark);
  }
  progress::-moz-progress-bar {
    background: var(--accent-mark);
  }
  .text {
    color: var(--fg);
    font-size: var(--text-sm);
    white-space: nowrap;
  }
</style>
