<script lang="ts">
  import { onMount } from "svelte";
  import { formatCount, formatEta } from "../shared/display.ts";
  import HelpOverlay from "./components/HelpOverlay.svelte";
  import Key from "./components/Key.svelte";
  import LoadIndicator from "./components/LoadIndicator.svelte";
  import {
    GLOBAL_KEYS,
    hasCommandModifier,
    isInDialog,
    isSelectAll,
    isTyping,
    triageKeyGroups,
    TWELVES_KEY_GROUPS,
  } from "./keymap.ts";
  import { loadStatus } from "./load-status.svelte.ts";
  import Settings from "./pages/Settings.svelte";
  import Setup from "./pages/Setup.svelte";
  import Triage from "./pages/Triage.svelte";
  import Twelves from "./pages/Twelves.svelte";
  import { getRoute, localhostAlternative, navigate } from "./router.svelte.ts";
  import { PAGES, type Route, ROUTES, SETTINGS } from "./routes.ts";
  import { pagesClosed, sendToSetup } from "./setup/access.ts";
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

  const colorScheme = $derived(settings.value?.appearance.colorScheme ?? "system");
  const eta = $derived(formatEta(stats.value?.rate.etaHours ?? null));
  const pageTitle = $derived(
    `${ROUTES.find((destination) => destination.route === route)?.label ?? "Setup"} – Digga`,
  );
  /** No load has finished: the library still needs its first, which the setup walks through. */
  const firstRun = $derived(stats.value !== null && stats.value.dump.loadedAt === null);
  const library = $derived({
    firstRun,
    loading: loadStatus.loading,
    recordsToDig: stats.value?.remaining ?? 0,
  });
  /** Until there is something to dig, the setup has the screen to itself. */
  const setupOnly = $derived(route === "setup" && pagesClosed(library));
  /** The setup has shown in this tab, so it has said why a load stopped. */
  let setupShown = false;
  /** The page Settings was opened from, which Esc in Settings goes back to. */
  let pageBeforeSettings: Route = "triage";

  // A clicked toolbar link must not keep focus: a later Enter would follow it again.
  const keepFocus = (event: MouseEvent) => event.preventDefault();

  onMount(() => {
    void settings.load();
    void stats.refresh();
    void loadStatus.check();
  });

  // A library without a finished load opens the setup, unless its first load is running.
  $effect(() => {
    if (!loadStatus.checked) return;
    if (route === "setup") setupShown = true;
    else if (sendToSetup(library, setupShown)) navigate("setup");
  });

  $effect(() => {
    if (route) void stats.refresh();
  });

  $effect(() => {
    if (route === "triage" || route === "twelves") pageBeforeSettings = route;
  });

  // styles.css picks the root's color scheme from this attribute.
  $effect(() => {
    document.documentElement.dataset.colorScheme = colorScheme;
  });

  function onkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || isTyping(event)) return;
    // Select All belongs to text fields; elsewhere it would paint the whole page, as in a browser.
    if (isSelectAll(event)) {
      event.preventDefault();
      return;
    }
    if (hasCommandModifier(event)) return;
    // ? closes the Keys dialog from inside it; another dialog keeps it for itself.
    if (event.key === "?" && (ui.helpOpen || !isInDialog(event))) {
      ui.helpOpen = !ui.helpOpen;
      event.preventDefault();
      return;
    }
    // The open dialog handles its own keys, Esc included.
    if (ui.helpOpen || setupOnly || isInDialog(event)) return;
    if (event.key === "Escape" && route === "settings") {
      navigate(pageBeforeSettings);
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
<!-- The setup names each of its steps itself. -->
<svelte:head>
  {#if route !== "setup"}<title>{pageTitle}</title>{/if}
</svelte:head>

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
    {#if setupOnly}
      <p class="title">Setting up</p>
    {:else}
      <nav class="pages" aria-label="Pages">
        {#each PAGES as destination (destination.route)}
          <a
            href="#/{destination.route}"
            aria-current={route === destination.route ? "page" : undefined}
            aria-keyshortcuts={destination.key}
            onmousedown={keepFocus}
          >
            {destination.label}
            <Key label={destination.key} size="sm" aria-hidden="true" />
          </a>
        {/each}
      </nav>

      {#if stats.value || stats.error}
        <div class="counter">
          {#if stats.value}
            <p><b>{formatCount(stats.value.dug)}</b> dug</p>
            <p><b>{formatCount(stats.value.remaining)}</b> to go{loadStatus.loading ? " so far" : ""}</p>
            {#if stats.value.remaining > 0 && !loadStatus.loading}
              <p class="eta">{eta ? `ETA ${eta}` : "ETA after a few verdicts"}</p>
            {/if}
            {#if stats.session > 0}<p class="session">+{formatCount(stats.session)} this session</p>{/if}
          {:else}
            <p class="error">Server unreachable</p>
          {/if}
        </div>
      {/if}

      <div class="tools">
        {#if loadStatus.job}
          <LoadIndicator href={firstRun ? "#/setup" : "#/settings/library"} />
        {/if}
        <a
          class="settings"
          href="#/{SETTINGS.route}"
          aria-current={route === SETTINGS.route ? "page" : undefined}
          aria-keyshortcuts={SETTINGS.key}
          onmousedown={keepFocus}
        >
          {SETTINGS.label}
          <Key label={SETTINGS.key} size="sm" aria-hidden="true" />
        </a>
      </div>
    {/if}
    <p class="visually-hidden" role="status">{loadStatus.announcement ?? ""}</p>
  </header>

  {#if localhostUrl}
    <p class="origin-warning">
      YouTube refuses some videos on 127.0.0.1. Open <a href={localhostUrl}>{localhostUrl}</a> instead.
    </p>
  {/if}

  <main>
    <div class="page" hidden={route !== "triage"}>
      <Triage active={route === "triage"} />
    </div>
    {#if route === "twelves"}
      <div class="page"><Twelves /></div>
    {:else if route === "settings"}
      <div class="page"><Settings /></div>
    {:else if route === "setup"}
      <div class="page"><Setup /></div>
    {/if}
  </main>
</div>

<HelpOverlay open={ui.helpOpen} groups={helpGroups} onclose={() => (ui.helpOpen = false)} />

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
  /*
   * The toolbar. In the desktop app it is also the title bar: the Window Controls Overlay
   * variables say where the window's own buttons are, and elsewhere their fallbacks add nothing.
   * Its empty space drags the window.
   */
  .top {
    position: relative;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 24px;
    min-height: 52px;
    padding-block: 8px;
    padding-left: max(24px, calc(env(titlebar-area-x, 0px) + 12px));
    padding-right: max(
      24px,
      calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 12px)
    );
    border-bottom: 1px solid var(--rule);
    background: var(--surface);
    user-select: none;
    -webkit-app-region: drag;
  }
  .top :global(:is(a, button)) {
    -webkit-app-region: no-drag;
  }
  .title {
    grid-column: 2;
    font-family: var(--display);
    font-size: var(--text-sm);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-muted);
  }
  .pages {
    display: flex;
    justify-self: start;
  }
  .pages a,
  .settings {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 5px 12px;
    border: 1px solid var(--rule);
    color: var(--fg-muted);
    text-decoration: none;
    cursor: default;
    -webkit-user-drag: none;
  }
  .pages a:first-child {
    border-radius: var(--radius) 0 0 var(--radius);
  }
  .pages a:last-child {
    border-radius: 0 var(--radius) var(--radius) 0;
  }
  .pages a + a {
    border-left: 0;
  }
  .settings {
    border-radius: var(--radius);
  }
  .pages a[aria-current="page"],
  .settings[aria-current="page"] {
    background: var(--bg);
    box-shadow: inset 0 -2px 0 var(--accent-mark);
    color: var(--fg);
  }
  /* The counts sit in a recessed readout in the toolbar's middle. */
  .counter {
    grid-column: 2;
    display: flex;
    align-items: baseline;
    gap: 14px;
    min-width: 0;
    padding: 3px 16px 4px;
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--sunken);
    box-shadow: inset 0 1px 3px var(--sunken-shadow);
    color: var(--fg-faint);
    font-size: var(--text-xs);
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
  .counter p + p::before {
    content: "/" / "";
    margin-right: 14px;
    color: var(--rule);
  }
  .counter b {
    font-family: var(--display);
    font-weight: 400;
    font-size: var(--text-lg);
    letter-spacing: 0.02em;
    color: var(--fg);
    margin-right: 0.35em;
  }
  .counter .session {
    color: var(--fg-accent);
  }
  .error {
    color: var(--fg-accent);
  }
  .tools {
    grid-column: 3;
    justify-self: end;
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .origin-warning {
    padding: 8px 40px;
    border-bottom: 1px solid var(--rule);
    background: var(--accent);
    color: var(--on-accent);
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
  /* Narrow windows hide the ETA as .visually-hidden does, so screen readers still have it. */
  @media (max-width: 1180px) {
    .counter .eta {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  }
  /* A browser window this narrow wraps the toolbar; the desktop app's window is never this narrow. */
  @media (max-width: 860px) {
    .top {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
      padding: 8px 20px;
    }
    .tools {
      margin-left: auto;
    }
  }
</style>
