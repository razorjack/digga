<script lang="ts">
  /** The first run (docs/FIRST_RUN.md): four steps from an empty library to digging. */
  import { onDestroy, onMount, untrack } from "svelte";
  import Art from "../components/Art.svelte";
  import { getAnchor, navigate } from "../router.svelte.ts";
  import CatalogueStep from "../setup/CatalogueStep.svelte";
  import CrateStep from "../setup/CrateStep.svelte";
  import DiscogsStep from "../setup/DiscogsStep.svelte";
  import DownloadNotice from "../setup/DownloadNotice.svelte";
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
  <aside class="sidebar">
    <Art name="logo" size={88} />
    <ol class="steps" aria-label="Setup">
      {#each SETUP_STEPS as entry, index (entry.step)}
        <li
          aria-current={index === current ? "step" : undefined}
          class:past={index < current}
          data-side={entry.position.endsWith("1") ? `Side ${entry.position[0]}` : undefined}
        >
          <span class="number" aria-hidden="true">{entry.position}</span>
          {entry.title}
        </li>
      {/each}
    </ol>
  </aside>

  <div class="pane">
    <div class="sections">
      {#if flow.step === "catalogue"}
        <CatalogueStep {flow} />
      {:else if flow.step === "discogs"}
        <DiscogsStep {flow} />
      {:else if flow.step === "sound"}
        <SoundStep {flow} />
      {:else}
        <CrateStep {flow} />
      {/if}
    </div>

    {#if flow.step === "discogs" || flow.step === "sound"}
      <div class="foot">
        <DownloadNotice
          message={flow.downloadStopped ?? flow.checksumRetry}
          canRestart={flow.downloadStopped !== null}
          busy={flow.busy}
          onrestart={() => void flow.restartDownload()}
        />
        {#if downloading && flow.download}
          <DownloadStrip download={flow.download} />
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  /* A split view like Twelves: the steps in a sidebar, the step beside them. */
  .setup {
    display: grid;
    grid-template-columns: 19em minmax(0, 1fr);
    height: 100%;
  }
  .sidebar {
    display: grid;
    align-content: start;
    gap: 20px;
    min-height: 0;
    padding: 28px 12px;
    overflow-y: auto;
    border-right: 1px solid var(--rule);
    background: var(--surface);
    user-select: none;
  }
  .sidebar :global(.art) {
    margin-left: 12px;
  }
  .steps {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--fg-faint);
  }
  .steps li {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 6px 12px;
  }
  /* The steps are numbered as tracks, so each side's first one says which side it starts. */
  .steps li[data-side]::before {
    content: attr(data-side) / "";
    position: absolute;
    translate: 0 -28px;
    color: var(--fg-faint);
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .steps li[data-side] {
    position: relative;
    margin-top: 28px;
  }
  .steps .number {
    width: 2em;
    font-family: var(--display);
    font-size: var(--text-sm);
  }
  .steps .past {
    color: var(--fg-muted);
  }
  .steps [aria-current="step"] {
    background: var(--bg);
    box-shadow: inset 3px 0 0 var(--accent-mark);
    color: var(--fg);
  }
  .steps [aria-current="step"] .number {
    color: var(--fg-accent);
  }
  .pane {
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    min-width: 0;
    min-height: 0;
  }
  /* The step scrolls; its outcome, the alerts and the actions, stays at the pane's foot. */
  .sections {
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: 32px 40px 0;
    overflow-y: auto;
  }
  .sections > :global(.step) {
    flex: 1 0 auto;
  }
  .sections :global(.step > .outcome) {
    position: sticky;
    bottom: 0;
    z-index: 1;
    margin: auto -40px 0;
    padding: 14px 40px;
    border-top: 1px solid var(--rule);
    background: var(--surface);
  }
  @media (max-width: 860px) {
    .setup {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr);
    }
    /* Stacked, the steps take one row and leave the height to the step. */
    .sidebar {
      padding-block: 8px;
      border-right: 0;
      border-bottom: 1px solid var(--rule);
    }
    .sidebar :global(.art),
    .steps li[data-side]::before {
      display: none;
    }
    .steps {
      display: flex;
      flex-wrap: wrap;
    }
    .steps li[data-side] {
      margin-top: 0;
    }
    .sections {
      padding-inline: 20px;
    }
    .sections :global(.step > .outcome) {
      margin-inline: -20px;
      padding-inline: 20px;
    }
  }
</style>
