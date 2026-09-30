/**
 * Every release, label, track, video and Discogs account the end-to-end tests use. The dump
 * files, the fake Discogs API and the fake YouTube player all read it, so the three agree
 * (docs/E2E_TESTING.md, "The fixture catalogue").
 */

export interface FixtureTrack {
  position: string;
  title: string;
  duration: string;
}

export interface FixtureVideo {
  id: string;
  title: string;
  seconds: number;
}

export interface FixtureRelease {
  id: number;
  master: { id: number; main: boolean } | null;
  artists: string[];
  title: string;
  label: { id: number; name: string; catno: string };
  year: number | null;
  country: string;
  styles: string[];
  tracks: FixtureTrack[];
  videos: FixtureVideo[];
}

export interface FixtureAccount {
  username: string;
  collection: number[];
  /** Release ids; one of them is in no dump. */
  wantlist: number[];
}

function track(position: string, title: string, duration: string): FixtureTrack {
  return { position, title, duration };
}

/** Video ids have YouTube's shape; an `e150` or `e100` prefix makes the fake player refuse them. */
function video(id: string, title: string, seconds: number): FixtureVideo {
  if (!/^[\w-]{11}$/.test(id)) throw new Error(`${id} is not an 11-character YouTube id`);
  return { id, title, seconds };
}

function release(fields: Omit<FixtureRelease, "master"> & Partial<FixtureRelease>): FixtureRelease {
  return { master: null, ...fields };
}

const AXIS_PLATE = { id: 30, name: "Axis Plate" };
const BASSLINE_THEORY = { id: 10, name: "Bassline Theory" };
const COLD_STORAGE = { id: 20, name: "Cold Storage" };
const DARK_MATTER = { id: 40, name: "Dark Matter Audio" };
const ECHO_CHAMBER = { id: 50, name: "Echo Chamber" };
const FRONTLINE = { id: 60, name: "Frontline" };

const DNB = ["Drum n Bass", "Techstep"];

/**
 * The small catalogue. Labels sort alphabetically, so the default label sweep digs them in this
 * order; Cold Storage's records are the account's collection and wantlist.
 */
export const SMALL: FixtureRelease[] = [
  release({
    id: 1101,
    master: { id: 601, main: true },
    artists: ["Nautic Unit"],
    title: "Pressure Drop",
    label: { ...AXIS_PLATE, catno: "AXP 001" },
    year: 1998,
    country: "UK",
    styles: DNB,
    tracks: [track("A", "Pressure Drop", "6:40"), track("B", "Undertow", "6:05")],
    videos: [
      video("nauticpress", "Nautic Unit - Pressure Drop", 400),
      video("nauticunder", "Nautic Unit - Undertow", 365),
    ],
  }),
  release({
    id: 1201,
    artists: ["Sub Frame"],
    title: "Cold Logic",
    label: { ...BASSLINE_THEORY, catno: "BLT 010" },
    year: 1999,
    country: "UK",
    styles: ["Drum n Bass", "Neurofunk"],
    tracks: [track("A", "Cold Logic", "7:02"), track("AA", "Relay", "6:48")],
    videos: [video("subframecld", "Sub Frame - Cold Logic", 422)],
  }),
  release({
    id: 1202,
    artists: ["Hollow Circuit"],
    title: "Grid Lock",
    label: { ...BASSLINE_THEORY, catno: "BLT 011" },
    year: 2000,
    country: "UK",
    styles: DNB,
    tracks: [track("A", "Grid Lock", "6:30"), track("B", "Brownout", "6:10")],
    videos: [video("hollowgridl", "Hollow Circuit - Grid Lock", 390)],
  }),
  release({
    id: 1301,
    artists: ["Kestrel"],
    title: "Night Shift",
    label: { ...COLD_STORAGE, catno: "COLD 004" },
    year: 2000,
    country: "UK",
    styles: DNB,
    tracks: [track("A", "Night Shift", "6:00")],
    videos: [video("kestrelnigh", "Kestrel - Night Shift", 360)],
  }),
  release({
    id: 1302,
    artists: ["Kestrel"],
    title: "Day Break",
    label: { ...COLD_STORAGE, catno: "COLD 005" },
    year: 2001,
    country: "UK",
    styles: DNB,
    tracks: [track("A", "Day Break", "6:20")],
    videos: [video("kestreldayb", "Kestrel - Day Break", 380)],
  }),
  release({
    id: 1401,
    artists: ["Vantage"],
    title: "Event Horizon",
    label: { ...DARK_MATTER, catno: "DMA 002" },
    year: 2001,
    country: "UK",
    styles: DNB,
    tracks: [track("A", "Event Horizon", "7:10"), track("B", "Singularity", "6:55")],
    videos: [video("vantageevhz", "Vantage - Event Horizon", 430)],
  }),
  release({
    id: 1501,
    artists: ["Relic"],
    title: "Signal Lost",
    label: { ...ECHO_CHAMBER, catno: "ECHO 01" },
    year: 2002,
    country: "UK",
    styles: DNB,
    tracks: [track("A", "Signal Lost", "6:44")],
    videos: [video("relicsignal", "Relic - Signal Lost", 404)],
  }),
  release({
    id: 1502,
    artists: ["Relic"],
    title: "Static",
    label: { ...ECHO_CHAMBER, catno: "ECHO 02" },
    year: 2002,
    country: "UK",
    styles: DNB,
    tracks: [track("A", "Static", "6:12")],
    videos: [],
  }),
  release({
    id: 1503,
    artists: ["Mirage"],
    title: "Second Sight",
    label: { ...ECHO_CHAMBER, catno: "ECHO 03" },
    year: 1999,
    country: "UK",
    styles: DNB,
    tracks: [track("A", "Second Sight", "6:36")],
    videos: [video("e150mirage1", "Mirage - Second Sight", 396)],
  }),
  release({
    id: 1601,
    artists: ["Vector"],
    title: "Old School",
    label: { ...FRONTLINE, catno: "FRONT 7" },
    year: 1996,
    country: "UK",
    styles: ["Drum n Bass", "Jungle"],
    tracks: [track("A", "Old School", "5:58")],
    videos: [video("vectoroldsc", "Vector - Old School", 358)],
  }),
];

