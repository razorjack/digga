import type { ShoppingSeller } from "../../shared/shopping.ts";
import type { Api } from "../api.ts";
import { Generation } from "../async.ts";
import { waitForJob } from "../jobs.ts";
import { errorMessage } from "../stores.svelte.ts";

/** Reads reuse the existing import jobs and keep running if the user leaves Shop. */
export class ShoppingShops {
  sellers = $state.raw<ShoppingSeller[]>([]);
  busy = $state(false);
  error = $state<string | null>(null);
  message = $state("");
  #api: Api;
  #controller = new AbortController();
  #loads = new Generation();

  constructor(api: Api) {
    this.#api = api;
  }

  async load(): Promise<boolean> {
    const isCurrent = this.#loads.next();
    try {
      const response = await this.#api.getShoppingSellers();
      if (!isCurrent()) return false;
      this.sellers = response.sellers;
      this.error = null;
      return true;
    } catch (error) {
      if (isCurrent()) this.error = errorMessage(error);
      return false;
    }
  }

  async read(kind: "seller" | "wantlist", username?: string): Promise<number | null> {
    if (this.busy) return null;
    this.busy = true;
    this.error = null;
    this.message = kind === "seller" ? "Reading the seller's shop…" : "Reading your wantlist…";
    try {
      const job = await this.#api.startImport(kind, { username });
      const finished = await waitForJob(this.#api, job, this.#controller.signal);
      if (finished.status !== "done")
        throw new Error(finished.error ?? "The import did not finish.");
      const loaded = await this.load();
      this.#controller.signal.throwIfAborted();
      if (!loaded) {
        this.message = "";
        return null;
      }
      this.#controller.signal.throwIfAborted();
      this.message =
        kind === "seller"
          ? "Shop refreshed. Your shopping decisions are saved."
          : "Wantlist refreshed.";
      return (
        this.sellers.find((seller) => seller.username.toLowerCase() === username?.toLowerCase())
          ?.id ?? null
      );
    } catch (error) {
      if (!this.#controller.signal.aborted) {
        this.error = errorMessage(error);
        this.message = "";
      }
      return null;
    } finally {
      if (!this.#controller.signal.aborted) this.busy = false;
    }
  }

  destroy(): void {
    this.#controller.abort();
    this.#loads.end();
  }
}
