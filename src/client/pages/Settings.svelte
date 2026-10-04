<script lang="ts">
  import { onDestroy, onMount, untrack } from "svelte";
  import { type Config, validateConfig } from "../../shared/config.ts";
  import { JOB_LABEL } from "../../shared/job-display.ts";
  import type { Job } from "../../shared/types.ts";
  import { loadStatus } from "../load-status.svelte.ts";
  import { getAnchor } from "../router.svelte.ts";
  import { errorMessage, settings, stats } from "../stores.svelte.ts";
  import Backups from "../settings/Backups.svelte";
  import { DiscogsSettings } from "../settings/discogs.svelte.ts";
  import DiggingTab from "../settings/DiggingTab.svelte";
  import DiscogsTab from "../settings/DiscogsTab.svelte";
  import GeneralTab from "../settings/GeneralTab.svelte";
  import { SettingsJobs } from "../settings/jobs.svelte.ts";
  import LibraryTab from "../settings/LibraryTab.svelte";
  import {
    hasSettingsForm,
    SETTINGS_TAB_LABEL,
    SETTINGS_TABS,
    settingsTab,
    unsavedTabs,
  } from "../settings/tabs.ts";
  import "../settings/settings.css";

  const id = $props.id();
  /** Each tab with settings fields renders its own form under this id, which the save bar submits. */
  const formId = `${id}-settings`;
  const jobState = new SettingsJobs();
  const discogs = new DiscogsSettings();
  let flashTimer: ReturnType<typeof setTimeout> | null = null;

  let draft = $state<Config | null>(null);
  let saving = $state(false);
  let flash = $state<string | null>(null);
  let head = $state<HTMLElement | null>(null);

  const saved = $derived(settings.value);
  const dirty = $derived(
    draft !== null && saved !== null && JSON.stringify(draft) !== JSON.stringify(saved),
  );
  const validation = $derived(draft ? validateConfig(draft) : null);
  const problems = $derived(validation && !validation.ok ? validation.errors : []);
  const issues = $derived(validation && !validation.ok ? validation.issues : []);
  const unsaved = $derived(draft && saved ? unsavedTabs(draft, saved) : []);
  /** The save bar shows only with something to say: a problem, a message or unsaved changes. */
  const idle = $derived(problems.length === 0 && flash === null && !dirty);
  const tab = $derived(settingsTab(getAnchor()));
  const highlighted = $derived(getAnchor() === "sandbox");
  /** Derived, so saves that keep the username do not fetch the lists again. */
  const discogsUsername = $derived(saved?.discogs.username ?? "");

  $effect(() => {
    if (!saved || draft !== null) return;
    draft = $state.snapshot(saved);
  });

  $effect(() => {
    if (discogsUsername) void discogs.loadLists();
  });

  $effect(() => {
    void settings.version;
    void settings.sandbox;
    untrack(() => void jobState.load());
  });

  // A tab opened from further down the page starts at its top.
  $effect(() => {
    void tab;
    untrack(() => head?.scrollIntoView({ block: "nearest" }));
  });

  onMount(() => {
    void discogs.loadAccount();
    void stats.refresh();
  });

  onDestroy(() => {
    jobState.destroy();
    discogs.destroy();
    if (flashTimer) clearTimeout(flashTimer);
  });

  function showFlash(message: string): void {
    flash = message;
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      if (flash === message) flash = null;
    }, 6000);
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    void save();
  }

  async function save(): Promise<void> {
    if (!draft || !validation?.ok || saving) return;
    saving = true;
    const username = saved?.discogs.username;
    try {
      await settings.save(validation.config);
      draft = $state.snapshot(settings.value!);
      showFlash("Saved. The queue has reloaded.");
      void stats.refresh();
      if (settings.value?.discogs.username !== username) void discogs.loadAccount();
    } catch (error) {
      showFlash(`Not saved: ${errorMessage(error)}`);
    } finally {
      saving = false;
    }
  }

  function revert(): void {
    if (saved) draft = $state.snapshot(saved);
  }

  async function startJob(start: () => Promise<Job>): Promise<void> {
    try {
      const job = await start();
      loadStatus.follow(job);
      showFlash(
        settings.sandbox && job.type === "import_list"
          ? "Reading your Discogs Maybe list; its maybes stay in this tab (sandbox)."
          : `${JOB_LABEL[job.type]} started.`,
      );
      await jobState.load();
    } catch (error) {
      showFlash(`Did not start: ${errorMessage(error)}`);
    }
  }

  async function cancelJob(job: Job): Promise<void> {
    try {
      await jobState.cancel(job);
    } catch (error) {
      showFlash(`Cancel failed: ${errorMessage(error)}`);
    }
  }

  function onkeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void save();
    }
  }
