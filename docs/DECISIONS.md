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
    and their host elements are `inert`, which keeps the iframes out of the tab order and away
    from clicks; YouTube's own J/K/arrow/digit shortcuts would otherwise swallow Digga's keys
    once focus is inside the video. Every control is a key or a button outside the iframe.
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
45. **The counter says "dug"** ("4,312 dug", ALL DUG at the end of the queue), replacing
    "rinsed". It ties to the app's name and reads the same for any genre. `dugCount()` in
    `src/shared/api.ts` defines it for the app and for `digga stats`: every triage verdict
    (`rejected`, `accepted`, `maybe`, `candidate`, `no_audio`), no seeds.
46. **`M` means "maybe: for the Discogs Maybe list"; the old "hear it again later" is `snoozed`
    on `L`.** The owner keeps a private Discogs list for records not good enough for the
    wantlist. No triage verdicts existed yet, so the status could be renamed without a migration.
    `L` ("later") was free; `snoozed` sits with `N` and `D` in the smaller group of the verdict
    bar, since it defers rather than judges.
47. **The Discogs API cannot write to lists**, so `M` records the verdict and Twelves hands off:
    maybes from triage are marked "not on your Discogs Maybe list yet", `O` opens the release, and
    reading the list again (`I` in Twelves, the Maybe list import, `digga import list`) turns
    them into `seed:list` maybes. The website's own add-to-list call uses a browser session, not
    the API token, and was not used.
48. **`discogs.maybeListId` in the config chooses the list**, from `GET /api/discogs/lists`. `M`
    is only offered once it is set; the key explains where to set it otherwise.
49. **The Maybe list ranks between want/grail and other triage verdicts** (1.55 against 1.6 and
    1.5). A triage `maybe`, skip or snooze turns into the list seed; a want or grail stays, and a
    wantlist or collection seed still wins. Removing an item from the Discogs list does not remove
    the verdict, as with the wantlist import.
50. **The sandbox reads the real list.** Reading a list is not a write, so the sandbox's Maybe list
    import calls `GET /api/discogs/lists/:id` (which resolves entries without writing) and keeps
    the resulting `maybe` seeds in memory. That lets the whole hand-off be tried before going live.
51. **"Dug" is counted by source, not status**: `Stats.dug` counts verdicts with source `triage`
    or `manual`, because `maybe` can now also be a seed from the Discogs list. It replaces the
    client-side `dugCount()` of decision 45.
52. **Sandbox mode is a setting, `sandbox` in `digga.config.json`, on by default.** A first run
    cannot change anything by accident; the header's sandbox stamp links to the setting, which
    Settings highlights. The switch is saved at once, outside the save bar, because it decides
    whether the next verdict is kept.
53. **The sandbox fakes only the digging writes**: verdicts, track marks, listens, wantlist pushes
    and removals, and the Maybe list import (which writes verdicts). Settings and the other jobs
    (dump load, enrich, collection, wantlist and history imports) set Digga up rather than dig, so
    they are real in the sandbox too; otherwise a new user would configure and load everything
    twice. This replaces the session 2 sandbox, which faked every write.
54. **The server refuses digging writes with `409` while `sandbox` is on.** The client fakes them
    anyway; the check means a client that missed a switch cannot save a verdict or reach Discogs.
55. **`api` is a facade that switches implementations** (`createAppApi`). Each switch into the
    sandbox starts an empty one, and bumps `api.generation`, which makes the triage session drop
    its undo history, passes and details, and the player its heard tunes. The session sends every
    write through `api.pinned()`, so a write queued in one mode never lands in the other.
56. **Undo after a wantlist push takes the release off the Discogs wantlist**, replacing the last
    sentence of decision 40. The session's wantlist writes run one at a time and each decides when
    it runs, from the newest verdict in the undo history (and, before a push, the saved verdict,
    which Twelves may have changed during the grace period). Any order of `A`, `Z` and slow
    requests therefore ends with the release on the wantlist exactly when its verdict is a want.
    In Twelves, re-judging a record as want adds it to the wantlist, and re-judging a want as
    anything else (grail too) takes it off, so the Want shelf and the wantlist agree; `Z` reverses
    both. `A` on a want that is not on the wantlist retries the push.
57. **A push is recorded in `seed_items`, not in the verdict.** The row is what the next wantlist
    import would write, so `TwelvesItem.onWantlist` works from one table for imported and pushed
    wants. The verdict stays `accepted` until that import outranks it with a `wantlist` seed.
