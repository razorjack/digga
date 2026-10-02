import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {
  BULK,
  BULK_CHECKPOINTS,
  type FixtureRelease,
  type FixtureTrack,
  SMALL,
  SMALL_SEPTEMBER,
} from "./catalogue.ts";

/** A releases dump as data.discogs.com publishes it: gzipped XML, with its checksum. */
export interface DumpFile {
  /** discogs_YYYYMMDD_releases.xml.gz */
  name: string;
  /** YYYY-MM-DD, the date in the name. */
  date: string;
  data: Buffer;
  sha256: string;
  checkpoints: Record<string, DumpCheckpoint>;
}

/**
 * A point where the compressor made a full flush. A gunzip stream given the bytes up to it yields
 * all the XML before it, so a transfer held there gives the load every release before it and no
 * part of the next one (docs/e2e/FIXTURES.md#the-fixture-catalogue).
 */
export interface DumpCheckpoint {
  name: string;
  /** The compressed bytes before the checkpoint. */
  offset: number;
  /** The releases before it; in a dump with checkpoints each release is one record to dig. */
  recordsToDig: number;
  /** The last of them, which the load names as "Just pulled" once it has read it. */
  last: FixtureRelease;
}

export interface DumpOptions {
  date: string;
  releases: FixtureRelease[];
  /** Each checkpoint's name and the number of releases before it. */
  checkpoints?: Record<string, number>;
}

/** The dump in memory, compressed with a full flush at each checkpoint. */
export function buildDump(options: DumpOptions): DumpFile {
  const breaks = Object.entries(options.checkpoints ?? {}).sort(
    (left, right) => left[1] - right[1],
  );
  const parts = splitXml(
    options.releases,
    breaks.map(([, releases]) => releases),
  );
  const { data, ends } = gzipInParts(parts);
  const checkpoints = Object.fromEntries(
    breaks.map(([name, releases], index) => [
      name,
      { name, offset: ends[index]!, recordsToDig: releases, last: options.releases[releases - 1]! },
    ]),
  );
  return {
    name: `discogs_${options.date.replaceAll("-", "")}_releases.xml.gz`,
    date: options.date,
    data,
    sha256: createHash("sha256").update(data).digest("hex"),
    checkpoints,
  };
}

/**
 * Writes the dump into the folder under its own name, unless it is there, and returns the path.
 * The file is written beside its final name and renamed, so a parallel worker never reads half of
 * it.
 */
export function writeDump(folder: string, dump: DumpFile): string {
  const file = path.join(folder, dump.name);
  if (fs.existsSync(file)) return file;
  const part = `${file}.${process.pid}.part`;
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(part, dump.data);
  fs.renameSync(part, file);
  return file;
}

/**
 * Gzips the parts as one stream with a full flush after each, and returns where each part ends in
 * the compressed data. A full flush resets the compressor, so each part is deflated on its own:
 * the bytes are those a gzip stream flushed with Z_FULL_FLUSH between the parts would write.
 */
export function gzipInParts(parts: string[]): { data: Buffer; ends: number[] } {
  const header = Buffer.from([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 0x03]);
  const chunks = [header];
  const ends: number[] = [];
  let length = header.length;
  for (const part of parts) {
    const deflated = zlib.deflateRawSync(part, { finishFlush: zlib.constants.Z_FULL_FLUSH });
    chunks.push(deflated);
    length += deflated.length;
    ends.push(length);
  }
  const xml = Buffer.from(parts.join(""));
  // The last block, empty, then the CRC-32 and the length of the uncompressed data.
  const trailer = Buffer.alloc(8);
  trailer.writeUInt32LE(zlib.crc32(xml), 0);
  trailer.writeUInt32LE(xml.length % 2 ** 32, 4);
  chunks.push(zlib.deflateRawSync(Buffer.alloc(0)), trailer);
  return { data: Buffer.concat(chunks), ends };
}

/** The dump's XML, cut after the given numbers of releases. */
function splitXml(releases: FixtureRelease[], cuts: number[]): string[] {
  const artistIds = new Map<string, number>();
  const parts: string[] = [];
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<releases>\n';
  for (const [index, release] of releases.entries()) {
    xml += `${releaseXml(release, artistIds)}\n`;
    if (cuts.includes(index + 1)) {
      parts.push(xml);
      xml = "";
    }
  }
  parts.push(`${xml}</releases>\n`);
  return parts;
}

