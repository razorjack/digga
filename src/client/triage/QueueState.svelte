<script lang="ts">
  import { formatCount, nounFor } from "../../shared/display.ts";
  import { SCOPE_NOUN } from "../../shared/scope.ts";
  import Art from "../components/Art.svelte";
  import Key from "../components/Key.svelte";
  import Stamp from "../components/Stamp.svelte";
  import { navigate } from "../router.svelte.ts";
  import { endOfQueueHeadline } from "./end-of-queue.ts";
  import type { TriageScreen } from "./screen.ts";

  interface Props {
    screen: Exclude<TriageScreen, { kind: "record" }>;
    settingsError: string | null;
    retryingSettings: boolean;
    queueError: string | null;
    /** Records passed with N, which a round can go through again. */
    passed: number;
    snoozed: number;
    loadingSnoozed: boolean;
    skipsWithoutVideos: boolean;
    onretrysettings: () => void;
    ongoround: () => void;
    onleavescope: () => void;
    onhearsnoozed: () => void;
  }

  let {
    screen,
    settingsError,
    retryingSettings,
    queueError,
    passed,
    snoozed,
    loadingSnoozed,
    skipsWithoutVideos,
    onretrysettings,
    ongoround,
    onleavescope,
    onhearsnoozed,
  }: Props = $props();
</script>

{#if screen.kind === "settings-failed"}
  <div class="state">
    <h1 class="headline">The settings did not load.</h1>
    <p class="quiet">{settingsError}</p>
    <p class="quiet">The queue starts from your settings. Check that the server runs, then try again.</p>
    <p class="actions">
      <button type="button" aria-keyshortcuts="Enter" aria-busy={retryingSettings} onclick={onretrysettings}>
        <Key label="Enter" primary aria-hidden="true" /> try again
      </button>
    </p>
  </div>
{:else if screen.kind === "queue-failed"}
  <div class="state">
    <h1 class="headline">The queue did not load.</h1>
    <p class="quiet">{queueError}</p>
    <p class="quiet">
      Check that the server runs (<code>npm run digga -- serve</code>), then press
      <Key label="Enter" /> to try again.
    </p>
  </div>
{:else if screen.kind === "waiting-for-load"}
  <div class="state">
    <Art name="press" size={160} />
    <h1 class="headline">You have dug everything loaded so far.</h1>
    <p class="quiet">
      {screen.percent === null ? "The catalogue is loading" : `${screen.percent}% of the catalogue is read`};
      records join the queue as they arrive, and the next one shows here.
    </p>
  </div>
{:else if screen.kind === "no-releases"}
  <div class="state">
    <Art name="press" size={160} />
    <h1 class="headline">No releases loaded yet.</h1>
    <p class="quiet">
      Digga digs a Discogs releases dump. In settings, under Library, "Update from the newest dump"
      downloads the latest one, over 10 GB, and loads it. The styles and years it keeps are under
      Universe beside it.
    </p>
    <p class="actions">
      <button type="button" aria-keyshortcuts="," onclick={() => navigate("settings", "library")}>
        <Key label="," aria-hidden="true" /> settings
      </button>
    </p>
  </div>
{:else if screen.kind === "nothing-matches"}
  <div class="state">
    <h1 class="headline">Your filters match no records.</h1>
    <p class="quiet">
      {formatCount(screen.loadedRecords)} {nounFor(screen.loadedRecords, "record is", "records are")} loaded.
      Widen the years, formats or countries in settings{skipsWithoutVideos ? ", or let in releases without videos" : ""}.
    </p>
    <p class="actions">
      <button type="button" aria-keyshortcuts="," onclick={() => navigate("settings")}>
        <Key label="," aria-hidden="true" /> settings
      </button>
    </p>
  </div>
{:else if screen.kind === "scope-dug"}
  <div class="state">
    <h1 class="headline">Nothing is left to dig from {SCOPE_NOUN[screen.scope.kind]} {screen.scope.name}.</h1>
    <p class="quiet">Under your filters, that is: widen the years, formats or countries in settings to dig further.</p>
    <p class="actions">
      {#if passed > 0}
        <button type="button" aria-keyshortcuts="N" onclick={ongoround}>
          <Key label="N" aria-hidden="true" /> go round the {formatCount(passed)} you passed
        </button>
      {/if}
      {#if screen.scope.kind === "seller"}
        <a href="#/shop/{screen.scope.id}">Shop my wants from this seller</a>
      {/if}
      <button type="button" aria-keyshortcuts="Escape" onclick={onleavescope}>
        <Key label="Esc" primary aria-hidden="true" /> back to the whole queue
      </button>
    </p>
  </div>
{:else if screen.kind === "all-dug"}
  <div class="state finished">
    <Stamp text="all dug" tone="accent" size="xl" seed={1} slam />
    <h1 class="headline">{endOfQueueHeadline(passed)}</h1>
    <p class="quiet">
      {screen.dug === null ? "" : `${formatCount(screen.dug)} dug so far.`}
      Widen the years, formats or countries in settings to dig further.
    </p>
    <p class="actions">
      {#if passed > 0}
        <button type="button" aria-keyshortcuts="N" onclick={ongoround}>
          <Key label="N" primary aria-hidden="true" /> go round the {formatCount(passed)} you passed
        </button>
      {/if}
      {#if snoozed > 0}
        <button type="button" disabled={loadingSnoozed} onclick={onhearsnoozed}>
          hear the {formatCount(snoozed)} snoozed again
        </button>
      {/if}
      <button type="button" aria-keyshortcuts="," onclick={() => navigate("settings")}>
        <Key label="," aria-hidden="true" /> settings
      </button>
    </p>
  </div>
{:else}
  <p class="state quiet">Loading the queue…</p>
{/if}

<style>
  .state {
    display: grid;
    align-content: start;
    justify-items: start;
    gap: 14px;
    padding-top: 24px;
  }
  .finished {
    gap: 22px;
    padding-top: 56px;
  }
  .headline {
    font-family: var(--display);
    font-size: var(--text-xl);
    line-height: 1.3;
    max-width: 24em;
  }
  .quiet {
    color: var(--fg-muted);
    max-width: 60ch;
  }
  code {
    font-family: inherit;
    color: var(--fg);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 28px;
  }
  .actions button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 0;
    background: none;
    padding: 0;
  }
  .actions button:disabled {
    opacity: 0.5;
  }
</style>
