import type { QueueItem } from "../../shared/api.ts";
import type { Filters, HiddenLabel, QueueStrategy } from "../../shared/config.ts";
import { formatSummary } from "../../shared/formats.ts";
import type { ScopeRef } from "../../shared/scope.ts";
import type { FormatRef, LabelRef } from "../../shared/types.ts";
import { rememberForCatalogue } from "../db/catalogue-memo.ts";
import type { Db } from "../db/db.ts";
import type { ReleaseRow } from "../db/releases.ts";
import { coverageIds, ON_COVERAGE } from "./coverage.ts";

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
  /** One label's, artist's or seller's records only. */
  scope?: ScopeRef | null;
  /** Keep releases that already have a verdict (used for universe counts). */
  includeDecided?: boolean;
  /** Triage keys left out of the answer, which the reader holds already. */
  exclude?: string[];
}

export interface SqlFragment {
  sql: string;
  params: unknown[];
}

type QueueRow = ReleaseRow & { video_count: number };

const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(", ");

export function buildFilterWhere(
  filters: Filters,
  opts: { includeDecided?: boolean; scope?: ScopeRef | null } = {},
): SqlFragment {
  const fragments = [
    { sql: "r.in_universe = 1", params: [] },
    scopeClause(opts.scope),
    styleClause(filters),
    yearClause(filters),
    formatClause(filters),
    descriptionClause(filters.includeDescriptions, "EXISTS"),
    descriptionClause(filters.excludeDescriptions, "NOT EXISTS"),
    countryClause(filters),
    labelClause(filters),
    opts.includeDecided ? null : { sql: undecidedClause(filters), params: [] },
    // Last: SQLite tests the cheaper conditions first.
    filters.skipWithoutVideos ? { sql: HAS_VIDEO, params: [] } : null,
  ].filter((fragment) => fragment !== null);
  return {
    sql: fragments.map((fragment) => fragment.sql).join("\n    AND "),
    params: fragments.flatMap((fragment) => fragment.params),
  };
}

const SHARES_TUNE = `EXISTS (SELECT 1 FROM tracks tr
           WHERE tr.release_id = r.id AND tr.heard_key = tp.heard_key AND tr.position <> '')`;

// What the player gets (releaseVideos): the release's own videos and attached links, and those of
// other pressings whose matched track is a tune of this release. CROSS JOIN keeps SQLite starting
// from the master's pressings; starting from a tune's heard key visits every release that has it.
const HAS_VIDEO = `(EXISTS (SELECT 1 FROM videos vf WHERE vf.release_id = r.id AND vf.embeddable = 1)
       OR EXISTS (SELECT 1 FROM user_videos uf WHERE uf.release_id = r.id)
       OR EXISTS (SELECT 1 FROM releases rp
         CROSS JOIN videos vp ON vp.release_id = rp.id AND vp.embeddable = 1
         CROSS JOIN tracks tp ON tp.release_id = rp.id AND tp.position = vp.matched_position
         WHERE rp.master_id = r.master_id AND rp.id <> r.id AND ${SHARES_TUNE})
       OR EXISTS (SELECT 1 FROM releases rp
         CROSS JOIN user_videos up ON up.release_id = rp.id
         CROSS JOIN tracks tp ON tp.release_id = rp.id AND tp.position = up.matched_position
         WHERE rp.master_id = r.master_id AND rp.id <> r.id AND ${SHARES_TUNE}))`;

/**
 * Records without a decision that the Discogs account does not hold. A release that left the
 * account outside Digga stays out too: the user has been through it.
 */
function undecidedClause(filters: Filters): string {
  const exclusion = filters.skipHistory ? "" : " AND v.status <> 'seen'";
  return `NOT EXISTS (SELECT 1 FROM verdicts v WHERE v.key = r.triage_key${exclusion})
    AND NOT EXISTS (SELECT 1 FROM releases mr JOIN memberships m ON m.release_id = mr.id
      WHERE mr.triage_key = r.triage_key)`;
}

// A scope is IN, not a correlated EXISTS, so SQLite starts from the scope's releases instead of
// testing every release in the universe.
const ON_LABEL = `r.id IN (SELECT sc.release_id FROM release_credits sc
       WHERE sc.kind = 'label' AND sc.credit_id = ?)`;

// Compilations credit their artists on the tracks, which release_credits includes.
const BY_ARTIST = `r.id IN (SELECT sc.release_id FROM release_credits sc
       WHERE sc.kind = 'artist' AND sc.credit_id = ?)`;

