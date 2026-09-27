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

## Session 3 (done): go live, push to Discogs

- `sandbox` in the config, on by default, switched in Settings (the header's sandbox stamp links
  to the highlighted setting). The sandbox fakes only the digging writes now; settings and jobs
  are real. The server refuses digging writes while it is on.
- `POST` / `DELETE /api/discogs/wantlist/:id`: `A` adds the release to the Discogs wantlist, `Z`
  takes it off again, Twelves re-judging keeps the wantlist in step and marks wants that did not
  reach it (`A` retries, "add all" for several).
- Token status in Settings (`GET /api/discogs/account`, whose token it is).
- Rounds of snoozed records in Triage, from Twelves (`Enter`) or the end of the queue.
- `filters.skipWithoutVideos`; first-run states for an empty library and filters that match
  nothing.

## Next

- Check the jobs panel against real progress shapes on a long enrich and a full dump load.
- `addToCollection` is still a stub; nothing in the UI needs it yet.
- If Discogs adds a list-write endpoint, push `M` to the Maybe list like `A` pushes to the
  wantlist, and drop the manual hand-off in Twelves.
- Twelves notes on a want could be copied to the Discogs wantlist notes.

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
- Sandbox: after a settings change, the "to go" count still subtracts every sandbox verdict,
  including ones the new filters exclude.
- `skipWithoutVideos` also narrows enrich, which works through the queue, so a release without
  videos in the dump only comes back with a newer dump.
- Twelves lists every shelf in one request; fine for hundreds of records, worth paging past a
  few thousand.
