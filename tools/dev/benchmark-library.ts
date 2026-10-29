import { createHash } from "node:crypto";
import { openDb, type Db } from "../../src/server/db/db.ts";
import { queryTwelves } from "../../src/server/queue/twelves.ts";
import { listMarkedTracks } from "../../src/server/queue/track-marks.ts";
import { formatPrice } from "../../src/shared/display.ts";

// Synthetic data only: this benchmark never opens the user's library.
const db = openDb(":memory:");
try {
  seedLibrary(db);
  console.log(
    JSON.stringify(
      {
        records: 5000,
        releases: 10000,
        marks: 10000,
        twelves: measure(() => queryTwelves(db, null, null)),
        tracks: measure(() => listMarkedTracks(db)),
        prices: measure(() =>
          Array.from({ length: 500 }, (_, index) => formatPrice(index / 10, "GBP")),
        ),
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
}

function measure(read: () => unknown): { medianMs: number; digest: string } {
  read();
  const durations: number[] = [];
  let result: unknown;
  for (let index = 0; index < 7; index += 1) {
    const started = performance.now();
    result = read();
    durations.push(performance.now() - started);
  }
  const medianMs = durations.toSorted((left, right) => left - right)[3]!;
  const digest = createHash("sha256").update(JSON.stringify(result)).digest("hex");
  return { medianMs: Math.round(medianMs * 100) / 100, digest };
}

function seedLibrary(db: Db): void {
  const release = db.prepare(`INSERT INTO releases
    (id, master_id, triage_key, title, artist_display, catno, year, formats_json, updated_at)
    VALUES (@id, @master, @key, 'Benchmark record', 'Benchmark artist', @catno, 2000,
      '[{"name":"Vinyl","qty":"1","descriptions":["12-inch"]}]', @at)`);
  const verdict = db.prepare(`INSERT INTO verdicts (key, status, source, release_id, decided_at)
    VALUES (?, 'accepted', 'triage', ?, ?)`);
  const mark = db.prepare(`INSERT INTO track_verdicts
    (release_id, heard_key, position, mark, decided_at, artist_display, title)
    VALUES (?, ?, ?, 'keep', ?, 'Benchmark artist', 'Benchmark tune')`);
  const note = db.prepare(`INSERT INTO release_notes (release_id, notes, updated_at)
    VALUES (?, 'Pressing note', ?)`);
  const at = "2026-01-01T00:00:00.000Z";
  db.transaction(() => {
    for (let master = 1; master <= 5000; master += 1) {
      const id = master * 2;
      const key = `m:${master}`;
      release.run({ id, master, key, catno: `BENCH-${id}`, at });
      release.run({ id: id + 1, master, key, catno: `BENCH-${id + 1}`, at });
      verdict.run(key, id, at);
      note.run(id + 1, at);
      mark.run(id, `tune ${master} a`, "A", at);
      mark.run(id, `tune ${master} b`, "B", at);
    }
  })();
}
