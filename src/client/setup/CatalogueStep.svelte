<script lang="ts">
  /** Step 1: what Digga is and what the setup does; the one long download starts here. */
  import { formatBytes } from "../../shared/display.ts";
  import { isTyping } from "../keymap.ts";
  import Action from "./Action.svelte";
  import type { SetupFlow } from "./flow.svelte.ts";
  import { formatDumpDate, homeRelative } from "./model.ts";

  let { flow }: { flow: SetupFlow } = $props();

  const catalogue = $derived(flow.setup?.catalogue ?? null);
  const newest = $derived(catalogue?.newest ?? null);
  const picked = $derived(flow.pickedDump);
  const shortOfSpace = $derived(
    picked === null &&
      catalogue !== null &&
      catalogue.neededBytes !== null &&
      catalogue.freeBytes !== null &&
      catalogue.freeBytes < catalogue.neededBytes,
  );
  const canFetch = $derived(newest !== null && !shortOfSpace && !flow.busy);
  /** The desktop app offers another folder, unless DIGGA_DUMPS_DIR names this one. */
  const canChooseFolder = $derived(
    shortOfSpace && flow.setup?.desktop === true && catalogue?.dumpsDirSource !== "environment",
  );
  /** The desktop app offers a dump the user has, unless the download has begun. */
  const canChooseFile = $derived(
    flow.setup?.desktop === true && picked === null && flow.download?.status !== "running",
  );

  function fetchCatalogue(): void {
    if (picked !== null) flow.goTo("discogs");
    else if (canFetch) void flow.fetchCatalogue();
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key !== "Enter" || isTyping(event) || event.target instanceof HTMLButtonElement)
      return;
    event.preventDefault();
    fetchCatalogue();
  }
</script>

<svelte:window {onkeydown} />

