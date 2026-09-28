import type { Readable } from "node:stream";
import { SaxesParser, type SaxesTagPlain } from "saxes";
import type { ArtistRef } from "../../src/shared/types.ts";
import type { DumpRelease, DumpTrack, DumpVideo } from "./types.ts";

function int(value: string | undefined): number | null {
  if (value === undefined) return null;
  const valueNumber = Number.parseInt(value.trim(), 10);
  return Number.isNaN(valueNumber) ? null : valueNumber;
}

function last<T>(list: T[]): T | undefined {
  return list[list.length - 1];
}

interface Field {
  name: string;
  parent: string | undefined;
  grandparent: string | undefined;
  text: string;
}

function emptyRelease(tag: SaxesTagPlain): DumpRelease {
  return {
    id: int(tag.attributes.id) ?? 0,
    status: tag.attributes.status ?? "",
    masterId: null,
    isMainRelease: false,
    title: "",
    artists: [],
    labels: [],
    formats: [],
    genres: [],
    styles: [],
    country: null,
    released: null,
    tracklist: [],
    videos: [],
  };
}

function setArtistField(artist: ArtistRef | undefined, name: string, text: string): void {
  if (!artist) return;
  if (name === "id") artist.id = int(text);
  if (name === "name" || name === "anv" || name === "join") artist[name] = text.trim();
}

function setReleaseField(release: DumpRelease, name: string, text: string): void {
  if (name === "title") release.title = text.trim();
  if (name === "country" || name === "released") release[name] = text.trim() || null;
  if (name === "master_id") release.masterId = int(text);
}

function setTrackField(track: DumpTrack | undefined, name: string, text: string): void {
  if (!track) return;
  if (name === "title" || name === "position" || name === "duration") track[name] = text.trim();
}

function setVideoField(video: DumpVideo | undefined, name: string, text: string): void {
  if (!video) return;
  if (name === "title") video.title = text.trim();
  if (name === "description") video.description = text;
}

/**
 * Streaming SAX state machine for the Discogs releases dump. It keeps a single
 * partially-built release in memory and hands it over at </release>.
 */
class ReleaseBuilder {
  readonly releases: DumpRelease[] = [];
  private readonly path: string[] = [];
  private text = "";
  private current: DumpRelease | null = null;
  private artistList: ArtistRef[] | null = null;

  open(tag: SaxesTagPlain): void {
    const parent = last(this.path);
    const grandparent = this.path[this.path.length - 2];
    this.path.push(tag.name);
    this.text = "";
    if (tag.name === "release" && this.path.length === 2) {
      this.current = emptyRelease(tag);
      return;
    }
    if (tag.name === "artist") {
      this.openArtist(parent, grandparent);
      return;
    }
    const release = this.current;
    if (!release) return;
    switch (tag.name) {
      case "label":
        this.openLabel(tag, release, parent, grandparent);
        return;
      case "format":
        if (parent === "formats") this.openFormat(tag, release);
        return;
      case "track":
        if (parent === "tracklist" || parent === "sub_tracks") {
          release.tracklist.push({ position: "", title: "", duration: "", artists: [] });
        }
        return;
      case "video":
        if (parent === "videos") this.openVideo(tag, release);
        return;
      case "master_id":
        if (parent === "release") release.isMainRelease = tag.attributes.is_main_release === "true";
    }
  }

  private openArtist(parent: string | undefined, grandparent: string | undefined): void {
    this.artistList = null;
    if (!this.current || parent !== "artists") return;
    if (grandparent === "release") this.artistList = this.current.artists;
    if (grandparent === "track") this.artistList = last(this.current.tracklist)?.artists ?? null;
    this.artistList?.push({ id: null, name: "", anv: "", join: "" });
  }

  private openLabel(
    tag: SaxesTagPlain,
    release: DumpRelease,
    parent: string | undefined,
    grandparent: string | undefined,
  ): void {
    if (parent !== "labels" || grandparent !== "release") return;
    release.labels.push({
      id: int(tag.attributes.id),
      name: tag.attributes.name ?? "",
      catno: tag.attributes.catno ?? "",
    });
  }

  private openFormat(tag: SaxesTagPlain, release: DumpRelease): void {
    release.formats.push({
      name: tag.attributes.name ?? "",
      qty: int(tag.attributes.qty) ?? 1,
      text: tag.attributes.text ?? "",
      descriptions: [],
    });
  }

  private openVideo(tag: SaxesTagPlain, release: DumpRelease): void {
    release.videos.push({
      src: tag.attributes.src ?? "",
      duration: int(tag.attributes.duration),
      embed: tag.attributes.embed !== "false",
      title: "",
      description: "",
    });
  }

  appendText(chunk: string): void {
    this.text += chunk;
  }

  close(tag: SaxesTagPlain): void {
    this.path.pop();
    const parent = last(this.path);
    const grandparent = this.path[this.path.length - 2];
    const text = this.text;
    this.text = "";
    const release = this.current;
    if (!release) return;
    if (tag.name === "release" && this.path.length === 1) {
      this.releases.push(release);
      this.current = null;
      return;
    }
    if (tag.name === "artists") this.artistList = null;
    this.closeField({ name: tag.name, parent, grandparent, text }, release);
  }

  private closeField(field: Field, release: DumpRelease): void {
    const { name, parent, grandparent, text } = field;
    switch (parent) {
      case "artist":
        setArtistField(this.artistList ? last(this.artistList) : undefined, name, text);
        return;
      case "release":
        setReleaseField(release, name, text);
        return;
      case "track":
        setTrackField(last(release.tracklist), name, text);
        return;
      case "video":
        setVideoField(last(release.videos), name, text);
        return;
      case "descriptions":
        if (name === "description" && grandparent === "format")
          last(release.formats)?.descriptions.push(text.trim());
        return;
      case "genres":
        if (name === "genre") release.genres.push(text.trim());
        return;
      case "styles":
        if (name === "style") release.styles.push(text.trim());
    }
  }
}

/**
 * Yields releases as they complete while streaming the XML. Memory stays flat:
 * only the releases finished within the current chunk are buffered.
 */
export async function* iterateReleases(
  input: Readable,
): AsyncGenerator<DumpRelease, void, undefined> {
  const parser = new SaxesParser({ xmlns: false, position: false });
  const builder = new ReleaseBuilder();
  parser.on("opentag", (tag) => builder.open(tag));
  parser.on("closetag", (tag) => builder.close(tag));
  parser.on("text", (text) => builder.appendText(text));
  parser.on("cdata", (text) => builder.appendText(text));
  input.setEncoding("utf8");
  for await (const chunk of input) {
    parser.write(chunk as string);
    if (builder.releases.length > 0) {
      const ready = builder.releases.splice(0);
      for (const release of ready) yield release;
    }
  }
  parser.close();
  for (const release of builder.releases.splice(0)) yield release;
}
