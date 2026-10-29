import {
  eligibleAlternative,
  matchingPressing,
  type AlternativePressing,
  type AlternativesPreview,
  type AlternativesPreviewInput,
  type PressingTrack,
} from "../shared/alternative-pressings.ts";
import { artistDisplay } from "../shared/normalize.ts";
import type { Db } from "./db/db.ts";
import { recordMembershipOf } from "./db/memberships.ts";
import type { DiscogsClient } from "./discogs/client.ts";
import type { DiscogsRelease, DiscogsTrack } from "./discogs/types.ts";
import { apiArtists, apiFormats, masterIdOf } from "./importers/seeds.ts";

export interface AlternativesDeps {
  db: Db;
  discogs: DiscogsClient;
  currency: string;
}

export async function previewAlternatives(
  deps: AlternativesDeps,
  input: AlternativesPreviewInput,
): Promise<AlternativesPreview> {
  const source = pressingFromApi(await deps.discogs.getRelease(input.releaseId, deps.currency));
  const preview: AlternativesPreview = { source, candidates: [], errors: [] };
  if (source.masterId === null) return preview;
  const wanted = recordMembershipOf(deps.db, `m:${source.masterId}`).wantlistReleaseIds;
  const ids = await alternativeVersionIds(deps.discogs, source.masterId);
  for (const id of ids) {
    if (id === source.id) continue;
    try {
      const release = pressingFromApi(await deps.discogs.getRelease(id, deps.currency));
      if (
        release.masterId !== source.masterId ||
        !eligibleAlternative(release.formats, input.options)
      )
        continue;
      preview.candidates.push({
        release,
        match: matchingPressing(source, release) ? "matching" : "review",
        onWantlist: wanted.includes(id),
      });
    } catch (error) {
      preview.errors.push({ releaseId: id, error: messageOf(error) });
    }
  }
  return preview;
}

/** The versions API abbreviates these tags; the full release is checked before proposing it. */
async function alternativeVersionIds(
  discogs: DiscogsClient,
  masterId: number,
): Promise<Set<number>> {
  const ids = new Set<number>();
  let pages = 1;
  for (let page = 1; page <= pages; page += 1) {
    const result = await discogs.getMasterVersions(masterId, page);
    pages = result.pagination.pages;
    for (const version of result.versions)
      if (!version.format || /Promo|W\/Lbl|White Label|Test Pressing|\bTP\b/i.test(version.format))
        ids.add(version.id);
  }
  return ids;
}

export function pressingFromApi(release: DiscogsRelease): AlternativePressing {
  return {
    id: release.id,
    masterId: masterIdOf(release),
    title: release.title,
    artist: artistDisplay(apiArtists(release.artists)),
    formats: apiFormats(release.formats),
    country: release.country || null,
    year: release.year || null,
    catno: release.labels?.[0]?.catno || null,
    tracks: pressingTracks(release.tracklist ?? [], release.artists),
  };
}

function pressingTracks(
  tracks: DiscogsTrack[],
  artists: DiscogsRelease["artists"],
): PressingTrack[] {
  const result: PressingTrack[] = [];
  for (const track of tracks) {
    if (track.sub_tracks?.length) {
      result.push(...pressingTracks(track.sub_tracks, track.artists ?? artists));
      continue;
    }
    if (track.type_ === "heading") continue;
    result.push({
      position: track.position,
      title: track.title,
      artists: apiArtists(track.artists?.length ? track.artists : artists),
    });
  }
  return result;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