<section class="step" aria-labelledby="catalogue-title">
  <h1 id="catalogue-title">Dig every record in your styles, by ear.</h1>
  <p class="lead">
    Digga plays a few seconds of each track on every record in the styles and years you pick. One key per record:
    skip, want, maybe, grail. What you want lands in Twelves, and on your Discogs wantlist if you like.
  </p>
  <p class="lead">Setting up takes about 20 minutes, mostly waiting. You can start digging after the first few.</p>

  <ol class="plan">
    <li>
      <span class="number" aria-hidden="true">1</span>
      <h2>Fetch the catalogue</h2>
      <div class="what" aria-live="polite" aria-busy={flow.setup === null}>
        {#if picked}
          <p>
            Digga reads releases from <code>{homeRelative(picked)}</code>, the file you chose, not from Discogs' API.
            The file stays where it is.
          </p>
        {:else if newest && catalogue}
          <p>
            Discogs publishes every release in one file a month. Digga downloads the newest, from
            <b>{formatDumpDate(newest.date)}</b>{#if newest.bytes}: <b>{formatBytes(newest.bytes)}</b>{/if}, into
            <code>{homeRelative(catalogue.dumpsDir)}</code>{#if catalogue.freeBytes !== null}{" "}({formatBytes(
                catalogue.freeBytes,
              )} free){/if}. Digga reads releases from this file, not from Discogs' API.
          </p>
        {:else if catalogue?.error}
          <p class="problem">Digga can't reach data.discogs.com: {catalogue.error}.</p>
        {:else}
          <p class="quiet">Asking data.discogs.com for the newest catalogue…</p>
        {/if}
        {#if flow.downloadQuit}
          <p>{flow.downloadQuit}</p>
        {/if}
      </div>
    </li>
    <li>
      <span class="number" aria-hidden="true">2</span>
      <h2>Bring your Discogs</h2>
      <p class="what">Optional. Leaves out what you own and want.</p>
    </li>
    <li>
      <span class="number" aria-hidden="true">3</span>
      <h2>Pick your sound</h2>
      <p class="what">Styles and years.</p>
    </li>
    <li>
      <span class="number" aria-hidden="true">4</span>
      <h2>Fill the crate</h2>
      <p class="what">Digga keeps what matches. Dig while it works.</p>
    </li>
  </ol>

  <!-- The alerts stay in the page, empty until they have something to say, so they are announced. -->
  <div class="outcome">
    <p class="problem" role="alert">
      {#if shortOfSpace && catalogue}
        The catalogue needs {formatBytes(catalogue.neededBytes ?? 0)} free, counting 1 GB to spare, and the disk with
        <code>{homeRelative(catalogue.dumpsDir)}</code> has {formatBytes(catalogue.freeBytes ?? 0)}.
        {#if canChooseFolder}
          Free some space, or choose a folder on another disk.
        {:else}
          Free some space, or put the catalogue on another disk: set <code>DIGGA_DUMPS_DIR</code> in <code>.env</code> and
          start Digga again.
        {/if}
      {/if}
    </p>
    <p class="problem" role="alert">{flow.error ?? ""}</p>

    <div class="actions">
      {#if picked}
        <Action primary keys="Enter" onclick={fetchCatalogue} disabled={flow.busy}>Continue</Action>
        <Action onclick={() => void flow.useDumpFile()} disabled={flow.busy}>Choose another file</Action>
      {:else if flow.download?.status === "running"}
        <p class="quiet">The catalogue is downloading.</p>
        <Action primary keys="Enter" onclick={fetchCatalogue} disabled={flow.busy}>Continue</Action>
      {:else if newest?.downloaded}
        <p class="quiet">Digga has the {formatDumpDate(newest.date)} catalogue already.</p>
        <Action primary keys="Enter" onclick={fetchCatalogue} disabled={flow.busy}>Continue</Action>
      {:else if newest}
        <Action primary keys="Enter" onclick={fetchCatalogue} disabled={!canFetch}>Fetch the catalogue</Action>
      {/if}
      {#if picked === null && (catalogue?.error || shortOfSpace)}
        <Action onclick={() => void flow.open()} disabled={flow.busy}>
          {shortOfSpace ? "Check again" : "Try again"}
        </Action>
      {/if}
      {#if canChooseFolder}
        <Action onclick={() => void flow.chooseDumpsFolder()} disabled={flow.busy}>Choose a folder…</Action>
      {/if}
      {#if canChooseFile}
        <Action onclick={() => void flow.useDumpFile()} disabled={flow.busy}>Use a dump file I have</Action>
      {/if}
    </div>
  </div>
</section>

<style>
  .step {
    display: flex;
    flex-direction: column;
    gap: 22px;
  }
  h1 {
    max-width: 16em;
    font-size: var(--text-3xl);
    line-height: 1.15;
  }
  .lead {
    max-width: 44em;
    color: var(--fg-muted);
  }
  .plan {
    display: grid;
    gap: 0;
    margin: 12px 0 0;
    padding: 0;
    list-style: none;
    border-top: 1px solid var(--rule);
  }
  .plan li {
    display: grid;
    grid-template-columns: 64px 220px 1fr;
    align-items: baseline;
    gap: 0 20px;
    padding: 16px 0;
    border-bottom: 1px solid var(--rule-soft);
  }
  .number {
    font-family: var(--display);
    font-size: var(--text-2xl);
    line-height: 1;
    color: var(--fg-accent);
  }
  .plan h2 {
    font-size: var(--text-md);
  }
  .what {
    color: var(--fg-muted);
  }
  .what b {
    color: var(--fg);
    font-weight: 600;
  }
  code {
    font-size: var(--text-sm);
    color: var(--fg);
  }
  .quiet {
    color: var(--fg-faint);
  }
  .problem {
    color: var(--fg-accent);
  }
  .outcome {
    display: flex;
    flex-direction: column;
    margin-top: 8px;
  }
  .outcome .problem:not(:empty) {
    margin-bottom: 22px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;
  }
  @media (max-width: 860px) {
    .plan li {
      grid-template-columns: 48px 1fr;
    }
    .plan .what {
      grid-column: 2;
    }
  }
</style>
