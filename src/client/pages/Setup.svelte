<script lang="ts">
  /** The first run (docs/FIRST_RUN.md): four steps from an empty library to digging. */
  import { onDestroy, onMount, untrack } from "svelte";
  import { getAnchor, navigate } from "../router.svelte.ts";
  import CatalogueStep from "../setup/CatalogueStep.svelte";
  import CrateStep from "../setup/CrateStep.svelte";
  import DiscogsStep from "../setup/DiscogsStep.svelte";
  import DownloadStrip from "../setup/DownloadStrip.svelte";
  import { SetupFlow } from "../setup/flow.svelte.ts";
  import SoundStep from "../setup/SoundStep.svelte";
  import { isSetupStep, SETUP_STEPS } from "../setup/steps.ts";
  import { stats } from "../stores.svelte.ts";

  const flow = new SetupFlow();
  const current = $derived(SETUP_STEPS.findIndex((entry) => entry.step === flow.step));
  const title = $derived(`${SETUP_STEPS[current]!.title} – Digga setup`);
  const downloading = $derived(
    flow.download?.status === "running" && (flow.step === "discogs" || flow.step === "sound"),
  );

  const anchor = $derived(getAnchor());
  let opened = $state(false);
  /** A library that has finished a load needs no setup, unless this visit watched it finish. */
  const done = $derived(opened && stats.value?.dump.loadedAt != null && !flow.followsLoad);

  onMount(async () => {
    await flow.open(isSetupStep(anchor) ? anchor : null);
    opened = true;
  });
  onDestroy(() => flow.close());

  // The step is in the address, so a reload stays on it and the browser's Back goes a step back.
  // Each direction follows its own side only, so neither undoes the other.
  $effect(() => {
    const step = flow.step;
    if (opened && untrack(() => anchor) !== step) navigate("setup", step);
  });
  $effect(() => {
    const requested = anchor;
    untrack(() => {
      if (!opened || requested === flow.step) return;
      // Once the load runs, its screen stays; "Change your picks" leads back.
      if (isSetupStep(requested) && flow.step !== "crate" && requested !== "crate")
        flow.goTo(requested);
      else navigate("setup", flow.step);
    });
  });

  $effect(() => {
    if (done) navigate("triage");
  });
</script>

<svelte:head><title>{title}</title></svelte:head>

<div class="setup">
  <ol class="steps" aria-label="Setup">
    {#each SETUP_STEPS as entry, index (entry.step)}
      <li aria-current={index === current ? "step" : undefined} class:past={index < current}>
        <span class="number" aria-hidden="true">{index + 1}</span>
        {entry.title}
      </li>
    {/each}
  </ol>

  {#if flow.step === "catalogue"}
    <CatalogueStep {flow} />
  {:else if flow.step === "discogs"}
    <DiscogsStep {flow} />
  {:else if flow.step === "sound"}
    <SoundStep {flow} />
  {:else}
    <CrateStep {flow} />
  {/if}

  {#if downloading && flow.download}
    <DownloadStrip download={flow.download} />
  {/if}
</div>

<style>
  .setup {
    display: flex;
    flex-direction: column;
    gap: 40px;
    max-width: 880px;
    margin: 0 auto;
    padding: 36px 40px 120px;
  }
  .steps {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 28px;
    margin: 0;
    padding: 0 0 14px;
    list-style: none;
    border-bottom: 1px solid var(--rule);
    color: var(--fg-faint);
    font-size: var(--text-sm);
  }
  .steps li {
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
  }
  .steps .number {
    font-family: var(--display);
  }
  .steps .past {
    color: var(--fg-muted);
  }
  .steps [aria-current="step"] {
    color: var(--fg);
  }
  .steps [aria-current="step"] .number {
    color: var(--fg-accent);
  }
  @media (max-width: 860px) {
    .setup {
      padding: 24px 20px 120px;
    }
  }
</style>
