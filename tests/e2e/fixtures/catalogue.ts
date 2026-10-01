import { triageKeyFor } from "../../../src/shared/triage-key.ts";

/**
 * Every release, label, track, video and Discogs account the end-to-end tests use. The dump
 * files, the fake Discogs API and the fake YouTube player all read it, so the three agree
 * (docs/E2E_TESTING.md, "The fixture catalogue").
 */

export interface FixtureTrack {
  position: string;
  title: string;
  duration: string;
  /** A compilation credits its artists on the tracks; empty for the release's artists. */
  artists: string[];
}

export interface FixtureVideo {
  id: string;
  title: string;
  seconds: number;
  /** False writes embed="false" in the dump: the uploader turned embedding off. */
  embed: boolean;
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
  /** Release ids of the account's For Sale listings. */
  inventory: number[];
  /** The account's Discogs lists; a private one shows only to the account's own token. */
  lists: FixtureList[];
}

export interface FixtureList {
  id: number;
  name: string;
  public: boolean;
}

function track(
  position: string,
  title: string,
  duration: string,
  artists: string[] = [],
): FixtureTrack {
  return { position, title, duration, artists };
}

/** Video ids have YouTube's shape; an `e150` or `e100` prefix makes the fake player refuse them. */
function video(
  id: string,
  title: string,
  seconds: number,
  options: { embed?: boolean } = {},
): FixtureVideo {
  if (!/^[\w-]{11}$/.test(id)) throw new Error(`${id} is not an 11-character YouTube id`);
  return { id, title, seconds, embed: options.embed ?? true };
}

function release(fields: Omit<FixtureRelease, "master"> & Partial<FixtureRelease>): FixtureRelease {
  return { master: null, ...fields };
}

const AXIS_PLATE = { id: 30, name: "Axis Plate" };
const BASSLINE_THEORY = { id: 10, name: "Bassline Theory" };
const COLD_STORAGE = { id: 20, name: "Cold Storage" };
const DARK_MATTER = { id: 40, name: "Dark Matter Audio" };
/** The label whose records have no audio: no videos, or videos YouTube will not play. */
export const ECHO_CHAMBER = { id: 50, name: "Echo Chamber" };
const FRONTLINE = { id: 60, name: "Frontline" };
/** The label of the record with a run of tracks for the player's keys. */
export const GROUNDWORK = { id: 70, name: "Groundwork" };
/** The label of a record that repeats a tune of the first record. */
export const HARDLINE_AUDIO = { id: 80, name: "Hardline Audio" };
/** Self-releases, as Discogs names their label: the label X hides (TRI-19). */
export const SELF_RELEASED = { id: 100, name: "Not On Label (Dillinja Self-released)" };
/** The label of a compilation and one more record, to dig with F (TRI-20). */
export const ROLLERS_ARCHIVE = { id: 110, name: "Rollers Archive" };
/** The label of a record whose repress the seller shopkeeper has (TRI-40). */
export const TEMPEST_AUDIO = { id: 120, name: "Tempest Audio" };
/** The label of the releases the September dump adds (SET-17). */
export const UPFRONT_AUDIO = { id: 130, name: "Upfront Audio" };

const DNB = ["Drum n Bass", "Techstep"];

/**
 * The first record in label-sweep order. Track C has no video, so the tracklist shows each video
 * state, and a pasted link to that tune finds its track (TRI-01, TRI-26).
 */
export const FIRST_RECORD = release({
  id: 1101,
  master: { id: 601, main: true },
  artists: ["Nautic Unit"],
  title: "Pressure Drop",
  label: { ...AXIS_PLATE, catno: "AXP 001" },
  year: 1998,
  country: "UK",
  styles: DNB,
  tracks: [
    track("A", "Pressure Drop", "6:40"),
    track("B", "Undertow", "6:05"),
    track("C", "Low Tide", "6:30"),
  ],
  videos: [
    video("nauticpress", "Nautic Unit - Pressure Drop", 400),
    video("nauticunder", "Nautic Unit - Undertow", 365),
  ],
});

