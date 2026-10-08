import { expectedVerdict, type MarkedTrack, type TwelvesItem } from "../../shared/api.ts";
import type { Verdict, VerdictStatus } from "../../shared/types.ts";
import { api as appApi, type Api, isConflict } from "../api.ts";
import { waitForJob } from "../jobs.ts";
import { formatCount, formatCounted } from "../../shared/display.ts";
import { isWantlistVerdict } from "../../shared/wantlist.ts";
import { errorMessage, stats, settings } from "../stores.svelte.ts";
import {
  type ShelfId,
  type SortId,
  SORTS,
  TRIAGE_STATUSES,
  missingFromWantlist,
  notOnList,
  notOnWantlist,
  releaseIdOf,
  type JudgedStatus,
  nameOf,
  rejudgedSentence,
  countShelves,
  pageAround,
  trackKey,
  turnedPageStart,
  visibleItems,
  visibleTracks,
} from "./model.ts";
type UndoEntry =
  | {
      kind: "verdict";
      previous: Verdict;
      /** What the change saved; undo expects the record to still have it. */
      saved: Verdict;
      wantlist: { releaseId: number; change: "added" | "removed" } | null;
    }
  | { kind: "note"; key: string; releaseId: number; previous: string | null };

type WantlistChange = Extract<UndoEntry, { kind: "verdict" }>["wantlist"];
export class TwelvesShelf {
  #client: Api;
  #closed = new AbortController();
  #flashTimer: ReturnType<typeof setTimeout> | null = null;
  #loadVersion = 0;

  constructor(api: Api = appApi) {
    this.#client = api;
  }

  destroy(): void {
    this.#closed.abort();
    if (this.#flashTimer) clearTimeout(this.#flashTimer);
  }

  #current(): boolean {
    return !this.#closed.signal.aborted;
  }

