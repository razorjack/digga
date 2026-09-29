import type { DumpRelease } from "./types.ts";

/**
 * A label or artist qualifies for coverage when at least this share of its releases in the load
 * years carry one of the universe styles. Below it, the label mostly releases other music, and
 * its releases in other styles would flood the queue.
 */
export const MIN_STYLE_SHARE = 1 / 3;

/**
 * A label or artist with more releases in other styles than this is not one of the style's,
 * whatever its share. The cap also bounds the releases held in memory until the end of the dump.
 */
export const MAX_OTHER_RELEASES = 500;

export interface CoverageIds {
  labelIds: number[];
  artistIds: number[];
}

export interface CoverageOutcome {
  /** Releases in other styles on qualifying labels or by qualifying artists. */
  releases: DumpRelease[];
  /** Labels and artists left out because they mostly release other styles, as "label Name". */
  broad: string[];
}

interface Tally {
  style: number;
  other: number;
}

interface Candidate {
  release: DumpRelease;
  ids: string[];
}

/**
 * Collects the coverage pass while the dump streams by: releases in the universe styles count
 * towards the share of their labels and artists, and releases in other styles on those labels or
 * by those artists wait here, since whether their label qualifies is only known at the end.
 */
export class CoverageTracker {
  #labels: Set<number>;
  #artists: Set<number>;
  #tallies = new Map<string, Tally>();
  #names = new Map<string, string>();
  #candidates = new Map<number, Candidate>();

  constructor(ids: CoverageIds) {
    this.#labels = new Set(ids.labelIds);
    this.#artists = new Set(ids.artistIds);
  }

  get active(): boolean {
    return this.#labels.size > 0 || this.#artists.size > 0;
  }

  /** A release in one of the styles: it raises the share of its labels and artists. */
  countStyleRelease(release: DumpRelease): void {
    for (const id of this.#idsOf(release)) this.#tally(id).style += 1;
  }

  /** A release in another style: held when a label or artist of it is covered. */
  offerOtherRelease(release: DumpRelease): void {
    const ids = this.#idsOf(release);
    if (ids.length === 0) return;
    const overflowing: string[] = [];
    for (const id of ids) {
      const tally = this.#tally(id);
      tally.other += 1;
      if (tally.other === MAX_OTHER_RELEASES + 1) overflowing.push(id);
    }
    if (ids.some((id) => !this.#tooBroad(id))) this.#candidates.set(release.id, { release, ids });
    if (overflowing.length > 0) this.#dropCandidatesOfBroadIds();
  }

  /** Once the dump has been read: the releases to keep and the labels and artists left out. */
  finish(): CoverageOutcome {
    const qualifies = (id: string) => this.#qualifies(id);
    const releases = [...this.#candidates.values()]
      .filter((candidate) => candidate.ids.some(qualifies))
      .map((candidate) => candidate.release);
    const broad = [...this.#tallies.keys()]
      .filter((id) => this.#tallies.get(id)!.other > 0 && !qualifies(id))
      .map((id) => `${id.split(":")[0]} ${this.#names.get(id) ?? id}`);
    this.#candidates.clear();
    return { releases, broad };
  }

  /** "label:77" and "artist:11" for the covered credits of the release. */
  #idsOf(release: DumpRelease): string[] {
    const ids = new Set<string>();
    const add = (id: string, name: string) => {
      ids.add(id);
      if (!this.#names.has(id)) this.#names.set(id, name);
    };
    for (const label of release.labels)
      if (label.id !== null && this.#labels.has(label.id)) add(`label:${label.id}`, label.name);
    for (const artist of release.artists)
      if (artist.id !== null && this.#artists.has(artist.id))
        add(`artist:${artist.id}`, artist.name);
    return [...ids];
  }

  #tally(id: string): Tally {
    let tally = this.#tallies.get(id);
    if (!tally) {
      tally = { style: 0, other: 0 };
      this.#tallies.set(id, tally);
    }
    return tally;
  }

  #tooBroad(id: string): boolean {
    return (this.#tallies.get(id)?.other ?? 0) > MAX_OTHER_RELEASES;
  }

  #qualifies(id: string): boolean {
    const tally = this.#tallies.get(id);
    if (!tally || this.#tooBroad(id)) return false;
    return tally.style / (tally.style + tally.other) >= MIN_STYLE_SHARE;
  }

  #dropCandidatesOfBroadIds(): void {
    for (const [releaseId, candidate] of this.#candidates)
      if (candidate.ids.every((id) => this.#tooBroad(id))) this.#candidates.delete(releaseId);
  }
}
