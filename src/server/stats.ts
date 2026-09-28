import type { Stats } from "../shared/api.ts";
import type { Config } from "../shared/config.ts";
import { rateSummary } from "../shared/rate.ts";
import { type Db, getMeta } from "./db/db.ts";
import {
  countDug,
  countHeardTracks,
  countVerdictsByStatus,
  triageDecisionTimes,
} from "./db/verdicts.ts";
import {
  countEnrichedRemaining,
  countRemaining,
  countUniverseKeys,
  countUniverseReleases,
} from "./queue/query.ts";

export function computeStats(db: Db, config: Config): Stats {
  const remaining = countRemaining(db, config.filters);
  return {
    dug: countDug(db),
    universe: {
      releases: countUniverseReleases(db),
      keys: countUniverseKeys(db, null),
      filteredKeys: countUniverseKeys(db, config.filters),
    },
    verdicts: countVerdictsByStatus(db),
    remaining,
    remainingEnriched: countEnrichedRemaining(db, config.filters),
    rate: rateSummary(triageDecisionTimes(db), remaining),
    dump: {
      date: getMeta(db, "dump_date") ?? null,
      loadedAt: getMeta(db, "dump_loaded_at") ?? null,
    },
    heardTracks: countHeardTracks(db),
  };
}
