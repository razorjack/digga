# Digga

Digga is a local-first app for exhaustively digging Discogs vinyl by ear. **Digga is the app, your
twelves are what it finds.** _Digga_ is the tool and the triage flow; _Twelves_ is the view of
everything the user has accepted, wants, or owns.

The owner uses it for drum & bass (techstep, early neurofunk) released 1998–2002: listen to every
release in that set through the YouTube links Discogs attaches to releases, a few seconds per track,
keyboard-driven, to (1) identify a handful of tunes heard on rave radio around 2000–2002 and (2)
build a DJ wantlist. Other people will use it for other styles and years, so **nothing about DnB or
1998–2002 is hardcoded outside `digga.config.json`**. Year range and formats are query-time filters
that change without reloading data.

## Delivery shape

- **Now (v1):** a Node process bound to 127.0.0.1:3456 serving a Svelte app, opened in a browser at
  `http://localhost:3456` (YouTube refuses some embeds on IP-address origins).
- **Sandbox mode:** `sandbox` in `digga.config.json`, on by default and switched in Settings (the
  header's sandbox stamp links there). While it is on, the UI fakes the digging writes in memory
  (`src/client/sandbox.ts`): verdicts, track marks, listens, wantlist pushes and the Maybe list
  import. Settings and the other jobs are real. The server refuses those writes with `409` too.
  Never turn the owner's sandbox off (or edit their config) to test; use a throwaway data dir.
- **Later:** an Electron app. Its main process imports `createServer` from `src/server/server.ts`,
  starts it on a free localhost port, opens a `BrowserWindow` at it, and exposes the CLI jobs as
  menu items. That must be packaging work only, never a rewrite. See `docs/ELECTRON_PLAN.md`.

## Commands

```sh
npm install                      # Node >= 22.18 (runs .ts directly, no build step for the server)
vp dev                           # Vite dev server on :5173, proxies /api to :3456
npm run digga -- serve           # Hono server on 127.0.0.1:3456, open http://localhost:3456 (serves dist/ after vp build)
npm run digga -- serve --port 0  # pick a free port
vp build                         # build the client into dist/
vp check                         # format + lint + type check (oxfmt, oxlint, tsgolint)
vp test                          # vitest, tests/**/*.test.ts
vp run check:portability         # Electron-ready rules, see below
vp run check:svelte              # svelte-check for .svelte files
vp run verify                    # all four of the above
```

`vp` is the Vite+ CLI. The global `vp` delegates to the project-local `vite-plus`; without it use
`npx vp <cmd>` or the `npm run` scripts. Every command above must be green before a commit.

### Loading a real dump and seeding

```sh
# 1. Get discogs_YYYYMMDD_releases.xml.gz from https://data.discogs.com/ into data/dumps/
npm run digga -- dump load data/dumps/discogs_20250901_releases.xml.gz            # ~10 GB gz, streams
npm run digga -- dump load data/dumps/discogs_20250901_releases.xml.gz --limit 500 --dry-run
gzip -dc data/dumps/discogs_20250901_releases.xml.gz | npm run digga -- dump load -   # from stdin
# 2. Seeds (needs discogs.username in digga.config.json, created on first run, and DISCOGS_TOKEN in .env)
npm run digga -- import collection
npm run digga -- import wantlist
npm run digga -- import history --browser brave        # Brave on macOS; also chrome, firefox, --path
npm run digga -- import list                           # releases on your Discogs Maybe list (discogs.maybeListId)
# 3. Prices, have/want, fresh videos for the next 200 queue items
npm run digga -- enrich --ahead 200
npm run digga -- stats
```

## Layout

```
digga.config.example.json  committed defaults; copied to digga.config.json (gitignored, per-user) on first run
.env.example           DISCOGS_TOKEN= (copy to .env, gitignored)
docs/                  ARCHITECTURE DATA_MODEL DISCOGS_NOTES DESIGN_BRIEF KEYMAP ROADMAP DECISIONS ELECTRON_PLAN
scripts/check-portability.ts
src/shared/            types, config schema, API contracts, pure logic (normalize, match-videos, discogs-urls,
                       triage-key, youtube, formats, playlist, rate, display). Imports nothing from Node.
src/server/            server.ts (createServer) app.ts (Hono routes) paths.ts secrets.ts logger.ts stats.ts static.ts
                       db/ (db.ts wrapper, migrations/*.sql, releases.ts, verdicts.ts, jobs.ts)
                       discogs/ (client.ts, types.ts) importers/ (collection, wantlist, history, seeds)
                       jobs/ (dump-load, enrich, runner, dump-load-worker, index) queue/query.ts
src/cli/digga.ts       command entry: dump load | import collection|wantlist|history | enrich | stats | serve
src/client/            Svelte 5 app: api.ts (the transport seam), sandbox.ts (fake writes), router.svelte.ts,
                       stores.svelte.ts, keymap.ts, styles.css (tokens), components/ (Key, Stamp, HelpOverlay),
                       player/ (YouTube decks), triage/ (session + triage components), pages/
tools/dump/            streaming loader (parse.ts, convert.ts, load.ts), worker-compatible
tests/ fixtures/       vitest unit tests + fixtures/releases-sample.xml(.gz)
data/                  gitignored: digga.sqlite, dumps/, tmp/
```

## Conventions

- Strict TypeScript, no `any`. Node runs the `.ts` sources directly (type stripping), so use only
  erasable syntax (no enums, namespaces, parameter properties) and import with `.ts` extensions.
- Tests for all pure logic and for the SQL builders (`tests/`, fixture-driven). Run `vp test`.
- Schema changes only via a new numbered file in `src/server/db/migrations/`; never edit an applied one.
- DnB defaults live only in `digga.config.example.json` and the matching schema defaults in
  `src/shared/config.ts` (a test keeps them equal). `digga.config.json` is per-user and gitignored:
  it holds the Discogs username and whatever `PUT /api/settings` writes. Never commit it.
- Comments explain constraints, not what the code says. No em dashes; en dash with spaces in prose.
- Formatting and lint are owned by `vp check --fix`.

## Electron-ready rules (enforced by `vp run check:portability`)

1. **Server is a function.** `createServer({ config, paths, secrets, logger })` returns
   `{ app, start(port, host), stop() }`. The CLI is one caller; Electron will be another. 127.0.0.1 only.
2. **One transport seam.** `src/client/api.ts` is the only file in `src/client` that may call `fetch`.
3. **One place for paths.** `src/server/paths.ts` resolves data dir, db file, config, dumps, temp, dist.
   `DIGGA_DATA_DIR` / `DIGGA_CONFIG_FILE` env or `./data` under the CLI's cwd. No `process.cwd()`
   outside `src/cli/`.
4. **One place for secrets.** `src/server/secrets.ts` (`.env` / `DISCOGS_TOKEN` now, `safeStorage` later).
   No other `process.env` reads outside `paths.ts`, `secrets.ts`, `src/cli/`.
5. **Jobs are library functions** in `src/server/jobs/` taking `{ db, discogs, logger }`, options and
   `onProgress`; status goes to the `jobs` table through `jobs/runner.ts`.
6. **Heavy work never blocks the server thread.** `POST /api/jobs/dump-load` runs the loader in a
   `worker_threads` Worker with its own DB connection and serialisable arguments; `enrich` is async,
   chunked and cancellable through `AbortSignal`.
7. **Frontend is environment-agnostic.** `src/shared` imports nothing from Node; `src/client` reads no
   env, filesystem, or `window.location` beyond the hash router. Vite `base: './'`, hash routing only.
   The YouTube IFrame API needs an http(s) origin, which the localhost server provides.
8. **Native modules stay isolated.** Only `db/db.ts` imports `better-sqlite3`; only
   `importers/history.ts` touches browser profile files.
9. **Logging goes through `src/server/logger.ts`.**
10. **Enforce it.** `scripts/check-portability.ts` fails the build on violations of 2, 3, 4, 7, 8.

## Where to go next

- `docs/ROADMAP.md` for the session plan (design + triage UI next).
- `docs/DESIGN_BRIEF.md` and `docs/KEYMAP.md` for the UI session.
- `docs/ELECTRON_PLAN.md` for packaging.
- `docs/DECISIONS.md` for why things are the way they are.
