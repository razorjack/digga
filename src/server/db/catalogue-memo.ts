import type { Db } from "./db.ts";

/** Results from different filters kept at once, so the settings preview cannot grow it unbounded. */
const MAX_RESULTS = 8;

// Writes on this connection that change what the query-time filters keep, or how the queue picks
// and orders a record. Verdicts and memberships are left to the callers: the queue applies them
// when it reads, and a result that reads the coverage names it in its key. TEMP triggers belong
// to this connection alone, so a dump load's worker pays nothing for them; PRAGMA data_version
// reports the other connections' commits.
const TRIGGERS: Record<string, string> = {
  releases_added: "AFTER INSERT ON main.releases",
  releases_removed: "AFTER DELETE ON main.releases",
  releases_changed: `AFTER UPDATE OF id, master_id, is_main_release, artists_json, labels_json,
    label_name, catno, year, country, formats_json, styles_json, in_universe, triage_key,
    added_by_load ON main.releases`,
  tracks_added: "AFTER INSERT ON main.tracks",
  tracks_removed: "AFTER DELETE ON main.tracks",
  tracks_changed: "AFTER UPDATE ON main.tracks",
  videos_added: "AFTER INSERT ON main.videos",
  videos_removed: "AFTER DELETE ON main.videos",
  videos_changed: "AFTER UPDATE ON main.videos",
  user_videos_added: "AFTER INSERT ON main.user_videos",
  user_videos_removed: "AFTER DELETE ON main.user_videos",
  user_videos_changed: "AFTER UPDATE ON main.user_videos",
};

/**
 * Remembers what `compute` returns from the catalogue until a write could change it. The results
 * belong to the connection, whose triggers report its writes, so they are kept per connection.
 */
export function rememberForCatalogue<T>(db: Db, key: string, compute: () => T): T {
  let memo = memos.get(db);
  if (!memo) {
    memo = new CatalogueMemo(db);
    memos.set(db, memo);
  }
  return memo.remember(key, compute);
}

const memos = new WeakMap<Db, CatalogueMemo>();

class CatalogueMemo {
  #db: Db;
  #version = "";
  #results = new Map<string, unknown>();

  constructor(db: Db) {
    this.#db = db;
    db.exec(`CREATE TEMP TABLE IF NOT EXISTS catalogue_changes (n INTEGER NOT NULL);
      INSERT INTO catalogue_changes SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM catalogue_changes);`);
    for (const [name, event] of Object.entries(TRIGGERS))
      db.exec(`CREATE TEMP TRIGGER IF NOT EXISTS catalogue_${name} ${event}
        BEGIN UPDATE catalogue_changes SET n = n + 1; END`);
  }

  remember<T>(key: string, compute: () => T): T {
    // A transaction can still roll back the writes the result would be computed from.
    if (this.#db.inTransaction) return compute();
    this.#forgetIfChanged();
    if (this.#results.has(key)) {
      const value = this.#results.get(key) as T;
      this.#results.delete(key);
      this.#results.set(key, value);
      return value;
    }
    const value = compute();
    this.#results.set(key, value);
    if (this.#results.size > MAX_RESULTS) this.#results.delete(this.#results.keys().next().value!);
    return value;
  }

  /** Read before computing: a commit meanwhile then only makes the next call compute again. */
  #forgetIfChanged(): void {
    const others = this.#db.pragma("data_version", { simple: true }) as number;
    const own = this.#db.prepare("SELECT n FROM temp.catalogue_changes").pluck().get() as number;
    const version = `${others}:${own}`;
    if (version === this.#version) return;
    this.#version = version;
    this.#results.clear();
  }
}