58. **Snoozed records come back as rounds.** `Enter` on a snoozed record in Twelves, or the button
    at the end of the queue, puts snoozed records ahead of the queue (oldest first from the end of
    the queue, shelf order from Twelves). A verdict replaces the snooze and keeps its note, `N`
    leaves it snoozed, undo restores it with its original date, and the queue resumes where it was
    after the last one or on `Esc`. A timed return to the queue was not chosen: the queue always
    starts at the first undecided release, so snoozed records would come back on every reload.
59. **`filters.skipWithoutVideos` is a query-time filter** on releases with at least one embeddable
    video. It applies per release before grouping, so a master whose main release has no video is
    represented by a pressing that has one. Off by default.
60. **Page keys work while a checkbox, radio button or slider has focus.** Only text fields and
    menus take the keys; a clicked checkbox used to swallow `T` and the verdict keys.
61. **Settings shows whose `DISCOGS_TOKEN` it is** (`GET /api/discogs/account`, one identity
    request), and the Sandbox section warns before going live when a push would fail: no token, a
    token for another account, or no username.
62. **Twelves changes run one at a time**, each on the records as the previous change left them,
    so `A` then `R`, or `Z` before a push returns, act on the right verdict. Re-judging a want
    always sends the wantlist removal, because a push from Triage may land after Twelves loaded.
63. **A listen is posted through the api of the mode it was heard in**, and hiding the Triage page
    flushes it, so seconds heard in the sandbox never reach the database after switching it off.
    A tap shorter than the 4 s threshold is not posted at all when the track is left, as
    decision 38 intended.
64. **The server backs up the whole database once a day and keeps five copies.** Skips, grails,
    track marks and notes exist nowhere else; wants are the only decisions Discogs mirrors. A full
    copy restores by copying a file back, with no import code to trust. It includes the release
    rows (most of its size) because a partial copy would need a restore path of its own. The copy
    uses better-sqlite3's `backup()`, which works in steps beside requests, and is written under a
    `.partial` name first so an interrupted copy never counts as the day's backup.
65. **Exports read the database.** `decisions.json`, `verdicts.csv` and `track-marks.csv` hold what
    is saved, with release artist, title, label and catalogue number so they read without Digga.
    Sandbox verdicts stay in the browser tab and are not in them; Settings says so.
66. **Enrich can cover the whole queue and refresh Twelves.** `ahead: "all"` (`enrich --all`) works
    through every unenriched record still to dig (a spelled-out value, so a cleared count field
    cannot start it); at the 1.1 s request gap that is about two hours
    for 7,000 records. The queue leaves out records with a verdict, so records judged before they
    were enriched, and imported wantlist and collection stubs, never got prices; `enrich_twelves`
    is a job type of its own that refreshes the Twelves records, never enriched first, then the
    oldest data. It is a separate type so the jobs table says which one ran.
67. **Settings says how much of the queue has a want count.** "Most wanted first" sorts by
    `community_want`, which only enrich fills, so on an unenriched queue it falls back to id
    order. The option's hint counts the records to dig that have one, and a warning offers
    "enrich all" with its duration.
68. **Triage enriches the next records as they come up** (`discogs.enrichAhead`, default 5, 0
    turns it off). The session asks the server for one release at a time, each once, through
    `POST /api/releases/:id/enrich`, so a long session never waits for a batch job and never
    exceeds the Discogs rate. It is a setup write like the enrich job, so it reaches the server in
    the sandbox too. The fresh market data replaces the queued record's; fresh videos replace the
    details of records still waiting, never those of the record playing.
69. **Marked tracks get a Twelves shelf** (`8`, Tracks). For the ID hunt a track marked grail is
    the result, and marks were only visible on the release in Triage. The shelf lists grail and
    keep marks, not meh, sorted and filtered like the records by their release. `E` edits the
    note the `track_verdicts` table always had; a mark written without notes keeps the saved one,
    so changing a mark in Triage does not drop it, and editing a note keeps the mark's date.
70. **The server writes the want's note.** A push without `notes` sends "grail B1; keep A1, A2;
    the record's note", built from `track_verdicts` and the verdict at push time. Triage pushes
    after the verdict and the marks are saved, so both reach Discogs; the same text goes into
    `seed_items.notes`. Notes changed after the push stay in Digga. A wantlist or collection
    import that takes over a verdict keeps the note Digga has, since the Discogs note is often
    the shortened one Digga sent; the Discogs note fills in only when Digga has none.