const FOR_SALE = `r.id IN (SELECT ss.release_id FROM seller_releases ss WHERE ss.seller_id = ?)`;

/**
 * Releases on the label, any of their labels; by the artist, on the release or a track; for
 * sale in the seller's shop when Digga last read it; or brought into the universe by the load.
 */
function scopeClause(scope: ScopeRef | null | undefined): SqlFragment | null {
  if (!scope) return null;
  switch (scope.kind) {
    case "label":
      return { sql: ON_LABEL, params: [scope.id] };
    case "artist":
      return { sql: BY_ARTIST, params: [scope.id] };
    case "seller":
      return { sql: FOR_SALE, params: [scope.id] };
    case "load":
      return { sql: "r.added_by_load = ?", params: [scope.id] };
  }
}

function styleClause(filters: Filters): SqlFragment | null {
  if (filters.styles === null) return null;
  if (filters.styles.length === 0) return { sql: "0", params: [] };
  return {
    sql: `EXISTS (SELECT 1 FROM json_each(r.styles_json) WHERE json_each.value IN (${placeholders(filters.styles.length)}))`,
    params: filters.styles,
  };
}

function yearClause(filters: Filters): SqlFragment {
  const parts: string[] = ["r.year IS NOT NULL"];
  const params: unknown[] = [];
  if (filters.yearFrom !== null) {
    parts.push("r.year >= ?");
    params.push(filters.yearFrom);
  }
  if (filters.yearTo !== null) {
    parts.push("r.year <= ?");
    params.push(filters.yearTo);
  }
  const known = `(${parts.join(" AND ")})`;
  if (filters.includeUnknownYear) return { sql: `(${known} OR r.year IS NULL)`, params };
  if (filters.includeUnknownYearOnCoverage)
    return { sql: `(${known} OR (r.year IS NULL AND ${ON_COVERAGE}))`, params };
  return { sql: known, params };
}

function formatClause(filters: Filters): SqlFragment | null {
  if (filters.formats.length === 0) return null;
  return {
    sql: `EXISTS (SELECT 1 FROM json_each(r.formats_json) WHERE json_extract(json_each.value, '$.name') IN (${placeholders(filters.formats.length)}))`,
    params: filters.formats,
  };
}

/** A release with (EXISTS) or without (NOT EXISTS) one of these format descriptions. */
function descriptionClause(
  descriptions: string[],
  test: "EXISTS" | "NOT EXISTS",
): SqlFragment | null {
  if (descriptions.length === 0) return null;
  return {
    sql: `${test} (SELECT 1 FROM json_each(r.formats_json) fd, json_each(fd.value, '$.descriptions') dd
      WHERE dd.value IN (${placeholders(descriptions.length)}))`,
    params: descriptions,
  };
}

function countryClause(filters: Filters): SqlFragment | null {
  if (filters.countries.length === 0) return null;
  return {
    sql: `r.country IN (${placeholders(filters.countries.length)})`,
    params: filters.countries,
  };
}

/**
 * Leaves out records whose first label, the one the sweep orders by, is hidden: by its Discogs id,
 * or by its name, ignoring case, for an entry without an id. Hidden Not On Label also leaves out
 * the self-release variants, "Not On Label (Artist Self-released)", which have ids of their own.
 */
function labelClause(filters: Filters): SqlFragment | null {
  const labels = filters.excludeLabels;
  if (labels.length === 0) return null;
  const ids = labels.map((label) => label.id).filter((id) => id !== null);
  const names = labels.filter((label) => label.id === null).map((label) => label.name);
  const hidden = [
    inList("json_extract(r.labels_json, '$[0].id')", ids),
    inList("r.label_name COLLATE NOCASE", names),
    labels.some(isNotOnLabel) ? { sql: SELF_RELEASE_VARIANT, params: [] } : null,
  ].filter((fragment) => fragment !== null);
  // A missing first label or id makes a comparison NULL, which does not hide the release.
  return {
    sql: `(${hidden.map((fragment) => fragment.sql).join(" OR ")}) IS NOT TRUE`,
    params: hidden.flatMap((fragment) => fragment.params),
  };
}

// LIKE ignores ASCII case, as the name match does.
const SELF_RELEASE_VARIANT = "r.label_name LIKE 'Not On Label (%'";

const isNotOnLabel = (label: HiddenLabel) => label.name.toLowerCase() === "not on label";

function inList(expression: string, values: unknown[]): SqlFragment | null {
  if (values.length === 0) return null;
  return { sql: `${expression} IN (${placeholders(values.length)})`, params: values };
}

