<script lang="ts">
  import { COLOR_SCHEMES, type ColorScheme, type Config } from "../../shared/config.ts";
  import { errorMessage, settings } from "../stores.svelte.ts";

  interface Props {
    draft: Config;
    showFlash: (message: string) => void;
  }

  let { draft = $bindable(), showFlash }: Props = $props();
  const id = $props.id();

  const COLOR_SCHEME_LABEL: Record<ColorScheme, string> = {
    system: "System",
    light: "Light",
    dark: "Dark",
  };

  let colorScheme = $state<ColorScheme>(settings.value?.appearance.colorScheme ?? "system");

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

<section>
  <h2 id="{id}-appearance">Appearance</h2>
  <div class="appearance">
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
  </div>
</section>

<style>
  .appearance {
    display: grid;
    gap: var(--space-hint);
  }
</style>
