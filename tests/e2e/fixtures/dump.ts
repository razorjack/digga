import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { FixtureRelease } from "./catalogue.ts";

/**
 * Writes releases as a Discogs releases dump, gzipped, the way data.discogs.com publishes it.
 * The file is written beside its final name and renamed, so a parallel worker never reads half
 * of it.
 */
export function writeDump(file: string, releases: FixtureRelease[]): void {
  if (fs.existsSync(file)) return;
  const xml = ['<?xml version="1.0" encoding="UTF-8"?>', "<releases>"];
  const artistIds = new Map<string, number>();
  for (const release of releases) xml.push(releaseXml(release, artistIds));
  xml.push("</releases>", "");
  const part = `${file}.${process.pid}.part`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(part, zlib.gzipSync(xml.join("\n")));
  fs.renameSync(part, file);
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
    `<tracklist>${release.tracks.map((track) => `<track><position>${escapeXml(track.position)}</position><title>${escapeXml(track.title)}</title><duration>${track.duration}</duration></track>`).join("")}</tracklist>`,
    `<videos>${release.videos.map((video) => `<video src="https://www.youtube.com/watch?v=${video.id}" duration="${video.seconds}" embed="true"><title>${escapeXml(video.title)}</title><description></description></video>`).join("")}</videos>`,
    "</release>",
  ].join("\n");
}

function artistXml(name: string, joined: boolean, artistIds: Map<string, number>): string {
  if (!artistIds.has(name)) artistIds.set(name, artistIds.size + 1);
  const join = joined ? "&amp;" : "";
  return `<artist><id>${artistIds.get(name)}</id><name>${escapeXml(name)}</name><anv></anv><join>${join}</join><role></role><tracks></tracks></artist>`;
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
