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

export function buildQueueSql(p: QueueParams): SqlFragment {
  const where = buildFilterWhere(p.filters, {
    includeDecided: p.includeDecided,
  });
  const order = orderClause(p.strategy, p.seed ?? 0);
  // "Unenriched" applies to the representative release, not to every pressing of a master.
  const outer = p.unenrichedOnly ? "rn = 1 AND enriched_at IS NULL" : "rn = 1";
  const sql = `WITH base AS (${BASE_SELECT}${where.sql}
), ${RANKED}
SELECT * FROM ranked WHERE ${outer}
ORDER BY ${order.sql}
LIMIT ?`;
  return { sql, params: [...where.params, ...order.params, p.limit] };
}

export function rowToQueueItem(r: QueueRow): QueueItem {
  return {
    id: r.id,
    triageKey: r.triage_key,
    masterId: r.master_id,
    title: r.title,
    artistDisplay: r.artist_display,
    labelName: r.label_name,
    catno: r.catno,
    year: r.year,
    country: r.country,
    formatSummary: formatSummary(JSON.parse(r.formats_json) as FormatRef[]),
    styles: JSON.parse(r.styles_json) as string[],
    videoCount: r.video_count,
    communityWant: r.community_want,
    communityHave: r.community_have,
    numForSale: r.num_for_sale,
    lowestPrice: r.lowest_price,
    currency: r.currency,
    enrichedAt: r.enriched_at,
  };
}

export function queryQueue(db: Db, p: QueueParams): QueueItem[] {
  const { sql, params } = buildQueueSql(p);
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