/** A release on the account's wantlist that no dump has. */
export const NOT_IN_ANY_DUMP = release({
  id: 9001,
  artists: ["Ghost Signal"],
  title: "Lost Press",
  label: { id: 90, name: "White Label", catno: "WL 1" },
  year: 2000,
  country: "UK",
  styles: DNB,
  tracks: [],
  videos: [],
});

export const DJ: FixtureAccount = { username: "dj", collection: [1301], wantlist: [1302, 9001] };

export const ACCOUNTS: FixtureAccount[] = [DJ, { username: "other", collection: [], wantlist: [] }];

/** Records in the bulk catalogue, all of them to dig. */
const BULK_RECORDS = 1500;
const BULK_FIRST_ID = 300_001;
const BULK_SEED = 20_260_901;
const WORDS = (
  "Axis Basalt Cipher Delta Ember Flux Granite Helix Ion Jolt Kinetic Lumen Mono Nadir Orbit " +
  "Prism Quartz Rift Static Tangent Umbra Vertex Warp Xenon Yield Zenith"
).split(" ");
const LABEL_KINDS = ["Audio", "Music", "Recordings", "Records", "Sound"];
const BULK_LABELS = 30;
const BULK_ARTISTS = 200;

/**
 * The transfer of the bulk dump can be held after this many records, each one to dig, so the
 * setup reaches exact states (docs/E2E_TESTING.md, "The fixture catalogue").
 */
export const BULK_CHECKPOINTS = { "100-to-dig": 100, "600-to-dig": 600 };

/**
 * Generated Drum n Bass records from 1998 to 2002 on vinyl, deterministic from a seed, for the
 * first run. None has a master, and each matches the picks the setup scenarios make (Drum n Bass,
 * the census's middle years, vinyl), so each is one record to dig. They sit in id order, as in a
 * Discogs dump, on labels no other fixture uses, so the coverage pass keeps nothing from them.
 */
export const BULK: FixtureRelease[] = generateBulk();

export const ALL_RELEASES: FixtureRelease[] = [...SMALL, NOT_IN_ANY_DUMP, ...BULK];

export function releaseById(id: number): FixtureRelease | undefined {
  return ALL_RELEASES.find((candidate) => candidate.id === id);
}

/** The fake YouTube player's titles and durations, by video id. */
export function videoCatalogue(): Record<string, { title: string; seconds: number }> {
  const videos: Record<string, { title: string; seconds: number }> = {};
  for (const fixture of ALL_RELEASES)
    for (const entry of fixture.videos)
      videos[entry.id] = { title: entry.title, seconds: entry.seconds };
  return videos;
}

function generateBulk(): FixtureRelease[] {
  const random = seededRandom(BULK_SEED);
  const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)]!;
  const words = (count: number) => Array.from({ length: count }, () => pick(WORDS)).join(" ");
  const labels = Array.from({ length: BULK_LABELS }, (_, index) => ({
    id: 700 + index,
    name: `${words(1)} ${pick(LABEL_KINDS)} ${index + 1}`,
    prefix: `BK${String(index + 1).padStart(2, "0")}`,
  }));
  const artists = Array.from({ length: BULK_ARTISTS }, (_, index) => `${words(2)} ${index + 1}`);

  const releases: FixtureRelease[] = [];
  for (let index = 0; index < BULK_RECORDS; index += 1) {
    const id = BULK_FIRST_ID + index;
    const label = pick(labels);
    const artist = pick(artists);
    const title = words(2);
    const seconds = 300 + Math.floor(random() * 180);
    releases.push(
      release({
        id,
        artists: [artist],
        title,
        label: { id: label.id, name: label.name, catno: `${label.prefix} ${index + 1}` },
        year: 1998 + Math.floor(random() * 5),
        country: "UK",
        styles: ["Drum n Bass"],
        tracks: [track("A", title, "6:00"), track("B", words(2), "6:30")],
        videos: [video(`bk${String(id).padStart(9, "0")}`, `${artist} - ${title}`, seconds)],
      }),
    );
  }
  return releases;
}

/** mulberry32: a small generator that gives the same sequence for the same seed. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
