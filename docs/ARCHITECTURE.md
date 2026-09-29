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

## The client

`src/client/api.ts` defines the `Api` interface and its HTTP implementation. The exported `api`
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
  an undo never overtakes its verdict. With `discogs.enrichAhead` above 0 it also has the
  server enrich the current record and the next few that lack market data, one request at a
  time (`triage/enrich-ahead.ts`, `POST /api/releases/:id/enrich`), and shows the fresh data;
  a record that is already playing keeps its videos until it comes up again.
- `src/client/player/` wraps the YouTube IFrame API: `deck.ts` is one player, and
  `triage-player.svelte.ts` runs three of them (one audible, one preloading the next release,
  one preloading the track `J` moves to), picks tracks with `src/shared/playlist.ts`, and logs
  listens.
- `src/client/stores.svelte.ts` holds app-wide state: stats for the counter, settings (with a
  version that restarts the queue on save, and the api mode switch), the help overlay flag, and
  the snoozed records Twelves hands to Triage for a round.
- Pages: `Triage.svelte` (always mounted, hidden when another page is shown), `Twelves.svelte`,
  `Settings.svelte`. The keymap and its help text are in `keymap.ts`.

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
year, formats, format descriptions to require or leave out, countries, hidden labels, records
without videos), picks one representative release per key (main release, then most
videos), orders by strategy and limits. Changing filters or strategy never requires a reload.
A scope (`src/shared/scope.ts`) narrows the same query to one label's, one artist's or one
seller's records by Discogs id; Triage digs one with `F` (decisions 83 and 84). A seller's
records are the releases the `import seller` job read from their shop (`seller_releases`).

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

`verdicts` holds one row per triage key. Seeds (`import collection|wantlist|history|list`) write
`collection`, `wantlist`, `seen` or `maybe` (from the Discogs Maybe list) under the precedence in
`docs/DATA_MODEL.md`; triage decisions (`rejected`, `accepted`, `maybe`, `candidate`, `snoozed`,
`no_audio`) are written by the UI. `listen_log` records
every listen (proof of coverage) and feeds `heard_tracks`, keyed by the normalized
`artist - title`, so a tune already heard on another release is greyed out instead of replayed.

## Jobs

The jobs (`downloadDump`, `dumpLoad`, `importCollection`, `importWantlist`, `importHistory`,
`importList`, `importSeller`, `enrich`, `enrichTwelves`) are
async functions in `src/server/jobs/` taking explicit dependencies and an `onProgress` callback.
`jobs/runner.ts` creates the `jobs` row, streams progress into `progress_json` and records the
outcome. The HTTP routes start jobs and return `202` with the job; the CLI waits for them. The dump
loader is the only CPU-heavy job and runs in a `worker_threads` Worker
(`jobs/dump-load-worker.ts`) with its own database connection when started from the server: the
job awaits `runWorker()` (`jobs/worker.ts`), which forwards the worker's progress, terminates it
on cancel and settles once it has exited. The CLI runs the loader inline. `enrich` is network-bound, sequential (Discogs allows 60 requests/minute) and
stops at the next release when its `AbortSignal` fires. It works through the next unenriched
records in queue order, a given number or all of them; `enrichTwelves` refreshes the records on
the Twelves shelves instead, those never enriched first, then the oldest data, because the queue
skips records once they have a verdict. `Stats.remainingEnriched` counts the records still to dig
that have market data, so Settings can say how much of the queue "most wanted first" can order.
`downloadDump` finds the newest releases dump on data.discogs.com
(`src/server/discogs/data-dumps.ts`), streams it into `paths.dumpsDir` as `<file>.part` while
hashing it, and renames it only when the SHA-256 matches the published one. It is network-bound
and runs on the server thread; `GET /api/dumps` lists what the folder holds for Load.

## Backups and exports

`createServer()` copies the database it opens into `paths.backupsDir` (`data/backups/`) once a
day, as `digga-YYYY-MM-DD.sqlite`, and keeps the newest five (`src/server/db/backup.ts`). The copy
uses SQLite's online backup, so it runs in steps beside requests and reads a consistent snapshot;
`stop()` waits for it before closing the database. `digga backup` writes the day's copy on demand.
Restoring is copying a backup over `digga.sqlite` while the server is stopped.

`GET /api/export/decisions.json`, `verdicts.csv` and `track-marks.csv` download every saved
verdict and track mark with the release they belong to (`src/server/export.ts`). They read the
database, so sandbox verdicts, which live in the browser tab, are not in them.

## Discogs API

`src/server/discogs/client.ts` wraps the handful of endpoints used: release detail (with
`curr_abbr`), collection and wantlist pages, identity. It serialises requests, keeps a 1.1 s gap
between them, backs off on `429` and pauses when `X-Discogs-Ratelimit-Remaining` is exhausted.
`addToWantlist` (`PUT /users/{u}/wants/{id}`) and `removeFromWantlist` (`DELETE`, where `404`
counts as removed) back `POST` / `DELETE /api/discogs/wantlist/:id`. A push without notes sends
the release's grail and keep tracks and the record's note (`wantlistNote()` in
`src/shared/wantlist.ts`, at most 255 characters); the server then records or
forgets the release in `seed_items`, as a wantlist import would, so Twelves knows which wants are on
the Discogs wantlist. `addToCollection` is still a typed stub.

## Configuration and paths

`digga.config.json` is the single source of truth, validated by the zod schema in
`src/shared/config.ts`. It is per-user and gitignored; the first run creates it from the committed
`digga.config.example.json`. `PUT /api/settings` validates and rewrites the file. Besides the
Discogs account, universe, filters, order and player, it holds `sandbox` (default `true`, so a
first run changes nothing by accident) and `filters.skipWithoutVideos` (default `false`), which
drops releases without an embeddable video from the queue and its counts. `src/server/paths.ts`
decides every filesystem location from a base directory (`process.cwd()` for the CLI,
`app.getPath('userData')` for Electron) plus optional `DIGGA_DATA_DIR` / `DIGGA_CONFIG_FILE`
overrides. `src/server/secrets.ts` reads `DISCOGS_TOKEN` from the environment or `.env`; Settings
saves the token to `.env` through `PUT /api/discogs/token`, unless the environment sets it.
