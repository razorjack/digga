import type { DiscogsAccountResponse, DiscogsListSummary } from "../../shared/api.ts";
import { api, type Api } from "../api.ts";
import { errorMessage } from "../stores.svelte.ts";

export class DiscogsSettings {
  account = $state<DiscogsAccountResponse | null>(null);
  accountError = $state<string | null>(null);
  tokenSaving = $state(false);
  tokenError = $state<string | null>(null);
  lists = $state.raw<DiscogsListSummary[]>([]);
  listsState = $state<"idle" | "loading" | "error">("idle");
  listsError = $state<string | null>(null);
  tokenProblem = $derived(accountProblem(this.account));
  tokenStatus = $derived(tokenStatusText(this.account, this.accountError));
  #client: Api;
  #accountVersion = 0;
  #listsVersion = 0;

  constructor(client: Api = api) {
    this.#client = client;
  }

  async loadAccount(): Promise<void> {
    const version = ++this.#accountVersion;
    try {
      const account = await this.#client.getDiscogsAccount();
      if (version !== this.#accountVersion) return;
      this.account = account;
      this.accountError = null;
    } catch (error) {
      if (version === this.#accountVersion) this.accountError = errorMessage(error);
    }
  }

  /** Saves the token, or removes the saved one with null. True once the server has it. */
  async saveToken(token: string | null): Promise<boolean> {
    const version = ++this.#accountVersion;
    this.tokenSaving = true;
    this.tokenError = null;
    try {
      const account = await this.#client.setDiscogsToken(token);
      if (version === this.#accountVersion) {
        this.account = account;
        this.accountError = null;
      }
      return true;
    } catch (error) {
      this.tokenError = errorMessage(error);
      return false;
    } finally {
      this.tokenSaving = false;
    }
  }

  async loadLists(): Promise<void> {
    const version = ++this.#listsVersion;
    this.lists = [];
    this.listsState = "loading";
    try {
      const response = await this.#client.getDiscogsLists();
      if (version !== this.#listsVersion) return;
      this.lists = response.lists;
      this.listsState = "idle";
      this.listsError = null;
    } catch (error) {
      if (version !== this.#listsVersion) return;
      this.listsState = "error";
      this.listsError = errorMessage(error);
    }
  }

  destroy(): void {
    this.#accountVersion += 1;
    this.#listsVersion += 1;
  }
}

function accountProblem(account: DiscogsAccountResponse | null): string | null {
  if (!account) return null;
  if (!account.hasToken) return "no Discogs token is set";
  if (account.error) return `Discogs did not confirm the token (${account.error})`;
  if (account.username === "") return "your Discogs username is not set below";
  if (
    account.tokenUsername &&
    account.tokenUsername.toLowerCase() !== account.username.toLowerCase()
  )
    return `the token belongs to ${account.tokenUsername}, not ${account.username}`;
  return null;
}

/** One sentence on the token: whose it is, or what is wrong with it. */
function tokenStatusText(
  account: DiscogsAccountResponse | null,
  accountError: string | null,
): string {
  if (accountError) return `Not checked: ${accountError}.`;
  if (!account) return "Checking…";
  const problem = accountProblem(account);
  if (problem) return `${problem[0]!.toUpperCase()}${problem.slice(1)}.`;
  const origin =
    account.tokenSource === "environment" ? ", from DISCOGS_TOKEN in the environment" : "";
  return `Works for ${account.tokenUsername}${origin}.`;
}