/** The second record in label-sweep order. */
export const SECOND_RECORD = release({
  id: 1201,
  artists: ["Sub Frame"],
  title: "Cold Logic",
  label: { ...BASSLINE_THEORY, catno: "BLT 010" },
  year: 1999,
  country: "UK",
  styles: ["Drum n Bass", "Neurofunk"],
  tracks: [track("A", "Cold Logic", "7:02"), track("AA", "Relay", "6:48")],
  videos: [video("subframecld", "Sub Frame - Cold Logic", 422)],
});

/** The second of Echo Chamber's records: no videos at all (TRI-27). */
export const WITHOUT_VIDEOS = release({
  id: 1502,
  artists: ["Relic"],
  title: "Static",
  label: { ...ECHO_CHAMBER, catno: "ECHO 02" },
  year: 2002,
  country: "UK",
  styles: DNB,
  tracks: [track("A", "Static", "6:12")],
  videos: [],
});

/** Its only video YouTube refuses. */
export const ONLY_VIDEO_REFUSED = release({
  id: 1503,
  artists: ["Mirage"],
  title: "Second Sight",
  label: { ...ECHO_CHAMBER, catno: "ECHO 03" },
  year: 1999,
  country: "UK",
  styles: DNB,
  tracks: [track("A", "Second Sight", "6:36")],
  videos: [video("e150mirage1", "Mirage - Second Sight", 396)],
});

/** Several videos, each refused, for one reason or another (TRI-28). */
export const EVERY_VIDEO_REFUSED = release({
  id: 1504,
  artists: ["Relic"],
  title: "Dead Air",
  label: { ...ECHO_CHAMBER, catno: "ECHO 04" },
  year: 2000,
  country: "UK",
  styles: DNB,
  tracks: [
    track("A", "Dead Air", "6:20"),
    track("B", "White Noise", "6:05"),
    track("C", "Carrier Wave", "5:50"),
  ],
  videos: [
    video("e150deadair", "Relic - Dead Air", 380),
    video("e100whitenz", "Relic - White Noise", 365),
    video("e150carrier", "Relic - Carrier Wave", 350),
  ],
});

/** B's video has embed="false" in the dump, so the player never loads it (TRI-28). */
export const EMBEDDING_OFF = release({
  id: 1505,
  artists: ["Mirage"],
  title: "Undertone",
  label: { ...ECHO_CHAMBER, catno: "ECHO 05" },
  year: 2001,
  country: "UK",
  styles: DNB,
  tracks: [track("A", "Half Light", "6:30"), track("B", "Undertone", "6:45")],
  videos: [
    video("miragehalfl", "Mirage - Half Light", 390),
    video("mirageunder", "Mirage - Undertone", 405, { embed: false }),
  ],
});

/**
 * A run of tracks for J, K and a video's end: given listens make A2 and B3 heard, and YouTube
 * refuses B1 (TRI-04); the playable ones take track marks (TRI-18).
 */
export const TRACK_RUN = release({
  id: 1701,
  artists: ["Torsion"],
  title: "Moving Parts",
  label: { ...GROUNDWORK, catno: "GRW 001" },
  year: 2001,
  country: "UK",
  styles: DNB,
  tracks: [
    track("A1", "Gearbox", "6:10"),
    track("A2", "Flywheel", "6:25"),
    track("B1", "Camshaft", "5:55"),
    track("B2", "Piston", "6:40"),
    track("B3", "Crankcase", "7:05"),
  ],
  videos: [
    video("torsiongear", "Torsion - Gearbox", 370),
    video("torsionflyw", "Torsion - Flywheel", 385),
    video("e150torsncm", "Torsion - Camshaft", 355),
    video("torsionpist", "Torsion - Piston", 400),
    video("torsioncrnk", "Torsion - Crankcase", 425),
  ],
});

/**
 * The first record's "Pressure Drop" again, on another label and master, so a listen to it there
 * greys it out here (TRI-06).
 */
export const SAME_TUNE_ELSEWHERE = release({
  id: 1801,
  master: { id: 801, main: true },
  artists: ["Nautic Unit"],
  title: "Second Wave",
  label: { ...HARDLINE_AUDIO, catno: "HARD 005" },
  year: 2000,
  country: "UK",
  styles: DNB,
  tracks: [track("A", "Pressure Drop", "6:40"), track("B", "Riptide", "6:15")],
  videos: [
    video("secondwvprd", "Nautic Unit - Pressure Drop", 400),
    video("secondwvrip", "Nautic Unit - Riptide", 375),
  ],
});

