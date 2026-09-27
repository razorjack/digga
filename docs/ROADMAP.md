# Roadmap

## Session 1 (done): foundation

Repo, config, paths, secrets, logger, SQLite + migrations, streaming dump loader with worker
runner, Discogs client, seed importers (collection, wantlist, browser history), enrich, queue
query, Hono API, CLI, placeholder Svelte UI, docs, tests, portability check.

## Session 2 (done): design, triage UI, Twelves and settings in sandbox mode

- Visual design from `docs/DESIGN_BRIEF.md`; the choices are recorded at the end of that file.
- Triage page: two YouTube IFrame decks (visible + preloading), start at `startAtFraction`,
  tracklist with heard/has-video/failed flags, the full keymap from `docs/KEYMAP.md`, undo of
  verdicts and `N`, stats header (dug, remaining, ETA, session count), listen logging, help
  overlay, states for no audio, failed embeds, loading, the first key press and end of queue.
- Twelves page (shelves, sort, filter, notes, re-judge, undo) and Settings page (filters with a
  live match count, order, player, account, universe, jobs panel with progress and cancel).
- **Sandbox mode:** `src/client/sandbox.ts` fakes every write in memory, including the wantlist
  push and the jobs. The owner uses this to tune the flow before any real decision is stored.

## Session 3: go live, push to Discogs

- Decide when to leave the sandbox: `export const api = createHttpApi()` in `src/client/api.ts`
  (or a setting that switches between the two; keep the sandbox for demos).
- Implement `POST /api/discogs/wantlist/:id` and the client stubs `addToWantlist` /
  `addToCollection`; push `accepted` with notes and rating. Decide what undo of an `accepted`
  does to the wantlist (the sandbox pretends nothing needs undoing).
- Settings writes and jobs then run for real; check the jobs panel against real progress shapes.
- Token status in Settings (a read-only endpoint saying whether `DISCOGS_TOKEN` is set).
- Re-audition maybes: open a Twelves record in the triage player.

## Session 4: coverage pass and freshness

- Coverage pass: mis-tagged and no-year releases on labels/artists present in the accepted set,
  via the loader's `--labels` / `--artists` mode; a job that derives the id lists from `verdicts`.
- Monthly dump diff: load a new dump, report new releases in the filtered universe.
- YouTube-search fallback for `no_audio` releases inside the app.

## Session 5: Electron shell

Per `docs/ELECTRON_PLAN.md`: main process imports `createServer`, packaging with electron-builder,
`@electron/rebuild` for `better-sqlite3`, menu items for jobs, signing and notarization.

## Known gaps to keep in mind

- The dump element shape was written from the published format, not verified against a real
  dump (none was present). Verify on first load (`docs/DISCOGS_NOTES.md`).
- `enrich` treats a 404 as enriched to avoid retry loops; a later `enrich --force` could revisit.
- Sandbox: prices and have/want appear only for releases enriched from the CLI
  (`npm run digga -- enrich --ahead 200`), which writes to the database; the app's Enrich button
  only simulates. After a settings change, the sandbox's "to go" count still subtracts every
  sandbox verdict, including ones the new filters exclude.
- Twelves lists every shelf in one request; fine for hundreds of records, worth paging past a
  few thousand.
