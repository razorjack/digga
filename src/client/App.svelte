<script lang="ts">
  import { onMount } from "svelte";
  import { formatCount, formatEta } from "../shared/display.ts";
  import HelpOverlay from "./components/HelpOverlay.svelte";
  import Key from "./components/Key.svelte";
  import Stamp from "./components/Stamp.svelte";
  import {
    GLOBAL_KEYS,
    hasCommandModifier,
    isTyping,
    triageKeyGroups,
    TWELVES_KEY_GROUPS,
  } from "./keymap.ts";
  import Settings from "./pages/Settings.svelte";
  import Triage from "./pages/Triage.svelte";
  import Twelves from "./pages/Twelves.svelte";
  import { getRoute, localhostAlternative, navigate, ROUTES } from "./router.svelte.ts";
  import { settings, stats, ui } from "./stores.svelte.ts";

  const route = $derived(getRoute());
  const localhostUrl = localhostAlternative();

  const helpGroups = $derived.by(() => {
    if (route === "triage") {
      return [
        ...triageKeyGroups(
          settings.value?.player.seekStepSeconds ?? 10,
          (settings.value?.discogs.maybeListId ?? null) !== null,
        ),
        GLOBAL_KEYS,
      ];
    }
    if (route === "twelves") return [...TWELVES_KEY_GROUPS, GLOBAL_KEYS];
    return [GLOBAL_KEYS];
  });

  const eta = $derived(formatEta(stats.value?.rate.etaHours ?? null));

  // A clicked header link must not keep focus: a later Enter would follow it again.
  const keepFocus = (event: MouseEvent) => event.preventDefault();

  onMount(() => {
    void settings.load();
    void stats.refresh();
  });

  $effect(() => {
    if (route) void stats.refresh();
  });

  function onkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || isTyping(event) || hasCommandModifier(event)) return;
    if (event.key === "?") {
      ui.helpOpen = !ui.helpOpen;
      event.preventDefault();
      return;
    }
    if (ui.helpOpen) {
      if (event.key === "Escape") ui.helpOpen = false;
      event.preventDefault();
      return;
    }
    const target = ROUTES.find(
      (destination) => destination.key.toLowerCase() === event.key.toLowerCase(),
    );
    if (target && !event.shiftKey && !event.repeat) {
      navigate(target.route);
      event.preventDefault();
    }
  }
</script>

<svelte:window {onkeydown} />

<!-- Rubber-stamp ink for .stamp elements: speckled voids plus wobbly edges; finer for small stamps. -->
<svg class="defs" aria-hidden="true" width="0" height="0">
  <filter id="ink" x="-10%" y="-25%" width="120%" height="150%">
    <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="7" result="grain" />
    <feColorMatrix
      in="grain"
      type="matrix"
      values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -8 6"
      result="voids"
    />
    <feComposite in="SourceGraphic" in2="voids" operator="in" result="inked" />
    <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="3" result="warp" />
    <feDisplacementMap in="inked" in2="warp" scale="2.5" xChannelSelector="R" yChannelSelector="G" />
  </filter>
  <filter id="ink-fine" x="-10%" y="-25%" width="120%" height="150%">
    <feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="1" seed="11" result="grain" />
    <feColorMatrix
      in="grain"
      type="matrix"
      values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -8 6.4"
      result="voids"
    />
    <feComposite in="SourceGraphic" in2="voids" operator="in" result="inked" />
    <feTurbulence type="fractalNoise" baseFrequency="0.08" numOctaves="1" seed="5" result="warp" />
    <feDisplacementMap in="inked" in2="warp" scale="1.2" xChannelSelector="R" yChannelSelector="G" />
  </filter>
</svg>

