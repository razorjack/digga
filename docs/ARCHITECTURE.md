# Architecture

Digga is one npm package with three runtimes sharing `src/shared`:

- `src/server`: Hono on `@hono/node-server`, SQLite through `better-sqlite3`.
- `src/client`: Svelte 5, built by Vite into `dist/`, served by the same Hono app in production and
  by the Vite dev server (proxying `/api`) in development.
- `src/cli`: `digga.ts`, thin wrappers over the job functions and `createServer`.

Node runs the TypeScript sources directly (type stripping), so there is no build step for the
server or the CLI. Only the client is bundled.

## Request flow

```
browser  --HTTP-->  src/client/api.ts  --/api/*-->  src/server/app.ts (Hono)  -->  db/*, queue/*, jobs/*
                                                             |
                                                  src/server/static.ts serves dist/ for everything else
```

`createServer()` in `src/server/server.ts` wires config, paths, secrets, logger, the database, the
job runner and the Discogs client into `createApp()`, and exposes `start(port, host)` / `stop()`.
The CLI's `serve` command calls it; an Electron main process will call the same function.

The server answers this computer only. It listens on a loopback address (`server.host` accepts
`127.0.0.1`, `::1` or `localhost`, and the listener refuses anything else), and
`src/server/local-only.ts` refuses a request whose `Host` is not a loopback name, which stops a
site that points its own domain at 127.0.0.1, and a write whose `Origin` is not the app's page:
the same port under a loopback name, since the app opens on `localhost` or `127.0.0.1`. Browsers
send another site's simple `POST` without a preflight. Tools such as curl send no `Origin` and
are let through. Request bodies must be `application/json` and at most 4 MB. The Vite dev proxy
keeps the browser's `Host`, so the dev server's page counts as the app's own.

## The client

`src/client/api.ts` defines the `Api` interface and its HTTP implementation. Every request has a
timeout that covers the body too (`DEFAULT_TIMEOUTS`): 30 s for what the server answers from its
database, 5 min for requests that wait on a Discogs call, 15 min for reading a Discogs list. The
exported `api`
is an `AppApi` facade (`createAppApi`) over one of two implementations: the HTTP api, or
`createSandboxApi(http)` from `src/client/sandbox.ts`, which keeps the digging writes (verdicts,
track marks, listens, wantlist pushes and removals, the Maybe list import) in memory and overlays
them on later reads. Settings and the other jobs pass through. The facade starts in the sandbox;
the settings store calls `api.setSandbox(config.sandbox)` whenever it loads or saves settings,
before anything reacts to them. Every switch bumps `api.generation`, which tells the triage session
to drop its undo history and details, and every switch into the sandbox starts an empty one. The
session sends each write through `api.pinned()`, the implementation of the moment, so a write
queued before a switch cannot land in the other mode. The server checks the same setting and
answers `409` to digging writes while `sandbox` is on.

- `src/client/triage/session.svelte.ts` holds the queue buffer, prefetches release details,
  applies verdicts optimistically, keeps the undo history and passes, and serialises writes so
  an undo never overtakes its verdict. When the Triage page is shown again it reads the queue
  again and orders the records after the one on screen as the server does (decision 112). `P` has the server fetch the record on screen from
  Discogs (`POST /api/releases/:id/enrich`) and shows its market data; the record keeps the
  videos it is playing until it comes up again.
- `src/client/player/` wraps the YouTube IFrame API: `deck.ts` is one player, and
  `triage-player.svelte.ts` runs three of them (one audible, one preloading the next release,
  one preloading the track `J` moves to), picks tracks with `src/shared/playlist.ts`, and logs
  listens.
- `src/client/stores.svelte.ts` holds app-wide state: stats for the counter, settings (with a
  version that restarts the queue on save, and the api mode switch), the help overlay flag, and
  the snoozed records Twelves hands to Triage for a round.
- Pages: `Triage.svelte` (always mounted, hidden when another page is shown), `Twelves.svelte`,
  `Settings.svelte`, `Setup.svelte`. The keymap and its help text are in `keymap.ts`.
- `src/client/load-status.svelte.ts` follows the running dump job for the header's indicator,
  Triage and the setup: it asks once when the app opens and whenever something starts a dump
  job, then every second while one runs, and says once when a load it watched has finished.
