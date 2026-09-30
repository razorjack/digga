import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { type StyleCensus, StyleCensusSchema } from "../shared/style-census.ts";
import type { Db } from "./db/db.ts";
import { getStoredStyleCensus } from "./db/style-census.ts";

/** The census shipped with Digga, written by `digga dump census` (docs/STYLE_CENSUS.md). */
export const SHIPPED_CENSUS_FILE = fileURLToPath(new URL("./style-census.json", import.meta.url));

let shipped: StyleCensus | null = null;

/** The census of the newest complete load, or the shipped one before the first load. */
export function readStyleCensus(db: Db): StyleCensus {
  return getStoredStyleCensus(db) ?? readShippedCensus();
}

function readShippedCensus(): StyleCensus {
  shipped ??= StyleCensusSchema.parse(JSON.parse(fs.readFileSync(SHIPPED_CENSUS_FILE, "utf8")));
  return shipped;
}