/** The first of two records on a self-release label; X hides both (TRI-19). */
export const SELF_RELEASE = release({
  id: 1901,
  artists: ["Dillinja"],
  title: "Iron Lung",
  label: { ...SELF_RELEASED, catno: "none" },
  year: 1999,
  country: "UK",
  styles: DNB,
  tracks: [track("A", "Iron Lung", "7:20")],
  videos: [video("dillinjairn", "Dillinja - Iron Lung", 440)],
});

/**
 * A compilation that credits its artists on the tracks, which F offers to dig (TRI-20). Kestrel
 * has two records of their own, so the search counts three for them (TRI-21).
 */
export const COMPILATION = release({
  id: 2001,
  artists: ["Various"],
  title: "Archive Volume One",
  label: { ...ROLLERS_ARCHIVE, catno: "RA 001" },
  year: 2000,
  country: "UK",
  styles: DNB,
  tracks: [
    track("A", "Cold Front", "6:40", ["Kestrel"]),
    track("B", "Gridiron", "6:15", ["Sub Frame"]),
    track("C", "Pulsar", "6:55", ["Vantage"]),
  ],
  videos: [
    video("kestrelcold", "Kestrel - Cold Front", 400),
    video("subframegrd", "Sub Frame - Gridiron", 375),
    video("vantagepuls", "Vantage - Pulsar", 415),
  ],
});

/** The main release of a master: the whole queue shows it for the master (TRI-40). */
export const MAIN_PRESSING = release({
  id: 2101,
  master: { id: 902, main: true },
  artists: ["Hollow Circuit"],
  title: "Kinetic Drift",
  label: { ...TEMPEST_AUDIO, catno: "TMP 001" },
  year: 1999,
  country: "UK",
  styles: DNB,
  tracks: [track("A", "Kinetic Drift", "6:50"), track("B", "Fault Line", "6:20")],
  videos: [video("hollowkinet", "Hollow Circuit - Kinetic Drift", 410)],
});

/** The repress of the same master, which the seller shopkeeper has for sale (TRI-40). */
export const SHOP_PRESSING = release({
  ...MAIN_PRESSING,
  id: 2102,
  master: { id: 902, main: false },
  label: { ...TEMPEST_AUDIO, catno: "TMP 001R" },
  year: 2001,
  videos: [video("hollowkinrp", "Hollow Circuit - Kinetic Drift (Repress)", 410)],
});

/**
 * The small catalogue as the August dump has it, which the templates load, in id order as in a
 * Discogs dump. Labels sort alphabetically, so the default
 * label sweep digs them in this order; Cold Storage's records are the account's collection and
 * wantlist. The labels after Frontline hold records only the scenarios that dig them reach.
 */
export const SMALL: FixtureRelease[] = [
  FIRST_RECORD,
  SECOND_RECORD,
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
  WITHOUT_VIDEOS,
  ONLY_VIDEO_REFUSED,
  EVERY_VIDEO_REFUSED,
  EMBEDDING_OFF,
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
  TRACK_RUN,
  SAME_TUNE_ELSEWHERE,
  SELF_RELEASE,
  release({
    id: 1902,
    artists: ["Dillinja"],
    title: "Brass Knuckle",
    label: { ...SELF_RELEASED, catno: "none" },
    year: 2000,
    country: "UK",
    styles: DNB,
    tracks: [track("A", "Brass Knuckle", "6:58")],
    videos: [video("dillinjabrs", "Dillinja - Brass Knuckle", 418)],
  }),
  COMPILATION,
  release({
    id: 2002,
    artists: ["Vantage"],
    title: "Pulsar Remixes",
    label: { ...ROLLERS_ARCHIVE, catno: "RA 002" },
    year: 2001,
    country: "UK",
    styles: DNB,
    tracks: [track("A", "Pulsar (Torsion Remix)", "7:05")],
    videos: [video("vantagermx1", "Vantage - Pulsar (Torsion Remix)", 425)],
  }),
  MAIN_PRESSING,
  SHOP_PRESSING,
];

/** The release the September dump no longer has; the library keeps it (SET-17). */
export const DROPPED_IN_SEPTEMBER = 1902;

