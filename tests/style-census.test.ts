import { describe, expect, it } from "vite-plus/test";
import { openDb } from "../src/server/db/db.ts";
import { getStoredStyleCensus } from "../src/server/db/style-census.ts";
import { dumpLoad } from "../src/server/jobs/dump-load.ts";
import { formatStyleCensus, StyleCensusSchema } from "../src/shared/style-census.ts";
import type { DumpLoadProgress } from "../src/shared/types.ts";
import { countStyleCensus } from "../tools/dump/census.ts";
import { FIXTURE_GZ, silentLogger } from "./helpers.ts";

const load = (db: ReturnType<typeof openDb>, limit?: number) => {
  const progress: DumpLoadProgress[] = [];
  const options = { file: FIXTURE_GZ, styles: ["Drum n Bass"], loadYears: null, coverage: false };
  const result = dumpLoad({ db, logger: silentLogger }, { ...options, limit }, (update) =>
    progress.push(update),
  );
  return result.then(() => progress);
};

describe("the style census", () => {
  it("counts every style's releases per year, with vinyl, genre and shared styles", async () => {
    const census = await countStyleCensus(FIXTURE_GZ);

    expect(census.releases).toBe(6);
    expect(census.styles.map((style) => style.name)).toEqual([
      "Drum n Bass",
      "Jungle",
      "Techno",
      "Techstep",
    ]);
    expect(census.styles[0]).toEqual({
      name: "Drum n Bass",
      genre: "Electronic",
      releases: 5,
      vinyl: 4,
      firstYear: 1996,
      years: [1, 0, 0, 1, 1, 1],
      vinylYears: [0, 0, 0, 1, 1, 1],
      undated: 1,
      undatedVinyl: 1,
      together: [
        ["Jungle", 1],
        ["Techstep", 1],
      ],
    });
  });

  it("writes one style per line and reads back as it was", async () => {
    const census = await countStyleCensus(FIXTURE_GZ);
    const text = formatStyleCensus(census);

    expect(text.split("\n").filter((line) => line.startsWith('    {"name"'))).toHaveLength(4);
    expect(StyleCensusSchema.parse(JSON.parse(text))).toEqual(census);
  });

  it("is stored by a complete load, not by one a limit stopped", async () => {
    const limited = openDb(":memory:");
    await load(limited, 1);
    expect(getStoredStyleCensus(limited)).toBeNull();

    const complete = openDb(":memory:");
    await load(complete);
    expect(getStoredStyleCensus(complete)).toEqual(await countStyleCensus(FIXTURE_GZ));
    limited.close();
    complete.close();
  });
});

describe("the load's progress", () => {
  it("says what it kept per year and which release came last", async () => {
    const db = openDb(":memory:");
    const done = (await load(db)).at(-1)!;

    expect(done.keptByYear).toEqual({ "1996": 1, "1999": 1, "2000": 1, "2001": 1, none: 1 });
    expect(done.latest).toMatchObject({ id: 1006, artist: "Konflikt" });
    db.close();
  });
});
