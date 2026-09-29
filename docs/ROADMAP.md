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

## Session 4 (done): keep the work, spend less time per record

Decisions 64 to 78 in `docs/DECISIONS.md`.

- A daily database backup on server start (five kept), `digga backup`, and JSON/CSV exports of
  verdicts and track marks.
- Enrich for every record still to dig or for the Twelves records, want-count coverage for the
  "most wanted" order, and enrichment of the next records while digging.
- A Twelves Tracks shelf for tracks marked grail or keep, with notes; wants carry the marked
  tracks and the record's note to the Discogs wantlist.
- Notes in Triage (`E`), saved with the verdict.
- Videos of every pressing of a master play on the record.
- The no-audio path: pasted YouTube links (`⌘V`), a No audio shelf, and records that return to
  the queue when a new video appears.
- A third deck that buffers the next track, so `J` starts at once.
- Label and format-description filters, and `X` to hide the label on screen.

## Next

- `addToCollection` is still a stub; nothing in the UI needs it yet.
- If Discogs adds a list-write endpoint, push `M` to the Maybe list like `A` pushes to the
  wantlist, and drop the manual hand-off in Twelves.
- Notes and marks changed after a push stay in Digga; `POST /users/{u}/wants/{id}` could update
  the want's note on Discogs.
- Hear records from Twelves: rounds like the snoozed ones for wants, grails and marked tracks.

## Session 5: coverage pass and freshness

- Coverage pass: mis-tagged and no-year releases on labels/artists present in the accepted set,
  via the loader's `--labels` / `--artists` mode; a job that derives the id lists from `verdicts`.
- Monthly dump diff: load a new dump, report new releases in the filtered universe.

## Session 6: Electron shell

Per `docs/ELECTRON_PLAN.md`: main process imports `createServer`, packaging with electron-builder,
`@electron/rebuild` for `better-sqlite3`, menu items for jobs, signing and notarization.

## Known gaps to keep in mind

- `enrich` treats a 404 as enriched to avoid retry loops; a later `enrich --force` could revisit.
- Sandbox: after a settings change, the "to go" count still subtracts every sandbox verdict,
  including ones the new filters exclude.
- `skipWithoutVideos` also narrows enrich, which works through the queue, so a release without
  videos in the dump only comes back with a newer dump.
- Twelves lists every shelf in one request; fine for hundreds of records, worth paging past a
  few thousand.
