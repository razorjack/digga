# Roadmap

## Session 1 (done): foundation

Repo, config, paths, secrets, logger, SQLite + migrations, streaming dump loader with worker
runner, Discogs client, seed importers (collection, wantlist, browser history), enrich, queue
query, Hono API, CLI, placeholder Svelte UI, docs, tests, portability check.

## Session 2: design + triage UI

- Visual design from `docs/DESIGN_BRIEF.md`.
- Triage page: YouTube IFrame player starting at `startAtFraction`, hidden preloading second
  player, tracklist with heard/has-video flags, the full keymap from `docs/KEYMAP.md`, undo,
  stats header (rinsed counter, remaining, ETA).
- Listen logging to `POST /api/listen-log`.
- Help overlay (`?`).

## Session 3: Twelves, push to Discogs, settings, jobs

- Twelves view (accepted / wantlist / collection / maybe / candidate) with notes and sorting.
- Implement `POST /api/discogs/wantlist/:id` and the client stubs `addToWantlist` /
  `addToCollection`; push `accepted` with notes and rating.
- Settings UI writing `PUT /api/settings` (universe, filters, strategy, account, player).
- Jobs UI: run loader / importers / enrich from the app with progress and cancel.

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
- No cancel button in the UI yet, but `POST /api/jobs/:id/cancel` exists.
