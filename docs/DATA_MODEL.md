# Data model

Every timestamp Digga stores is ISO 8601 in UTC with `Z` (`2026-09-22T21:48:52.000Z`), so SQL
orders them as text; only `memberships.date_added` keeps the text Discogs sent.

SQLite, WAL mode, one file: `digga.sqlite` in the library folder (`paths.dbFile`). With
`synchronous = NORMAL`, an OS crash or power cut can roll back the last writes but never corrupts
the database. Migrations are numbered `.sql` files in
`src/server/db/migrations/` applied at startup; `meta.schema_version` records the last one applied.
A library whose schema version is newer than the newest migration this Digga has is refused before
anything is written, since a newer Digga migrated it.
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

| column                           | notes                                                   |
| -------------------------------- | ------------------------------------------------------- |
| `release_id`, `seq`              | PK; `seq` is the tracklist index (sub-tracks flattened) |
| `position`                       | `A1`, `B`, `1`, or empty for headings                   |
| `title`                          |                                                         |
| `artists_json`, `artist_display` | track credits, falling back to the release artist       |
| `duration_seconds`               | nullable                                                |
| `heard_key`                      | the tune key, see below                                 |

The tune key (`heardKeyFor()` in `src/shared/normalize.ts`) is the normalized `artist - title`
built from the canonical Discogs artist names, `(n)` suffix included, so a credit under another
name (ANV) is the same tune and two same-named artists are not. Normalization keeps the letters
and digits of every script. A tune whose artists are all Discogs placeholders (Various, Unknown
Artist, No Artist) or whose title names no tune ("Untitled", "Track 3", "Side B", "Dub") is keyed
by its record and position instead, as `m:501 A1`. `meta.tune_key_version` records the rules the
tracks follow; a library keyed by older rules is rekeyed as it opens.

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
after the ones from Discogs. The table has no foreign key to `releases` (migration 16): an
attached video stays when its release row goes or is not loaded, and applies again when a load
brings the release back.

## no_audio_videos

`key` PK, `video_ids_json`: the embeddable video ids the player had for the release (its own,
attached and pooled from other pressings) when the record was marked `no_audio`. Migration 2
fills it for earlier `no_audio` verdicts, and a verdict without a row counts its current videos
as known. After a dump load, an enrich or an attached
link, a `no_audio` record with a playable video outside this list loses its verdict and is back
in the queue (`requeueNoAudio()` in `src/server/db/no-audio.ts`).

## verdicts

What was decided about a record: in Digga, or `seen` from the browser history. What the Discogs
account holds is not a verdict (see `memberships`).

| column       | notes                                                                       |
| ------------ | --------------------------------------------------------------------------- |
| `key`        | PK, triage key                                                              |
| `status`     | `seen`, `rejected`, `accepted`, `maybe`, `candidate`, `no_audio`, `snoozed` |
| `source`     | `seed:history`, `triage`, `manual`                                          |
| `release_id` | the release that was on screen, nullable for master-only history hits       |
| `decided_at` | ISO in UTC; a history hit uses the last browser visit                       |

Precedence (`verdictRank()` in `src/shared/verdict-rank.ts`) decides only which verdict a record
keeps when two meet on one key: `candidate` (grail) > `accepted` (want) > any other decision >
`seen`. A history hit never replaces a decision (`applySeedVerdict`). `maybe` means the release
belongs on the Discogs Maybe list; Twelves says when the list does not hold it yet. `snoozed` is
"hear it again later": a round of snoozed records in Triage replaces it with the new verdict, and
undo there restores the snooze with its original `decided_at` (`POST /api/verdicts` accepts
`decidedAt` for that). The "dug" count is every verdict with source `triage` or `manual`, and
the rate reads their `decided_at`. Migration 17 moved the collection, wantlist and Maybe-list
seeds that verdicts used to hold into `memberships`, put back the decision made in Digga that a
seed had replaced (from `verdict_log`), and dropped `notes` and `dug_at`.

A verdict follows the release it was given on (`release_id`, indexed): a dump load that changes the
release's key moves the verdict, and the videos of a no-audio record, to the new key
(`moveVerdictsToReleaseKeys()` in `src/server/db/verdict-keys.ts`). When the new key has a verdict,
the higher rank stays, then the newer decision (`preferredVerdict()`), and the log keeps the
others. A load's moves are worked out together before any is made, so verdicts
whose releases swap masters swap keys instead of merging. `POST /api/verdicts` and `digga restore`
put a verdict with a `releaseId` on the key its release has now, whatever key the page or the
backup had. A verdict without a `release_id`, such as a browser-history hit on a master, stays on
its key, and stops applying if Discogs retires that master.

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
logged. `verdict_log` also has `previous_key`, the key an update moved the verdict from. The decisions backup includes both logs and the listen log. Each event has a stable `event_id`,
so restoring overlapping backups merges their histories without duplicating events. Restore writes
do not generate new decision events. The backup also contains configuration; `digga restore --config`
restores it explicitly and keeps the previous configuration beside it. Saved tokens are not exported.