/**
 * The releases the September dump adds, on a label that sorts after every other, each a record to
 * dig under the default filters (SET-17).
 */
export const SEPTEMBER_ADDITIONS: FixtureRelease[] = [
  release({
    id: 2201,
    artists: ["Kestrel"],
    title: "Late Arrival",
    label: { ...UPFRONT_AUDIO, catno: "UPF 001" },
    year: 2000,
    country: "UK",
    styles: DNB,
    tracks: [track("A", "Late Arrival", "6:30")],
    videos: [video("kestrellate", "Kestrel - Late Arrival", 390)],
  }),
  release({
    id: 2202,
    artists: ["Torsion"],
    title: "Overdrive",
    label: { ...UPFRONT_AUDIO, catno: "UPF 002" },
    year: 2001,
    country: "UK",
    styles: DNB,
    tracks: [track("A", "Overdrive", "6:45")],
    videos: [video("torsionovdr", "Torsion - Overdrive", 405)],
  }),
  release({
    id: 2203,
    artists: ["Vantage"],
    title: "Parallax",
    label: { ...UPFRONT_AUDIO, catno: "UPF 003" },
    year: 2002,
    country: "UK",
    styles: DNB,
    tracks: [track("A", "Parallax", "7:00")],
    videos: [video("vantageprlx", "Vantage - Parallax", 420)],
  }),
];

/** The small catalogue as the September dump has it: three releases more, one fewer. */
export const SMALL_SEPTEMBER: FixtureRelease[] = [
  ...SMALL.filter((fixture) => fixture.id !== DROPPED_IN_SEPTEMBER),
  ...SEPTEMBER_ADDITIONS,
];

/**
 * Videos YouTube has that no release lists, for pasting: one whose title names the first record's
 * track C, and one that matches none of its tracks.
 */
export const YOUTUBE_ONLY = {
  lowTide: video("nautictide1", "Nautic Unit - Low Tide", 390),
  liveSet: video("nauticlive9", "Nautic Unit live at the Blue Note, 1999", 1800),
};

/** Every label of the small catalogue but these; a test that digs only them leaves the rest out. */
export function labelsBesides(names: string[]): string[] {
  const labels = new Set(SMALL.map((fixture) => fixture.label.name));
  return [...labels].filter((name) => !names.includes(name));
}

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

/** dj's private list for maybes (SET-11). */
export const MAYBE_LIST: FixtureList = { id: 9001, name: "Maybe", public: false };
/** A public list of dj's, which any token can read. */
export const PUBLIC_LIST: FixtureList = { id: 9002, name: "Played out", public: true };

export const DJ: FixtureAccount = {
  username: "dj",
  collection: [1301],
  wantlist: [1302, 9001],
  inventory: [],
  lists: [MAYBE_LIST, PUBLIC_LIST],
};

/** A seller whose shop has a repress of a loaded master and a release no dump has (TRI-40). */
export const SHOPKEEPER: FixtureAccount = {
  username: "shopkeeper",
  collection: [],
  wantlist: [],
  inventory: [SHOP_PRESSING.id, NOT_IN_ANY_DUMP.id],
  lists: [],
};

export const ACCOUNTS: FixtureAccount[] = [
  DJ,
  { username: "other", collection: [], wantlist: [], inventory: [], lists: [] },
  SHOPKEEPER,
];

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

export const ALL_RELEASES: FixtureRelease[] = [
  ...SMALL,
  ...SEPTEMBER_ADDITIONS,
  NOT_IN_ANY_DUMP,
  ...BULK,
];

/** The key Digga digs the release under: its master's, else its own. */
export function triageKeyOf(fixture: FixtureRelease): string {
  return triageKeyFor({ id: fixture.id, masterId: fixture.master?.id ?? null });
}

export function releaseById(id: number): FixtureRelease | undefined {
  return ALL_RELEASES.find((candidate) => candidate.id === id);
}

/** The fake YouTube player's titles and durations, by video id. */
export function videoCatalogue(): Record<string, { title: string; seconds: number }> {
  const videos: Record<string, { title: string; seconds: number }> = {};
  const listed = ALL_RELEASES.flatMap((fixture) => fixture.videos);
  for (const entry of [...listed, ...Object.values(YOUTUBE_ONLY)])
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
