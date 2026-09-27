import type { Stats } from "../shared/api.ts";
import type { Config } from "../shared/config.ts";
import { type Db, getMeta } from "./db/db.ts";
import { countHeardTracks, countVerdictsByStatus, triageDecisionTimes } from "./db/verdicts.ts";
import { countRemaining, countUniverseKeys, countUniverseReleases } from "./queue/query.ts";

export interface Session {
  start: number;
  end: number;
  count: number;
}

/** Splits decision timestamps into sessions separated by gaps longer than gapMinutes. */
export function sessionsFromTimes(times: string[], gapMinutes = 30): Session[] {
  const sessions: Session[] = [];
  const gap = gapMinutes * 60_000;
  for (const t of times) {
    const ms = Date.parse(t);
    if (Number.isNaN(ms)) continue;
    const current = sessions[sessions.length - 1];
    if (current && ms - current.end <= gap) {
      current.end = Math.max(current.end, ms);
      current.count += 1;
    } else {
      sessions.push({ start: ms, end: ms, count: 1 });
    }
  }
  return sessions;
}

/** Verdicts per hour over the last N sessions; a session shorter than a minute counts as one minute. */
export function verdictsPerHour(
  sessions: Session[],
  lastN = 5,
): { rate: number | null; sessions: number } {
  const recent = sessions.slice(-lastN);
  const count = recent.reduce((acc, s) => acc + s.count, 0);
  const hours = recent.reduce((acc, s) => acc + Math.max(s.end - s.start, 60_000), 0) / 3_600_000;
  if (count < 2 || hours <= 0) return { rate: null, sessions: recent.length };
  return { rate: count / hours, sessions: recent.length };
}

export function computeStats(db: Db, config: Config): Stats {
  const remaining = countRemaining(db, config.filters);
  const { rate, sessions } = verdictsPerHour(sessionsFromTimes(triageDecisionTimes(db)));
  return {
    universe: {
      releases: countUniverseReleases(db),
      keys: countUniverseKeys(db, null),
      filteredKeys: countUniverseKeys(db, config.filters),
    },
    verdicts: countVerdictsByStatus(db),
    remaining,
    rate: {
      verdictsPerHour: rate === null ? null : Math.round(rate * 10) / 10,
      sessions,
      etaHours: rate === null ? null : Math.round((remaining / rate) * 10) / 10,
    },
    dump: {
      date: getMeta(db, "dump_date") ?? null,
      loadedAt: getMeta(db, "dump_loaded_at") ?? null,
    },
    heardTracks: countHeardTracks(db),
  };
}
