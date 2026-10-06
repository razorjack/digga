import { fileURLToPath } from "node:url";
import { loadDump } from "../tools/dump/load.ts";
import { type Db, openDb } from "../src/server/db/db.ts";
import { createLogger, silentSink } from "../src/server/logger.ts";
import type { Secrets } from "../src/server/secrets.ts";
import type { TuneSnapshot } from "../src/shared/api.ts";
import { DEFAULT_CONFIG, type Filters } from "../src/shared/config.ts";

export const FIXTURE_GZ = fileURLToPath(
  new URL("../fixtures/releases-sample.xml.gz", import.meta.url),
);
export const FIXTURE_XML = fileURLToPath(
  new URL("../fixtures/releases-sample.xml", import.meta.url),
);

export const silentLogger = createLogger({ sink: silentSink });

/** Secrets holding the token the callback returns, as if saved; saving is not expected. */
export function testSecrets(token: () => string | undefined = () => undefined): Secrets {
  return {
    getDiscogsToken: token,
    discogsTokenSource: () => (token() ? "saved" : null),
    discogsTokenEncrypted: () => false,
    setDiscogsToken: () => {
      throw new Error("this test does not save tokens");
    },
  };
}

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

/** The tune a tracklist has at a position, as Triage sends it with a mark. */
export function tuneAt(db: Db, releaseId: number, position: string): TuneSnapshot {
  return db
    .prepare(
      `SELECT heard_key AS heardKey, artist_display AS artistDisplay, title FROM tracks
       WHERE release_id = ? AND position = ? ORDER BY seq LIMIT 1`,
    )
    .get(releaseId, position) as TuneSnapshot;
}
