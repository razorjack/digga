import { fileURLToPath } from "node:url";
import { loadDump } from "../tools/dump/load.ts";
import { type Db, openDb } from "../src/server/db/db.ts";
import { createLogger, silentSink } from "../src/server/logger.ts";
import { DEFAULT_CONFIG, type Filters } from "../src/shared/config.ts";

export const FIXTURE_GZ = fileURLToPath(
  new URL("../fixtures/releases-sample.xml.gz", import.meta.url),
);

export const silentLogger = createLogger({ sink: silentSink });

/** In-memory database with the fixture dump loaded (5 DnB releases, 1005 excluded by style). */
export async function fixtureDb(): Promise<Db> {
  const db = openDb(":memory:");
  await loadDump(db, { file: FIXTURE_GZ, styles: ["Drum n Bass"], loadYears: null });
  return db;
}

export const defaultFilters: Filters = { ...DEFAULT_CONFIG.filters };

export function filters(overrides: Partial<Filters>): Filters {
  return { ...defaultFilters, ...overrides };
}
