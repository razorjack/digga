import type { Readable } from "node:stream";
import { SaxesParser, type SaxesTagPlain } from "saxes";
import type { ArtistRef } from "../../src/shared/types.ts";
import type { DumpRelease, DumpTrack, DumpVideo } from "./types.ts";

function int(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number.parseInt(value.trim(), 10);
  return Number.isNaN(n) ? null : n;
}

function last<T>(list: T[]): T | undefined {
  return list[list.length - 1];
}

/**
 * Streaming SAX state machine for the Discogs releases dump. It keeps a single
 * partially-built release in memory and hands it over at </release>.
 */
class ReleaseBuilder {
  readonly out: DumpRelease[] = [];
  private readonly path: string[] = [];
  private text = "";
  private current: DumpRelease | null = null;
  private artistList: ArtistRef[] | null = null;

  open(tag: SaxesTagPlain): void {
    const parent = last(this.path);
    const grand = this.path[this.path.length - 2];
    this.path.push(tag.name);
    this.text = "";
    const c = this.current;
    switch (tag.name) {
      case "release":
        if (this.path.length === 2) {
          this.current = {
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
        return;
      case "artist": {
        if (!c || parent !== "artists") {
          this.artistList = null;
          return;
        }
        let list: ArtistRef[] | null = null;
        if (grand === "release") list = c.artists;
        else if (grand === "track") list = last(c.tracklist)?.artists ?? null;
        this.artistList = list;
        list?.push({ id: null, name: "", anv: "", join: "" });
        return;
      }
      case "label":
        if (c && parent === "labels" && grand === "release") {
          c.labels.push({
            id: int(tag.attributes.id),
            name: tag.attributes.name ?? "",
            catno: tag.attributes.catno ?? "",
          });
        }
        return;
      case "format":
        if (c && parent === "formats") {
          c.formats.push({
            name: tag.attributes.name ?? "",
            qty: int(tag.attributes.qty) ?? 1,
            text: tag.attributes.text ?? "",
            descriptions: [],
          });
        }
        return;
      case "track":
        if (c && (parent === "tracklist" || parent === "sub_tracks")) {
          c.tracklist.push({ position: "", title: "", duration: "", artists: [] });
        }
        return;
      case "video":
        if (c && parent === "videos") {
          c.videos.push({
            src: tag.attributes.src ?? "",
            duration: int(tag.attributes.duration),
            embed: tag.attributes.embed !== "false",
            title: "",
            description: "",
          });
        }
        return;
      case "master_id":
        if (c && parent === "release") c.isMainRelease = tag.attributes.is_main_release === "true";
        return;
      default:
        return;
    }
  }

  text_(chunk: string): void {
    this.text += chunk;
  }

  close(tag: SaxesTagPlain): void {
    this.path.pop();
    const parent = last(this.path);
    const grand = this.path[this.path.length - 2];
    const t = this.text;
    this.text = "";
    const c = this.current;
    if (!c) return;
    const track: DumpTrack | undefined = last(c.tracklist);
    const video: DumpVideo | undefined = last(c.videos);
    const artist = this.artistList ? last(this.artistList) : undefined;
    switch (tag.name) {
      case "release":
        if (this.path.length === 1) {
          this.out.push(c);
          this.current = null;
        }
        return;
      case "artists":
        this.artistList = null;
        return;
      case "id":
        if (parent === "artist" && artist) artist.id = int(t);
        return;
      case "name":
        if (parent === "artist" && artist) artist.name = t.trim();
        return;
      case "anv":
        if (parent === "artist" && artist) artist.anv = t.trim();
        return;
      case "join":
        if (parent === "artist" && artist) artist.join = t.trim();
        return;
      case "title":
        if (parent === "release") c.title = t.trim();
        else if (parent === "track" && track) track.title = t.trim();
        else if (parent === "video" && video) video.title = t.trim();
        return;
      case "position":
        if (parent === "track" && track) track.position = t.trim();
        return;
      case "duration":
        if (parent === "track" && track) track.duration = t.trim();
        return;
      case "description":
        if (parent === "descriptions" && grand === "format")
          last(c.formats)?.descriptions.push(t.trim());
        else if (parent === "video" && video) video.description = t;
        return;
      case "genre":
        if (parent === "genres") c.genres.push(t.trim());
        return;
      case "style":
        if (parent === "styles") c.styles.push(t.trim());
        return;
      case "country":
        if (parent === "release") c.country = t.trim() === "" ? null : t.trim();
        return;
      case "released":
        if (parent === "release") c.released = t.trim() === "" ? null : t.trim();
        return;
      case "master_id":
        if (parent === "release") c.masterId = int(t);
        return;
      default:
        return;
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
  parser.on("text", (text) => builder.text_(text));
  parser.on("cdata", (text) => builder.text_(text));
  input.setEncoding("utf8");
  for await (const chunk of input) {
    parser.write(chunk as string);
    if (builder.out.length > 0) {
      const ready = builder.out.splice(0);
      for (const rel of ready) yield rel;
    }
  }
  parser.close();
  for (const rel of builder.out.splice(0)) yield rel;
}