export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function orderClause(strategy: QueueStrategy, seed: number): SqlFragment {
  switch (strategy) {
    case "label_sweep":
      return {
        sql: "label_name COLLATE NOCASE ASC NULLS LAST, catno COLLATE NOCASE ASC NULLS LAST, id ASC",
        params: [],
      };
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
      // Mix the seed before hashing; adding it afterward only rotates a fixed order.
      // SQLite has no XOR operator: (id | seed) - (id & seed) computes it.
      return {
        sql: "((((id | ?) - (id & ?)) * 2654435761) % 4294967296) ASC, id ASC",
        params: [seed, seed],
      };
  }
}

// Prefer standard vinyl within the already-filtered candidates. A white label or test pressing
// still represents a master when it is the only matching release (including in a seller scope).
const SPECIAL_PRESSING = `EXISTS (SELECT 1 FROM json_each(r.formats_json) pf,
  json_each(pf.value, '$.descriptions') pd
  WHERE json_extract(pf.value, '$.name') = 'Vinyl' AND pd.value IN ('White Label', 'Test Pressing'))`;
const REPRESENTATIVE_ORDER = "special_pressing ASC, is_main_release DESC, video_count DESC, id ASC";

const RANKING_COLUMNS = `(SELECT COUNT(*) FROM videos vd WHERE vd.release_id = r.id) AS video_count,
    ${SPECIAL_PRESSING} AS special_pressing`;

const BASE_SELECT = `
  SELECT r.*, ${RANKING_COLUMNS}
  FROM releases r
  WHERE `;

// What ranking and every strategy's order read, for the remembered queue order.
const ORDER_SELECT = `
  SELECT r.id, r.triage_key, r.label_name, r.catno, r.country, r.year, r.is_main_release,
    ${RANKING_COLUMNS}
  FROM releases r
  WHERE `;

const RANKED = `
ranked AS (
  SELECT base.*, ROW_NUMBER() OVER (
    PARTITION BY triage_key ORDER BY ${REPRESENTATIVE_ORDER}
  ) AS rn
  FROM base
)`;

export function buildQueueSql(query: QueueParams): SqlFragment {
  const where = buildFilterWhere(query.filters, {
    includeDecided: query.includeDecided,
    scope: query.scope,
  });
  const order = orderClause(query.strategy, query.seed ?? 0);
  const sql = `WITH base AS (${BASE_SELECT}${where.sql}
), ${RANKED}
SELECT * FROM ranked
WHERE rn = 1 AND triage_key NOT IN (SELECT value FROM json_each(?))
ORDER BY ${order.sql}
LIMIT ? OFFSET ?`;
  return {
    sql,
    params: [
      ...where.params,
      JSON.stringify(query.exclude ?? []),
      ...order.params,
      query.limit,
      query.offset ?? 0,
    ],
  };
}

export function rowToQueueItem(row: QueueRow): QueueItem {
  const labels = JSON.parse(row.labels_json) as LabelRef[];
  return {
    id: row.id,
    triageKey: row.triage_key,
    masterId: row.master_id,
    title: row.title,
    artistDisplay: row.artist_display,
    labelId: labels[0]?.id ?? null,
    labelName: row.label_name,
    catno: row.catno,
    year: row.year,
    country: row.country,
    formatSummary: formatSummary(JSON.parse(row.formats_json) as FormatRef[]),
    styles: JSON.parse(row.styles_json) as string[],
    videoCount: row.video_count,
    communityWant: row.community_want,
    communityHave: row.community_have,
    ratingAverage: row.rating_average,
    ratingCount: row.rating_count,
    numForSale: row.num_for_sale,
    lowestPrice: row.lowest_price,
    currency: row.currency,
    enrichedAt: row.enriched_at,
  };
}

/**
 * Without a scope, the queue reads the records the filters keep in the strategy's order, which
 * stay remembered until the catalogue changes, and leaves out those decided since.
 */
export function queryQueue(db: Db, query: QueueParams): QueueItem[] {
  if (query.scope) return queryScopedQueue(db, query);
  const skipped = new Set(query.exclude ?? []);
  if (!query.includeDecided) for (const key of decidedKeys(db, query.filters)) skipped.add(key);

  const records = queueOrder(db, query).filter((record) => !skipped.has(record.triage_key));
  const offset = query.offset ?? 0;
  const page = records.slice(offset, offset + query.limit);
  return queueItems(
    db,
    page.map((record) => record.id),
  );
}