- The setup (`src/client/setup/`, `docs/FIRST_RUN.md`): `flow.svelte.ts` owns the jobs it starts
  and polls them, and resumes from what the server has; `model.ts` holds the estimate, the
  suggestions and the default years as pure functions; one component per step. `App.svelte`
  sends a library without a finished load to `#/setup` unless its first load runs, and until
  the load starts the header keeps only the wordmark and the page keys stay quiet. While a load
  runs, the triage session's `lookAgain()` asks the server again at the end of the queue every
  10 seconds, and once more when the load ends.
- Twelves loads every shelf in one request and filters, sorts and counts in the browser
  (`twelves/model.ts`), so counts, "add all" and rounds of snoozed records cover the whole shelf.
  It renders the 500 records around the selection (`pageAround`); `J` and `K` cross pages and
  `←` / `→` turn them.

## The universe and the queue

The set of releases to dig comes from the monthly Discogs releases dump, never from the search
API. `tools/dump/parse.ts` streams `fs -> gunzip -> saxes` and yields one lightweight object per
`<release>`; `tools/dump/load.ts` keeps releases matching `universe.styles` (plus the wide
`universe.loadYears` window, unknown years always pass) and upserts them in batches of 500 through
`src/server/db/releases.ts`. Memory stays flat regardless of dump size, except for the coverage
pass (`universe.coverage`, decision 90): releases in other styles on the labels and by the artists
of wanted or owned records (`queue/coverage.ts`) wait in `tools/dump/coverage.ts` until the end
of the dump shows whether their label mostly releases the styles, at most 500 per label or artist.

The queue is a query (`src/server/queue/query.ts`), not a table. It groups releases by triage key
(`m:{master_id}` or `r:{release_id}`, see `src/shared/triage-key.ts`), drops keys that already have a
verdict, applies the query-time filters (`filters.*` in config: styles subset, year range, unknown
year everywhere or only on the coverage labels and artists, formats, format descriptions to require or leave out, countries, hidden labels, records
without videos), picks one representative release per key (main release, then most
videos), orders by strategy and limits. Changing filters or strategy never requires a reload.
A scope (`src/shared/scope.ts`) narrows the same query to one label's, one artist's or one
seller's records by Discogs id, or to the releases one dump load added (`load:<id>`); Triage
digs one with `F` (decisions 83, 84 and 92). A seller's records are the releases the
`import seller` job read from their shop (`seller_releases`); the release detail carries the
copies read with them (`seller_listings`), which Triage shows in that seller's scope.

A record plays the videos of all its pressings. `buildReleaseDetail()` returns the release's own
videos, then those of other releases on the same master whose matched track is a tune on this
release (same heard key), placed at this release's position for it (`poolVideos()` in
`src/shared/videos.ts`). Unmatched videos of other pressings are left out, since they may be bonus
tracks or full sides. Attached links of other pressings are pooled the same way.
`filters.skipWithoutVideos` asks the same of each release in SQL, so a record passes only when the
player would have something to play.

Records with nothing to play have a way back. `D` stores `no_audio` together with the video ids
the player had for the release (`no_audio_videos`, from `releaseVideos()`); a dump load, an
enrich or a pasted link that brings a video outside that list deletes the verdict, so the record
is in the queue again, while videos that were there and refused to play keep it out. In the
sandbox a pasted link does not delete a saved verdict; the next dump load or enrich does. A YouTube link pasted in Triage, or on a record in
Twelves, is stored in `user_videos` through `POST /api/releases/:id/videos`, matched to a track
by the title YouTube's oEmbed endpoint gives (`src/server/youtube.ts`, no API key), and played at
once; the player rebuilds the open release's playlist when its videos change.

## Verdicts and coverage

`verdicts` holds one row per triage key: the decisions made in Digga (`rejected`, `accepted`,
`maybe`, `candidate`, `snoozed`, `no_audio`), written by the UI, and `seen` from the browser
history import. `import collection|wantlist|list` record what the Discogs account holds in
`memberships` and never change a verdict; the queue leaves out records with either, and Twelves
shows both (`docs/DATA_MODEL.md`). `listen_log` records
every listen (proof of coverage) and feeds `heard_tracks`, keyed by the tune key (the normalized
canonical `artist - title`, or the record and position of an untitled tune), so a tune already
heard on another release is greyed out instead of replayed.

## Jobs