</script>

<svelte:window {onkeydown} />

<div class="settings">
  <header class="head" bind:this={head}>
    <h1>Settings</h1>
    <p class="lede">Filters and order change the queue as soon as you save.</p>
  </header>

  {#if !draft}
    {#if settings.error}
      <p class="quiet">Settings did not load: {settings.error}</p>
      <p>
        <button type="button" class="secondary" aria-busy={settings.loading} onclick={() => void settings.retry()}>
          Try again
        </button>
      </p>
    {:else}
      <p class="quiet">Loading…</p>
    {/if}
  {:else}
    <div class="layout">
      <nav class="tabs" aria-label="Settings sections">
        <ul>
          {#each SETTINGS_TABS as destination (destination)}
            <li>
              <a
                href="#/settings/{destination}"
                aria-current={tab === destination ? "page" : undefined}
                aria-describedby={unsaved.includes(destination) ? `${id}-unsaved` : undefined}
              >
                {SETTINGS_TAB_LABEL[destination]}
                {#if unsaved.includes(destination)}<span class="unsaved" aria-hidden="true"></span>{/if}
              </a>
            </li>
          {/each}
        </ul>
        <span id="{id}-unsaved" hidden>Unsaved changes</span>
      </nav>

      <div class="panel">
        {#if tab === "digging"}
          <DiggingTab bind:draft {issues} {formId} onsubmit={submit} />
        {:else if tab === "library"}
          <LibraryTab bind:draft {formId} onsubmit={submit} jobs={jobState} {startJob} {cancelJob} {showFlash} />
        {:else if tab === "discogs"}
          <DiscogsTab
            bind:draft
            {formId}
            onsubmit={submit}
            {discogs}
            jobs={jobState}
            {startJob}
            {cancelJob}
            {showFlash}
          />
        {:else if tab === "backups"}
          <Backups />
        {:else}
          <GeneralTab bind:draft {discogs} {highlighted} {showFlash} />
        {/if}
        {#if !hasSettingsForm(tab)}
          <!-- Unsaved changes from another tab still save from this one, through this empty form. -->
          <form id={formId} onsubmit={submit}></form>
        {/if}
      </div>
    </div>

    <div class="savebar" class:idle>
      <p class="status" role="status">
        {#if problems.length > 0}
          <span class="problem">{problems[0]}</span>
        {:else if flash}
          <span class="flash">{flash}</span>
        {:else if dirty}
          Unsaved changes.
        {/if}
      </p>
      {#if dirty}
        <button type="button" class="secondary" onclick={revert}>Revert</button>
        <button
          type="submit"
          form={formId}
          class="primary"
          disabled={problems.length > 0 || saving}
          aria-keyshortcuts="Meta+S Control+S"
        >
          Save settings <kbd class="kbd" aria-hidden="true">⌘S</kbd>
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    padding: 32px 40px 0;
  }
  .head {
    display: grid;
    gap: 8px;
    margin-bottom: 28px;
    scroll-margin-top: 32px;
  }
  .lede {
    color: var(--fg-muted);
  }
  .layout {
    display: grid;
    grid-template-columns: 11em minmax(0, 940px);
    align-items: start;
    column-gap: 48px;
    flex: 1;
    padding-bottom: 48px;
  }
  .tabs {
    position: sticky;
    top: 24px;
  }
  .tabs ul {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .tabs a {
    display: block;
    padding: 6px 12px;
    color: var(--fg-muted);
    text-decoration: none;
  }
  .tabs a:hover {
    color: var(--fg);
  }
  .unsaved {
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-left: 8px;
    border-radius: 50%;
    background: var(--accent-mark);
    vertical-align: middle;
  }
  .tabs a[aria-current="page"] {
    background: var(--surface);
    box-shadow: inset 3px 0 0 var(--accent-mark);
    color: var(--fg);
  }
  @media (max-width: 760px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
      row-gap: 24px;
    }
    .tabs {
      position: static;
    }
    .tabs ul {
      display: flex;
      flex-wrap: wrap;
    }
  }
  .savebar {
    position: sticky;
    bottom: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 14px;
    margin: 0 -40px;
    padding: 12px 40px;
    border-top: 1px solid var(--rule);
    background: var(--surface);
  }
  /* The status stays in the DOM while idle, so its next message is announced. */
  .savebar.idle {
    padding-block: 0;
    border-top: 0;
    background: none;
  }
  .status {
    margin-right: auto;
  }
  .kbd {
    margin-left: 6px;
    font-family: inherit;
    font-weight: 400;
    opacity: 0.7;
  }
</style>
