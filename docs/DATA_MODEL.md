# Data model

SQLite, WAL mode, one file at `data/digga.sqlite`. Migrations are numbered `.sql` files in
`src/server/db/migrations/` applied at startup; `meta.schema_version` records the last one applied.
JSON columns hold arrays of small objects and are filtered with `json_each`; the universe is tens
of thousands of rows, so no junction tables are needed.

## releases

One row per Discogs release in the universe, plus stub rows for seed releases outside it.

| column                                                                                        | notes                                                                         |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `id`                                                                                          | Discogs release id (PK)                                                       |
| `master_id`                                                                                   | nullable                                                                      |
| `is_main_release`                                                                             | 0/1, from `<master_id is_main_release>`                                       |
| `title`                                                                                       |                                                                               |
| `artists_json`                                                                                | `ArtistRef[]`: `{ id, name, anv, join }`                                      |
| `artist_display`                                                                              | "Ed Rush & Optical Feat. Ryme Tyme", anv preferred, `(n)` suffixes stripped   |
| `labels_json`                                                                                 | `LabelRef[]`: `{ id, name, catno }`                                           |
| `label_name`, `catno`                                                                         | first label, denormalised for the label sweep order and index                 |
| `year`                                                                                        | nullable int parsed from `released`                                           |
| `released_raw`                                                                                | `YYYY`, `YYYY-MM-DD`, `YYYY-00-00` or null                                    |
| `country`                                                                                     | nullable                                                                      |
| `formats_json`                                                                                | `FormatRef[]`: `{ name, qty, text, descriptions[] }`                          |
| `is_vinyl`                                                                                    | derived: any format named `Vinyl`                                             |
| `genres_json`, `styles_json`                                                                  | string arrays                                                                 |
| `in_universe`                                                                                 | 1 when loaded from the dump, 0 for stubs created from seeds                   |
| `triage_key`                                                                                  | `m:{master_id}` or `r:{id}`, computed by `triageKeyFor()` in application code |
| `lowest_price`, `num_for_sale`, `currency`, `community_have`, `community_want`, `enriched_at` | API snapshot from `enrich`                                                    |
| `updated_at`                                                                                  | ISO timestamp of the last dump/stub write                                     |

Indexes: `triage_key`, `master_id`, `(label_name, catno)` NOCASE, `year`, `country`, `in_universe`.

A dump reload replaces the release columns, tracks and videos and keeps the snapshot columns. A stub
insert never overwrites an existing row.

## tracks

| column                           | notes                                                       |
| -------------------------------- | ----------------------------------------------------------- |
| `release_id`, `seq`              | PK; `seq` is the tracklist index (sub-tracks flattened)     |
| `position`                       | `A1`, `B`, `1`, or empty for headings                       |
| `title`                          |                                                             |
| `artists_json`, `artist_display` | track credits, falling back to the release artist           |
| `duration_seconds`               | nullable                                                    |
| `heard_key`                      | normalized `artist - title` (see `src/shared/normalize.ts`) |

## videos

| column                                    | notes                                                            |
| ----------------------------------------- | ---------------------------------------------------------------- |
| `release_id`, `video_id`                  | PK; `video_id` is the 11-char YouTube id parsed from `src`       |
| `src`                                     | original URL                                                     |
| `title`, `duration_seconds`, `embeddable` | from the dump or the API                                         |
| `matched_position`                        | track position guessed by `src/shared/match-videos.ts`, nullable |

Non-YouTube videos are dropped at load time.

## verdicts

| column       | notes                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| `key`        | PK, triage key                                                                                        |
| `status`     | `collection`, `wantlist`, `seen`, `rejected`, `accepted`, `maybe`, `candidate`, `no_audio`, `snoozed` |
| `source`     | `seed:collection`, `seed:wantlist`, `seed:history`, `seed:list`, `triage`, `manual`                   |
| `notes`      | nullable                                                                                              |
| `release_id` | the release that was on screen or imported, nullable for master-only history hits                     |
| `decided_at` | ISO; seeds use Discogs `date_added` or the last browser visit                                         |

Seed precedence (`applySeedVerdict`, ranks in `src/shared/verdict-rank.ts`): collection (3) >
wantlist (2) > `accepted` or `candidate` from triage (1.6) > the Discogs Maybe list, `maybe` from
`seed:list` (1.55) > other triage/manual decisions (1.5) > seen (1). A seed never downgrades a
higher rank. `maybe` means the release belongs on the Discogs Maybe list: from `triage` it is not
there yet, from `seed:list` it is. `snoozed` is "hear it again later": a round of snoozed records
in Triage replaces it with the new verdict, and undo there restores the snooze with its original
`decided_at` (`POST /api/verdicts` accepts `decidedAt` for that). The "dug" count is every verdict
with source `triage` or `manual`.

## track_verdicts

`(release_id, position)` PK, `mark` in `keep | meh | candidate`, `notes`, `decided_at`. A write
without `notes` keeps the saved note, and `decided_at` changes only when the mark does.
`GET /api/track-marks` lists them for the Twelves Tracks shelf.

## heard_tracks

`heard_key` PK, `first_release_id`, `seconds_listened` (accumulated), `first_heard_at`,
`last_heard_at`. Updated by `POST /api/listen-log` when the position maps to a track.

## listen_log

Append-only proof of coverage: `id`, `release_id`, `position` (nullable), `video_id`, `seconds`, `at`.

## seed_items

Raw Discogs seed rows: `(kind, release_id)` PK with `kind` in `collection | wantlist`, `master_id`,
`date_added`, `rating`, `notes`, `basic_information_json`, `imported_at`. A want Digga pushes to
the Discogs wantlist is recorded here too (with `basic_information_json` built from the release
row), and removed when Digga takes it off, so `TwelvesItem.onWantlist` can say which wants reached
Discogs before the next wantlist import. The push leaves the `accepted` verdict as it is; the next
wantlist import turns it into a `wantlist` seed by rank.

## jobs

`id` (uuid), `type` (`dump_load`, `import_collection`, `import_wantlist`, `import_history`,
`import_list`, `enrich`, `enrich_twelves`),
`status` (`queued`, `running`, `done`, `failed`, `cancelled`), `progress_json`, `error`, `created_at`,
`started_at`, `finished_at`. Jobs still `running` when the server starts are marked `failed`
with error `interrupted`.

## meta

Key/value: `schema_version`, `dump_date` (from the dump file name), `dump_file`, `dump_loaded_at`.