71. **`E` in Triage writes a note on the record, and its verdict saves it.** The record has no
    verdict while it is being heard, and the note belongs to the moment of hearing ("the tune from
    the Kool FM tape"). The session keeps notes by triage key, so a note survives `N` and undo
    and is sent with the next verdict on that record; a snoozed record starts from its own note.
    Notes not yet saved are lost on reload, like the passes.
72. **A record plays the videos of every pressing of its master.** The representative release is
    chosen by main release first, so a record whose original has no video could land on "no
    audio" while a repress or the CD has one: about 160 records of the owner's 7,139 had a video
    on another in-filter pressing, and 198 only on a pressing outside the filter. Another
    pressing's video joins the detail only when its matched track is a tune of this release, by
    heard key, and it takes this release's position, so heard tracking, marks and listens stay on
    the release being judged. Decision 59's per-release filter becomes per record for the same
    reason, and asks the same as the player: a video on another pressing counts only when its
    matched track is a tune of the release. The SQL starts from the master's pressings (`CROSS
JOIN`); starting from a tune's heard key took 1.3 s per query on the owner's data, 0.1 s this
    way.
73. **Pasted YouTube links live in `user_videos`, not `videos`.** Dump loads and enrich replace a
    release's `videos`, which would drop them. `⌘V` anywhere in Triage (outside text fields)
    attaches the link to the release on screen and plays it; in Twelves it goes on the selected
    record. Attaching is catalogue data like enrich, so it reaches the server in the sandbox too.
    The title comes from YouTube's oEmbed endpoint, which needs no API key (search would need a
    Data API key at 100 quota units a query); it lets the link match a track, and without it the
    link plays as an unmatched video.
74. **A no-audio record comes back only for a video it did not have.** `D` is also the answer to
    "none of its videos will play here", so bringing records back whenever they have an
    embeddable video would return them after every dump load. The verdict route records the video
    ids the player had for the release; `requeueNoAudio()` runs after a dump load, after each
    enriched release and after an attached link, and deletes the verdict of records with a new
    one. Verdicts from before the snapshot count their current videos as known, and a link pasted
    in the sandbox leaves the saved verdict for the next dump load or enrich to reconsider.
    `enrich_twelves` covers the No audio shelf, so "Refresh Twelves" looks for fresh videos.
75. **No audio is a Twelves shelf (`9`) but not part of Everything.** Everything is what you want,
    own or put aside; the records nothing played on are leftovers to rescue with `Y` (YouTube
    search, since `S` sorts in Twelves) and `⌘V`, or to re-judge.
76. **A third deck buffers the track `J` moves to.** Measured in Chrome on the owner's queue, `J`
    took a median 1.2 s (0.9 to 1.5 s) from the key to playback, because the next video loaded on
    the playing deck; over about 22,800 tracks that is roughly seven hours. The third deck loads
    the entry `J` would pick, muted and paused at its start, and `J`, auto-advance or a click on
    that track swaps it in the way a verdict swaps in the next release; the median dropped to
    0.28 s, most of it the measurement's polling. The deck re-aims after every track change and
    after an embed error, and the three roles (playing, next release, next track) rotate between
    fixed hosts because moving an iframe reloads it (decision 36).
77. **Labels and format descriptions are query-time filters.** `filters.excludeLabels` matches a
    release's first label, the one shown and swept, case-insensitively, and also its bracketed
    variants: Discogs names self-releases "Not On Label (Artist Self-released)" (about 240 of the
    owner's records) and tells same-named labels apart as "Name (2)". `includeDescriptions` and
    `excludeDescriptions` test the format descriptions (`12"`, `Promo`, `Unofficial Release`,
    `Compilation`). Nothing is excluded by default: white labels and promos are ordinary records
    in this scene.
78. **`X` hides the label on screen and `Z` undoes it like a verdict.** The session keeps a
    "label" entry in the undo history and changes the filter through a callback the Triage page
    gives it, which saves the settings; the save restarts the queue as any settings change does.
    Hiding is a settings write, so it is real in the sandbox too, and Settings lists the hidden
    labels one per line (names can contain commas).
79. **Color tokens are named by role, and the accent has three roles.** `--bg`, `--surface`,
    `--rule`, `--fg`, `--fg-muted` and `--fg-faint` replace ground, sleeve, groove, paper, faded
    and dust, names that described the dark palette; in a light scheme the page is the paper.
    The accent fills key caps, the primary button and selections (`--accent`, with
    `--on-accent` text), draws bars, underlines, outlines, focus rings and progress
    (`--accent-mark`), and sets text (`--fg-accent`). Decision 31 kept it off text, but notes,
    flash messages and the playing position had taken it anyway; `--fg-accent` names that use.
    Yellow only reads as a fill on a light background, so the three can differ per scheme.
80. **Faint text reaches 4.5:1.** Dust (`--fg-faint`) was `#6b675e`: 3.2:1 on the ground and
    3.0:1 on the sleeve, below the WCAG minimum for text this size, and it sets hints,
    placeholders, counts and heard tracks. `#8e897d` reaches 5.0:1 and 4.6:1, measured on
    screenshots because the grain lightens both surfaces by a few levels, and stays a visible
    step below faded.