## heard_tracks

`heard_key` PK, `first_release_id`, `seconds_listened` (accumulated), `first_heard_at`,
`last_heard_at`. Updated by `POST /api/listen-log` when the position maps to a track. It can be
derived from `listen_log`: after a rekey, a dump load or a restore, each listen and mark takes the
key of the track now at its position when that track has the title it saved
(`remapTuneKeys()`), and `heard_tracks` is rebuilt from the listens.

## listen_log

Append-only proof of coverage: `id`, `release_id`, `position` (nullable), `video_id`, `seconds`, `at`.
Each new row also keeps the heard key, artist and title snapshot, upload title, playback ID,
optional session ID, client start time, sampled video offsets and the heard flag. Older rows have
null context. Seeking starts a new sampled segment; the threshold and remainder of a continuous
play share a playback ID. Catalogue changes never rewrite this evidence.
It has every play, also one shorter than the 4 s after which a tune turns heard; such a play
(`heard: false` in `POST /api/listen-log`) leaves `heard_tracks` alone. A play of 4 s or more is
logged at 4 s and again with the rest when the listener leaves it, so one play can be two rows.

## memberships

What the Discogs account holds: `(kind, release_id)` PK with `kind` in `collection | wantlist |
list` (the Maybe list), `master_id`, `date_added`, `rating` and `notes` as Discogs sent them (the
list item's comment for `list`), `added_at` (first seen by Digga), `imported_at` (the last import
or push that found it) and `removed_at` (null while Discogs holds it). The imports write it; a
want Digga pushes to the Discogs wantlist is recorded here too, and deleted when Digga takes it
off, so Twelves can say which wants reached Discogs before the next wantlist import. An import
that reads every page (a cancelled one does not; for the Maybe list, one where every entry
resolved to a release) sets `removed_at` on the items of its kind it did not find, unless Digga
pushed them after the import started; finding an item again clears it. A record the account holds
any release of, also one that left the account outside Digga, is out of the queue
(`undecidedClause()`); Twelves shows it on the Discogs wantlist, Owned and Maybe shelves beside
the decisions made in Digga, which the imports never change.

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

Key/value: `schema_version`, `dump_date` (from the dump file name), `dump_file`, `dump_loaded_at`,
`discogs_account` (whose collection, wantlist and lists `memberships` holds; another account is
refused until Settings forgets them).

## Backup schedule

The server writes daily database copies (seven retained) and daily portable decisions backups
(thirty retained). Every fifteen minutes and at clean shutdown it also writes a checkpoint of
changed personal data and settings (forty-eight retained). Settings offers **Back up now**.
Opening an existing database with pending migrations first writes a consistent
`backups/before-migration-<version>.sqlite` copy, including committed WAL data. These copies do
not participate in daily retention. Checkpoints restore through the same CLI as daily backups.
`digga restore` with a database copy replaces `digga.sqlite` and removes its `-wal` and `-shm`
files; it first keeps the database it replaces as `backups/before-restore-YYYY-MM-DD-HHMMSS.sqlite`,
also outside daily retention.

## release_notes

Notes belong to releases: `release_id` PK, nullable `notes` and `updated_at`. `E` in Triage and
Twelves writes the note of the release shown. A cleared note keeps a null row so an older backup
cannot bring it back. Verdicts have no note, so undoing or merging a verdict never touches one.
Release details and Twelves expose the release's own `note` and `pressingNotes`, the notes
written on the record's other pressings, which the page labels with their catalogue number. The
want Digga pushes to Discogs carries the pushed release's note. Portable backups include these
rows.

Track marks retain their original tune snapshot even when a catalogue refresh reuses the position.
Triage follows a moved tune only when its heard key identifies one track unambiguously. Twelves
flags changed tracklists and displays the saved name. A mark for a different tune at the saved
position cannot overwrite it; this requires reviewing the old mark instead of automatic relabelling.

`digging_sessions` stores lightweight session checkpoints: current release, passes, scope, random
queue seed, replay round and underlying queue, and upload/second. The creation context includes
configuration, dump date, and schema version; later checkpoints update only the cursor and timestamp.
These rows are included in portable backups, and restore keeps a newer checkpoint already present.
A session this version cannot parse (its settings from an older or newer Digga) is left out of a
restore and not offered for resuming; it never blocks restoring the decisions.
The client saves changed positions every five seconds and when leaving Triage or changing tab
visibility. Sandbox sessions stay unsaved. This is best-effort persistence, with no durable client
write queue; the undo stack does not survive a reload.
