# Data model

SQLite, WAL mode, one file: `digga.sqlite` in the library folder (`paths.dbFile`). Migrations are numbered `.sql` files in
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
| `lowest_price`, `num_for_sale`, `currency`, `community_have`, `community_want`, `enriched_at` | API snapshot, fetched when `P` in Triage asks for it                          |
| `updated_at`                                                                                  | ISO timestamp of the last dump/stub write                                     |
| `added_by_load`                                                                               | `dump_loads.id` of the load that brought it into the universe; null for stubs |
| `written_by_load`                                                                             | `dump_loads.id` of the newest load that wrote it; null for stubs              |

Indexes: `triage_key`, `master_id`, `(label_name, catno)` NOCASE, `year`, `country`, `in_universe`,
`added_by_load`.

A dump reload replaces the release columns, tracks and videos and keeps the snapshot columns. A stub
insert never overwrites an existing row. When a reload changes a release's `triage_key`, because
Discogs gave it a master, moved it to another or took it off one, the verdicts given on that
release move to the new key in the same transaction (see `verdicts`).

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

## user_videos

YouTube videos the user attached by pasting a link: `(release_id, video_id)` PK, `src`, `title`
(from YouTube's oEmbed, empty when it gave none), `matched_position`, `added_at`. Dump loads and
enrich replace `videos` per release and never touch this table; release details add these videos
after the ones from Discogs.

## no_audio_videos

`key` PK, `video_ids_json`: the embeddable video ids the player had for the release (its own,
attached and pooled from other pressings) when the record was marked `no_audio`. Migration 2
fills it for earlier `no_audio` verdicts, and a verdict without a row counts its current videos
as known. After a dump load, an enrich or an attached
link, a `no_audio` record with a playable video outside this list loses its verdict and is back
in the queue (`requeueNoAudio()` in `src/server/db/no-audio.ts`).

## verdicts

| column       | notes                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| `key`        | PK, triage key                                                                                        |
| `status`     | `collection`, `wantlist`, `seen`, `rejected`, `accepted`, `maybe`, `candidate`, `no_audio`, `snoozed` |
| `source`     | `seed:collection`, `seed:wantlist`, `seed:history`, `seed:list`, `triage`, `manual`                   |
| `notes`      | nullable                                                                                              |
| `release_id` | the release that was on screen or imported, nullable for master-only history hits                     |
| `decided_at` | ISO; seeds use Discogs `date_added` or the last browser visit                                         |
| `dug_at`     | when the record was last judged in Digga; a seed that replaces the verdict keeps it, null if never    |

Seed precedence (`applySeedVerdict`, ranks in `src/shared/verdict-rank.ts`): collection (3) >
`candidate` (grail, 2.5) > wantlist (2) > `accepted` from triage (1.6) > the Discogs Maybe list,
`maybe` from `seed:list` (1.55) > other triage/manual decisions (1.5) > seen (1). A seed never
downgrades a higher rank. A grail is on the wantlist too, so the wantlist import leaves it a grail. `maybe` means the release belongs on the Discogs Maybe list: from `triage` it is not
there yet, from `seed:list` it is. `snoozed` is "hear it again later": a round of snoozed records
in Triage replaces it with the new verdict, and undo there restores the snooze with its original
`decided_at` (`POST /api/verdicts` accepts `decidedAt` for that). The "dug" count is every verdict
with a `dug_at`, and the rate reads those times (`dugAtAfter()` in `src/shared/verdict-rank.ts`):
a `triage` or `manual` write sets `dug_at` to its `decided_at`, a seed keeps the record's, and undo
in Twelves restores the one it had (`dugAt`).

A verdict follows the release it was given on (`release_id`, indexed): a dump load that changes the
release's key moves the verdict, and the videos of a no-audio record, to the new key
(`moveVerdictsToReleaseKeys()` in `src/server/db/verdict-keys.ts`). When the new key has a verdict,
the higher rank stays, then the newer decision (`preferredVerdict()`); the notes of both are kept
and the later `dug_at`. `digga restore` puts each verdict on the key its release has in the library
it restores into. A verdict without a `release_id` stays on its key.

## track_verdicts

`(release_id, position)` PK, `mark` in `keep | meh | candidate`, `notes`, `decided_at`. A write
without `notes` keeps the saved note, and `decided_at` changes only when the mark does.
`GET /api/track-marks` lists them for the Twelves Tracks shelf.

Each mark also keeps its tune: `heard_key`, `artist_display` and `title`, copied from the track
when the mark is written and kept when a later dump no longer lists the position. `video_id` and
`at_seconds` are the video playing in Triage when the mark was set and the second it had reached;
a write without them (a note from Twelves) keeps the saved ones.

## verdict_log and track_mark_log

Every change to `verdicts` and to `track_verdicts`, written by triggers (migration 8), so a
decision an import, a re-judgement, an undo or a dump load replaced or deleted stays known. Each
row has `id`, `at` (when the change happened), `change` and the columns of the row after the
change, or of the deleted row for a delete. `change` is `existing` for the rows the log started
from, then `insert`, `update` or `delete`; an update that writes the values the row has is not
logged. `verdict_log` also has `previous_key`, the key an update moved the verdict from. Nothing in
the app reads the logs yet; they are in the database and its daily copies, not in the decisions
backup.

## heard_tracks

`heard_key` PK, `first_release_id`, `seconds_listened` (accumulated), `first_heard_at`,
`last_heard_at`. Updated by `POST /api/listen-log` when the position maps to a track.

## listen_log

Append-only proof of coverage: `id`, `release_id`, `position` (nullable), `video_id`, `seconds`, `at`.
It has every play, also one shorter than the 4 s after which a tune turns heard; such a play
(`heard: false` in `POST /api/listen-log`) leaves `heard_tracks` alone. A play of 4 s or more is
logged at 4 s and again with the rest when the listener leaves it, so one play can be two rows.

## seed_items

Raw Discogs seed rows: `(kind, release_id)` PK with `kind` in `collection | wantlist`, `master_id`,
`date_added`, `rating`, `notes`, `basic_information_json`, `imported_at`. A want Digga pushes to
the Discogs wantlist is recorded here too (with `basic_information_json` built from the release
row), and removed when Digga takes it off, so `TwelvesItem.onWantlist` can say which wants reached
Discogs before the next wantlist import. The push leaves the `accepted` verdict as it is; the next
wantlist import turns it into a `wantlist` seed by rank.

## sellers and seller_releases

Shops read by `import seller`, for the seller scope in Triage. `sellers`: `id` (the seller's
Discogs user id, PK), `username`, `listings` (For Sale listings the shop had), `listings_read`
(fewer when the API stopped paging at 10,000), `read_at`. `seller_releases`: `(seller_id,
release_id)` PK, the releases for sale at the last read, loaded or not. A new read replaces the
seller's rows; a cancelled one leaves them. Prices and conditions are not stored.

## dump_loads

One row per dump load that wrote to the database (dry runs record nothing): `id`, `file`,
`dump_date`, `started_at`, `finished_at` (null while it runs and for a load that failed or was
cancelled), `added` (releases it brought into the universe), `coverage` (releases in other styles
it kept for their label or artist) and `missing` (universe releases whose `written_by_load` is
another load's; null when a limit stopped it). A finished load takes over
the releases of earlier unfinished loads and deletes their rows. The scope `load:<id>` digs the
releases with that `added_by_load`.

## jobs

`id` (uuid), `type` (`dump_download`, `dump_load`, `dump_update`, `import_collection`, `import_wantlist`, `import_history`,
`import_list`, `import_seller`; migration 5 deleted the rows of the removed `enrich` and
`enrich_twelves`),
`status` (`queued`, `running`, `done`, `failed`, `cancelled`), `progress_json`, `error`, `created_at`,
`started_at`, `finished_at`. Jobs still `running` when the server starts are marked `failed`
with error `interrupted`.

## style_census

One row (`id` 1): `dump_date`, `counted_at` and `census_json`, the `StyleCensus` of the newest
load that read its dump to the end (`src/shared/style-census.ts`, `docs/STYLE_CENSUS.md`). A dry
run or a load stopped by a limit leaves it. Before the first load, `GET /api/styles` reads the
census shipped with Digga instead.

## meta

Key/value: `schema_version`, `dump_date` (from the dump file name), `dump_file`, `dump_loaded_at`.
