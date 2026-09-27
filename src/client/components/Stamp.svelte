<script lang="ts">
  /**
   * A rubber stamp: bordered caps, rough ink (the #ink SVG filter in App.svelte) and a tilt that
   * stays the same for the same seed. `slam` animates it in once, for stamps the user just applied.
   */
  import { stampTilt } from "../../shared/display.ts";

  let {
    text,
    tone = "paper",
    seed = 0,
    size = "md",
    slam = false,
  }: {
    text: string;
    tone?: "paper" | "flyer" | "dust";
    seed?: number;
    size?: "sm" | "md" | "lg" | "xl";
    slam?: boolean;
  } = $props();

  const tilt = $derived(stampTilt(seed));
</script>

<span class="stamp {tone} {size}" class:slam style:--tilt="{tilt}deg">{text}</span>

<style>
  .stamp {
    display: inline-block;
    padding: 0.28em 0.5em 0.22em;
    border: 0.14em solid currentColor;
    border-radius: 0.18em;
    font-family: var(--display);
    font-size: var(--text-sm);
    line-height: 1.1;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
    transform: rotate(var(--tilt));
    filter: url(#ink);
  }
  .sm {
    font-size: 10px;
    border-width: 1.5px;
    filter: url(#ink-fine);
  }
  .lg {
    font-size: var(--text-lg);
  }
  .xl {
    font-size: 64px;
    border-width: 6px;
    padding: 0.12em 0.4em 0.06em;
  }
  .paper {
    color: var(--paper);
  }
  .flyer {
    color: var(--flyer);
  }
  .dust {
    color: var(--faded);
  }
  .slam {
    animation: slam 150ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
  }
  @keyframes slam {
    from {
      opacity: 0;
      transform: rotate(var(--tilt)) scale(1.9);
    }
    to {
      opacity: 1;
      transform: rotate(var(--tilt)) scale(1);
    }
  }
</style>
