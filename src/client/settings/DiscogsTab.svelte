<script lang="ts">
  import { BROWSERS, type Browser } from "../../shared/api.ts";
  import { type Config, DISCOGS_CURRENCIES } from "../../shared/config.ts";
  import { formatCount } from "../../shared/display.ts";
  import type { Job } from "../../shared/types.ts";
  import { api } from "../api.ts";
  import Key from "../components/Key.svelte";
  import RequestList from "../setup/RequestList.svelte";
  import { errorMessage, settings, stats } from "../stores.svelte.ts";
  import { type DiscogsSettings, tokenStorageText, usernameAfterTokenSave } from "./discogs.svelte.ts";
  import JobList from "./JobList.svelte";
  import type { SettingsJobs } from "./jobs.svelte.ts";
  import { recentJobs, TAB_JOBS } from "./tabs.ts";

  interface Props {
    draft: Config;
    formId: string;
    onsubmit: (event: SubmitEvent) => void;
    discogs: DiscogsSettings;
    jobs: SettingsJobs;
    startJob: (start: () => Promise<Job>) => Promise<void>;
    cancelJob: (job: Job) => void;
    showFlash: (message: string) => void;
  }

  let {
    draft = $bindable(),
    formId,
    onsubmit,
    discogs,
    jobs,
    startJob,
    cancelJob,
    showFlash,
  }: Props = $props();
  const id = $props.id();

  let tokenDraft = $state("");
  let historyBrowser = $state<Browser>("brave");
  let sellerUsername = $state("");

  const tokenSaved = $derived(discogs.account?.tokenSource === "saved");
  const tokenFromEnvironment = $derived(discogs.account?.tokenSource === "environment");
  const importJobs = $derived(recentJobs(jobs.items, TAB_JOBS.discogs));
  const maybeListMissing = $derived(
    draft.discogs.maybeListId !== null && !discogs.lists.some((list) => list.id === draft.discogs.maybeListId),
  );

  /**
   * Saved at once, outside the settings form; private lists need the token, so they reload. The
   * first token also sets the username on the server, which the form then takes.
   */
  async function saveToken(token: string | null): Promise<void> {
    const savedUsername = settings.value?.discogs.username ?? "";
    const stored = await discogs.saveToken(token);
    if (!stored) return;
    tokenDraft = "";
    if (token === null) showFlash("Token removed.");
    else if (discogs.account?.error) showFlash("Token saved, but Discogs did not confirm it.");
    else showFlash("Token saved.");
    if (discogs.account && discogs.account.username !== savedUsername) await adoptUsername(savedUsername);
    else if (settings.value?.discogs.username) void discogs.loadLists();
  }

  /**
   * Reads the settings the token save changed, so a later Save keeps the adopted username; the new
   * username then loads the lists.
   */
  async function adoptUsername(savedUsername: string): Promise<void> {
    await settings.load();
    draft.discogs.username = usernameAfterTokenSave(draft.discogs.username, savedUsername, discogs.account);
  }

  async function forgetDiscogsData(account: string): Promise<void> {
    const question = `Forget the collection, wantlist and Maybe list of ${account} in Digga? Verdicts, notes and marks stay, and Discogs keeps the account as it is.`;
    if (!confirm(question)) return;
    try {
      const forgotten = await discogs.forgetData();
      showFlash(`Forgot ${formatCount(forgotten)} Discogs items of ${account}.`);
      void stats.refresh();
    } catch (error) {
      showFlash(`Not forgotten: ${errorMessage(error)}`);
    }
  }

  function submitToken(event: SubmitEvent): void {
    event.preventDefault();
    void saveToken(tokenDraft.trim());
  }

  function readSellerShop(event: SubmitEvent): void {
    event.preventDefault();
    void startJob(() => api.startImport("seller", { username: sellerUsername.trim() }));
  }

  function setMaybeList(value: string): void {
    draft.discogs.maybeListId = value === "" ? null : Number(value);
  }
</script>

