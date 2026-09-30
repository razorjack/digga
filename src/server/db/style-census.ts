import { type StyleCensus, StyleCensusSchema } from "../../shared/style-census.ts";
import type { Db } from "./db.ts";

/** Replaces the stored census with the one a complete load counted. */
export function saveStyleCensus(db: Db, census: StyleCensus, countedAt: string): void {
  db.prepare(
    `INSERT INTO style_census (id, dump_date, counted_at, census_json) VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET dump_date = excluded.dump_date,
       counted_at = excluded.counted_at, census_json = excluded.census_json`,
  ).run(census.dumpDate, countedAt, JSON.stringify(census));
}

/** The census the newest complete load counted; null before the first. */
export function getStoredStyleCensus(db: Db): StyleCensus | null {
  const json = db.prepare("SELECT census_json FROM style_census WHERE id = 1").pluck().get() as
    | string
    | undefined;
  return json === undefined ? null : StyleCensusSchema.parse(JSON.parse(json));
}
