import type { SavedSession, SessionResolution } from "../../shared/digging-session.ts";
import type { QueueItem } from "../../shared/api.ts";
import type { ReplayItem } from "../../shared/replay.ts";
import type { Db } from "../db/db.ts";
import { getVerdict } from "../db/verdicts.ts";
import { wantlistKeys } from "../importers/seeds.ts";
import { buildFilterWhere, queueItemForRelease } from "./query.ts";

export function resolveSession(db: Db, session: SavedSession): SessionResolution {
  const state = session.state;
  const cursor = state.queueBeforeRound ?? state;
  const where = buildFilterWhere(session.config.filters, { scope: state.scope });
  const eligible = db.prepare(`SELECT 1 FROM releases r WHERE r.id = ? AND ${where.sql}`);
  const queued = (id: number): QueueItem | null =>
    eligible.get(id, ...where.params) ? queueItemForRelease(db, id) : null;
  const passed = cursor.passedIds.map(queued).filter((item) => item !== null);
  const current = cursor.currentId === null ? null : queued(cursor.currentId);
  const round = state.roundIds === null ? null : resolveRound(db, state.roundIds);
  let unavailable = cursor.passedIds.length - passed.length;
  if (cursor.currentId !== null && current === null) unavailable += 1;
  if (round) unavailable += state.roundIds!.length - round.length;
  return { session, current, passed, round, unavailable };
}

function resolveRound(db: Db, ids: number[]): ReplayItem[] {
  const onWantlist = wantlistKeys(db);
  const items: ReplayItem[] = [];
  for (const id of ids) {
    const release = queueItemForRelease(db, id);
    if (!release) continue;
    items.push({
      release,
      verdict: getVerdict(db, release.triageKey),
      onWantlist: onWantlist.has(release.triageKey),
    });
  }
  return items;
}
