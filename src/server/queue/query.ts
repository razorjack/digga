import type { QueueItem } from "../../shared/api.ts";
import type { Filters, QueueStrategy } from "../../shared/config.ts";
import { formatSummary } from "../../shared/formats.ts";
import type { FormatRef } from "../../shared/types.ts";
import type { Db } from "../db/db.ts";
import type { ReleaseRow } from "../db/releases.ts";

/**
 * The queue is a query, not a table: releases grouped by triage key, without a verdict,
 * filtered at query time, ordered by strategy, limited. Nothing here is style-specific.
 */

export interface QueueParams {
  filters: Filters;
  strategy: QueueStrategy;
  limit: number;
  offset?: number;
  seed?: number | null;
  /** Only releases enrich has not touched yet (used by the enrich job). */
  unenrichedOnly?: boolean;
  /** Keep releases that already have a verdict (used for universe counts). */
  includeDecided?: boolean;
}

export interface SqlFragment {
  sql: string;
  params: unknown[];
}

type QueueRow = ReleaseRow & { video_count: number };

const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(", ");

export function buildFilterWhere(
  filters: Filters,
  opts: { includeDecided?: boolean } = {},
): SqlFragment {
  const clauses: string[] = ["r.in_universe = 1"];
  const params: unknown[] = [];
  if (filters.styles && filters.styles.length > 0) {
    clauses.push(
      `EXISTS (SELECT 1 FROM json_each(r.styles_json) WHERE json_each.value IN (${placeholders(filters.styles.length)}))`,
    );
    params.push(...filters.styles);
  }
  const yearParts: string[] = ["r.year IS NOT NULL"];
  if (filters.yearFrom !== null) {
    yearParts.push("r.year >= ?");
    params.push(filters.yearFrom);
  }
  if (filters.yearTo !== null) {
    yearParts.push("r.year <= ?");
    params.push(filters.yearTo);
  }
  const known = `(${yearParts.join(" AND ")})`;
  clauses.push(filters.includeUnknownYear ? `(${known} OR r.year IS NULL)` : known);
  if (filters.formats.length > 0) {
    clauses.push(
      `EXISTS (SELECT 1 FROM json_each(r.formats_json) WHERE json_extract(json_each.value, '$.name') IN (${placeholders(filters.formats.length)}))`,
    );
    params.push(...filters.formats);
  }
  if (filters.countries.length > 0) {
    clauses.push(`r.country IN (${placeholders(filters.countries.length)})`);
    params.push(...filters.countries);
  }
  // A record plays videos of every pressing of its master, so any of them counts.
  if (filters.skipWithoutVideos)
    clauses.push(
      `(EXISTS (SELECT 1 FROM videos vf JOIN releases rv ON rv.id = vf.release_id
         WHERE rv.triage_key = r.triage_key AND vf.embeddable = 1)
       OR EXISTS (SELECT 1 FROM user_videos uf JOIN releases ru ON ru.id = uf.release_id
         WHERE ru.triage_key = r.triage_key))`,
    );
  if (!opts.includeDecided)
    clauses.push("NOT EXISTS (SELECT 1 FROM verdicts v WHERE v.key = r.triage_key)");
  return { sql: clauses.join("\n    AND "), params };
}

export function orderClause(strategy: QueueStrategy, seed: number): SqlFragment {
  switch (strategy) {
    case "label_sweep":
      return {
        sql: "label_name COLLATE NOCASE ASC NULLS LAST, catno COLLATE NOCASE ASC NULLS LAST, id ASC",
        params: [],
      };
    case "popular":
      return { sql: "community_want DESC NULLS LAST, id ASC", params: [] };
    case "country":
      return {
        sql: "country ASC NULLS LAST, label_name COLLATE NOCASE ASC, catno COLLATE NOCASE ASC, id ASC",
        params: [],
      };
    case "year":
      return {
        sql: "year ASC NULLS LAST, label_name COLLATE NOCASE ASC, catno COLLATE NOCASE ASC, id ASC",
        params: [],
      };
    case "random":
      // Deterministic shuffle: same seed, same order, so a session can be resumed.
      return { sql: "((id * 2654435761 + ?) % 4294967296) ASC, id ASC", params: [seed] };
  }
}

const BASE_SELECT = `
  SELECT r.*, (SELECT COUNT(*) FROM videos vd WHERE vd.release_id = r.id) AS video_count
  FROM releases r
  WHERE `;

