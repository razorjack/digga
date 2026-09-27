import type { ArtistRef, FormatRef, LabelRef } from "../../src/shared/types.ts";

/** One <release> element from the Discogs releases dump, as parsed by parse.ts. */
export interface DumpRelease {
  id: number;
  status: string;
  masterId: number | null;
  isMainRelease: boolean;
  title: string;
  artists: ArtistRef[];
  labels: LabelRef[];
  formats: FormatRef[];
  genres: string[];
  styles: string[];
  country: string | null;
  released: string | null;
  tracklist: DumpTrack[];
  videos: DumpVideo[];
}

export interface DumpTrack {
  position: string;
  title: string;
  duration: string;
  artists: ArtistRef[];
}

export interface DumpVideo {
  src: string;
  duration: number | null;
  embed: boolean;
  title: string;
  description: string;
}