  items = $state.raw<TwelvesItem[]>([]);
  /** Every marked track; the Tracks shelf shows the grail and keep marks. */
  tracks = $state.raw<MarkedTrack[]>([]);
  loading = $state(true);
  error = $state<string | null>(null);
  shelf = $state<ShelfId>("all");
  sort = $state<SortId>("newest");
  query = $state("");
  selectedKey = $state<string | null>(null);
  flash = $state<string | null>(null);
  undoStack = $state.raw<UndoEntry[]>([]);
  checking = $state(false);
  pushing = $state(false);
  pending = $derived(this.items.filter(notOnList).length);
  /** Wants and grails on this shelf that are not on the Discogs wantlist. */
  wantsPending = $derived(missingFromWantlist(this.items, this.shelf));
  counts = $derived(countShelves(this.items, this.tracks));
  visible = $derived(
    visibleItems(this.items, { shelf: this.shelf, sort: this.sort, query: this.query }),
  );
  selectedIndex = $derived(this.visible.findIndex((item) => item.key === this.selectedKey));
  selected = $derived(this.selectedIndex === -1 ? null : this.visible[this.selectedIndex]!);
  /** The page of the shelf that holds the selected record. */
  page = $derived(pageAround(this.visible, this.selectedIndex));
  visibleTracks = $derived(visibleTracks(this.tracks, { sort: this.sort, query: this.query }));
  selectedTrackKey = $state<string | null>(null);
  selectedTrackIndex = $derived(
    this.visibleTracks.findIndex((track) => trackKey(track) === this.selectedTrackKey),
  );
  selectedTrack = $derived(
    this.selectedTrackIndex === -1 ? null : this.visibleTracks[this.selectedTrackIndex]!,
  );
  trackPage = $derived(pageAround(this.visibleTracks, this.selectedTrackIndex));
  changes: Promise<void> = Promise.resolve();
  async load(): Promise<void> {
    const version = ++this.#loadVersion;
    try {
      const [response, marks] = await Promise.all([
        this.#client.getTwelves(),
        this.#client.getTrackMarks(),
      ]);
      if (!this.#current() || version !== this.#loadVersion) return;
      this.items = response.items;
      this.tracks = marks.items;
      this.error = null;
    } catch (error) {
      if (this.#current() && version === this.#loadVersion) this.error = errorMessage(error);
    } finally {
      this.loading = false;
    }
  }

  showFlash(message: string): void {
    if (!this.#current()) return;
    this.flash = message;
    if (this.#flashTimer) clearTimeout(this.#flashTimer);
    this.#flashTimer = setTimeout(() => {
      if (this.flash === message) this.flash = null;
    }, 5000);
  }

  async wantlistWrite(releaseId: number, add: boolean): Promise<string | null> {
    try {
      if (add) await this.#client.pushToWantlist(releaseId);
      else await this.#client.removeFromWantlist(releaseId);
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  }

  async syncWantlist(
    item: TwelvesItem,
    status: VerdictStatus,
  ): Promise<{
    entry: WantlistChange;
    note: string;
  }> {
    const releaseId = releaseIdOf(item);
    const from = item.verdict?.status ?? null;
    if (releaseId === null || status === from) return { entry: null, note: "" };
    // A want that becomes a grail, or the reverse, stays on the wantlist.
    if (isWantlistVerdict(status)) {
      if (item.membership.onWantlist) return { entry: null, note: "" };
      const error = await this.wantlistWrite(releaseId, true);
      return error
        ? {
            entry: null,
            note: ` Not on your Discogs wantlist: ${error}; the same key tries again.`,
          }
        : { entry: { releaseId, change: "added" }, note: " Added to your Discogs wantlist." };
    }
    if (from !== null && isWantlistVerdict(from)) {
      // Sent even when the want is not marked as on the wantlist: a push from Triage may have
      // landed after this page loaded. Discogs treats a missing want as removed.
      const error = await this.wantlistWrite(releaseId, false);
      if (!item.membership.onWantlist) return { entry: null, note: "" };
      return error
        ? { entry: null, note: ` Still on your Discogs wantlist: ${error}.` }
        : { entry: { releaseId, change: "removed" }, note: " Taken off your Discogs wantlist." };
    }
    return { entry: null, note: "" };
  }

  enqueueTask(task: () => Promise<void>): void {
    this.changes = this.changes
      .then(task)
      .catch((error: unknown) => this.showFlash(errorMessage(error)));
  }

  enqueue(key: string, change: (item: TwelvesItem) => Promise<void>): void {
    this.enqueueTask(async () => {
      const item = this.items.find((candidate) => candidate.key === key);
      if (item) await change(item);
    });
  }

  /** Re-judges a record decided in Digga, keeping the Discogs wantlist in step. */
  async #writeVerdict(item: TwelvesItem, previous: Verdict, status: JudgedStatus): Promise<void> {
    // If the record leaves this shelf, the selection moves to its neighbour, not to the top.
    const index = this.visible.findIndex((visible) => visible.key === item.key);
    const neighbour = (this.visible[index + 1] ?? this.visible[index - 1])?.key ?? null;
    let saved: Verdict;
    try {
      saved = await this.#client.postVerdict({
        key: previous.key,
        status,
        source: "triage",
        releaseId: previous.releaseId,
        expected: expectedVerdict(previous),
      });
      this.#replaceVerdict(item.key, saved);
    } catch (error) {
      this.showFlash(`Not saved: ${errorMessage(error)}`);
      if (isConflict(error)) await this.load();
      return;
    }
    const wantlist = await this.syncWantlist(item, status);
    const entry: UndoEntry = { kind: "verdict", previous, saved, wantlist: wantlist.entry };
    this.undoStack = [...this.undoStack, entry];
    this.showFlash(`${rejudgedSentence(nameOf(item), status)}${wantlist.note} Z undoes it.`);
    await this.load();
    if (!this.visible.some((visible) => visible.key === this.selectedKey))
      this.selectedKey = neighbour;
    void stats.refresh();
  }

