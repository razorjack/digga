<script lang="ts">
  import { COLOR_SCHEMES, type ColorScheme, type Config } from "../../shared/config.ts";
  import Key from "../components/Key.svelte";
  import { errorMessage, settings } from "../stores.svelte.ts";
  import type { DiscogsSettings } from "./discogs.svelte.ts";

  interface Props {
    draft: Config;
    discogs: DiscogsSettings;
    /** Arrived from the header's sandbox link, which points at the Sandbox section. */
    highlighted: boolean;
    showFlash: (message: string) => void;
  }

  let { draft = $bindable(), discogs, highlighted, showFlash }: Props = $props();
  const id = $props.id();

  const COLOR_SCHEME_LABEL: Record<ColorScheme, string> = {
    system: "System",
    light: "Light",
    dark: "Dark",
  };

  let switching = $state(false);
  let colorScheme = $state<ColorScheme>(settings.value?.appearance.colorScheme ?? "system");
  let modeEl = $state<HTMLElement | null>(null);
  let modeButton = $state<HTMLButtonElement | null>(null);

  $effect(() => {
    if (!highlighted || !modeEl) return;
    modeEl.scrollIntoView({ block: "nearest" });
    modeButton?.focus({ preventScroll: true });
  });

  /** Saved at once, outside the form: the mode decides whether the next verdict is kept. */
  async function setSandbox(on: boolean): Promise<void> {
    const saved = settings.value;
    if (!saved || switching) return;
    switching = true;
    try {
      await settings.save({ ...$state.snapshot(saved), sandbox: on });
      draft.sandbox = on;
      showFlash(
        on
          ? "Back in the sandbox: verdicts stay in this tab again."
          : "Sandbox off: verdicts are saved from now on.",
      );
    } catch (error) {
      showFlash(`The sandbox did not switch: ${errorMessage(error)}`);
    } finally {
      switching = false;
    }
  }

  /** Saved at once, outside the form, and without restarting the queue. */
  async function saveColorScheme(): Promise<void> {
    const chosen = colorScheme;
    try {
      await settings.saveColorScheme(chosen);
      draft.appearance.colorScheme = chosen;
    } catch (error) {
      // A later choice may still be saving; only a failure of the latest one resets the radios.
      if (colorScheme === chosen) colorScheme = settings.value?.appearance.colorScheme ?? "system";
      showFlash(`The color scheme did not change: ${errorMessage(error)}`);
    }
  }
</script>

<!--
  The header's sandbox link points here. The section is then the page's current location
  (aria-current), which also draws its highlight, so what shows and what is announced agree.
-->
<section
  class="mode"
  id="sandbox"
  aria-current={highlighted ? "location" : undefined}
  aria-labelledby="{id}-sandbox-title"
  bind:this={modeEl}
>
  <h2 id="{id}-sandbox-title">Sandbox</h2>
  {#if settings.sandbox}
    <p>
      <b>On.</b> Verdicts, notes, track marks and heard tunes stay in this browser tab until it reloads,
      and nothing is sent to Discogs. Settings and jobs are saved as usual.
    </p>
    <p class="quiet">
      Turn it off to dig for real: every verdict is saved, and <Key label="A" size="sm" /> adds the release to
      your Discogs wantlist{#if !discogs.tokenProblem && discogs.account?.tokenUsername} ({discogs.account.tokenUsername}){/if}.
      What you did in the sandbox is dropped.
    </p>
    {#if discogs.tokenProblem}
      <p class="problem">
        Before you do: {discogs.tokenProblem}. Verdicts are saved either way, but wants will not reach the Discogs
        wantlist.
      </p>
    {/if}
    <div class="inline">
      <button
        type="button"
        class="primary"
        bind:this={modeButton}
        disabled={switching}
        onclick={() => void setSandbox(false)}
      >
        {switching ? "Switching…" : "Turn off the sandbox"}
      </button>
    </div>
  {:else}
    <p>
      <b>Off.</b> Verdicts are saved, and <Key label="A" size="sm" /> adds the release to your Discogs wantlist;
      <Key label="Z" size="sm" /> right after takes it off again.
    </p>
    <p class="quiet">The sandbox keeps verdicts in this tab only, for trying the flow without consequences.</p>
    <div class="inline">
      <button
        type="button"
        class="secondary"
        bind:this={modeButton}
        disabled={switching}
        onclick={() => void setSandbox(true)}
      >
        {switching ? "Switching…" : "Back to the sandbox"}
      </button>
    </div>
  {/if}
</section>

<section>
  <h2 id="{id}-appearance">Appearance</h2>
  <fieldset class="inline" aria-labelledby="{id}-appearance" aria-describedby="{id}-appearance-hint">
    {#each COLOR_SCHEMES as scheme (scheme)}
      <label class="check">
        <input
          type="radio"
          name="color-scheme"
          value={scheme}
          bind:group={colorScheme}
          onchange={() => void saveColorScheme()}
        />
        {COLOR_SCHEME_LABEL[scheme]}
      </label>
    {/each}
  </fieldset>
  <p class="hint" id="{id}-appearance-hint">
    System follows the light or dark setting of your computer. A change applies at once.
  </p>
</section>

<style>
  .mode p {
    max-width: 72ch;
  }
  .mode[aria-current="location"] {
    margin-left: -23px;
    padding: 20px 20px 20px 20px;
    background: var(--surface);
    box-shadow: inset 3px 0 0 var(--accent-mark);
  }
</style>
