import type { SeedTally } from "../../shared/api.ts";
import type { Db } from "./db.ts";

/** Styles shown, most first; the setup suggests the top few and reads their years. */
const STYLES_KEPT = 30;

/**
 * The styles and years of the releases the collection and wantlist imports brought in. Their
 * stubs carry what Discogs sends with each item, so this works before any dump is loaded.
 */
export function tallySeedReleases(db: Db): SeedTally {
  const releases = db
    .prepare("SELECT COUNT(DISTINCT release_id) FROM seed_items")
    .pluck()
    .get() as number;
  const rows = db
    .prepare(
      `SELECT style.value AS name, r.year AS year, COUNT(*) AS releases
       FROM (SELECT DISTINCT release_id FROM seed_items) s
       JOIN releases r ON r.id = s.release_id, json_each(r.styles_json) style
       GROUP BY style.value, r.year`,
    )
    .all() as { name: string; year: number | null; releases: number }[];
  return { releases, styles: stylesByCount(rows) };
}

function stylesByCount(rows: { name: string; year: number | null; releases: number }[]) {
  const styles = new Map<string, SeedTally["styles"][number]>();
  for (const row of rows) {
    const style = styles.get(row.name) ?? { name: row.name, releases: 0, years: [] };
    style.releases += row.releases;
    if (row.year !== null) style.years.push([row.year, row.releases]);
    styles.set(row.name, style);
  }
  return [...styles.values()]
    .map((style) => ({ ...style, years: style.years.sort((left, right) => left[0] - right[0]) }))
    .sort((left, right) => right.releases - left.releases || left.name.localeCompare(right.name))
    .slice(0, STYLES_KEPT);
}
