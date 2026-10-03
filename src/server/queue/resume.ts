import type { QueueItem } from "../../shared/api.ts";
import type { SavedSession, SessionResolution } from "../../shared/digging-session.ts";
import type { ReplayItem } from "../../shared/replay.ts";
import type { Db } from "../db/db.ts";
import { getVerdict } from "../db/verdicts.ts";
import { wantlistKeys } from "../importers/seeds.ts";
import { buildFilterWhere, queueItemForRelease } from "./query.ts";

/**
 * The records a saved session pointed at, as they are now. The current and passed records come
 * back only while the session's filters and scope still queue them; `unavailable` counts the
 * saved records that did not come back.
 */
export function resolveSession(db: Db, session: SavedSession): SessionResolution {
  const { state } = session;
  // During a round, the queue position is the one saved before the round started.
  const cursor = state.queueBeforeRound ?? state;
  const queued = queuedRelease(db, session);

  const current = cursor.currentId === null ? null : queued(cursor.currentId);
  const passed = cursor.passedIds.map(queued).filter((item) => item !== null);
  const round = state.roundIds === null ? null : resolveRound(db, state.roundIds);

  const savedCount =
    (cursor.currentId === null ? 0 : 1) + cursor.passedIds.length + (state.roundIds?.length ?? 0);
  const foundCount = (current === null ? 0 : 1) + passed.length + (round?.length ?? 0);
  return { session, current, passed, round, unavailable: savedCount - foundCount };
}

/** Looks up a release as a queue item while the session's filters and scope still select it. */
function queuedRelease(db: Db, session: SavedSession): (id: number) => QueueItem | null {
  const where = buildFilterWhere(session.config.filters, { scope: session.state.scope });
  const eligible = db.prepare(`SELECT 1 FROM releases r WHERE r.id = ? AND ${where.sql}`);
  return (id) => (eligible.get(id, ...where.params) ? queueItemForRelease(db, id) : null);
}

/** Round records come back whatever their verdict, as Twelves hands them over. */
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