<form id={formId} {onsubmit}>
  <section aria-labelledby="{id}-discogs-title">
    <header>
      <h2 id="{id}-discogs-title">Discogs</h2>
      <p>
        Digga reads the catalogue from the dump. The token is used only for what you do: imports,
        <Key label="A" size="sm" /> and <Key label="C" size="sm" /> wants, <Key label="P" size="sm" /> prices, and
        this page.
      </p>
      <RequestList />
    </header>
    <div class="fields">
      <div class="field">
        <label class="name" for="{id}-username">Username</label>
        <input
          id="{id}-username"
          aria-describedby="{id}-username-hint {id}-data-account"
          bind:value={draft.discogs.username}
          autocomplete="off"
          spellcheck="false"
        />
        <span class="hint" id="{id}-username-hint">Collection and wantlist imports read this account.</span>
        {#if discogs.account?.dataAccount}
          {@const dataAccount = discogs.account.dataAccount}
          <span class="hint" id="{id}-data-account">
            The library holds {dataAccount}'s collection, wantlist and Maybe list; forget them to use another account.
            <button type="button" class="link" disabled={discogs.forgetting} onclick={() => void forgetDiscogsData(dataAccount)}>
              Forget them
            </button>
          </span>
        {/if}
      </div>
      <div class="field">
        <label class="name" for="{id}-token">Token</label>
        <div class="inline wrap">
          <input
            id="{id}-token"
            form="{id}-token-form"
            type="password"
            class="token"
            autocomplete="off"
            spellcheck="false"
            required
            disabled={tokenFromEnvironment}
            aria-invalid={discogs.tokenError !== null ? "true" : undefined}
            placeholder={tokenSaved ? "saved; paste another to replace it" : "paste your token"}
            aria-describedby="{id}-token-status {id}-token-hint"
            bind:value={tokenDraft}
          />
          <button
            type="submit"
            form="{id}-token-form"
            class="secondary"
            disabled={tokenFromEnvironment || discogs.tokenSaving || tokenDraft.trim() === ""}
          >
            {discogs.tokenSaving ? "Checking…" : "Save token"}
          </button>
          {#if tokenSaved}
            <button type="button" class="link" disabled={discogs.tokenSaving} onclick={() => void saveToken(null)}>
              Remove
            </button>
          {/if}
        </div>
        <p
          class="token-status"
          id="{id}-token-status"
          class:problem={discogs.tokenError !== null || discogs.tokenProblem !== null}
        >
          {discogs.tokenError ? `Not saved: ${discogs.tokenError}.` : discogs.tokenStatus}
        </p>
        <span class="hint" id="{id}-token-hint">
          {#if tokenFromEnvironment}
            DISCOGS_TOKEN in the environment, or in the .env digga started with, overrides a saved token; remove it
            there to change the token here.
          {:else}
            {tokenStorageText(discogs.account)}
          {/if}
        </span>
      </div>
      <div class="field narrow">
        <label class="name" for="{id}-currency">Currency</label>
        <select id="{id}-currency" aria-describedby="{id}-currency-hint" bind:value={draft.discogs.currency}>
          {#each DISCOGS_CURRENCIES as currency (currency)}<option value={currency}>{currency}</option>{/each}
        </select>
        <span class="hint" id="{id}-currency-hint">For the lowest price <Key label="P" size="sm" /> shows in Triage.</span>
      </div>
      <div class="field">
        <label class="name" for="{id}-maybe-list">Maybe list</label>
        <div class="inline wrap">
          <select
            id="{id}-maybe-list"
            aria-describedby="{id}-maybe-list-hint"
            value={draft.discogs.maybeListId === null ? "" : String(draft.discogs.maybeListId)}
            onchange={(event) => setMaybeList(event.currentTarget.value)}
          >
            <option value="">None: no M verdict</option>
            {#each discogs.lists as list (list.id)}
              <option value={String(list.id)}>{list.name}{list.public ? "" : " (private)"}</option>
            {/each}
            {#if maybeListMissing}
              <option value={String(draft.discogs.maybeListId)}>List {draft.discogs.maybeListId}</option>
            {/if}
          </select>
          <button
            type="button"
            class="secondary"
            disabled={discogs.listsState === "loading" || draft.discogs.username === ""}
            onclick={() => void discogs.loadLists()}
          >
            {#if discogs.listsState === "loading"}Reading lists…{:else if discogs.lists.length > 0}Reload lists{:else}Read my lists{/if}
          </button>
        </div>
        <span class="hint" id="{id}-maybe-list-hint">
          {#if discogs.listsState === "error"}
            Lists did not load: {discogs.listsError}.
          {:else}
            Where M files maybes. Discogs lets no app add to a list, so Twelves shows what to add.
          {/if}
        </span>
      </div>
    </div>
  </section>
</form>
<!-- The token field sits in the settings form but saves at once, so it belongs to this form. -->
<form id="{id}-token-form" onsubmit={submitToken}></form>

<section class="jobs" aria-labelledby="{id}-imports-title">
  <header>
    <h2 id="{id}-imports-title">Imports</h2>
    <p>Seed verdicts from your Discogs collection, wantlist and Maybe list, and from browser history.</p>
  </header>
  <div class="fields">
    <fieldset class="field">
      <legend class="name">Your Discogs</legend>
      <div class="inline wrap">
        <button type="button" class="secondary" onclick={() => startJob(() => api.startImport("collection"))}>Collection</button>
        <button type="button" class="secondary" onclick={() => startJob(() => api.startImport("wantlist"))}>Wantlist</button>
        <select bind:value={historyBrowser} aria-label="Browser">
          {#each BROWSERS as browser (browser)}<option value={browser}>{browser}</option>{/each}
        </select>
        <button type="button" class="secondary" onclick={() => startJob(() => api.startImport("history", { browser: historyBrowser }))}>
          History
        </button>
        <button
          type="button"
          class="secondary"
          disabled={(settings.value?.discogs.maybeListId ?? null) === null}
          onclick={() => startJob(() => api.startImport("list"))}
        >
          Maybe list
        </button>
      </div>
    </fieldset>
    <form onsubmit={readSellerShop}>
      <fieldset class="field">
        <legend class="name">Seller shop</legend>
        <div class="inline wrap">
          <input
            bind:value={sellerUsername}
            placeholder="username"
            aria-label="Seller's Discogs username"
            aria-describedby="{id}-seller-hint"
            autocomplete="off"
            spellcheck="false"
            required
          />
          <button type="submit" class="secondary" disabled={sellerUsername.trim() === ""}>Read shop</button>
        </div>
        <span class="hint" id="{id}-seller-hint">
          What a Discogs seller has for sale, so <Key label="F" size="sm" /> in Triage can dig just that.
        </span>
      </fieldset>
    </form>
    <JobList jobs={importJobs} error={jobs.error} oncancel={cancelJob} />
  </div>
  <details>
    <summary>How imports run</summary>
    <p>
      Imports run on the server; closing this page does not stop them. A shop is read at about 100 listings a second, at most 10,000. Buying stays on Discogs.
    </p>
  </details>
</section>

<style>
  .token {
    width: 26em;
  }
</style>