  #replaceVerdict(key: string, verdict: Verdict): void {
    this.items = this.items.map((item) => (item.key === key ? { ...item, verdict } : item));
  }

  /** Saves the note on the record's shown release; an empty note removes it. */
  saveNote(selectedItem: TwelvesItem, notes: string | null): void {
    this.enqueue(selectedItem.key, async (item) => {
      const releaseId = item.release?.id ?? null;
      if (releaseId === null) {
        this.showFlash("This record is not in the loaded dump, so a note cannot go on it.");
        return;
      }
      try {
        await this.#client.putReleaseNote(releaseId, notes);
      } catch (error) {
        this.showFlash(`Not saved: ${errorMessage(error)}`);
        return;
      }
      this.undoStack = [
        ...this.undoStack,
        { kind: "note", key: item.key, releaseId, previous: item.note },
      ];
      this.showFlash(`${notes ? "Note saved." : "Note removed."} Z undoes it.`);
      await this.load();
    });
  }

  async undo(): Promise<void> {
    const entry = this.undoStack.at(-1);
    if (!entry) {
      this.showFlash("Nothing to undo.");
      return;
    }
    try {
      if (entry.kind === "note") await this.#client.putReleaseNote(entry.releaseId, entry.previous);
      else
        await this.#client.postVerdict({
          ...entry.previous,
          expected: expectedVerdict(entry.saved),
        });
    } catch (error) {
      this.showFlash(`Undo failed: ${errorMessage(error)}`);
      // A verdict changed elsewhere since leaves nothing this page can undo.
      if (isConflict(error)) {
        this.undoStack = this.undoStack.slice(0, -1);
        await this.load();
      }
      return;
    }
    this.undoStack = this.undoStack.slice(0, -1);
    const error = entry.kind === "verdict" ? await this.#undoWantlistChange(entry) : null;
    this.selectedKey = entry.kind === "note" ? entry.key : entry.previous.key;
    this.showFlash(error ? `Undone, but the Discogs wantlist did not follow: ${error}` : "Undone.");
    await this.load();
    void stats.refresh();
  }

  /** Restores the verdict's record and takes back what the re-judgement did to the wantlist. */
  async #undoWantlistChange(
    entry: Extract<UndoEntry, { kind: "verdict" }>,
  ): Promise<string | null> {
    this.#replaceVerdict(entry.previous.key, entry.previous);
    const { wantlist } = entry;
    if (!wantlist) return null;
    return this.wantlistWrite(wantlist.releaseId, wantlist.change === "removed");
  }

  async addToWantlist(list: TwelvesItem[]): Promise<void> {
    if (this.pushing || list.length === 0) return;
    this.pushing = true;
    let added = 0;
    let error: string | null = null;
    for (const item of list) {
      const releaseId = releaseIdOf(item);
      if (releaseId === null) continue;
      if (list.length > 1)
        this.flash = `Adding to your Discogs wantlist: ${added + 1} of ${list.length}…`;
      error = await this.wantlistWrite(releaseId, true);
      if (error) break;
      added += 1;
    }
    this.pushing = false;
    await this.load();
    if (error)
      this.showFlash(
        added > 0
          ? `${formatCount(added)} added, then Discogs refused: ${error}`
          : `Not added to your Discogs wantlist: ${error}`,
      );
    else
      this.showFlash(
        list.length === 1
          ? `${nameOf(list[0]!)}: added to your Discogs wantlist.`
          : `${formatCount(added)} added to your Discogs wantlist.`,
      );
  }

  rejudge(selectedItem: TwelvesItem, status: JudgedStatus): void {
    this.enqueue(selectedItem.key, async (item) => {
      const { verdict } = item;
      if (verdict === null || !TRIAGE_STATUSES.has(verdict.status)) {
        this.showFlash("Wantlist and owned records come from Discogs; change them there.");
        return;
      }
      if (verdict.status === status) {
        if (notOnWantlist(item)) await this.addToWantlist([item]);
        return;
      }
      await this.#writeVerdict(item, verdict, status);
    });
  }

  /** Attaches a YouTube link to the record's release; a record without audio goes back to the queue. */
  attachVideo(selectedItem: TwelvesItem, url: string): void {
    this.enqueue(selectedItem.key, async (item) => {
      const releaseId = releaseIdOf(item);
      if (releaseId === null) {
        this.showFlash("This record is not in the loaded dump, so a link cannot go on it.");
        return;
      }
      let requeued: boolean;
      try {
        const detail = await this.#client.attachVideo(releaseId, url);
        requeued = item.verdict?.status === "no_audio" && detail.verdict === null;
      } catch (error) {
        this.showFlash(`The link was not attached: ${errorMessage(error)}`);
        return;
      }
      await this.load();
      void stats.refresh();
      this.showFlash(`${nameOf(item)}: link attached${requeued ? ", and back in the queue" : ""}.`);
    });
  }

  /** Saves the note on a marked track, keeping its mark. */
  saveTrackNote(track: MarkedTrack, notes: string | null): void {
    this.enqueueTask(async () => {
      const { releaseId, position, mark, heardKey } = track.mark;
      const tune = {
        heardKey,
        artistDisplay: track.track?.artistDisplay ?? "",
        title: track.track?.title ?? "",
      };
      try {
        await this.#client.postTrackVerdict({ releaseId, position, tune, mark, notes });
      } catch (error) {
        this.showFlash(`Not saved: ${errorMessage(error)}`);
        return;
      }
      await this.load();
      this.showFlash(notes ? "Note saved." : "Note removed.");
    });
  }

  move(delta: number): void {
    if (this.shelf === "tracks") {
      this.#moveTrack(delta);
      return;
    }
    if (this.visible.length === 0) return;
    const index = Math.min(
      this.visible.length - 1,
      Math.max(0, (this.selectedIndex === -1 ? 0 : this.selectedIndex) + delta),
    );
    this.selectedKey = this.visible[index]!.key;
  }

  /** ← and →: selects the first record of the page before or after. */
  turnPage(turn: -1 | 1): void {
    if (this.shelf === "tracks") {
      const start = turnedPageStart(this.visibleTracks.length, this.selectedTrackIndex, turn);
      if (start !== null) this.selectedTrackKey = trackKey(this.visibleTracks[start]!);
      return;
    }
    const start = turnedPageStart(this.visible.length, this.selectedIndex, turn);
    if (start !== null) this.selectedKey = this.visible[start]!.key;
  }

  #moveTrack(delta: number): void {
    const tracks = this.visibleTracks;
    if (tracks.length === 0) return;
    const from = this.selectedTrackIndex === -1 ? 0 : this.selectedTrackIndex;
    const index = Math.min(tracks.length - 1, Math.max(0, from + delta));
    this.selectedTrackKey = trackKey(tracks[index]!);
  }

  async checkList(): Promise<void> {
    if (this.checking) return;
    if (settings.value?.discogs.maybeListId == null) {
      this.showFlash("Pick your Discogs Maybe list in Settings first.");
      return;
    }
    this.checking = true;
    try {
      const started = await this.#client.startImport("list");
      const job = await waitForJob(this.#client, started, this.#closed.signal);
      if (job.status !== "done") throw new Error(job.error ?? `the check ended as ${job.status}`);
      if (job.type !== "import_list" || !job.progress)
        throw new Error("Missing list import progress");
      const progress = job.progress;
      await this.load();
      void stats.refresh();
      this.showFlash(
        `Your Discogs Maybe list has ${formatCounted(progress.processed, "record")}; ${formatCount(progress.added)} new here.`,
      );
    } catch (error) {
      this.showFlash(`The list check failed: ${errorMessage(error)}`);
    } finally {
      this.checking = false;
    }
  }

  cycleSort(): void {
    const index = SORTS.findIndex((s) => s.id === this.sort);
    this.sort = SORTS[(index + 1) % SORTS.length]!.id;
  }
}
