import { z } from "zod";
import { heardKeyFor } from "./normalize.ts";
import type { ArtistRef, FormatRef } from "./types.ts";

export const AlternativeOptionsSchema = z.object({
  whiteLabels: z.boolean().default(false),
  promos: z.boolean().default(false),
  testPressings: z.boolean().default(false),
});
export type AlternativeOptions = z.infer<typeof AlternativeOptionsSchema>;

export interface PressingTrack {
  position: string;
  title: string;
  artists: ArtistRef[];
}

export interface AlternativePressing {
  id: number;
  masterId: number | null;
  title: string;
  artist: string;
  formats: FormatRef[];
  country: string | null;
  year: number | null;
  catno: string | null;
  tracks: PressingTrack[];
}

export interface PressingCandidate {
  release: AlternativePressing;
  match: "matching" | "review";
  onWantlist: boolean;
}

export interface AlternativesPreview {
  source: AlternativePressing;
  candidates: PressingCandidate[];
  errors: { releaseId: number; error: string }[];
}

export const AlternativesPreviewSchema = z.object({
  releaseId: z.number().int().positive(),
  options: AlternativeOptionsSchema,
});
export type AlternativesPreviewInput = z.infer<typeof AlternativesPreviewSchema>;

export const AddAlternativesSchema = AlternativesPreviewSchema.extend({
  operationId: z.uuid(),
  releaseIds: z.array(z.number().int().positive()).min(1).max(500),
  automatic: z.boolean(),
});
export type AddAlternativesInput = z.infer<typeof AddAlternativesSchema>;
export const UndoAlternativesSchema = z.object({ operationId: z.uuid() });

export interface AlternativeAdditions {
  operationId: string;
  added: number[];
  existing: number[];
  errors: { releaseId: number; error: string }[];
  undone: boolean;
}

export function alternativesEnabled(options: AlternativeOptions): boolean {
  return options.whiteLabels || options.promos || options.testPressings;
}

export function eligibleAlternative(formats: FormatRef[], options: AlternativeOptions): boolean {
  if (!formats.some((format) => format.name === "Vinyl")) return false;
  const descriptions = new Set(formats.flatMap((format) => format.descriptions));
  if (descriptions.has("Unofficial Release") || descriptions.has("Partially Unofficial"))
    return false;
  // A promo can also be a test pressing; accepting promos must not opt into test pressings.
  if (descriptions.has("Test Pressing")) return options.testPressings;
  return (
    (options.whiteLabels && descriptions.has("White Label")) ||
    (options.promos && descriptions.has("Promo"))
  );
}

/** Compare every credited tune, retaining mix names and duplicate tracks, regardless of side order. */
export function matchingPressing(
  source: AlternativePressing,
  candidate: AlternativePressing,
): boolean {
  if (source.masterId === null || source.masterId !== candidate.masterId) return false;
  const original = trackIdentities(source.tracks);
  const alternative = trackIdentities(candidate.tracks);
  if (original === null || alternative === null || original.length !== alternative.length)
    return false;
  return original.every((identity, index) => identity === alternative[index]);
}

function trackIdentities(tracks: PressingTrack[]): string[] | null {
  if (tracks.length === 0) return null;
  const identities: string[] = [];
  for (const track of tracks) {
    const identity = heardKeyFor({ ...track, recordKey: "unknown:" });
    // Generic titles and anonymous credits cannot establish equivalence, even within a master.
    if (identity.startsWith("unknown:")) return null;
    identities.push(identity);
  }
  return identities.toSorted();
}
