<script lang="ts">
  import { BROWSERS, type Browser } from "../../shared/api.ts";
  import { type Config, DISCOGS_CURRENCIES } from "../../shared/config.ts";
  import { formatCount } from "../../shared/display.ts";
  import type { Job } from "../../shared/types.ts";
  import { api } from "../api.ts";
  import Key from "../components/Key.svelte";
  import RequestList from "../setup/RequestList.svelte";
  import { errorMessage, settings, stats } from "../stores.svelte.ts";
  import { type DiscogsSettings, usernameAfterTokenSave } from "./discogs.svelte.ts";
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
    <h2 id="{id}-discogs-title">Discogs</h2>
    <div class="api-use">
      <p>
        Digga reads the catalogue from the dump, not through your account. It uses the token only for things you
        do: importing, <Key label="A" size="sm" /> and <Key label="C" size="sm" /> putting records on your
        wantlist, <Key label="P" size="sm" /> asking for a price, and showing your account here. One request at a
        time, within Discogs' rate limit.
      </p>
      <RequestList />
    </div>
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
            The library holds the collection, wantlist and Maybe list of {dataAccount}; another account needs them
            forgotten first.
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
            A personal access token from discogs.com/settings/developers, saved beside the database in secrets.env. Pushes to your wantlist
            and reads of private lists need it.
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
            The Discogs list you keep maybes on. Once it is set, M files a release as maybe; the
            Discogs API cannot add to lists, so Twelves shows which ones still need adding there.
          {/if}
        </span>
      </div>
    </div>
  </section>
</form>
<!-- The token field sits in the settings form but saves at once, so it belongs to this form. -->
<form id="{id}-token-form" onsubmit={submitToken}></form>

<section class="jobs" aria-labelledby="{id}-imports-title">
  <h2 id="{id}-imports-title">Imports</h2>
  <p class="hint">
    Imports run on the server, in the sandbox too, since they set Digga up rather than dig. Closing this page does
    not stop them.{settings.sandbox ? " Only the Maybe list import stays in this tab in the sandbox." : ""}
  </p>
  <div class="job">
    <p><b>Import</b> seeds verdicts from Discogs and from browser history.</p>
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
  </div>
  <form class="job" onsubmit={readSellerShop}>
    <p>
      <b>Seller shop</b> reads which releases a Discogs seller has for sale, about 100 listings a second and at most
      10,000, so <Key label="F" size="sm" /> in Triage can dig just those. Buying stays on Discogs.
    </p>
    <div class="inline wrap">
      <input
        bind:value={sellerUsername}
        placeholder="username"
        aria-label="Seller's Discogs username"
        autocomplete="off"
        spellcheck="false"
        required
      />
      <button type="submit" class="secondary" disabled={sellerUsername.trim() === ""}>Read shop</button>
    </div>
  </form>
  <JobList jobs={importJobs} error={jobs.error} oncancel={cancelJob} />
</section>

<style>
  .api-use {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 46em;
    margin-bottom: 18px;
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .token {
    width: 26em;
  }
  .job {
    display: grid;
    gap: 8px;
  }
  .job p {
    color: var(--fg-muted);
  }
</style>