const RANKED = `
ranked AS (
  SELECT base.*, ROW_NUMBER() OVER (
    PARTITION BY triage_key ORDER BY is_main_release DESC, video_count DESC, id ASC
  ) AS rn
  FROM base
)`;

export function buildQueueSql(query: QueueParams): SqlFragment {
  const where = buildFilterWhere(query.filters, {
    includeDecided: query.includeDecided,
  });
  const order = orderClause(query.strategy, query.seed ?? 0);
  // "Unenriched" applies to the representative release, not to every pressing of a master.
  const outer = query.unenrichedOnly ? "rn = 1 AND enriched_at IS NULL" : "rn = 1";
  const sql = `WITH base AS (${BASE_SELECT}${where.sql}
), ${RANKED}
SELECT * FROM ranked WHERE ${outer}
ORDER BY ${order.sql}
LIMIT ? OFFSET ?`;
  return { sql, params: [...where.params, ...order.params, query.limit, query.offset ?? 0] };
}

export function rowToQueueItem(row: QueueRow): QueueItem {
  return {
    id: row.id,
    triageKey: row.triage_key,
    masterId: row.master_id,
    title: row.title,
    artistDisplay: row.artist_display,
    labelName: row.label_name,
    catno: row.catno,
    year: row.year,
    country: row.country,
    formatSummary: formatSummary(JSON.parse(row.formats_json) as FormatRef[]),
    styles: JSON.parse(row.styles_json) as string[],
    videoCount: row.video_count,
    communityWant: row.community_want,
    communityHave: row.community_have,
    numForSale: row.num_for_sale,
    lowestPrice: row.lowest_price,
    currency: row.currency,
    enrichedAt: row.enriched_at,
  };
}

export function queryQueue(db: Db, query: QueueParams): QueueItem[] {
  const { sql, params } = buildQueueSql(query);
  const rows = db.prepare(sql).all(...params) as QueueRow[];
  return rows.map(rowToQueueItem);
}

/** Triage keys in the filtered universe that still have no verdict. */
export function countRemaining(db: Db, filters: Filters): number {
  const where = buildFilterWhere(filters, { includeDecided: false });
  const row = db
    .prepare(`SELECT COUNT(DISTINCT r.triage_key) AS n FROM releases r WHERE ${where.sql}`)
    .get(...where.params) as {
    n: number;
  };
  return row.n;
}

/** Records still to dig whose representative release has market data from enrich. */
export function countEnrichedRemaining(db: Db, filters: Filters): number {
  const where = buildFilterWhere(filters, { includeDecided: false });
  const row = db
    .prepare(
      `WITH base AS (${BASE_SELECT}${where.sql}
), ${RANKED}
SELECT COUNT(*) AS n FROM ranked WHERE rn = 1 AND enriched_at IS NOT NULL`,
    )
    .get(...where.params) as { n: number };
  return row.n;
}

/** Triage keys in the universe, optionally after the query-time filters. */
export function countUniverseKeys(db: Db, filters: Filters | null): number {
  if (filters === null) {
    return (
      db
        .prepare("SELECT COUNT(DISTINCT triage_key) AS n FROM releases WHERE in_universe = 1")
        .get() as { n: number }
    ).n;
  }
  const where = buildFilterWhere(filters, { includeDecided: true });
  const row = db
    .prepare(`SELECT COUNT(DISTINCT r.triage_key) AS n FROM releases r WHERE ${where.sql}`)
    .get(...where.params) as {
    n: number;
  };
  return row.n;
}

export function countUniverseReleases(db: Db): number {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM releases WHERE in_universe = 1").get() as { n: number }
  ).n;
}

export function queueItemForRelease(db: Db, releaseId: number): QueueItem | null {
  const row = db.prepare(`${BASE_SELECT} r.id = ?`).get(releaseId) as QueueRow | undefined;
  return row ? rowToQueueItem(row) : null;
}

/** The release shown for a triage key: main release first, then the one with most videos. */
export function representativeForKey(db: Db, key: string): QueueItem | null {
  const row = db
    .prepare(
      `${BASE_SELECT} r.triage_key = ? ORDER BY r.is_main_release DESC, video_count DESC, r.id ASC LIMIT 1`,
    )
    .get(key) as QueueRow | undefined;
  return row ? rowToQueueItem(row) : null;
}