The jobs (`downloadDump`, `dumpLoad`, `importCollection`, `importWantlist`, `importHistory`,
`importList`, `importSeller`) are
async functions in `src/server/jobs/` taking explicit dependencies and an `onProgress` callback.
`jobs/runner.ts` creates the `jobs` row, streams progress into `progress_json` and records the
outcome. The HTTP routes start jobs and return `202` with the job; the CLI waits for them. The dump
loader is the only CPU-heavy job and runs in a `worker_threads` Worker
(`jobs/dump-load-worker.ts`) with its own database connection when started from the server: the
job awaits `runWorker()` (`jobs/worker.ts`), which forwards the worker's progress, terminates it
on cancel and settles once it has exited. The CLI runs the loader inline. Enrichment is not a
job: `P` in Triage fetches price, have/want and current videos for the record on screen
(`src/server/enrich.ts`, decisions 95 and 97).
The dump update (`POST /api/jobs/dump-update`, `digga dump update`) is one job of two steps,
`downloadDump` and then the loader, with progress tagged by `step`; the server runs one dump job at
a time. `downloadDump` finds the newest releases dump on data.discogs.com
(`src/server/discogs/data-dumps.ts`), streams it into `paths.dumpsDir` as `<file>.part` while
hashing it, and renames it only when the SHA-256 matches the published one. It is network-bound
and runs on the server thread; `GET /api/dumps` lists what the folder holds for Load, and
`DELETE /api/dumps/:name` deletes a dump the listing names, never while a dump job runs.
A load can start while its dump downloads: `POST /api/jobs/dump-load` naming the dump the
running download writes starts beside it, and the loader reads `<file>.part` as it grows
(`tools/dump/growing.ts`), waiting at the end of what has arrived. It asks the jobs table whether
the download is still running, finished or failed (`jobs/follow-download.ts`), which the worker's
own connection can read too. A finished download has renamed the part, and the open handle reads
the same file to its end; a failed one ends the load with its reason. The dump update still
downloads first and loads after.
The loader reports progress every 100,000 releases, logged, and every second in between, with
the releases it kept per year and the last one it kept, for the setup's progress screen. A load
that reaches the end of the dump also counts the style census (`tools/dump/census.ts`,
`docs/STYLE_CENSUS.md`) into the `style_census` table.

## The first run

`docs/FIRST_RUN.md` is the design. `GET /api/setup` (`src/server/setup.ts`) says whether the
library still needs its first load (no load has finished), which dump data.discogs.com offers,
with the size its listing shows (read again after an hour), whether the dumps folder has it, the
free space there and the space the download needs, the styles and years of the imported
collection and wantlist (`db/seed-tally.ts`), and the browsers with a history to import.
`GET /api/styles` returns the style census for the style picker: the one the last complete load
counted, or the one shipped with Digga (`src/server/style-census.json`) before the first.
`GET /api/discogs/profile` gives the account's collection and wantlist sizes and its currency.

## Backups and exports

`createServer()` starts `daily-backups.ts`, which checks every fifteen minutes while the server
runs, so a server left open for days still copies the database into `paths.backupsDir`
(`backups/` in the library) once a day, as `digga-YYYY-MM-DD.sqlite`, and keeps the newest two
(`src/server/db/backup.ts`). The copy
uses SQLite's online backup, so it runs in steps beside requests and reads a consistent snapshot;
`stop()` waits for it before closing the database. A check that fails is logged, and Settings
shows it (`failure` in `GET /api/backups`) until a later check succeeds.

`digga restore` with a `.sqlite` file, a daily copy or a `before-migration-<version>.sqlite`,
replaces the database with it (`src/server/db/restore-copy.ts`). It holds the library lock, so it
refuses while the server runs. It stages a duplicate of the copy beside `digga.sqlite` and checks
that it has a schema version this Digga knows. It then copies the current database with
`VACUUM INTO`, which includes committed WAL content, to
`backups/before-restore-YYYY-MM-DD-HHMMSS.sqlite`, a name daily rotation leaves alone. It removes
`digga.sqlite-wal` and `digga.sqlite-shm`, since SQLite would apply that log to the copy, moves the
staged file over `digga.sqlite`, and opens it once to apply the migrations it lacks.

