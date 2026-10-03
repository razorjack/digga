import { formatDecisionsBackup } from "../src/server/decisions-backup.ts";
import { DecisionsBackupSchema } from "../src/shared/decisions-backup.ts";
import { expect, it } from "vite-plus/test";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";
import type { SessionInput } from "../src/shared/digging-session.ts";
import { saveSession, latestSession } from "../src/server/db/digging-sessions.ts";
import { resolveSession } from "../src/server/queue/resume.ts";
import { readBackedUpData, restoreBackedUpData } from "../src/server/db/user-data.ts";
import { upsertVerdict } from "../src/server/db/verdicts.ts";
import { fixtureDb } from "./helpers.ts";

const checkpoint: SessionInput = {
  id: "bb8f7741-9dca-42c7-a252-100000000001",
  startedAt: "2026-10-03T12:00:00.000Z",
  state: {
    seed: null,
    currentId: 1001,
    passedIds: [1006],
    scope: null,
    roundIds: null,
    queueBeforeRound: null,
    playback: { releaseId: 1001, videoId: "aaaaaaaaaa1", atSeconds: 97 },
  },
};

it("preserves session context, restores checkpoints, and ignores records decided since saving", async () => {
  const db = await fixtureDb();
  saveSession(db, checkpoint, DEFAULT_CONFIG);
  const original = latestSession(db)!;
  saveSession(
    db,
    { ...checkpoint, state: { ...checkpoint.state, playback: null } },
    { ...DEFAULT_CONFIG, player: { ...DEFAULT_CONFIG.player, startAtFraction: 0.1 } },
  );
  expect(latestSession(db)?.config).toEqual(original.config);
  expect(latestSession(db)?.state.playback).toBeNull();
  const rebuilt = await fixtureDb();
  const backup = DecisionsBackupSchema.parse(
    JSON.parse(
      formatDecisionsBackup({
        ...readBackedUpData(db),
        app: "digga",
        kind: "decisions",
        version: 2,
        backedUpAt: "2099-01-01T00:00:00Z",
        config: DEFAULT_CONFIG,
      }),
    ),
  );
  restoreBackedUpData(rebuilt, backup, backup.backedUpAt);
  expect(latestSession(rebuilt)).toEqual(latestSession(db));
  upsertVerdict(db, { key: "m:501", releaseId: 1001, status: "accepted", source: "triage" });
  const resolved = resolveSession(db, latestSession(db)!);
  expect(resolved.current).toBeNull();
  expect(resolved.passed.map((release) => release.id)).toEqual([1006]);
  expect(resolved.unavailable).toBe(1);
  db.close();
  rebuilt.close();
});

it("resolves replay records separately from the undecided queue underneath them", async () => {
  const db = await fixtureDb();
  upsertVerdict(db, { key: "m:501", releaseId: 1001, status: "snoozed", source: "triage" });
  saveSession(
    db,
    {
      ...checkpoint,
      state: {
        ...checkpoint.state,
        roundIds: [1001],
        passedIds: [],
        queueBeforeRound: { currentId: 1006, passedIds: [] },
      },
    },
    DEFAULT_CONFIG,
  );
  const resolved = resolveSession(db, latestSession(db)!);
  expect(resolved.current?.id).toBe(1006);
  expect(resolved.round?.[0]?.verdict?.status).toBe("snoozed");
  expect(resolved.unavailable).toBe(0);
  db.close();
});

it("starts fresh when this version cannot resume the latest session", async () => {
  const db = await fixtureDb();
  saveSession(db, checkpoint, DEFAULT_CONFIG);
  db.prepare("UPDATE digging_sessions SET config_json = ?").run(
    JSON.stringify({ queue: { strategy: "removed-strategy" } }),
  );

  expect(latestSession(db)).toBeNull();
  db.close();
});

it("keeps the newest sessions and those touched in the last 90 days, as cursors", async () => {
  const db = await fixtureDb();
  const session = (index: number) => ({
    ...checkpoint,
    id: `bb8f7741-9dca-42c7-a252-${String(index).padStart(12, "0")}`,
  });
  for (let index = 0; index < 25; index += 1) saveSession(db, session(index), DEFAULT_CONFIG);
  const age = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  // The five oldest are a year old, two more a month old; then one more save prunes.
  db.prepare("UPDATE digging_sessions SET updated_at = ? WHERE id <= ?").run(
    age(365),
    session(4).id,
  );
  db.prepare("UPDATE digging_sessions SET updated_at = ? WHERE id IN (?, ?)").run(
    age(30),
    session(5).id,
    session(6).id,
  );
  saveSession(db, session(25), DEFAULT_CONFIG);

  const kept = db.prepare("SELECT id FROM digging_sessions").pluck().all() as string[];
  expect(kept).toHaveLength(21);
  expect(kept).not.toContain(session(0).id);
  expect(kept).toContain(session(5).id);
  db.close();
});