<div class="app">
  <header class="top">
    <a class="wordmark" href="#/triage" aria-label="Digga, triage" onmousedown={keepFocus}>digga</a>
    <nav aria-label="Pages">
      {#each ROUTES as destination (destination.route)}
        <a href="#/{destination.route}" aria-current={route === destination.route ? "page" : undefined} onmousedown={keepFocus}>
          {destination.label}
          <Key label={destination.key} size="sm" />
        </a>
      {/each}
    </nav>

    {#if settings.sandbox}
      <a
        class="sandbox"
        href="#/settings/sandbox"
        title="Verdicts, notes, track marks and heard tunes stay in this tab, and nothing goes to Discogs. Click to change."
        onmousedown={keepFocus}
      >
        <Stamp text="sandbox" tone="flyer" size="sm" seed={3} />
        <span>verdicts are not saved</span>
      </a>
    {/if}

    <div class="counter" aria-live="off">
      {#if stats.value}
        <p><b>{formatCount(stats.value.dug)}</b> dug</p>
        <p><b>{formatCount(stats.value.remaining)}</b> to go</p>
        {#if stats.value.remaining > 0}
          <p class="eta">{eta ? `ETA ${eta}` : "ETA after a few verdicts"}</p>
        {/if}
        {#if stats.session > 0}<p class="session">+{formatCount(stats.session)} this session</p>{/if}
      {:else if stats.error}
        <p class="error">Server unreachable</p>
      {/if}
    </div>
  </header>

  {#if localhostUrl}
    <p class="origin-warning">
      YouTube refuses some videos on 127.0.0.1. Open <a href={localhostUrl}>{localhostUrl}</a> instead.
    </p>
  {/if}

  <main>
    <div class="page" class:hidden={route !== "triage"}>
      <Triage active={route === "triage"} />
    </div>
    {#if route === "twelves"}
      <!-- A shelf's history and writes belong to one mode, including while Settings first loads. -->
      {#key settings.sandbox}
        <div class="page scroll"><Twelves /></div>
      {/key}
    {:else if route === "settings"}
      <div class="page scroll"><Settings /></div>
    {/if}
  </main>
</div>

{#if ui.helpOpen}
  <HelpOverlay groups={helpGroups} onclose={() => (ui.helpOpen = false)} />
{/if}

<style>
  .defs {
    position: absolute;
    width: 0;
    height: 0;
  }
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 36px;
    min-height: 54px;
    padding: 0 40px;
    border-bottom: 1px solid var(--groove);
  }
  .wordmark {
    font-family: var(--display);
    font-size: 19px;
    letter-spacing: 0.02em;
    text-decoration: none;
    color: var(--paper);
  }
  nav {
    display: flex;
    gap: 26px;
  }
  nav a {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 16px 0 14px;
    border-bottom: 2px solid transparent;
    color: var(--faded);
    text-decoration: none;
  }
  nav a[aria-current="page"] {
    color: var(--paper);
    border-bottom-color: var(--flyer);
  }
  .sandbox {
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 12px;
    color: var(--faded);
    font-size: var(--text-sm);
    text-decoration: none;
  }
  .sandbox:hover span {
    color: var(--paper);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .counter {
    display: flex;
    align-items: baseline;
    gap: 22px;
    margin-left: auto;
    color: var(--faded);
    font-size: var(--text-sm);
    white-space: nowrap;
  }
  .counter b {
    font-family: var(--display);
    font-weight: 400;
    font-size: var(--text-lg);
    color: var(--paper);
    margin-right: 0.3em;
  }
  .counter .session {
    color: var(--flyer);
  }
  .error {
    color: var(--flyer);
  }
  .origin-warning {
    padding: 8px 40px;
    border-bottom: 1px solid var(--groove);
    background: var(--flyer);
    color: var(--flyer-ink);
    font-size: var(--text-sm);
  }
  .origin-warning a {
    font-weight: 600;
  }
  main {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .page {
    height: 100%;
  }
  .page.hidden {
    display: none;
  }
  .scroll {
    overflow-y: auto;
  }
  @media (max-width: 1180px) {
    .sandbox span,
    .counter .eta {
      display: none;
    }
  }
  @media (max-width: 860px) {
    .top {
      flex-wrap: wrap;
      gap: 8px 20px;
      padding: 8px 20px;
    }
    .counter {
      margin-left: 0;
    }
  }
</style>
