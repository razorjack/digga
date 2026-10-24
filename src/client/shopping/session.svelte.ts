import type { ReleaseDetail } from "../../shared/api.ts";
import type { ShoppingItem, ShoppingResponse, ShoppingState } from "../../shared/shopping.ts";
import type { Api } from "../api.ts";
import { errorMessage } from "../stores.svelte.ts";

export type ShoppingView = "pending" | "shortlisted" | "skipped";

interface Undo {
  listingId: number;
  state: ShoppingState;
  view: ShoppingView;
}

/** Shopping writes are serialized; a failed save leaves the selected copy in place. */
export class ShoppingSession {
  shop = $state.raw<ShoppingResponse | null>(null);
  view = $state<ShoppingView>("pending");
  selectedId = $state<number | null>(null);
  visited = $state.raw<Set<number>>(new Set());
  detail = $state.raw<ReleaseDetail | null>(null);
  detailError = $state<string | null>(null);
  error = $state<string | null>(null);
  message = $state("");
  busy = $state(false);
  loading = $state(false);
  refreshingAudio = $state(false);
  history = $state.raw<Undo[]>([]);
  items = $derived(this.shop?.items.filter((item) => item.state === this.view) ?? []);
  current = $derived(this.items.find((item) => item.listing.id === this.selectedId) ?? null);
  #api: Api;
  #generation = 0;
  #detailGeneration = 0;
  #closed = false;

  constructor(api: Api) {
    this.#api = api;
  }

  async open(sellerId: number): Promise<void> {
    if (this.busy) return;
    const generation = ++this.#generation;
    this.loading = true;
    this.error = null;
    this.shop = null;
    this.message = "";
    this.history = [];
    this.select(null);
    try {
      const shop = await this.#api.getShopping(sellerId);
      if (!this.#owns(generation)) return;
      this.shop = shop;
      this.switchView("pending");
    } catch (error) {
      if (this.#owns(generation)) this.error = errorMessage(error);
    } finally {
      if (this.#owns(generation)) this.loading = false;
    }
  }

  switchView(view: ShoppingView): void {
    if (this.busy) return;
    this.view = view;
    this.visited = new Set();
    this.select(this.shop?.items.find((item) => item.state === view)?.listing.id ?? null);
  }

  select(listingId: number | null): void {
    if (this.busy) return;
    this.selectedId = listingId;
    this.detail = null;
    this.detailError = null;
    this.refreshingAudio = false;
    const generation = ++this.#detailGeneration;
    const item = this.shop?.items.find((copy) => copy.listing.id === listingId);
    if (item) void this.#readDetail(item, generation);
  }

  async decide(state: ShoppingState): Promise<void> {
    const item = this.current;
    if (!item || !this.shop || this.busy) return;
    const undo = { listingId: item.listing.id, state: item.state, view: this.view };
    const saved = await this.#save(item.listing.id, state);
    if (!saved) return;
    this.history = [...this.history, undo];
    this.visited = new Set([...this.visited, item.listing.id]);
    this.select(this.items.find((copy) => !this.visited.has(copy.listing.id))?.listing.id ?? null);
    this.message =
      state === "shortlisted" ? "Copy saved to your shortlist." : "Shopping decision saved.";
  }

  async undo(): Promise<void> {
    const undo = this.history.at(-1);
    if (!undo || this.busy) return;
    if (!(await this.#save(undo.listingId, undo.state))) return;
    this.history = this.history.slice(0, -1);
    this.view = undo.view;
    this.visited = new Set([...this.visited].filter((id) => id !== undo.listingId));
    this.select(undo.listingId);
    this.message = "Shopping decision undone.";
  }

  async #save(listingId: number, state: ShoppingState): Promise<boolean> {
    if (!this.shop) return false;
    const generation = this.#generation;
    this.busy = true;
    this.error = null;
    try {
      const shop = await this.#api.putShoppingDecision(this.shop.seller.id, listingId, state);
      if (!this.#owns(generation)) return false;
      this.shop = shop;
      return true;
    } catch (error) {
      if (this.#owns(generation)) this.error = `Not saved: ${errorMessage(error)}`;
      return false;
    } finally {
      if (this.#owns(generation)) this.busy = false;
    }
  }

  async #readDetail(item: ShoppingItem, generation: number): Promise<void> {
    try {
      let detail = await this.#api.getRelease(item.release.id);
      if (this.#closed || generation !== this.#detailGeneration) return;
      // Wantlist stubs have no tracks until they are read from Discogs or a dump.
      if (!item.release.enrichedAt && detail.tracks.length === 0)
        detail = await this.#api.enrichRelease(item.release.id);
      if (!this.#closed && generation === this.#detailGeneration) this.detail = detail;
    } catch (error) {
      if (!this.#closed && generation === this.#detailGeneration)
        this.detailError = errorMessage(error);
    }
  }

  async refreshAudio(): Promise<void> {
    const item = this.current;
    if (!item || this.refreshingAudio || this.busy || this.#closed) return;
    const generation = ++this.#detailGeneration;
    this.refreshingAudio = true;
    this.error = null;
    this.message = "";
    try {
      const detail = await this.#api.enrichRelease(item.release.id);
      if (this.#closed || generation !== this.#detailGeneration) return;
      this.detail = detail;
      this.detailError = null;
      this.message = "Audio links refreshed from Discogs.";
    } catch (error) {
      if (!this.#closed && generation === this.#detailGeneration)
        this.error = `Audio refresh failed: ${errorMessage(error)}`;
    } finally {
      if (!this.#closed && generation === this.#detailGeneration) this.refreshingAudio = false;
    }
  }

  #owns(generation: number): boolean {
    return !this.#closed && generation === this.#generation;
  }

  destroy(): void {
    this.#closed = true;
    this.#generation += 1;
    this.#detailGeneration += 1;
  }
}
