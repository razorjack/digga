<script lang="ts">
  import type { QueueItem } from "../../shared/api.ts";
  import Key from "../components/Key.svelte";
  import Stamp from "../components/Stamp.svelte";
  import { STATUS_COPY, STATUS_TONE, type TriageStatus } from "../keymap.ts";
  import type { Slip } from "./session.svelte.ts";

  let {
    slip,
    next,
    nextReady,
    sandbox,
    inRound,
  }: {
    slip: Slip | null;
    next: QueueItem | null;
    nextReady: boolean;
    sandbox: boolean;
    /** The slip's release is the last of a snoozed round, so the queue comes next. */
    inRound: boolean;
  } = $props();

  const name = (i: QueueItem) => `${i.artistDisplay} – ${i.title}`;

  function undoneText(undone: TriageStatus | "pass" | "label"): string {
    if (undone === "label") return "Its label is back in the queue.";
    const what = undone === "pass" ? "next" : STATUS_COPY[undone];
    return `Back on it; the ${what} is gone.`;
  }
</script>

<div class="slips">
  <div class="slip last" aria-live="polite">
    {#if slip === null}
      <p class="quiet">Your verdicts land here. <Key label="Z" /> takes the last one back.</p>
    {:else}
      {#key slip.id}
        <div class="stamp">
          {#if slip.kind === "verdict"}
            <Stamp text={STATUS_COPY[slip.status]} tone={STATUS_TONE[slip.status]} seed={slip.item.id} slam />
          {:else if slip.kind === "pass"}
            <Stamp text="later" tone="dust" seed={slip.item.id} slam />
          {:else if slip.kind === "label"}
            <Stamp text="label hidden" tone="dust" seed={slip.item.id} slam />
          {:else}
            <Stamp text="undone" tone="dust" seed={slip.item.id} slam />
          {/if}
        </div>
      {/key}
      <div class="text">
        <p class="what">{name(slip.item)}</p>
        <p class="quiet">
          {#if slip.kind === "verdict" && slip.push === "pending"}
            Adding to your Discogs wantlist…
          {:else if slip.kind === "verdict" && slip.push === "done"}
            {sandbox ? "Added to your wantlist (sandbox: nothing sent)." : "Added to your Discogs wantlist."}
          {:else if slip.kind === "verdict" && slip.push === "failed"}
            Saved, but not on the Discogs wantlist.
          {:else if slip.kind === "verdict" && slip.status === "maybe"}
            On the Maybe shelf; add it to your Discogs list from Twelves.
          {:else if slip.kind === "verdict" && slip.status === "snoozed"}
            On the Snoozed shelf, out of the queue.
          {:else if slip.kind === "pass"}
            {slip.stays === "snoozed" ? "Stays snoozed." : "Stays in the queue for another go."}
          {:else if slip.kind === "label"}
            Every record on {slip.label} is out of the queue; Settings lists the hidden labels.
          {:else if slip.kind === "undo"}
            {undoneText(slip.undone)}
          {:else}
            {sandbox ? "Sandbox: nothing was saved." : "Saved."}
          {/if}
        </p>
      </div>
      {#if slip.kind !== "undo"}<span class="undo"><Key label="Z" /> undo</span>{/if}
    {/if}
  </div>

  <div class="slip next">
    <p class="label">Up next</p>
    {#if next}
      <p class="what">
        <span class="catno">{next.catno ?? ""}</span>
        {name(next)}
      </p>
      <p class="quiet">
        {#if next.videoCount === 0}
          no videos
        {:else if nextReady}
          buffered, starts at once
        {:else}
          buffering…
        {/if}
      </p>
    {:else}
      <p class="quiet">{inRound ? "Then back to the queue." : "Nothing after this one."}</p>
    {/if}
  </div>
</div>

<style>
  .slips {
    display: grid;
    gap: 14px;
  }
  .slip {
    min-width: 0;
    padding-top: 12px;
    border-top: 1px dashed var(--groove);
  }
  .last {
    display: flex;
    align-items: center;
    gap: 18px;
    min-height: 64px;
  }
  .stamp {
    flex: none;
    width: 124px;
    display: grid;
    place-items: center;
  }
  .text {
    flex: 1;
    min-width: 0;
  }
  .what {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .quiet {
    color: var(--faded);
    font-size: var(--text-sm);
  }
  .undo {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--faded);
    font-size: var(--text-sm);
  }
  .label {
    color: var(--dust);
    font-size: var(--text-sm);
  }
  .catno {
    color: var(--faded);
    margin-right: 0.6em;
  }
</style>
