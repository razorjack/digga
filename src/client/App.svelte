<script lang="ts">
  import { onMount } from "svelte";
  import { formatCount, formatEta } from "../shared/display.ts";
  import { api } from "./api.ts";
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
  import { rinsedCount, settings, stats, ui } from "./stores.svelte.ts";

  const route = $derived(getRoute());
  const sandbox = api.mode === "sandbox";
  const localhostUrl = localhostAlternative();

  const helpGroups = $derived(
    route === "triage"
      ? [...triageKeyGroups(settings.value?.player.seekStepSeconds ?? 10), GLOBAL_KEYS]
      : route === "twelves"
        ? [...TWELVES_KEY_GROUPS, GLOBAL_KEYS]
        : [GLOBAL_KEYS],
  );

  const eta = $derived(formatEta(stats.value?.rate.etaHours ?? null));

  // A clicked header link must not keep focus: a later Enter would follow it again.
  const keepFocus = (e: MouseEvent) => e.preventDefault();

  onMount(() => {
    void settings.load();
    void stats.refresh();
  });

  $effect(() => {
    if (route) void stats.refresh();
  });

  function onkeydown(e: KeyboardEvent): void {
    if (e.defaultPrevented || isTyping(e) || hasCommandModifier(e)) return;
    if (e.key === "?") {
      ui.helpOpen = !ui.helpOpen;
      e.preventDefault();
      return;
    }
    if (ui.helpOpen) {
      if (e.key === "Escape") ui.helpOpen = false;
      e.preventDefault();
      return;
    }
    const target = ROUTES.find((r) => r.key.toLowerCase() === e.key.toLowerCase());
    if (target && !e.shiftKey && !e.repeat) {
      navigate(target.route);
      e.preventDefault();
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
      {#each ROUTES as r (r.route)}
        <a href="#/{r.route}" aria-current={route === r.route ? "page" : undefined} onmousedown={keepFocus}>
          {r.label}
          <Key label={r.key} size="sm" />
        </a>
      {/each}
    </nav>

    {#if sandbox}
      <p class="sandbox" title="Verdicts, notes, settings and jobs are kept in memory until the page reloads.">
        <Stamp text="sandbox" tone="flyer" size="sm" seed={3} />
        <span>nothing saved or sent</span>
      </p>
    {/if}

    <div class="counter" aria-live="off">
      {#if stats.value}
        <p><b>{formatCount(rinsedCount(stats.value))}</b> rinsed</p>
        <p><b>{formatCount(stats.value.remaining)}</b> to go</p>
        <p class="eta">{eta ? `ETA ${eta}` : "ETA after a few verdicts"}</p>
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
      <div class="page scroll"><Twelves /></div>
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
