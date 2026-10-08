<script lang="ts">
  /** Step 2 (optional): the Discogs token, what Digga does with it, and the imports to run. */
  import { DISCOGS_CURRENCIES } from "../../shared/config.ts";
  import { formatCount, formatCounted } from "../../shared/display.ts";
  import { tick } from "svelte";
  import { isTyping } from "../keymap.ts";
  import { settings } from "../stores.svelte.ts";
  import Action from "./Action.svelte";
  import { describedBy, reportProblem } from "./field-problem.ts";
  import type { SetupFlow } from "./flow.svelte.ts";
  import { importSeconds } from "./model.ts";
  import RequestList from "./RequestList.svelte";

  let { flow }: { flow: SetupFlow } = $props();

  let token = $state("");
  let username = $state("");
  let tokenField = $state<HTMLInputElement | null>(null);
  let usernameField = $state<HTMLInputElement | null>(null);
  /** The step's error is about the field that was refused, until the field is edited. */
  let refused = $state<"token" | "username" | null>(null);
  let seeds = $state(true);
  let currency = $state<string | null>(null);

  const fromEnvironment = $derived(flow.account?.tokenSource === "environment");
  const connectedAs = $derived(flow.account?.tokenUsername ?? flow.profile?.username ?? null);
  const chosenCurrency = $derived(
    currency ?? flow.profile?.currency ?? settings.value?.discogs.currency ?? "EUR",
  );
  const importTime = $derived(
    Math.round(importSeconds(flow.profile?.collection ?? 0) + importSeconds(flow.profile?.wantlist ?? 0)),
  );
  const tokenProblem = $derived(refused === "token" ? (flow.error ?? "") : "");
  const usernameProblem = $derived(refused === "username" ? (flow.error ?? "") : "");

  async function connect(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    refused = null;
    if (await flow.connect(token.trim())) {
      token = "";
      return;
    }
    await reportRefusal("token", tokenField);
  }

  async function useUsername(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    refused = null;
    if (!(await flow.useUsername(username.trim()))) await reportRefusal("username", usernameField);
  }

  /** The field takes the step's error once the page shows it, so its description is complete. */
  async function reportRefusal(field: "token" | "username", input: HTMLInputElement | null): Promise<void> {
    refused = field;
    await tick();
    input?.reportValidity();
  }

  function continueToSound(): void {
    void flow.continueFromDiscogs({
      seeds: seeds && connectedAs !== null,
      currency: chosenCurrency,
    });
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key !== "Enter" || isTyping(event) || event.target instanceof HTMLButtonElement)
      return;
    if (event.target instanceof HTMLElement && event.target.closest("summary")) return;
    event.preventDefault();
    continueToSound();
  }
</script>

<svelte:window {onkeydown} />