function releaseXml(release: FixtureRelease, artistIds: Map<string, number>): string {
  const { label } = release;
  return [
    `<release id="${release.id}" status="Accepted">`,
    `<artists>${release.artists.map((name, index) => artistXml(name, index < release.artists.length - 1, artistIds)).join("")}</artists>`,
    `<title>${escapeXml(release.title)}</title>`,
    `<labels><label catno="${escapeXml(label.catno)}" id="${label.id}" name="${escapeXml(label.name)}"/></labels>`,
    '<formats><format name="Vinyl" qty="1" text=""><descriptions><description>12"</description></descriptions></format></formats>',
    "<genres><genre>Electronic</genre></genres>",
    `<styles>${release.styles.map((style) => `<style>${escapeXml(style)}</style>`).join("")}</styles>`,
    `<country>${escapeXml(release.country)}</country>`,
    release.year === null ? "" : `<released>${release.year}</released>`,
    masterXml(release),
    `<tracklist>${release.tracks.map((track) => trackXml(track, artistIds)).join("")}</tracklist>`,
    `<videos>${release.videos.map((video) => `<video src="https://www.youtube.com/watch?v=${video.id}" duration="${video.seconds}" embed="${video.embed}"><title>${escapeXml(video.title)}</title><description></description></video>`).join("")}</videos>`,
    "</release>",
  ].join("\n");
}

function trackXml(track: FixtureTrack, artistIds: Map<string, number>): string {
  const credits = track.artists.map((name, index) =>
    artistXml(name, index < track.artists.length - 1, artistIds),
  );
  const artists = credits.length === 0 ? "" : `<artists>${credits.join("")}</artists>`;
  return `<track><position>${escapeXml(track.position)}</position><title>${escapeXml(track.title)}</title><duration>${track.duration}</duration>${artists}</track>`;
}

function artistXml(name: string, joined: boolean, artistIds: Map<string, number>): string {
  const join = joined ? "&amp;" : "";
  return `<artist><id>${artistId(name, artistIds)}</id><name>${escapeXml(name)}</name><anv></anv><join>${join}</join><role></role><tracks></tracks></artist>`;
}

/** Discogs' id for Various, which Digga does not offer as an artist to dig. */
const VARIOUS = { name: "Various", id: 194 };

function artistId(name: string, artistIds: Map<string, number>): number {
  if (name === VARIOUS.name) return VARIOUS.id;
  if (!artistIds.has(name)) artistIds.set(name, artistIds.size + 1);
  return artistIds.get(name)!;
}

function masterXml(release: FixtureRelease): string {
  if (!release.master) return "";
  return `<master_id is_main_release="${release.master.main}">${release.master.id}</master_id>`;
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * The small catalogue's monthly dumps (docs/e2e/FIXTURES.md#the-fixture-catalogue). The templates
 * load August; September adds three releases and drops one, and data.discogs.com lists it for the
 * update (SET-17), which a test can hold at its checkpoint; July is an older dump that only lies in
 * a dumps folder (SET-16).
 */
export type SmallDumpMonth = "july" | "august" | "september";

const SMALL_DUMP_OPTIONS: Record<SmallDumpMonth, DumpOptions> = {
  july: { date: "2026-07-01", releases: SMALL },
  august: { date: "2026-08-01", releases: SMALL },
  september: { date: "2026-09-01", releases: SMALL_SEPTEMBER, checkpoints: { "part-way": 10 } },
};

const smallDumps = new Map<SmallDumpMonth, DumpFile>();

/** The month's small dump, built once per worker. */
export function smallDump(month: SmallDumpMonth): DumpFile {
  let dump = smallDumps.get(month);
  if (!dump) {
    dump = buildDump(SMALL_DUMP_OPTIONS[month]);
    smallDumps.set(month, dump);
  }
  return dump;
}

let bulk: DumpFile | null = null;

/** The bulk catalogue as the newest dump, with its checkpoints; built once per worker. */
export function bulkDump(): DumpFile {
  bulk ??= buildDump({ date: "2026-09-01", releases: BULK, checkpoints: BULK_CHECKPOINTS });
  return bulk;
}
