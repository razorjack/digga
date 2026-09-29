import { z } from "zod";
import type { ArtistRef, LabelRef } from "./types.ts";

/**
 * A scope narrows the Triage queue to the records of one label or one artist. Scopes name
 * Discogs ids rather than names: several labels and artists share a name, and Discogs tells them
 * apart as "Name (2)".
 */
export const SCOPE_KINDS = ["label", "artist"] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

export const ScopeRefSchema = z.object({
  kind: z.enum(SCOPE_KINDS),
  id: z.number().int().positive(),
});
export type ScopeRef = z.infer<typeof ScopeRefSchema>;

/** The label or artist Triage digs, with the name it shows. */
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
      ctx.addIssue({ code: "custom", message: "scope must look like label:123 or artist:45" });
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
