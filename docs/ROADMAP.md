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

## Session 5 (done): setup without a terminal, coverage pass and freshness

Decisions 86 to 93.

- The Discogs token is saved in Settings, and Settings downloads the newest dump, checked against
  its published checksum. The jobs panel was checked against a full download, load and enrich:
  it shows how far a load has read and the time a job has left.
- Coverage pass: every load also keeps releases in other styles on the labels and by the artists
  of wanted or owned records, when those mostly release the styles; undated records on them
  reach the queue.
- Freshness: "Update from the newest dump" (`digga dump update`) downloads and loads the month's
  dump in one job. Each load is recorded, Settings says what it added and did not find, and `F`
  digs the records it added.

## Next

- If Discogs adds a list-write endpoint, push `M` to the Maybe list like `A` pushes to the
  wantlist, and drop the manual hand-off in Twelves.
- Hear records from Twelves: rounds like the snoozed ones for wants, grails and marked tracks.

## Session 6: Electron shell

Per `docs/ELECTRON_PLAN.md`: main process imports `createServer`, packaging with electron-builder,
`@electron/rebuild` for `better-sqlite3`, menu items for jobs, signing and notarization.

## Known gaps to keep in mind

- Releases a load no longer finds stay in the library and the queue; the load only counts them.
- The coverage pass and the undated filter read the verdicts saved on the server, so sandbox
  wants widen neither.
- A dump download cannot resume: data.discogs.com answers range requests with the whole file.
- Nothing deletes a dump by itself: Settings says which dumps nothing needs and deletes them on
  request, 10 GB each.
- Sandbox: after a settings change, the "to go" count still subtracts every sandbox verdict,
  including ones the new filters exclude.
- With `skipWithoutVideos`, a release without videos in the dump never reaches Triage, which is
  where enrichment happens, so it comes back only with a newer dump.
- Twelves loads every shelf in one request and pages only the rendering. 5,000 records take
  0.23 s and 3 MB; past tens of thousands the server should page too.