It also writes `decisions-YYYY-MM-DD.json.gz` there, gzipped at level 9, and keeps the newest 30
(`src/server/decisions-backup.ts`). The file holds what only the user made, read by
`db/user-data.ts` in one read transaction: every verdict, the account's items, track marks,
heard tunes, attached videos, the videos of no-audio records, release notes, sessions and the
listen and decision logs, oldest first. Version 3 is JSON Lines: a header line (format version,
time, settings and a SHA-256 `dataHash` of the record lines), then one record per line, its type
in `record` and its fields in camelCase in a fixed order; `src/shared/decisions-backup.ts`
validates it, and versions 1 and 2, one JSON document each, still restore. No release data: the
Discogs ids in the keys find it again after a dump load. A day gets no file when one exists,
when the library holds nothing made in Digga, or when the newest file's `dataHash` matches, so
idle days and a new library never push older backups out; the check reads only that file's
header. Reading and formatting a long history takes seconds (3.8 s for 300,000 listens and
120,000 logged decisions), so the server writes these backups and the checkpoints in a worker
thread with its own connection (`decisions-backup-worker.ts`); an in-memory database is backed up
inline.
`digga backup` writes both backups on demand. `digga restore` with a decisions backup copies the
database, then merges the file into the library in one transaction (`restoreBackedUpData`): a
verdict or track mark keeps whichever side changed it last, a deletion included; heard tunes and
attached videos are added, the latter also for releases the library has not loaded, which they
wait for.

`GET /api/export/decisions.json`, `verdicts.csv` and `track-marks.csv` download every saved
verdict and track mark with the release they belong to (`src/server/export.ts`). They read the
database, so sandbox verdicts, which live in the browser tab, are not in them.

## Discogs API

`src/server/discogs/client.ts` wraps the handful of endpoints used: release detail (with
`curr_abbr`), collection and wantlist pages, identity. It serialises requests, keeps a 1.1 s gap
between them, backs off on `429` and pauses when `X-Discogs-Ratelimit-Remaining` is exhausted.
`addToWantlist` (`PUT /users/{u}/wants/{id}`) and `removeFromWantlist` (`DELETE`, where `404`
counts as removed) back `POST` / `DELETE /api/discogs/wantlist/:id`. A push sends the
release's grail and keep tracks and its note (`wantlistNote()` in
`src/shared/wantlist.ts`, at most 255 characters); the server then records or
forgets the release in `memberships`, as a wantlist import would, so Twelves knows which wants
are on the Discogs wantlist.

## Configuration and paths

`digga.config.json` is the single source of truth, validated by the zod schema in
`src/shared/config.ts`. It is per-user and lives in the library folder; the first run creates it
from the schema defaults, which the committed `digga.config.example.json` shows.
`PUT /api/settings` validates and rewrites the file. Besides the
Discogs account, universe, filters, order and player, it holds `sandbox` (default `true`, so a
first run changes nothing by accident), `filters.skipWithoutVideos` (default `false`), which
drops releases without an embeddable video from the queue and its counts, and
`setup.picksConfirmed` (default `false`), which the setup's step 3 sets when it writes the styles,
years and formats, so the setup starts from them and not from the defaults when it returns.

`src/server/paths.ts` decides every filesystem location. The library (database, backups, config,
saved token, temp files) defaults to the per-user app folder, named as Electron names `userData`
(`~/Library/Application Support/Digga`, `%APPDATA%\Digga`, `~/.config/Digga`), so the packaged
app opens the same library. Dumps default to the OS cache folder, which backups skip and the OS may
clear; a dump can be downloaded again. The CLI reads `.env` from its working directory into the
environment (variables already set win) and passes `DIGGA_DATA_DIR`, `DIGGA_DUMPS_DIR` and
`DIGGA_CONFIG_FILE` to `resolvePaths()`; a library placed with `DIGGA_DATA_DIR` keeps its dumps
inside it. `src/server/secrets.ts` reads `DISCOGS_TOKEN` from the environment or `secrets.env` in
the library; Settings saves the token there through `PUT /api/discogs/token`, unless the
environment sets it. The route asks Discogs whose token it is first: it keeps the previous token
when Discogs refuses the new one or when it belongs to another account than the one whose data
the library holds (`meta.discogs_account`), and a library without a Discogs username takes the
token's.

One process at a time owns a library. `src/server/library-lock.ts` writes `digga.lock` in the
library, naming the process; `createServer()` takes it before it opens the database, and so do
the CLI commands that change the library (`dump download`, `dump update`, `dump load`, `import`,
`restore`). Another process that wants it is refused with the holder's name, and a lock whose
process has ended is taken over. So only the owner migrates the database, marks interrupted jobs
failed and writes the scheduled backups. `digga stats` and `digga backup` only read and run beside
the server.

Several tabs may dig in one library. A new verdict replaces whatever the record has, but a write
that changes a verdict the page already knows names it (`expected`: its status and
`decidedAt`): an undo in Triage or Twelves and a change in Twelves. The server refuses such a write
with `409` when the record's verdict is another one by then, and the page drops the undo step or
reloads the shelf.
