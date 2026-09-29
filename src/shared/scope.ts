import { z } from "zod";
import type { DumpLoadSummary, ScopeMatch } from "./api.ts";
import { formatDay } from "./display.ts";
import type { ArtistRef, LabelRef } from "./types.ts";

/**
 * A scope narrows the Triage queue to the records of one label, one artist, one seller's shop or
 * one dump load's additions. Scopes name Discogs ids rather than names: several labels and
 * artists share a name, and Discogs tells them apart as "Name (2)". A seller is named by their
 * Discogs user id, a load by its row in dump_loads.
 */
export const SCOPE_KINDS = ["label", "artist", "seller", "load"] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

/** How a scope reads before its name: "the label Virus Recordings". */
export const SCOPE_NOUN: Record<ScopeKind, string> = {
  label: "the label",
  artist: "the artist",
  seller: "the seller",
  load: "the records",
};

export const ScopeRefSchema = z.object({
  kind: z.enum(SCOPE_KINDS),
  id: z.number().int().positive(),
});
export type ScopeRef = z.infer<typeof ScopeRefSchema>;

/** The label, artist or seller Triage digs, with the name it shows. */
export interface QueueScope extends ScopeRef {
  name: string;
}

/** Discogs credits compilations to the artist "Various"; digging it means every compilation. */
const VARIOUS_ARTIST_ID = 194;

/** "label:123", the form a scope takes in a query string. */
export function scopeKey(scope: ScopeRef): string {
  return `${scope.kind}:${scope.id}`;
}

/** Serialises a scope for ScopeParamSchema. */
export function scopeParam(scope: ScopeRef | null | undefined): string | undefined {
  return scope ? scopeKey(scope) : undefined;
}

export const ScopeParamSchema = z
  .string()
  .transform((text, ctx) => {
    const match = /^([a-z]+):(\d+)$/.exec(text);
    if (!match) {
      ctx.addIssue({
        code: "custom",
        message: "scope must look like label:123, artist:45, seller:6 or load:2",
      });
      return z.NEVER;
    }
    return { kind: match[1], id: Number(match[2]) };
  })
  .pipe(ScopeRefSchema);

/**
 * The labels and artists a release offers to dig: its labels, its artists, then the artists of
 * its tracks, which is where a compilation credits them. Each appears once.
 */
export function scopesOfRelease(
  release: { labels: LabelRef[]; artists: ArtistRef[] },
  tracks: { artists: ArtistRef[] }[],
): QueueScope[] {
  const scopes = new Map<string, QueueScope>();
  const add = (kind: ScopeKind, credit: { id: number | null; name: string }) => {
    if (credit.id === null || credit.id <= 0) return;
    if (kind === "artist" && credit.id === VARIOUS_ARTIST_ID) return;
    const scope = { kind, id: credit.id, name: credit.name };
    if (!scopes.has(scopeKey(scope))) scopes.set(scopeKey(scope), scope);
  };
  for (const label of release.labels) add("label", label);
  for (const artist of release.artists) add("artist", artist);
  for (const artist of tracks.flatMap((track) => track.artists)) add("artist", artist);
  return [...scopes.values()];
}

/**
 * The records a dump load added that are still to dig, as a scope; null when none are left.
 * "Added from" rather than "new in": the coverage pass adds releases the dump had before.
 */
export function newRecordsScope(
  load: (DumpLoadSummary & { toDig: number }) | null,
  now: Date = new Date(),
): ScopeMatch | null {
  if (!load || load.toDig === 0) return null;
  const dump = load.dumpDate ? `the ${formatDay(load.dumpDate, now)} dump` : "the last dump";
  return { kind: "load", id: load.id, name: `added from ${dump}`, records: load.toDig };
}
