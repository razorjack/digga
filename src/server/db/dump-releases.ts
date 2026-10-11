import type { Db } from "./db.ts";
import { upsertRelease, type ReleaseWrite } from "./releases.ts";
import { moveVerdictsToReleaseKeys } from "./verdict-keys.ts";

interface ReleaseKey {
  id: number;
  masterId: number | null;
  triageKey: string;
  isMainRelease: number;
}

/** Keeps existing record identities stable until a complete dump can move them together. */
export class DumpReleaseWriter {
  #db: Db;

  constructor(db: Db) {
    this.#db = db;
    db.exec(`CREATE TEMP TABLE pending_release_keys (
      id INTEGER PRIMARY KEY, master_id INTEGER, triage_key TEXT NOT NULL,
      is_main_release INTEGER NOT NULL
    )`);
  }

  write(releases: ReleaseWrite[], loadId: number | null): void {
    const db = this.#db;
    db.transaction(() => {
      const previous = this.#readKeys(releases);
      for (const release of releases) {
        const key = previous.get(release.id);
        if (!key || key.triageKey === release.triageKey) {
          upsertRelease(db, release, loadId);
          continue;
        }
        db.prepare(`INSERT OR REPLACE INTO pending_release_keys
          (id, master_id, triage_key, is_main_release) VALUES (?, ?, ?, ?)`).run(
          release.id,
          release.masterId,
          release.triageKey,
          release.isMainRelease ? 1 : 0,
        );
        upsertRelease(
          db,
          {
            ...release,
            masterId: key.masterId,
            triageKey: key.triageKey,
            isMainRelease: key.isMainRelease === 1,
          },
          loadId,
        );
      }
    })();
  }

  finish(): number {
    const db = this.#db;
    return db.transaction(() => {
      db.exec(`UPDATE releases SET master_id = pending.master_id,
        triage_key = pending.triage_key, is_main_release = pending.is_main_release
        FROM pending_release_keys pending WHERE releases.id = pending.id`);
      const releaseIds = db
        .prepare(`SELECT DISTINCT v.release_id
        FROM verdicts v JOIN releases r ON r.id = v.release_id
        WHERE v.key <> r.triage_key`)
        .pluck()
        .all() as number[];
      return moveVerdictsToReleaseKeys(db, releaseIds);
    })();
  }

  /** Interrupted and limited loads leave the old identities and their verdicts intact. */
  close(): void {
    this.#db.exec("DROP TABLE pending_release_keys");
  }

  #readKeys(releases: ReleaseWrite[]): Map<number, ReleaseKey> {
    const rows = this.#db
      .prepare(`SELECT id, master_id AS masterId, triage_key AS triageKey,
      is_main_release AS isMainRelease FROM releases WHERE id IN (SELECT value FROM json_each(?))`)
      .all(JSON.stringify(releases.map((release) => release.id))) as ReleaseKey[];
    return new Map(rows.map((row) => [row.id, row]));
  }
}
