import type { Stats } from "../shared/api.ts";
import type { Config } from "../shared/config.ts";
import type { ScopeRef } from "../shared/scope.ts";
import { rateSummary } from "../shared/rate.ts";
import { type Db, getMeta } from "./db/db.ts";
import { latestDumpLoad } from "./db/dump-loads.ts";
import { countMemberships } from "./db/memberships.ts";
import {
  countDug,
  countHeardTracks,
  countVerdictsByStatus,
  triageDecisionTimes,
} from "./db/verdicts.ts";
import { countRemaining, countUniverseKeys, countUniverseReleases } from "./queue/query.ts";

/** The counters; with a scope, also the records left to dig in it. */
export function computeStats(db: Db, config: Config, scope: ScopeRef | null = null): Stats {
  const remaining = countRemaining(db, config.filters);
  return {
    dug: countDug(db),
    universe: {
      releases: countUniverseReleases(db),
      keys: countUniverseKeys(db, null),
      filteredKeys: countUniverseKeys(db, config.filters),
    },
    verdicts: countVerdictsByStatus(db),
    discogs: countMemberships(db),
    remaining,
    scopeRemaining: scope ? countRemaining(db, config.filters, scope) : null,
    rate: rateSummary(triageDecisionTimes(db), remaining),
    dump: {
      date: getMeta(db, "dump_date") ?? null,
      loadedAt: getMeta(db, "dump_loaded_at") ?? null,
      lastLoad: lastLoadSummary(db, config),
    },
    heardTracks: countHeardTracks(db),
  };
}

/** The newest finished load, and how many of the records it added are still to dig. */
function lastLoadSummary(db: Db, config: Config): Stats["dump"]["lastLoad"] {
  const load = latestDumpLoad(db);
  if (!load) return null;
  return { ...load, toDig: countRemaining(db, config.filters, { kind: "load", id: load.id }) };
}
