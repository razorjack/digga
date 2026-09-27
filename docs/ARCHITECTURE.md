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
is currently `createSandboxApi(createHttpApi())`: reads go to the server, writes (verdicts, track
marks, listens, settings, jobs, the wantlist push) are kept in memory by `src/client/sandbox.ts`
and overlaid on later reads. `api.mode` tells the UI which one it is talking to.

- `src/client/triage/session.svelte.ts` holds the queue buffer, prefetches release details,
  applies verdicts optimistically, keeps the undo history and passes, and serialises writes so
  an undo never overtakes its verdict.
- `src/client/player/` wraps the YouTube IFrame API: `deck.ts` is one player, and
  `triage-player.svelte.ts` runs two of them (one audible, one preloading the next release),
  picks tracks with `src/shared/playlist.ts`, and logs listens.
- `src/client/stores.svelte.ts` holds app-wide state: stats for the counter, settings (with a
  version that restarts the queue on save) and the help overlay flag.
- Pages: `Triage.svelte` (always mounted, hidden when another page is shown), `Twelves.svelte`,
  `Settings.svelte`. The keymap and its help text are in `keymap.ts`.

## The universe and the queue

The set of releases to dig comes from the monthly Discogs releases dump, never from the search
API. `tools/dump/parse.ts` streams `fs -> gunzip -> saxes` and yields one lightweight object per
`<release>`; `tools/dump/load.ts` keeps releases matching `universe.styles` (plus the wide
`universe.loadYears` window, unknown years always pass) and upserts them in batches of 500 through
`src/server/db/releases.ts`. Memory stays flat regardless of dump size.

The queue is a query (`src/server/queue/query.ts`), not a table. It groups releases by triage key
(`m:{master_id}` or `r:{release_id}`, see `src/shared/triage-key.ts`), drops keys that already have a
verdict, applies the query-time filters (`filters.*` in config: styles subset, year range, unknown
year, formats, countries), picks one representative release per key (main release, then most
videos), orders by strategy and limits. Changing filters or strategy never requires a reload.

## Verdicts and coverage

`verdicts` holds one row per triage key. Seeds (`import collection|wantlist|history|list`) write
`collection`, `wantlist`, `seen` or `maybe` (from the Discogs Maybe list) under the precedence in
`docs/DATA_MODEL.md`; triage decisions (`rejected`, `accepted`, `maybe`, `candidate`, `snoozed`,
`no_audio`) are written by the UI. `listen_log` records
every listen (proof of coverage) and feeds `heard_tracks`, keyed by the normalized
`artist - title`, so a tune already heard on another release is greyed out instead of replayed.

## Jobs

The six jobs (`dumpLoad`, `importCollection`, `importWantlist`, `importHistory`, `importList`,
`enrich`) are
async functions in `src/server/jobs/` taking explicit dependencies and an `onProgress` callback.
`jobs/runner.ts` creates the `jobs` row, streams progress into `progress_json` and records the
outcome. The HTTP routes start jobs and return `202` with the job; the CLI waits for them. The dump
loader is the only CPU-heavy job and runs in a `worker_threads` Worker
(`jobs/dump-load-worker.ts`) with its own database connection when started from the server. The
CLI runs it inline. `enrich` is network-bound, sequential (Discogs allows 60 requests/minute) and
stops at the next release when its `AbortSignal` fires.

## Discogs API

`src/server/discogs/client.ts` wraps the handful of endpoints used: release detail (with
`curr_abbr`), collection and wantlist pages, identity. It serialises requests, keeps a 1.1 s gap
between them, backs off on `429` and pauses when `X-Discogs-Ratelimit-Remaining` is exhausted. Push
operations (add to wantlist, add to collection) are typed stubs until session 3.

## Configuration and paths

`digga.config.json` is the single source of truth, validated by the zod schema in
`src/shared/config.ts`. It is per-user and gitignored; the first run creates it from the committed
`digga.config.example.json`. `PUT /api/settings` validates and rewrites the file. `src/server/paths.ts`
decides every filesystem location from a base directory (`process.cwd()` for the CLI,
`app.getPath('userData')` for Electron) plus optional `DIGGA_DATA_DIR` / `DIGGA_CONFIG_FILE`
overrides. `src/server/secrets.ts` reads `DISCOGS_TOKEN` from the environment or `.env`.
