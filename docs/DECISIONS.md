# Decisions

Chronological. Each entry records a choice made without asking and why.

1. **Scaffolded with `create-vite` (svelte-ts) plus `vp migrate` instead of `vp create`.** The
   machine's global `vp` (mise, 0.2.9) ships only the binary without the bundled `vite-plus`
   package, so `vp create` fails; run through `npx --package=vite-plus vp create`, its npm 12
   `npx` could not spawn `create-vite` in this environment. `vp create vite` is internally
   `create-vite` followed by the Vite+ rewrite, so the two-step path yields the same project. The
   global `vp` delegates to the project-local `vite-plus@1.0.0-rc.1` for every other command.
2. **npm, not pnpm.** The task names `npm run digga -- <cmd>`. `vp migrate` picked npm because a
   `package-lock.json` existed; it added the required `vite` alias override.
3. **Node runs the TypeScript sources directly.** Node 22.18+/24 strips types natively, so the
   server, CLI, worker and scripts run without a build step; `erasableSyntaxOnly` and `.ts` import
   extensions keep the sources compatible. Only the client is bundled by Vite.
4. **`better-sqlite3` 13 with prebuilt binaries** loaded fine on macOS arm64 / Node 24, so the
   `node:sqlite` fallback was not needed. `db.ts` remains the only importer.
5. **`triage_key` is a stored column computed by `triageKeyFor()`**, not a SQL generated column,
   so the grouping rule lives in exactly one place (`src/shared/triage-key.ts`).
6. **JSON columns + `json_each` for styles and formats** instead of junction tables. The universe is
   tens of thousands of rows; the filters run in milliseconds and the schema stays small.
7. **Seed precedence ranks:** collection 3 > wantlist 2 > triage/manual 1.5 > seen 1. A history
   `seen` never overrides a decision; collection and wantlist do, because they are facts about the
   account, not opinions.
8. **Unknown-year releases pass the load window** and are governed by `filters.includeUnknownYear`
   at query time, so mis-dated records can still be dug later.
9. **`filters.styles`** (nullable subset of the loaded styles) was added to the config schema so the
   query-time style filter from the spec has a home; `null` means all loaded styles.
10. **Heard key separator is ASCII `" - "`** (`artist - title`), following the ASCII-in-code rule.
11. **Queue representative per key:** main release, then most videos, then lowest id. The
    `enriched_at IS NULL` filter for `enrich` applies to that representative, not to every pressing,
    otherwise a repress of an already enriched master would be fetched again.
12. **A dump reload replaces tracks and videos and keeps the API snapshot columns.** The dump is
    the source of truth for the universe; `enriched_at` tells the UI how fresh the snapshot is.
13. **`random` strategy is a seeded multiplicative hash order**; the API defaults the seed to the
    current day number and returns it, so a session can be resumed with the same order.
14. **`enrich` marks a 404 as enriched** (null snapshot) so the job never loops on deleted releases;
    401/403 abort the job because the token is wrong.
15. **History import copies the profile database to `paths.tempDir`** (plus `-wal`/`-journal` if
    present) and deletes the copy afterwards; a permission error prints the Full Disk Access hint.
16. **Light jobs run inline on the server's event loop; only the dump loader uses a Worker.** With
    an in-memory database (tests) the loader runs inline because a Worker cannot share it.
17. **Static files are served by a small hand-written handler** (`static.ts`) rather than
    `@hono/node-server/serve-static`, so the dist directory is an absolute path from `paths.ts`
    and never relative to `process.cwd()`.
18. **`POST /api/jobs/:id/cancel`** was added beyond the spec; the runner already tracked abort
    controllers and workers.
19. **Rate/ETA:** triage decisions split into sessions at 30-minute gaps; the last five sessions
    count, each at least one minute long; ETA is remaining keys divided by verdicts per hour.
20. **`seed_items` table** stores Discogs `date_added`, rating, notes and the raw
    `basic_information` per collection/wantlist item, so a later Twelves view can show when a
    record was added without another API round trip.
21. **Collection pages are requested with `sort=added&sort_order=desc`** so a partial import still
    seeds the newest additions first.
22. **CLI parsing uses `node:util` `parseArgs`**; no CLI dependency.
23. **No `.vscode` directory.** The template's extension recommendation was dropped to keep the
    repo tool-neutral.
24. **Branch is `master`**, per the owner's request during the session.
25. **API 404/500 handlers live on the root Hono app**, because Hono ignores `notFound`/`onError`
    of a mounted sub-app and the static catch-all would otherwise answer unknown `/api` routes.
26. **`digga.config.json` is gitignored; `digga.config.example.json` is committed.** The file
    holds the Discogs username and is rewritten by `PUT /api/settings`, so it is per-user state
    like `.env`. The first run copies the example (or the schema defaults when the example is
    absent, as in Electron), and a test keeps the example equal to the schema defaults.
