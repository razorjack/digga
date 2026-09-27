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
27. **Writes are faked in the transport seam, not on the server.** The owner asked for a full
    flow with no database writes and nothing sent to Discogs while the UI is tuned.
    `createSandboxApi(inner)` in `src/client/sandbox.ts` forwards reads, keeps verdicts, track
    marks, listens, settings and jobs in memory, and overlays them on later reads (queue,
    remaining, rate/ETA, Twelves, heard tracks). The client never sends a write request, so a
    server started normally stays untouched. A server-side scratch copy of the database was the
    alternative; it would have exercised the real write routes but still counts as writing a
    database. Going live is one line in `src/client/api.ts`. A test runs the sandbox over the real
    HTTP API with every inner write method throwing and checks that no table changes.
28. **`GET /api/queue` and `GET /api/stats` accept a `filters` JSON parameter** that replaces the
    configured filters for that read. The sandbox needs it to apply unsaved settings; Settings
    uses it for the live "these filters match N records" preview. Both are reads.
29. **The app is opened on `localhost`, never `127.0.0.1`.** YouTube refuses some embeds with
    error 150 on IP-address origins while playing them on `localhost` (checked with three
    videos from the same release: two refused on 127.0.0.1, all three played on localhost). The
    server still binds to 127.0.0.1; `start()` returns `browserUrl` on localhost, the CLI prints
    it, and the app shows a link to the localhost address when opened on 127.0.0.1.
30. **Typefaces: Michroma and Martian Mono, bundled via Fontsource.** Michroma descends from
    Eurostile Extended, the type of late-90s drum & bass sleeves; it sets artist names, counters
    and stamps. Martian Mono (variable width, set at 87.5%) sets everything else and keeps
    positions, catalogue numbers and durations aligned. Fonts ship in `dist/`, so Electron and
    offline use need no CDN.
31. **One accent, used as paper.** Dayglo flyer yellow (`#ffd21a`) fills the verdict key caps,
    the playing-track bar, progress and the positive verdict stamps; it is never used for glowing
    text. Surfaces are graphite, text is white-label paper (`#ebe5d4`).
32. **The signature is rubber-stamp ink.** Catalogue numbers and verdicts render as stamps: an
    SVG filter (`#ink`, `#ink-fine` in `App.svelte`) adds speckled voids and wobbly edges, and a
    stable per-release tilt (`stampTilt`). The only motion is the stamp slamming onto the last
    verdict slip (150 ms, off under `prefers-reduced-motion`).
33. **`D` records `no_audio`.** The keymap left the key open. `D` sits next to `S` (the YouTube
    search for the same situation) and away from the verdict keys.
34. **`Z` also undoes `N`.** Undo walks back through verdicts and passes alike, so an accidental
    `N` is as cheap to take back as an accidental verdict.
35. **The embed never takes focus.** Players are created with `controls: 0` and `disablekb: 1`
    and the iframe has `pointer-events: none`; YouTube's own J/K/arrow/digit shortcuts would
    otherwise swallow Digga's keys after a click on the video. Every control is a key or a
    button outside the iframe.
36. **Two decks, swapped rather than moved.** Both player iframes stay in place; the hidden one
    is transparent and muted. Moving an iframe in the DOM reloads it, so a verdict swaps which
    deck is visible. Events and progress from a deck that still holds the previous release are
    ignored.
37. **The Triage page stays mounted when another page is shown.** The session (queue, undo
    history, passes) and the players survive a visit to Twelves or Settings; leaving the page
    pauses playback. Saving settings restarts the queue with the new filters.
38. **A listen is logged after 4 s of playback**, then the remainder when the track is left.
    Shorter taps (seeking past, skipping at once) do not grey a tune out elsewhere.
39. **Rate and ETA helpers moved to `src/shared/rate.ts`** so the sandbox computes the same
    rate from its in-memory decisions as the server computes from the `verdicts` table.
40. **A want (`accepted`) waits 1.5 s before the wantlist push**, and the push runs outside the serialised
    write chain. A quick `Z` cancels the push instead of chasing it, and a slow Discogs request
    never holds back the next verdicts. Undoing after the push leaves the release on the Discogs
    wantlist; live mode says so.
41. **`GET /api/queue` accepts `offset`.** The sandbox pages past its own verdicts, which the
    server still counts as undecided, instead of hitting the 5,000-row limit after a long session.
42. **YouTube errors are charged to the video the player reports** (`getVideoData().video_id`),
    not to whatever the deck loaded last; an error that arrives after `J` moved on would
    otherwise block the wrong video for the session.
43. **Tunes heard this session are tracked in the player** (`heardKeys`), because the next
    releases' details were prefetched before the listen and still say `heard: false`. Playlists,
    the preload and the tracklist use the set.
44. **Verdict copy is "want" (`A`) and "grail" (`C`)**, replacing "wheel up" and "bo!". Digga is
    for general digging, not only the ID hunt: a grail is the one you have been hunting, whether a
    long-sought record or a half-remembered tune. The imported wantlist shelf in Twelves is
    labelled "Discogs wantlist" so it does not read like the "Want" shelf.