<section class="step" aria-labelledby="discogs-title">
  <header>
    <h1 id="discogs-title">Bring your Discogs</h1>
    <span class="optional">optional</span>
  </header>

  <div class="why">
    <p>With a Discogs token Digga can:</p>
    <ul>
      <li>leave records you own or already want out of the queue</li>
      <li>put a record on your wantlist when you press <kbd>A</kbd> (<kbd>Z</kbd> takes it back)</li>
      <li>ask for the lowest price when you press <kbd>P</kbd></li>
    </ul>
    <p>
      Digga reads the catalogue from the file it downloaded, not through your account. It uses the token only for
      things you do: the ones above, and showing your account in Settings. One request at a time, within Discogs'
      rate limit.
    </p>
    <RequestList />
  </div>

  <div class="account">
    <!-- The status stays in the page, empty until connected, so the account is announced. -->
    <div class="connected" role="status">
      {#if connectedAs}
        <p>
          Connected as <b>{connectedAs}</b>{#if flow.profile?.collection !== null && flow.profile?.collection !== undefined}:
            {formatCount(flow.profile.collection)} in your collection, {formatCounted(flow.profile.wantlist ?? 0, "want")}{/if}.
          {#if fromEnvironment}The token comes from <code>DISCOGS_TOKEN</code>.{/if}
        </p>
      {/if}
    </div>
    {#if !connectedAs}
      <form class="token" onsubmit={connect}>
        <p class="hint" id="token-hint">
          The token stays on this computer. Get one on discogs.com under Settings › Developers › Generate new token.
          <a href="https://www.discogs.com/settings/developers" target="_blank" rel="noopener noreferrer">Open discogs.com</a>
        </p>
        <label for="token">Token</label>
        <div class="field">
          <input
            id="token"
            type="password"
            autocomplete="off"
            spellcheck="false"
            required
            aria-describedby={describedBy("token-hint", "discogs-error", tokenProblem)}
            bind:value={token}
            bind:this={tokenField}
            oninput={() => (refused = null)}
            {@attach reportProblem(tokenProblem)}
          />
          <Action type="submit" disabled={flow.busy || token.trim() === ""}>
            {flow.busy ? "Checking…" : "Connect"}
          </Action>
        </div>
      </form>
      <details class="username">
        <summary>No token? Use your username</summary>
        <form onsubmit={useUsername}>
          <p class="hint" id="username-hint">
            Digga can read a public collection and wantlist by username, more slowly. Wants you add with
            <kbd>A</kbd> then stay in Digga, and Twelves marks them for adding on discogs.com.
          </p>
          <label for="username">Discogs username</label>
          <div class="field">
            <input
              id="username"
              autocomplete="username"
              required
              aria-describedby={describedBy("username-hint", "discogs-error", usernameProblem)}
              bind:value={username}
              bind:this={usernameField}
              oninput={() => (refused = null)}
              {@attach reportProblem(usernameProblem)}
            />
            <Action type="submit" disabled={flow.busy || username.trim() === ""}>Use it</Action>
          </div>
        </form>
      </details>
    {/if}
  </div>

  {#if connectedAs}
    <fieldset class="imports">
      <legend>What you already know</legend>
      <label>
        <input type="checkbox" bind:checked={seeds} />
        Read my collection and wantlist
        <span class="quiet">about {importTime} s</span>
      </label>
      <label class="currency">
        Prices in
        <select value={chosenCurrency} onchange={(event) => (currency = event.currentTarget.value)}>
          {#each DISCOGS_CURRENCIES as code (code)}<option value={code}>{code}</option>{/each}
        </select>
      </label>
    </fieldset>
  {/if}

  <div class="outcome">
    <p class="problem" role="alert" id="discogs-error">{flow.error ?? ""}</p>

    <div class="actions">
      <Action primary keys="Enter" onclick={continueToSound} disabled={flow.busy}>Continue</Action>
      {#if !connectedAs}
        <Action onclick={() => flow.goTo("sound")}>Skip</Action>
      {/if}
      <button type="button" class="back" onclick={() => flow.goTo("catalogue")}>Back</button>
    </div>
  </div>
</section>

<style>
  .step {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  header {
    display: flex;
    align-items: baseline;
    gap: 16px;
  }
  h1 {
    font-size: var(--text-3xl);
    line-height: 1.15;
  }
  .optional {
    color: var(--fg-faint);
    font-size: var(--text-sm);
  }
  .why {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 46em;
    color: var(--fg-muted);
  }
  .why ul {
    margin: 0;
    padding-left: 1.2em;
    color: var(--fg);
  }
  kbd {
    font-family: var(--mono);
    font-weight: 600;
    color: var(--fg-accent);
  }
  .account {
    display: flex;
    flex-direction: column;
  }
  .account .username {
    margin-top: 24px;
  }
  .token,
  .username form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 40em;
  }
  label {
    color: var(--fg);
  }
  .field {
    display: flex;
    gap: 12px;
  }
  .field input {
    flex: 1;
    font-size: var(--text-md);
  }
  input:user-invalid {
    border-color: var(--accent-mark);
  }
  .hint,
  .quiet {
    color: var(--fg-faint);
    font-size: var(--text-sm);
  }
  .username summary {
    cursor: pointer;
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .username[open] summary {
    margin-bottom: 10px;
  }
  .connected b {
    font-family: var(--display);
    font-weight: 400;
    color: var(--fg-accent);
  }
  .imports {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px 20px;
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .imports legend {
    float: none;
    padding: 0 6px;
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .imports label {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .imports input[type="checkbox"] {
    accent-color: var(--accent);
  }
  .currency {
    margin-top: 6px;
  }
  .problem {
    color: var(--fg-accent);
  }
  .outcome {
    display: flex;
    flex-direction: column;
  }
  .outcome .problem:not(:empty) {
    margin-bottom: 24px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;
  }
  .back {
    padding: 0;
    border: 0;
    background: none;
    color: var(--fg-faint);
    font-size: var(--text-sm);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
</style>