/** A scope starts from its own releases, and picks each record's representative among them. */
function queryScopedQueue(db: Db, query: QueueParams): QueueItem[] {
  const { sql, params } = buildQueueSql(query);
  const rows = db.prepare(sql).all(...params) as QueueRow[];
  return rows.map(rowToQueueItem);
}

interface OrderedRecord {
  /** The record's representative. */
  id: number;
  triage_key: string;
}

/** Every record the filters keep, decided or not, by its representative in the strategy's order. */
function queueOrder(db: Db, query: QueueParams): OrderedRecord[] {
  const seed = query.seed ?? 0;
  const memoKey = catalogueKey(db, query.filters, ["queue order", query.strategy, seed]);
  return rememberForCatalogue(db, memoKey, () => {
    const where = buildFilterWhere(query.filters, { includeDecided: true });
    const order = orderClause(query.strategy, seed);
    const sql = `WITH base AS (${ORDER_SELECT}${where.sql}
), ${RANKED}
SELECT id, triage_key FROM ranked WHERE rn = 1 ORDER BY ${order.sql}`;
    return db.prepare(sql).all(...where.params, ...order.params) as OrderedRecord[];
  });
}

/**
 * Names a result of the filters for rememberForCatalogue(). Records of unknown year on the
 * coverage follow the wants and grails, so their labels and artists are part of the name.
 */
function catalogueKey(db: Db, filters: Filters, parts: unknown[]): string {
  const readsCoverage = !filters.includeUnknownYear && filters.includeUnknownYearOnCoverage;
  return JSON.stringify([...parts, filters, readsCoverage ? coverageIds(db) : null]);
}

/** The releases as queue items, in the order of `ids`. */
function queueItems(db: Db, ids: number[]): QueueItem[] {
  const rows = db
    .prepare(`${BASE_SELECT} r.id IN (SELECT value FROM json_each(?))`)
    .all(JSON.stringify(ids)) as QueueRow[];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const items: QueueItem[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (row) items.push(rowToQueueItem(row));
  }
  return items;
}

/** The keys undecidedClause() leaves out, for reading the remembered records. */
function decidedKeys(db: Db, filters: Filters): Set<string> {
  const keys = db
    .prepare(`SELECT v.key FROM verdicts v WHERE @every_verdict = 1 OR v.status <> 'seen'
      UNION SELECT mr.triage_key FROM memberships m JOIN releases mr ON mr.id = m.release_id`)
    .pluck()
    .all({ every_verdict: filters.skipHistory ? 1 : 0 }) as string[];
  return new Set(keys);
}

interface FilteredRelease {
  triage_key: string;
  added_by_load: number | null;
}

/** Every release the filters keep, decided or not; remembered until the catalogue changes. */
function filteredReleases(db: Db, filters: Filters): FilteredRelease[] {
  return rememberForCatalogue(db, catalogueKey(db, filters, ["filtered releases"]), () => {
    const where = buildFilterWhere(filters, { includeDecided: true });
    return db
      .prepare(`SELECT r.triage_key, r.added_by_load FROM releases r WHERE ${where.sql}`)
      .all(...where.params) as FilteredRelease[];
  });
}

/** Triage keys in the filtered universe, or in a scope of it, that still have no verdict. */
export function countRemaining(db: Db, filters: Filters, scope: ScopeRef | null = null): number {
  if (scope !== null && scope.kind !== "load") return countScopeRemaining(db, filters, scope);
  const decided = decidedKeys(db, filters);
  const keys = new Set<string>();
  for (const release of filteredReleases(db, filters)) {
    if (scope !== null && release.added_by_load !== scope.id) continue;
    if (!decided.has(release.triage_key)) keys.add(release.triage_key);
  }
  return keys.size;
}

function countScopeRemaining(db: Db, filters: Filters, scope: ScopeRef): number {
  const where = buildFilterWhere(filters, { includeDecided: false, scope });
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
    return rememberForCatalogue(db, "universe keys", () => {
      const row = db
        .prepare("SELECT COUNT(DISTINCT triage_key) AS n FROM releases WHERE in_universe = 1")
        .get() as { n: number };
      return row.n;
    });
  }
  const keys = new Set(filteredReleases(db, filters).map((release) => release.triage_key));
  return keys.size;
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

/** Standard vinyl first, then the main release and the one with most videos. */
export function representativeForKey(db: Db, key: string): QueueItem | null {
  const row = db
    .prepare(`${BASE_SELECT} r.triage_key = ? ORDER BY ${REPRESENTATIVE_ORDER} LIMIT 1`)
    .get(key) as QueueRow | undefined;
  return row ? rowToQueueItem(row) : null;
}
