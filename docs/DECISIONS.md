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
13. **`random` strategy is a multiplicative hash of the release id XOR the seed**; the API defaults the seed to the
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
81. **A light scheme follows the system.** The brief started dark only, for long sessions without
    glare; a light scheme now sits beside it. Every color token is a `light-dark()` pair under
    `color-scheme: light dark`, so the system preference picks the scheme without script and no
    component has scheme-specific rules. Light is warm paper, not white, with the dark scheme's
    text steps (about 14:1, 7:1 and 5:1, measured under the grain). Yellow is 1.2:1 on paper, so
    it stays a fill, and marks and accented text turn dark amber `#855000`. Soft-light grain
    barely changes a light surface, so the noise masks a `--grain` color: light gray on the dark
    scheme, black on paper. The stamp ink filter only cuts holes in the alpha channel and needs
    no change; the YouTube embed stays a black rectangle.
82. **The color scheme is a setting, saved at once.** `appearance.colorScheme` (`system`, `light`
    or `dark`) lives in `digga.config.json` rather than browser storage: the Electron shell
    serves the app on a free port, so its origin, and localStorage with it, changes on every
    start. Settings saves it outside the form, like the sandbox switch, but without a new
    settings version, so it is the one save that leaves the Triage queue alone; quick changes
    are saved in order. `App.svelte` sets `data-color-scheme` on the root and `styles.css` turns
    it into `color-scheme`, because the build compiles `light-dark()` into variables that only a
    `color-scheme` declaration switches, not an inline style. In the browser the page follows
    the system until the settings load; Electron sets `nativeTheme.themeSource` from the config
    before the window opens.
83. **`F` digs one label or artist.** A scope narrows the Triage queue to the records of one
    label or one artist, picked from the record on screen or searched by name
    (`GET /api/scopes`, labels and artists with loaded records, most records first). It names a
    Discogs id, because several labels and artists share a name and Discogs tells them apart as
    "Name (2)"; the release's `labels_json`, `artists_json` and its tracks' `artists_json` carry
    the ids. A label matches any label line of a release, so co-releases count, and an artist
    matches release and track credits, since compilations credit their artists on the tracks.
    Discogs' "Various" (id 194) is left out. The scope is one more condition in
    `buildFilterWhere`: the filters, verdicts and order still apply, and the representative
    pressing is chosen among the releases in the scope, so the record shown is the one on that
    label or with that artist. `GET /api/queue` and `GET /api/stats` take it as `scope=label:123`;
    stats answer `scopeRemaining` for the banner and keep the header's counts for the whole
    queue. The scope lives in the session, not the settings: a reload or Esc returns to the whole
    queue, and a settings save keeps it. Passes start over with each scope because they belong
    to the queue they were made in. The sandbox subtracts only the local verdicts of keys the
    scope's queue returned, which is all of them once the queue has paged through the scope.
84. **A seller's shop is a scope, and buying stays on Discogs.** The use is one order with one
    shipping cost: a seller has a few wants, and their other stock is worth hearing before
    checkout. `import seller <username>` (a job, so real in the sandbox) looks the user up with
    `GET /users/{u}` and keeps only the release ids of their For Sale listings in
    `seller_releases`, keyed by the Discogs user id, which is also the scope's id. Prices,
    conditions and carts are left to Discogs: `A` pushes the release to the wantlist, and
    "Shop my wants" there shows it under that seller. Because the scope applies before the
    representative is chosen, the pushed release is the seller's pressing. The inventory API
    has no style filter and reportedly stops at page 100 of someone else's shop, so a read
    covers at most 10,000 listings and the job says how many the shop has. A new read replaces
    the old one; a cancelled read keeps it, since half a shop would look like a whole one.
    Sellers come first in the `F` search because there are few and their names are typed on
    purpose. Grails, maybes and snoozes never reach the wantlist, so a seller's records with
    those verdicts appear neither in the seller's queue nor under "Shop my wants".
85. **A grail goes onto the wantlist like a want and stays a grail in Digga.** "Grail" means "I
    am buying this, and I have been looking for it for a long time", so `C` pushes after the same
    grace period as `A`, `Z` takes it off, and Twelves keeps a record on the wantlist when it is
    re-judged between want and grail (`isWantlistVerdict()` in `src/shared/wantlist.ts`). This
    replaces the grail part of decision 56 and the last sentence of decision 84. Only the
    wantlist entry and its note go to Discogs, no rating: Digga stays a triage tool and keeps
    the grail mark to itself. A grail ranks 2.5, between the wantlist (2) and the collection
    (3), so the wantlist import that finds the pushed release leaves the verdict a grail, and
    owning the record still ends the hunt. Grails from before this change are not on the
    wantlist; Twelves marks them like a failed want push, and `C` or "add all" adds them.
86. **Settings saves the Discogs token.** A packaged app has no `.env` to edit, and the browser
    version should not need one either. `PUT /api/discogs/token` takes a token, or null to remove
    it, and answers the account as `GET /api/discogs/account` does, so the field shows at once
    whose token it is. `Secrets` gained `setDiscogsToken` and `discogsTokenSource`: the CLI's
    implementation rewrites the `DISCOGS_TOKEN` line of `.env`, keeps the other lines, and
    writes the file readable by its owner only; Electron's will use `safeStorage`. A token in the
    environment still wins, so the route refuses with `409` and Settings says why instead of
    saving a token that would not be used. A token Discogs refuses is saved anyway, with the
    reason next to the field, since Discogs may only be unreachable. Setting up is not digging,
    so the sandbox does not refuse it.
87. **Digga downloads the newest dump itself.** Without a terminal, the dump was the one step a
    user could not do from Settings. `dump download` (`POST /api/jobs/dump-download`) reads the
    year pages of data.discogs.com, takes the newest `discogs_YYYYMMDD_releases.xml.gz`, and
    skips the download when the folder has it. The file is written as `<file>.part` while it is
    hashed and renamed only when its SHA-256 matches `CHECKSUM.txt`, so a file under a dump's
    name is always whole; a failed, cancelled or mismatched download leaves nothing. The server
    does not answer range requests, so there is no resume. The job checks for the dump's size
    plus 1 GB free first, refuses a second download while one runs, and runs on the server
    thread because it waits on the network; hashing a chunk takes microseconds. Old dumps are
    not deleted: after a load they are only needed again for another load, and deleting a
    10 GB file is the user's call. Settings lists the folder (`GET /api/dumps`) and offers its
    newest dump to Load.
88. **The jobs panel shows how far a job has got and how long it has left.** Checked against a
    download of the 2026-09-01 dump (7 min 45 s), a full load of it (19,417,067 releases,
    13 min 27 s) and a 300-record enrich, all started from the panel. The load reported only
    counts, so it ran without a bar; it now reports how much of the compressed file it has
    read, which tracks the scan closely. A running job with a fraction gets an estimate from
    its pace so far, once it is past 1% and 10 seconds; on the load it was within 6% of the
    real end from the second minute and within 2% from the fifth. Progress text wraps instead
    of being cut off, which had hidden the estimate and long errors, and keeps the estimate on
    one line. Durations over an hour read "2 h 5 min" and the duration column no longer
    wraps. "Enrich all" shows no estimate when nothing is left to enrich.
89. **The loader runs as a step of an async job.** `runWorker()` (`jobs/worker.ts`) starts the
    worker, forwards its progress, terminates it when the job's signal fires, and settles once
    the worker has exited, so nothing uses the database after it. The runner lost its separate
    worker path: every job is an async function, and one that needs a worker awaits it, which
    lets a single job download the dump and then load it. A worker that has posted its result
    but not exited keeps its job running; it used to show as done.
90. **The coverage pass is part of every load.** With `universe.coverage` (on by default) a load
    also keeps releases in other styles on the labels, and by the release artists, of the
    records the user wants or owns: wants, grails, the wantlist and the collection, every
    pressing, stubs included. The ids come from the database when the load starts
    (`queue/coverage.ts`), so a new want widens the next load. A label that mostly releases
    other music would flood the queue, so a label or artist qualifies only when at least a
    third of its releases in the load years carry one of the styles, and not at all past 500
    releases in other styles. The share is only known at the end of the dump, so candidates
    wait in memory until then; the cap bounds them. Various, Unknown Artist and "Not On Label"
    never count. The load years apply to coverage releases too, and a load stopped by its
    limit keeps none, since it has no shares to go on. `--labels` and `--artists` now add ids
    to the pass instead of replacing style matching.
91. **Undated releases on the labels you want reach the queue by default.** 5,559 of the
    owner's 71,699 loaded releases have no year, and `includeUnknownYear` is off because most
    of them would be noise. Those on the coverage labels and artists are the likely strays of
    the years dug, and the label sweep puts them beside their catalogue neighbours, so
    `filters.includeUnknownYearOnCoverage` (on by default) lets them in. It is a query-time
    filter like the others: the coverage set is read from the verdicts in the same query
    (`ON_COVERAGE` in `queue/coverage.ts`), so a new want lets its label's undated records in
    at once. Sandbox verdicts stay in the tab, so they do not widen it. On the owner's library,
    with 212 seed verdicts, it adds 134 records to dig and about 12 ms to a queue query.
92. **Each load is recorded, and `F` digs what the last one added.** A new monthly dump brings
    releases that contributors added or retagged, and a wider coverage set brings more; the
    load reloaded them silently. `dump_loads` records each load, and `releases.added_by_load`
    names the load that brought a release into the universe, so the diff is a query rather
    than a comparison of two dumps. A load also counts the universe releases it did not
    write: Discogs deleted or merged them, or they no longer match. It finds them by
    `releases.written_by_load`, the newest load that wrote each release; write times failed
    when two loads wrote within the same millisecond. They stay, since a verdict or a listen
    may refer to them, and the count only tells the user. The records a load
    added are the scope `load:<id>`: Settings says how many are still to dig, and `F` offers
    them after the record's own labels and artists, so `F` then Enter still digs the first
    label. A cancelled load's additions pass to the next finished load, which is the first to
    report them.
93. **The monthly update is one job.** "Update from the newest dump" downloads the newest dump
    unless the folder has it, then loads it: the coverage pass, the load record and the new
    records under `F` come with it. It runs even when that dump was loaded before, since the
    coverage set may have grown since. Its progress is the download's, then the load's, tagged
    by `step`, and the estimate for the load step uses the load's own time, not the job's. A
    download, a load and an update each refuse to start while another of them runs, since two
    would write the same file or the same rows. Checked from the panel with the owner's
    collection and wantlist (214 records, 122 labels, 166 artists): the update found the dump
    downloaded and loaded it in 819 s, 12 s more than without coverage. It kept 557 releases in
    other styles, mostly Jungle, Breakbeat and Hardcore on Moving Shadow, Certificate 18 and
    Passenger, 87 of them records to dig under the default filters, and left out 9 labels and
    artists that mostly release other music, P!NK among them.
94. **Digga is a triage tool, not a Discogs client.** It reads Discogs to decide what to dig and
    writes back only what a verdict decides: the wantlist entry and its note. Buying, owning and
    keeping Discogs data current happen on Discogs. So the `addToCollection` stub and the
    wantlist push's unused `notes` and `rating` options are gone, and the roadmap no longer
    plans to update a want's note after the push. `seed_items` keeps the Discogs data it stores
    (date added, rating, notes, basic information) although nothing reads it yet: showing more
    of it later would otherwise need every user to import again.
95. **Enrichment happens only in Triage, for the record on screen.** Digga is for triage by ear,
    and a record is heard before anything about it is worth fetching. The bulk jobs ("Enrich
    next N", "Enrich all", "Refresh Twelves", `digga enrich`) are gone, and so is the "most
    wanted first" order, the only thing that needed the whole queue enriched: it suits someone
    who cannot hear everything, and Digga's premise is hearing everything. The jobs also
    promised fresh videos, but of 305 records enriched a month after their dump none had gained
    or lost a video, and the monthly update reloads videos anyway. Enrich-ahead stays
    (`discogs.enrichAhead`, the record on screen and the next few), since price and have/want
    can matter while deciding. A saved "popular" order reads as the label sweep, and
    migration 5 deletes the jobs rows of the removed types, which the jobs panel could no longer
    describe.
96. **A release Discogs no longer has stays without market data.** Decision 14 stored a 404 as an
    empty snapshot so the bulk jobs would not ask for it on every pass. Those jobs are gone, and
    the empty snapshot read as "none for sale, 0 want, 0 have" in Triage and Twelves. A 404 now
    only fails the request (`502`, "Discogs did not return the release").
97. **Prices come when asked for, with `P`.** Enrich ahead (decision 68, on by default) asked
    Discogs about every record Triage reached, about 6,000 requests over the owner's queue, for
    records mostly skipped within seconds. A price matters once a record might be bought, so `P`
    fetches the record on screen, and the line shows the answer's age; pressing it again
    refreshes it. While digging, Digga now calls Discogs only when the user acts: `P`, a wantlist
    push, an import. A setting to choose between the two was not added: the count already
    switched enrich ahead off, and two paths cost more than they give a triage tool.
    `discogs.enrichAhead` is gone; a saved config that has it still parses, and the next save
    drops it.
98. **The library lives in the per-user app folder.** The database, backups, `digga.config.json`
    and the token Settings saves (`secrets.env`) default to the folder Electron will call
    `userData` (`~/Library/Application Support/Digga`, `%APPDATA%\Digga`, `~/.config/Digga`), so
    the packaged app opens the library the browser version built, with nothing to move. Dumps
    default to the OS cache folder: they are 10 GB each and can be downloaded again, Time Machine
    skips `~/Library/Caches`, and `%APPDATA%` roams. The CLI reads a `.env` in its working
    directory into the environment, variables already set winning, and passes `DIGGA_DATA_DIR`,
    `DIGGA_DUMPS_DIR` and `DIGGA_CONFIG_FILE` to `resolvePaths()`, which reads no overrides
    itself, so tests and Electron are never redirected by the shell. A library placed with
    `DIGGA_DATA_DIR` keeps its dumps inside it, so a throwaway library never writes to the cache.
    A new config starts from the schema defaults, since the app folder has no example to copy.
    There is no migration from `./data`: the only library was moved by hand.
99. **Every request from the client times out.** A request that never returned left `P` on
    "asking Discogs…" for good, and a stuck wantlist push would hold up every push after it,
    since they run one at a time. The timeouts sit above what the server can legitimately take:
    30 s for database answers; 5 min for a Discogs call, which may wait out a 60 s rate-limit
    pause or 429 backoffs; 15 min for reading a Discogs list, one lookup a second per entry
    outside the library. A timed-out request may still finish on the server: a price is then
    stored and shows next time, and a push reaches the wantlist although the slip says it
    failed. Twelves reads what the server recorded, so it shows such a want as on the wantlist.
100. **Twelves pages what it renders, 500 records a page.** Measured with 5,212 records (4,234 on
     Everything): the request took 0.23 s and 3 MB, while rendering took 1.5 s to open the page,
     about 550 ms per sort change and 40 ms per `J`. With pages of 500, a sort or shelf change
     takes about 80 ms and `J` 20 ms; smaller pages would save little more, since opening the
     page costs about 0.7 s whatever the page size. The one request stays, so shelf counts, "add
     all", rounds of snoozed records from the selected one onwards and undo keep covering the
     whole shelf, as does the sandbox overlay. The page follows the selection: `J` and `K` cross
     into the next page and `←` / `→` jump a page.
101. **Settings deletes dumps; nothing deletes them by itself.** Each dump is over 10 GB, and
     Digga reads one only while it loads it, so a loaded dump, and any dump older than it, is
     kept only to load again without a download. Settings lists the dumps with what each is
     for ("the library was loaded from it", "nothing needs it: the 1 Oct dump is newer", "not
     loaded yet") and deletes one after a confirmation, since a deleted dump means another
     download of over 10 GB. `DELETE /api/dumps/:name` accepts only a name the folder listing
     returns, so no name reaches outside the folder, and it waits, like the dump jobs, until no
     download, load or update runs. The update does not delete the dump it replaces: the user
     asked for deleting on request, and a deletion nobody asked for can cost a download.
102. **A daily decisions backup, restorable with `digga restore`.** The full copies (decision 64)
     sit on the same disk and grow with the catalogue; what only the user made is small. So the
     server also writes `decisions-YYYY-MM-DD.json.gz`, gzipped at level 9, and keeps 30: every
     verdict, seeds included, track marks, heard tunes, attached videos and the videos of
     no-audio records, without release data, since the Discogs ids find it again after a dump
     load. Measured on a copy of the owner's library scaled to 60,000 records with two heard
     tunes each: 27 MB of JSON, 3.5 MB gzipped; level 9 saves 4% over the default at under a
     second, and brotli or zstd would save more but take seconds and need other tools to open.
     One entry per line, in a fixed field order, so `gunzip -c` reads well and unchanged data
     writes the same text: a day on which nothing changed gets no file, and neither does a
     library with nothing made in Digga, so idle days and a new or emptied library never push
     good backups out. A backup nobody can load back would be an export, so `digga restore`
     copies the database first and then writes the file in one transaction. The backup wins,
     except over a verdict or track mark made in Digga after it was written; seeds it replaces
     come back when the imports run again, which the README says to do after a restore.
103. **Two daily database copies, not five.** A full copy is 136 MB for 1994–2008 and would be
     about 330 MB for every Drum n Bass year. The decisions backup (decision 102) keeps a month of
     what only the user made at a few MB, so the full copies only need to cover a bad day or two:
     they restore by copying a file back, with nothing to rebuild.
104. **Daily backups run while the server runs, not only when it starts.** The backups were
     written once, at start, so a server left running for days, as the Electron app will be,
     wrote one backup. The server now checks every hour; a check on a day that has its backups
     costs two file lookups, and one after midnight writes the new day's. `stop()` ends the
     checks and waits for a backup being written before the database closes.
105. **The first run is a setup in the app, designed in `docs/FIRST_RUN.md`.** It fetches the
     catalogue, connects Discogs, picks styles and years, and lets the user dig while the load
     runs. A load of the September 2026 dump showed why that works: the dump is ordered by
     release id and Discogs catalogued old electronic records early, so 44% of the owner's
     1998–2002 vinyl records were in the library after 7 seconds and 91% after two minutes.
106. **Every complete load counts a style census; Digga ships one for the first run.** The setup
     needs every style's size by year before anything is loaded, and Discogs has no endpoint for
     it. The loader parses every release anyway, so counting them costs little, and the table
     it fills keeps the counts current. The shipped file comes from the 1 September 2026 dump
     through `digga dump census`; `docs/STYLE_CENSUS.md` says how to refresh it. It is excluded
     from formatting, one style per line, so a refresh reads as a diff.
107. **Saving a Discogs token asks Discogs whose it is first.** A token Discogs refuses (`401`,
     `403`) is not kept, and the previous one stays; a library without a username takes the
     token's, so the setup never asks for it. Settings still asks Discogs whose token it is when
     it opens: loading the lists only when the Maybe list select opens would leave the select
     empty or need another click, for about two requests saved per visit.
108. **A load can read the dump while it downloads.** The download takes about 8 minutes and the
     load 17, one after the other; read together, they take about as long as the slower of the
     two, and the first records arrive seconds after the load starts instead of after the whole
     download. The loader reads the `.part` file as it grows and asks the jobs table how the
     download is doing, so neither job needs the other's cooperation or a channel between the
     server thread and the load's worker. A checksum that fails after the load read everything
     leaves the load unfinished, so the next finished load takes its releases over.
109. **The setup's step is in the address.** A reload during the setup should not lose the step,
     and the browser's Back should go a step back. The server knows which jobs ran, not which
     screen the user was on, so `#/setup/sound` says it; what the server has still decides where
     a step can resume: nothing before the download starts, and nothing but the load's screen
     once the load runs. A catalogue that was in the dumps folder before any download opens step
     1, which says Digga has it, unless the address asks for a later step.
110. **The setup turns the sandbox off, and offers a practice round.** The schema default stays
     on, for configs the CLI creates. Someone who has just set Digga up and digs in the sandbox
     loses the evening's verdicts on reload; the choice is explicit instead. "Practice on five
     records first" turns it on for five verdicts, then a dialog turns it off and the queue
     starts again without them.
111. **Triage digs while a load runs.** The queue is a query, so each refill sees what the load
     has written so far; an empty refill is not the end while a load runs, and the session asks
     again every 10 seconds. The label sweep can return to a label once, for releases that
     arrived after it passed; in the owner's dump 91% of the records arrive in the first two
     minutes, so this is rare.
112. **Triage reads its queue again when it is shown.** The page stays mounted while hidden, and
     its session read the queue only when it started, when fewer than eight records were
     buffered, and at the end of the queue during a load, and it appended what it found after
     everything buffered. A record that a link pasted on Twelves' No audio shelf sent back to the
     queue therefore came after the whole batch, up to `queue.limit` records, and one judged in
     the same session not before a reload, since refills left out every record with a verdict
     in the undo history. Showing the page now reads the queue again, also the first time when
     the app opened on another page; a page shown from the start has just read it. The record on
     screen and its player stay, and the records after it follow the server's order, in the same
     `F` scope and with the passes still left out until the end of the queue. An unchanged order
     keeps the buffered list, so the hidden decks keep what they loaded. Nothing is read during a
     round of snoozed records or while `start()` reads, and a refill asked for meanwhile waits
     for the read. Only a verdict or undo whose write the server has not answered keeps a record
     out, and so does one written while a read was out, whose answer may predate it; once the
     write is answered, the server's queue decides, and in the sandbox the sandbox's queue, which
     leaves out its own verdicts. A record the queue offers has no verdict on the server, so the
     session drops that record's verdicts from the undo history, with a snooze kept from a round
     and the cached details. `Z` would otherwise delete a verdict the server no longer has, or
     restore an old snooze over the verdict given since, and the record would come back with the
     videos it had before the link. This also closes SETUP-01's gap: "Start digging" opens on a
     record without waiting for the next look.
113. **One Esc closes the scope picker, whatever its search field holds.** In Chromium, Esc in a
     `type="search"` field with text clears the field, and only a second Esc reaches the dialog;
     other engines differ. The picker's keydown handler now cancels Esc's default action and
     closes the dialog itself, which works the same in every engine. The field stays
     `type="search"` for its `searchbox` role, and the picker opens again with it empty.
114. **Twelves' rows scroll into view above the footer's measured height.** The shelf's footer is
     sticky, so `scrollIntoView({ block: "nearest" })` put a row selected at the bottom under it.
     The footer's height changes with its hints, the pager and the window's width, so a fixed
     margin would be right for one layout only. `Twelves.svelte` binds the footer's
     `offsetHeight` to `--foot-height`, and the rows of both tables take it as
     `scroll-margin-bottom`.
115. **Settings tells the load status about the jobs it starts.** The header's indicator asked
     whether a dump job runs when the app opened and when the setup started one, so an update,
     download or load started in Settings showed only after a reload. `loadStatus.follow(job)`
     checks again for a dump job, and Settings calls it for every job it starts; polling every
     second for a job nobody started would cost a request a second on every page. A check now
     drops an answer that a later check overtook, since the app's first check could otherwise
     arrive after the job started and hide it.
116. **Triage and Settings retry a failed read of the settings.** The queue starts from the
     settings, so when `/api/settings` failed as the app opened, Triage waited for good with
     nothing on screen but "Loading the queue…", and Settings named the error with no way on but
     a reload. Triage now says "The settings did not load." with the reason and `Enter` to try
     again, and Settings has "Try again". Both call `settings.retry()`, which shares a read
     already out, so a key held down asks once; `settings.load()` still reads afresh each time,
     since a token save calls it for the username the server adopted.
117. **Confirmed picks are marked in the config.** Step 3 writes the styles, years and formats
     to `digga.config.json`, but a new config already holds the schema's Drum n Bass defaults,
     so the setup could not tell picks from defaults and started step 3 from the suggestions
     every time, after "Change your picks" and on resume. `setup.picksConfirmed` (default
     `false`) is set with the picks, in the same write; the setup reads the picks back from the
     config (`confirmedPicks()`) and starts step 3 from them, before any suggestion. The flag
     lives in the config beside the values it vouches for, so the two cannot disagree, a config
     kept across a rebuilt library still counts, and a config the CLI made never does. A setup
     with confirmed picks and no load yet, which waited for the imports, resumes at step 3
     unless the address asks for step 2. Settings keeps the flag as it is, so styles changed
     there during the load are what step 3 shows after "Change your picks".
118. **A stopped download is said where the user is, and a new start is one key away.** The setup
     showed nothing on steps 2 and 3 when the download failed: the strip went, and "Fill the
     crate" then failed with "Dump file not found". The crate showed the load's generic "The
     catalogue stopped loading: The download stopped: …". Now steps 2 and 3 show the design's
     sentence at their foot instead of the strip, and the crate shows it in place of the generic
     one, both with "Start again" (`stoppedDownloadMessage()` in `src/client/setup/model.ts`).
     Step 1 is left out: its own button fetches again. The figure is what the download took from
     the transfer, which the job now reports when the transfer fails, since its regular reports
     come at most once a second. A download that stopped before a byte arrived gives only the
     reason, as resuming does not apply. "Fill the crate" downloads again first, a setup opened
     afterwards resumes at step 2, and a download that ended with Digga ("interrupted") keeps the
     load's "Pick up" (SETUP-27). The design says the releases loaded so far can be dug, but the
     app sent every page back to the setup until a load finished; the pages now open once the
     library has records to dig, after the setup has shown in the tab (`src/client/setup/access.ts`),
     so the app still opens on the setup, which says what stopped.
119. **The download job retries a checksum mismatch, and the setup reads the new download.** The
     design downloads once more by itself before asking. The setup page is unmounted while the
     user digs in Triage, which is where they are for most of a download, so a retry the setup
     started would often never run; the download job runs in the server, so it retries there,
     once, and the CLI's `dump download` and Settings' update get the same retry. A load reading
     the growing file holds the first download's file, which the mismatch threw away, and would
     otherwise read it to the end and take the second download's "done" for its own; the job
     counts mismatches in its progress, and the load's follower stops when the count changes, with
     `DOWNLOAD_RETRIED_ERROR`. The setup starts a new load on the new download whenever it sees
     that error, on a poll or when it opens, and shows "The download does not match Discogs'
     checksum, so Digga downloads it once more." meanwhile; the releases the first load kept stay,
     and the second upserts them again. After a second mismatch the job fails, and the setup says
     "The download does not match Discogs' checksum. Digga downloaded it twice." with "Start
     again".
120. **"Nothing matches" means the first load kept no release.** The crate decides from the
     finished load's own count of releases matched and kept for coverage, which arrives with the
     job; the records to dig come from a stats read that can lag the load's end by a poll, and
     drop to 0 when the user has judged every record during the load. A load that kept releases
     outside the dug years still ends on READY TO DIG, and Triage then says the filters match
     nothing. "Change your picks" after such a load goes back to step 3 without
     `DELETE /api/setup/load`: there is nothing to forget, and the server refuses once a load has
     finished. The finished load stays recorded, so the setup does not show after a reload, and
     Triage says no releases are loaded (TRI-31); keeping it avoids a second kind of "finished"
     that the library, Settings and the CLI would all have to know.
121. **A track mark keeps its tune and the moment it was set.** Marks were keyed by release and
     position only, so a later dump that renamed `A1` to `A` left a mark the Tracks shelf could not
     name, and nothing recorded where in the video the remembered part played, which for the ID
     hunt is what a grail mark is about. A mark now copies the track's heard key, artist and title
     when it is written and keeps them when the tracklist no longer has the position, and Triage
     sends the playing video and its second with the mark. A note edited in Twelves sends no
     moment and keeps the saved one. The Tracks shelf, the exports and the decisions backup carry
     the new fields; a backup written before them reads them as null.
122. **Every change to a decision is logged, by triggers.** `verdicts` and `track_verdicts` hold
     only the latest decision, and ordinary use replaces decisions made in Digga: the wantlist
     import turns a pushed want into a `wantlist` seed, re-reading the Maybe list turns a triage
     maybe into a list seed, the collection import ends a grail, and re-judging, undo and the
     no-audio requeue rewrite or delete rows. Afterwards nothing said what was decided in Digga or
     when. `verdict_log` and `track_mark_log` keep every change; the migration starts them from
     the rows a library has. Triggers write them rather than the functions that change decisions,
     because those are many (Triage, Twelves, the imports, restore, requeue) and a forgotten call
     would lose exactly the history the log is for. A log of what was decided is data only the
     user made, like the listen log, so the daily database copies keep it; the decisions backup
     leaves both out for now.
123. **A record stays dug after an import replaces its verdict.** "Dug" counted verdicts with
     source `triage` or `manual` (decision 51), and the rate read their dates. The imports replace
     such verdicts by rank: the wantlist import every pushed want, re-reading the Maybe list every
     triage maybe. So after a weekend of wants and an import, the counter dropped by the number of
     wants and the rate lost those decisions. `verdicts.dug_at` records when the record was last
     judged in Digga; a decision made in Digga sets it to its own date, and a seed keeps it. The
     counter, the rate, the sandbox's overlay, the decisions backup and its restore (whose "made
     here after the backup" test now reads `dug_at`) and the exports use it. One pure function,
     `dugAtAfter()`, decides it for the server and the sandbox. The migration fills it for
     verdicts made in Digga; one an import replaced before it existed cannot be told apart from a
     seed.
124. **Every play is logged; only 4 s or more make a tune heard.** A play shorter than 4 s posted
     nothing (decisions 38 and 63), so a record skipped after two seconds of each track left no
     trace of what was heard. At a few seconds per track, much of a fast session would be missing
     from the listen log, and it cannot be filled in later. The player now posts such a play when
     the listener leaves it, with `heard: false`; the server appends it to `listen_log` and leaves
     `heard_tracks` alone, and so does the sandbox. Greying out a tune still needs 4 s, so a tap
     that skips past a track does not hide the tune elsewhere. A play that rounds to no tenth of a
     second is not posted.
125. **A verdict follows its release when a dump load changes the release's key.** Verdicts are
     keyed by record, `m:{master}` or `r:{release}`, and a monthly dump changes a release's key
     when Discogs gives it a master, merges masters or moves it to another. The load rewrote
     `releases.triage_key` and left the verdict on the old key, so the record came back to the
     queue as undecided. 2,214 of the owner's 7,139 records to dig have no master and are keyed by
     release. Each verdict keeps the release it was given on, so the batch that writes a release
     also moves the verdicts on it to the release's new key, in the same transaction, and takes
     the no-audio record's videos along; nothing else changes a key. Following the release rather
     than the old key is right for the split case too: the verdict is about the release that was
     heard. When two verdicts land on one record, as two judged pressings under a new master, the
     higher rank stays and then the newer decision, so a want is never lost to a skip; both notes
     are kept, and the log keeps the replaced verdict. A restore puts each verdict on the key its
     release has now before applying its own rule, since a library rebuilt from a newer dump has
     the new keys. History hits on a master have no release and stay.
126. **A want or grail goes to the Discogs wantlist as soon as its verdict is saved.** Decision 40
     held the push for 1.5 s so that a quick `Z` cancelled it rather than taking the release off
     again. The owner digs with `A` and `C` as final: decided, next record, never shown again, and
     on Discogs at once. The push now starts when the server has saved the verdict. A `Z` before
     then sends nothing, and one after it takes the release off the wantlist, which the session's
     one-at-a-time wantlist writes already did in any order (decision 56). The pushes still run
     after one another, so a slow Discogs answer never holds back the next verdict, and each
     reads the saved verdict first, since Twelves may have changed it while the push waited for
     earlier ones. A misfired `A` now costs an add and a remove on Discogs. The setup's copy and
     TRI-12, TRI-13 and SBX-07 changed with it: a live want that the sandbox switch follows is now
     on the wantlist.
127. **A failed push is tried again three times.** A want whose push failed stayed off the
     Discogs wantlist until the user pressed `A` in Twelves or "add all", and a flash that
     vanished after 6 s was the only notice; in a long session a Wi-Fi drop or a Discogs 5xx
     would leave wants behind unnoticed. Triage now tries again after 5 s, 30 s and 2 min when
     the request failed on the way or the server answered 5xx (a Discogs error is `502`), and not
     when the server refused it (`4xx`: no username, unknown release, sandbox), which another try
     would not change. The slip says "trying again in 30 s" while it waits, which is also what
     the end-to-end tests wait for before they run the clock. Each try decides from the undo
     history when it runs, so a want undone meanwhile is not pushed, and a mode switch or the end
     of the session stops the tries. After the last one the slip says the want is not on the
     wantlist, and the message now names the record, since by then the listener has moved on. The
     tries live in the tab: a reload during the waits leaves the want for Twelves to mark.
128. **Every persistent format says what it cannot read.** The pre-release review (F06) found that
     an older Digga opened a library a newer one had migrated and wrote to it, and that a backup
     whose settings or sessions no longer passed the current schemas failed as a whole, before any
     decision was read. The migration runner now refuses a schema version above its newest
     migration, before anything is written. A backup from a newer Digga is refused with a message
     that says so. A backup's settings are kept as written and validated only when
     `digga restore --config` asks for them, and a session this version cannot resume is left out
     of a restore and not offered by `GET /api/sessions/latest`. Settings have no format version:
     a shape change parses the old shape with a `preprocess` shim, as the removed `popular` order
     does.
129. **One process owns a library at a time.** The pre-release review (F07) found that a second
     server over the same library marked the first one's running jobs as interrupted, even when it
     then failed to bind its port, and that each server wrote and pruned the same backups. Nothing
     said which process recovered jobs, migrated or wrote backups. A lock file in the library,
     `digga.lock`, names the process holding it. The server takes it before opening the database,
     and the CLI commands that change the library take it for their run; the others are refused
     with the holder's name. `digga stats` and `digga backup` only read, so they run beside the
     server, as the end-to-end tests do. A lock whose process has ended is taken over, since a
     crash or `kill -9` leaves the file behind. Jobs stay recorded without a process id: only the
     owner can have running ones.
130. **The server answers this computer's browser and tools only.** The pre-release review (F08)
     saved a verdict posted as `text/plain` with a foreign `Origin` and `Host`, and the config
     accepted `server.host: "0.0.0.0"`. A page on any site can send such a `POST` to
     `localhost:3456` without a preflight, and `/api/discogs/wantlist/:id` writes to the user's
     Discogs account; a site that points its own domain at 127.0.0.1 could also read responses.
     So `server.host` is one of `127.0.0.1`, `::1` and `localhost`, the listener refuses others,
     every request must name a loopback host, a write that carries an `Origin` must come from the
     app's page (the same port under any loopback name, since the app opens on `localhost` or
     `127.0.0.1`), bodies must be JSON, and a body is at most 4 MB. There is no per-launch
     token: a process on the same computer can read the database file anyway, and requiring one
     would break curl and the CLI-style tools the owner uses.
131. **Every stored timestamp is UTC.** The pre-release review (F13) found seed verdicts dated with
     Discogs' `date_added` as sent, with the account's offset (`2026-09-22T14:48:52-07:00` in the
     owner's library) or as a bare date in fixtures, beside Digga's own UTC times, while
     `listVerdicts()`, the backup and the `decided_at` index order the column as text.
     `upsertVerdict()` stores `decided_at` and `dug_at` in UTC whatever the caller passes, a
     backup's times are converted as it is read, and migration 15 converts the stored verdicts and
     their log without logging the change as a decision. `seed_items.date_added` keeps Discogs'
     text, since that table is the raw import.
132. **Personal data outlives the catalogue rows it names.** The pre-release review (F05) deleted
     a release that an unfinished load had added and the user had attached a video to: "Change
     your picks" protected only releases with a verdict, and `user_videos` followed its release
     through `ON DELETE CASCADE`. A restore also skipped attachments whose release the library had
     not loaded. Migration 16 rebuilds `user_videos` without the foreign key; "Change your picks"
     turns a release the user has data on (a verdict, mark, note, listen, attached video or
     import) into a stub outside the universe instead of deleting it, so it also leaves the queue
     of the new picks; and restore keeps every attachment, which applies once its release loads.
     A later feature that prunes releases a load no longer finds (`docs/ROADMAP.md`) has to keep
     the same rows.
133. **A load moves verdicts all at once, and the server decides a verdict's key.** The
     pre-release review (F01) gave two releases each other's masters: moving the verdicts one at a
     time merged the first into the second before the second moved, so one decision was lost from
     the verdicts. All moves of a batch are now worked out first; each key keeps one verdict by
     the precedence of decision 125, a verdict leaving a key never merges with one arriving, and a
     cycle of keys is rewritten instead of moved. The review also saved a verdict under a key its
     release no longer had: a tab that read the queue before a load sends the old key, and the
     queue then ignores the verdict. `POST /api/verdicts` now files a verdict with a `releaseId`
     under the release's current key and answers that key, which Triage's undo uses. A decision
     stays keyed by record rather than by release: re-judging a record is then one write, and the
     merged-away verdict stays in the log.
134. **What the Discogs account holds is kept apart from decisions made in Digga.** The
     collection, wantlist and Maybe-list imports wrote seed verdicts that competed with the user's
     own decisions by rank (decisions 7, 49 and 85): a wantlist import turned a want into a seed,
     the collection ended a grail, `dug_at` had to survive the replacement (decision 123), and
     restore needed the same ranks. The pre-release review (F10) asked whether these are
     independent facts; the owner decided they are. `memberships` holds the account's items per
     release, with Discogs' date, rating and note and, for a removal an import finds, `removed_at`;
     verdicts hold decisions made in Digga and history hits. Imports never change a verdict, a
     record either holds is out of the queue, and Twelves' shelves became filters: Want and Grail
     show decisions, Discogs wantlist and Owned show the account, a record can be on several,
     owning ends the hunt, and Everything lists each record once. Migration 17 moved the seed
     verdicts and put back the decision a seed had replaced from `verdict_log`. Notes belong to the
     release (`release_notes`): a verdict has none, a record shows the notes of its other pressings
     labelled with their catalogue number, and the trigger that copied verdict notes is gone. With
     seeds gone, `dug_at` is the date of a decision made in Digga and was dropped. Triage may now
     judge a record only Discogs holds, since a judgment no longer overwrites what Discogs holds;
     Twelves still re-judges only records decided in Digga. The decisions backup is version 3: it
     holds memberships, and versions 1 and 2 restore with their seed verdicts as memberships and
     their verdict notes as release notes.
135. **`digga restore` restores a database copy too.** The pre-release review (F15) found that the
     daily `digga-YYYY-MM-DD.sqlite` copies and the `before-migration-<version>.sqlite` copies had
     only a manual procedure: copy the file over `digga.sqlite` with the server stopped. Tried on a
     library whose `-wal` file held writes made after the copy, that procedure gave back the newer
     verdicts, because SQLite applied the old log to the copied file. `digga restore` now also
     takes a `.sqlite` file. It holds the library lock, so it refuses while the server or another
     command that changes the library runs. It checks that the copy is a Digga database with a
     schema version this Digga knows, on a duplicate staged beside the database, since opening a
     WAL file read-only leaves `-wal` and `-shm` files beside it. It keeps the current database as
     `backups/before-restore-YYYY-MM-DD-HHMMSS.sqlite`, which daily rotation leaves alone, removes
     `digga.sqlite-wal` and `digga.sqlite-shm`, moves the copy into place and opens it once, so an
     older copy is migrated. `--config` is refused with a database copy, which holds no settings.
     Restoring stays a CLI command; Settings says how to run it.
136. **A hidden label is a Discogs id with its name.** The pre-release review (F14) noted that
     `filters.excludeLabels` held names, so a label Discogs renames would return to the queue
     after the next load, and that the bracket rule of decision 77 also hid `Signal (2)`, a
     different label, when `Signal` was hidden. An entry is now `{ id, name }` and still matches a release's first label,
     the one the sweep orders by. `X` stores the label's id, which matches whatever Discogs calls
     the label later. An entry without an id, typed in Settings or saved by an older Digga as a
     plain name, matches the first label's name, ignoring case; in the owner's catalogue no name
     belongs to several ids. Settings lists the names one per line and keeps the id of a line
     that still names an entry. The bracket rule remains only for Not On Label: Discogs gives each
     "Not On Label (Artist Self-released)" an id of its own (705 in the owner's catalogue), so
     hiding Not On Label also hides every first label whose name starts with "Not On Label (".
137. **An import that misses an item ends it.** Imports only added what Discogs listed, so a want
     removed on Discogs stayed a want in Digga, and Twelves offered to push it again (F10). An
     import that reads every page now sets `removed_at` on the items of its kind it did not find;
     the Maybe-list import does so only when every entry resolved to a release, since an entry
     whose lookup failed would look removed. A push Digga makes while the import runs is newer
     than its start and stays. The owner decided what a removal means: the record stays out of the
     queue, since the user has been through it, and a want or grail decided in Digga leaves the
     Want and Grail shelves, as an owned record does, and is no longer offered for the wantlist.
     The decision itself stays, so the record is still dug and a later `A` brings the want back.
138. **A library holds one Discogs account's data.** `memberships` had no account, and the
     username in Settings could change while another account's collection and wantlist stayed
     (F10). The owner chose to refuse the change instead of storing an account per item. The
     library records the account in `meta.discogs_account` when an import or a wantlist push
     uses it; a library from before that counts as the configured account's. While memberships
     are stored, Settings refuses a username of another account, a token of another account is
     not kept, and imports and pushes for another account fail. Discogs usernames ignore case.
     Settings names the account and offers to forget its collection, wantlist and Maybe list
     (`DELETE /api/discogs/data`); verdicts, notes and marks stay, and records only the account
     held return to the queue until the next imports.
139. **An undo or a Twelves change names the verdict it expects.** Writes from one tab run in
     order, but the server took any write, so an undo in one tab could delete a decision another
     tab had just made (F07). The owner allowed several writing tabs and asked for refusal with a
     message over silent overwriting. `POST /api/verdicts` takes an optional `expected` (status and
     `decidedAt`), and `DELETE /api/verdicts/:key` requires it as query parameters; the server
     compares it with the record's verdict in the same synchronous step as the write and answers
     `409` when they differ. Triage sends no expectation with a new verdict, since judging a record
     is a fresh decision. A refused undo is dropped, as it can never apply, and Twelves reloads.
     Notes stay last-write-wins.
140. **A tune key uses canonical artist names and every script, and an untitled tune its record.**
     The pre-release review (F02) found heard keys colliding: normalization kept only ASCII, so any
     two titles in Cyrillic or Japanese were the same tune; dropping Discogs' `(n)` suffix merged
     different artists; and every "Unknown Artist - Untitled" was one tune, which with `skipHeard`
     on skipped every other white label once one was heard. The owner chose canonical names, which
     keep the suffix and also make a credit under another name (ANV) the same tune, and Unicode
     letters and digits. A tune by placeholder artists only (Various, Unknown Artist, No Artist,
     ids 194, 355 and 118760) or with a generic title is keyed `m:501 A1` by its record and
     position, so pressings of one master still share it; in the owner's catalogue 35,896 of
     499,596 tracks are keyed so. `meta.tune_key_version` (2) records the rules, and a library at
     an older version is rekeyed as it opens: 4 s for those tracks, migrations included. Listens
     and marks then take the key of the track at their position when its title is the one they
     saved, also after every dump load and restore, and `heard_tracks` is rebuilt from
     `listen_log`. A position that holds another tune now keeps the saved key.
141. **A track mark belongs to a release's tune; its position only locates it.** `track_verdicts`
     was keyed by `(release_id, position)`, so when a catalogue edit put another tune at a marked
     position the new tune could not be marked: the server refused it until the old mark was
     reviewed (F03). Positions also repeat (1,279 times in the owner's catalogue) or are empty
     (10,470 tracks). The owner made the position a locator. Migration 18 keys the table by
     `(release_id, heard_key)`, a mark saved without a tune taking `r:{release} {position}`;
     `POST /api/track-verdicts` requires the tune and allows an empty position; Triage marks the
     playing track's tune, which shows on every track of the release with it. The identity
     conflict and its `409` are gone. A backup mark without a tune is restored on the track at its
     position.
142. **Restore merges: whichever side changed an item last keeps it.** The pre-release review
     (F04) showed a restore overwriting a mark's note edited after the backup, since a note edit
     keeps the mark's `decided_at`; bringing back a verdict deleted after the backup; and leaving
     a merged master `rejected` instead of its grail. The owner chose a merge. Migration 19 adds
     `updated_at` to `verdicts` and `track_verdicts`, set by every write that changes the row and
     carried in the backup, and to both logs, which now hold every column. Restore compares the
     backup item's `updated_at` (its `decidedAt` in older backups) with the library's last change
     to that verdict or mark, its row's `updated_at` or the latest delete in the log, and keeps
     the later side. A history hit and a decision made in Digga never replace each other, as on
     import, and backed-up verdicts that meet on one record keep the one `preferredVerdict()`
     picks. A write that changes nothing leaves `updated_at` alone. Going back in time is a
     database copy's job (decision 135).
143. **The decisions backup is JSON Lines, read in one transaction and written off the server
     thread.** The pre-release review (F12) asked for the backup layout to settle before release,
     since released files must stay restorable. The owner chose to restructure version 3: a
     header line, then one record per line with its type in `record`, every field in camelCase
     (the logged rows used database column names), and a SHA-256 of the record lines in the
     header, so the unchanged check reads one header line instead of parsing the newest file.
     Versions 1 and 2 still restore. `readBackedUpData()` reads every section in one read
     transaction. A benchmark on a synthetic library (40,000 verdicts, 120,000 decision events,
     300,000 listens, 8,000 marks, 20 large sessions) took 1.3 s to read and 2.6 s to format and
     hash 200 MB of lines, all on the server thread every fifteen minutes even when nothing
     changed, so scheduled backups, checkpoints and Back up now run in a worker with its own
     connection; the longest pause of the server thread fell to 7 ms. The scheduler skips a tick
     while a check still runs. Sessions are cursors, not history: the newest 20 and any touched
     in 90 days are kept. A failed scheduled check is shown in Settings until one succeeds. The
     CLI ignores `EPIPE` on its output, since a parent that stops reading must not end the
     server.
144. **Two database copies again, an MIT license, and docs that match the code.** The second
     review found the code keeping seven daily database copies while decision 103 and
     `ARCHITECTURE.md` said two and `ROADMAP.md` five, and `ARCHITECTURE.md` saying the backup check
     runs hourly where it runs every fifteen minutes (decision 104 predates the checkpoints). The
     owner went back to two copies, as decision 103 reasoned: the decisions backups cover a month.
     The repository is MIT-licensed (`LICENSE`, `package.json`).
145. **Wantlist pushes stay with the tab, and listens are not retried.** The pre-release review (F11)
     noted that a want's push and its retries live in the Triage tab, so closing the tab can leave
     a want unsent, and that a listen has no submission id, so a retried listen could count twice.
     The owner kept both as they are: Twelves marks wants missing from the Discogs wantlist and
     pushes them with `A`, `C` or "add all", and the player posts each listen once and drops a
     failed one, so no listen needs an id to be recognized.
146. **A shop read keeps each copy's grading, price and comment, and says what changed.** Filling
     one order to a round number makes a cheap clean copy worth a want that the music alone would
     not earn, so Triage in a seller scope shows the seller's copies of the record under the
     player: price, a "NM / VG+" stamp (record, then sleeve) and the comment. This replaces
     "Prices, conditions ... are left to Discogs" in decision 84; carts still are. The read stores
     the listings in `seller_listings` beside `seller_releases`, which stays the scope's set, so
     shops read before migration 22 still scope until their next read and say they have no
     prices yet. A read replaces both, so sold copies drop out, and the job line counts the
     releases gone and new since the previous read. Grades are abbreviated from the text in
     Discogs's condition names, with M and NM in the accent and VG and below muted.
     The release snapshot also keeps the community rating `P` fetches, average and count.
147. **Video titles match with their words run together, and libraries are rematched.** Uploads
     write "Covergirl" for a track called "Cover Girl", and credit "The Outfit" as "Outfit", so
     such a video played under "Other videos". The matcher also compares the titles with their
     spaces dropped, from six letters up so a short title does not match inside unrelated words,
     and credits an artist without a leading "The". Matches are stored when a release is loaded,
     enriched or given a video, so `meta.video_match_version` (2) records the rules and a library
     at an older version is rematched once as it opens. The rematch writes only
     `matched_position`; verdicts, marks, listens and heard tunes key on the tracklist, not on
     videos, so they stay as they were.
148. **Settings is split into tabs.** One page of eleven sections had grown to over four screens,
     with the filters below the backups and the dump jobs far from the universe they load. The
     tabs group what is changed together: Digging (filters, order, player), Library (counts,
     universe, dumps), Discogs (account, imports, seller shop), Backups, and General (sandbox,
     appearance). Each is an address, `#/settings/<tab>`, so the tab list is plain links with
     `aria-current="page"` rather than an ARIA tab widget, and `#/settings/sandbox` opens General
     on the highlighted Sandbox section. The draft lives in the page, so changes on one tab stay
     unsaved while another is shown, and the save bar saves all of them. Each tab lists the
     newest five of its own jobs in place of the separate jobs panel.
149. **The practice round is gone.** "Practice on five records first" (decision 110) dug five
     records in the sandbox before the setup's "Start digging". It protected five verdicts that `Z`
     and Twelves' re-judging already make recoverable, and it was the sandbox's last use in the
     first run. The setup now offers only "Start digging".
150. **Sandbox mode is gone.** It was added so the UI could be tuned without database writes
     (decision 27); a throwaway library in `DIGGA_DATA_DIR` covers that now and exercises the real
     write paths, as the E2E suite does. The setup already turned it off (decision 110), and `Z`
     and Twelves' re-judging make any verdict recoverable. It also cost a second
     implementation of every digging write in the client and a sandbox rule in every feature
     that writes. Every verdict, track mark, note, listen and wantlist push is now written for
     real from the first one. This supersedes decisions 27, 50, 52, 53, 54 and 55, and the
     sandbox parts of 110. `GET /api/discogs/lists/:id`, which existed only for the sandbox's
     Maybe list import, went with it. A config that still has `sandbox` keeps loading, since the
     schema strips the unknown key, and loses it on the next save.
151. **The Electron app reads the environment through the CLI's code.** `src/cli/environment.ts`
     adds a `.env` from the working directory and reads `DIGGA_DATA_DIR`, `DIGGA_DUMPS_DIR`,
     `DIGGA_CONFIG_FILE`, `DIGGA_LOG_LEVEL` and the three service URLs, for the CLI and for
     `electron/main.ts` alike, so the app opens the same library with the same services and the
     portability rules need no new file that may read `process.env`. `DIGGA_LOG_LEVEL` is
     validated now: an unknown level stops the start, where it used to log everything. The
     server takes the library lock under the name `createServer` is given, "the Digga app" in
     Electron, so a CLI command the app keeps off the library names it.
152. **The app encrypts the saved token in `secrets.env`.** `createSecrets` takes an optional
     `SecretEncryption`, and Electron passes `safeStorage` (the Keychain, DPAPI, a Linux keyring).
     The encrypted token is `DISCOGS_TOKEN_ENCRYPTED` in the library's `secrets.env`, so the token
     stays with its library (decision 138) instead of moving to userData, which `DIGGA_DATA_DIR`
     does not move. `DISCOGS_TOKEN` in the environment still wins. A token the browser version
     saved as text keeps working and is encrypted when it is saved again; each save replaces both
     forms, so a token saved in the browser version replaces the encrypted one. Where
     `safeStorage` cannot encrypt (Linux without a keyring) the owner chose to save the token as
     text in `secrets.env` instead of refusing it, and Settings says "saved unencrypted" for any
     token stored as text, in the browser version too, since it is true there. The CLI cannot
     decrypt what the app encrypted, so after a save in the app the CLI's imports need
     `DISCOGS_TOKEN`. A token that cannot be decrypted counts as none, and Settings asks for one.
153. **better-sqlite3 needs no separate build for Electron.** Version 13 is a Node-API addon
     (`NAPI_VERSION=10`) with prebuilt binaries, and Node-API is ABI-stable across Node and
     Electron. Electron 44.5.1 (Node 24.21.0, Node-API 10) loads the repository's
     `prebuilds/darwin-arm64.node` in the main process and in a worker, so there is no
     `@electron/rebuild`, no `nativeBinding` path and no second install, and the CLI, vitest and
     the web suite keep the binary they use. Packaging still has to check the binary on each
     platform it ships; the prebuilds cover darwin, linux, linuxmusl and win32 on x64 and arm64.
154. **Electron runs the TypeScript sources as Node does.** Electron 44's Node 24.21 strips types
     from the main entry (`electron/main.ts`, an ES module), from the `src/` modules it imports and
     from the dump-load worker, which `new Worker(new URL("./dump-load-worker.ts", ...))` starts.
     The unpackaged app needs no build beyond `vp build` for the client. Whether a packaged app
     can load `.ts` files from an asar archive is a packaging question (ELECTRON_PLAN, "Build").
155. **Chromium's files stay out of the library.** The library is in Electron's userData folder by
     default, so Chromium's caches and profile files would sit beside `digga.sqlite`. The app
     moves `sessionData` to `userData/Chromium`. The log, `digga.log`, stays in userData as
     planned, and an unpackaged run also prints it to the terminal. The client uses no web
     storage, so that folder holds nothing of the user's.
156. **The app quits after the server stops, and a second one is refused.** `before-quit` waits
     for `server.stop()`, so running jobs end cancelled, a backup being written finishes and the
     database closes, and then quits. SIGTERM goes the same way, since Chromium handles it as a
     quit. Closing the window quits on every platform, macOS included: an app without a window
     would hold the library with nothing to show. A second start meets the library lock (decision 129) and shows a dialog naming the holder; Electron's single-instance lock is not used,
     since it covers one userData folder and not the library.
157. **The window keeps to the app's pages, and the menu opens Settings for the jobs.** The window
     runs with context isolation and Chromium's sandbox, without Node and without a preload: the
     renderer is the browser client and reaches the server over HTTP. `window.open` and links
     that leave the app's origin go to `shell.openExternal` when they are http(s), and nowhere
     otherwise; navigation away from the origin is refused. A download asks where to save it,
     starting in Downloads. Every permission request is denied, YouTube's fullscreen included,
     since nothing in Digga needs one. The menu has the standard roles, Edit among them for copy
     and paste in text fields, Settings… (⌘,) in macOS's application menu, and a Library menu
     whose items, Update the Catalogue…, Import from Discogs… and Back Up…, open the Settings tab
     that starts the job instead of starting it. The tab shows the job's progress, Cancel and
     result; a job the main process started would be unknown to the page, which learns of the
     jobs it starts (decision 115). The tab's "From a file" field takes an absolute path, so the
     planned file dialog for dumps is not needed.
158. **No paid code signing.** On 2026-10-07 the owner decided never to pay for code signing: no
     Apple Developer ID, no notarization, and on Windows only a free signing service, if one
     qualifies. macOS builds are ad-hoc signed, which arm64 needs for the app to start at all,
     and a user opens a downloaded build through Gatekeeper's "Open Anyway" in System Settings >
     Privacy & Security. The hardened runtime is off: it serves only notarization, and with an
     ad-hoc signature its library validation can refuse the better-sqlite3 binary. Each ad-hoc
     build has a new signature, so macOS may ask whether a new build may read the "Digga Safe
     Storage" Keychain item; a token it cannot decrypt counts as none (decision 152).
159. **electron-builder packages the app, for Apple silicon first.** `scripts/package-electron.ts`
     calls electron-builder's `build()` with its configuration in the script, so the packaging
     has one file and no configuration file beside `package.json`. The app id is
     `io.github.razorjack.digga`, after the repository. The archive holds what the main process
     and the workers import: `dist/`, `electron/`, `src/` without the client's sources,
     `tools/dump/` and the production dependencies, with better-sqlite3 reduced to its
     `darwin-arm64.node` prebuild, which electron-builder unpacks. `npmRebuild` is off, so the
     repository's `node_modules` keeps the binary the CLI, vitest and the web suite load
     (decision 153). Only the English locale ships. The build is arm64 only: an x64 build would
     be one more target and the darwin-x64 prebuild, but Rosetta is not installed on the Mac that
     builds it, so it could not be started, and an unstarted build should not ship.
160. **The packaged app runs the TypeScript sources from `app.asar`.** Electron's archive support
     covers its ES module loader and its workers, and Node strips types from `.ts` files outside
     `node_modules`, so `electron/main.ts`, the server and both workers, which
     `new Worker(new URL("./dump-load-worker.ts", import.meta.url))` and its backup counterpart
     start inside the archive, run as they do unpackaged. A first build showed it: the server
     answered `/api/health`, the dump-load worker loaded 1,500 releases, and Back up now wrote a
     decisions backup through its worker. No transpile step and no `asarUnpack` for the sources
     are needed, so the CLI, vitest and the web suite run as before. better-sqlite3 loads from
     `app.asar.unpacked`, where Electron redirects the archive path of its `.node` file.
161. **The release build has its fuses set, and an inspectable variant differs in one.** The
     release build turns off `RunAsNode`, `EnableNodeOptionsEnvironmentVariable` and
     `EnableNodeCliInspectArguments`, and turns on `OnlyLoadAppFromAsar` and
     `EnableEmbeddedAsarIntegrityValidation`, so nothing runs the app's Node as plain Node, loads
     code into it from the environment or the command line, or replaces its archive.
     `EnableCookieEncryption` stays off: it would read the Keychain at every start, and the app
     keeps no cookies of its own. Playwright attaches to Electron through `--inspect`, so the
     E2E suite runs on a second build, `release/inspectable/`, with only that fuse on; both
     builds have the same `app.asar`. Integrity covers the archive only: electron-builder writes
     its hash into `Info.plist`, which the ad-hoc signature seals, and the unpacked better-sqlite3
     package is covered by the signature alone. An ad-hoc signature can be made again by anyone
     who can write the app, so the two keep a copy from being damaged or changed by accident, not
     from someone who means to change it.
162. **The packaged app waits for the E2E host with `DIGGA_E2E_HOLD=1`.** A packaged build ignores
     `-r`, with its fuses or without them, so the harness preload cannot run before the app's
     first line there. `electron/main.ts` gets the one test hook `docs/e2e/ELECTRON.md` planned:
     with `DIGGA_E2E_HOLD=1` in the environment (read by `testHostHoldRequested()` in
     `src/cli/environment.ts`), it sets `sessionData`, which must happen before Electron is
     ready, and then waits for `globalThis.diggaE2eHold.release()` before it starts the server.
     The host loads the same preload through the inspector while the app waits, so the packaged
     and unpackaged runs share the preload, its guard and its stubs. The wait is a promise, since
     a top-level `await` held Electron's start and Playwright never saw the DevTools endpoint.
     Only the inspectable variant can be released; the release build, with no inspector, just
     waits, so the variable gives nothing to anyone who sets it. Chromium runs before the
     preload, so on the packaged app a refused userData folder already holds Chromium's files,
     and the host's check before each launch is what keeps userData in the test's folder.
163. **The fused build's health check is a script that packaging runs.** Playwright cannot attach
     to the release build, and a check of it needs the build, which only `vp run electron:package`
     makes; as a vitest test it would fail or be skipped in every `vp test` without one, and CI
     never packages. So `scripts/electron-health-check.ts` runs as the last step of
     `vp run electron:package`, and alone on any build. It starts the app in a new temp folder
     with an environment built from nothing, the mock keychain and the fake services, refuses to
     start if any path or URL points elsewhere, and passes when the app logs "listening on",
     answers `GET /api/health` and stops on SIGTERM.
164. **Workers log through the thread that started them, and the log rotates at the start.** A
     packaged app has no terminal, so what a worker printed to its console was lost. A worker's
     `workerLogger()` posts each line to the thread that started it, where `runWorker()` writes it
     through the caller's logger, so the line has the main log's level, scope and file. The
     dump-load worker logs through it; the backup worker logs nothing of its own, and its result
     and errors already reach the main thread as messages. Logged data must survive
     `postMessage`, as errors and plain objects do. `createFileSink()` moves a log larger than
     10 MB at the start to `digga.log.1`, replacing the one there: a few lines that bound the log
     to two files for ordinary use, without rotating while the app runs.
165. **The server reports to a desktop interface the app implements; the window keeps no preload.**
     The setup's Electron parts need the main process to know the downloads and loads, for the
     Dock's progress bar, keeping the Mac awake and asking before quitting, and the page to reach
     native dialogs. `createServer` takes an optional `desktop` (`src/server/desktop.ts`), which
     `electron/main.ts` implements in `electron/desktop.ts` and the CLI leaves out. The job runner
     reports every change of a job to it, start, progress and end, so the main process follows
     the jobs itself, whether the page is open on the setup, on another page or not at all. A
     product preload with `contextBridge` was the alternative: it would give the page a second
     channel beside HTTP, which decision 157 kept out and which would need its own isolation
     review, and the main process would still have to learn the jobs from the page. With the
     interface the renderer stays the browser client, `src/client/api.ts` stays its one
     transport, and nothing in `src/` imports Electron.
166. **Quitting during a download or load asks first, and closing the window asks the same.**
     Discogs does not let a download resume, so a quit 9 GB into the catalogue costs the whole
     download again, and a quit during the load means reading the dump from the start. During
     either, `before-quit` asks "Quit while Digga downloads and loads the catalogue?" and says what
     stops and what is lost: where the download stands, how far the load has read, and that the
     releases it kept stay. Quit is the default button, since the user asked to quit; Cancel keeps
     the jobs and the app running. Closing the window becomes a quit, so it asks the same and a
     Cancel keeps the window: an app left without one would hold the library with nothing to
     show (decision 156). With nothing of that running, quitting asks nothing. The question
     comes from the jobs the server reports to the desktop (decision 165), so it does not depend
     on the page. A quit during an import, a backup or a seller read does not ask: those end
     cancelled, as before, and are quick to run again. The crate gives no reason for a cancelled
     load, so after such a quit it says "The catalogue stopped loading." instead of the worker's
     "Cancelled".
167. **The Dock follows the load, the Mac stays awake while the catalogue arrives, and a load that
     ends unseen is announced.** From the jobs the server reports (decision 165), the main process
     sets the window's progress bar to how far the load has read while one runs, since that is
     what the setup waits for, and to the download's progress before it; the bar goes once
     neither runs. `powerSaveBlocker.start("prevent-app-suspension")` runs from the first download
     or load until none runs, so a laptop left alone does not sleep and break the 10.5 GB
     download; the display may still sleep. A notification says that a load or update finished,
     with the releases kept, or why it failed, only while no window of the app is focused, and not
     for a cancelled load or one the setup starts again after a checksum mismatch. The app logs
     each notification before it asks `Notification.isSupported()`: that call and the
     constructor create Electron's notification presenter, which asks macOS for permission to
     notify, so the E2E preload answers it with false and the tests read the log instead of
     creating one.
168. **The page reaches the app's dialogs through the server, and a dump file the user chose is
     read where it is and never deleted.** The setup's "Use a dump file I have" needs a native
     file dialog, which only the main process can show. The page asks for it with
     `POST /api/desktop/dump-file`, which calls the `desktop` (decision 165) and answers the path,
     so `src/client/api.ts` stays the page's one transport and the window keeps no preload. Only
     a server with a `desktop` registers the `/api/desktop` routes, and `GET /api/setup`, which the
     setup reads anyway, reports `desktop: true`; the browser's setup offers no dialog and its
     server answers the routes as unknown. The server checks the answer, since the macOS filter
     only knows the last part of `.xml.gz`: a file that is not there or not named `*.xml.gz` gets
     a 400. The path goes into `setup.dumpFile` in `digga.config.json` beside `picksConfirmed`,
     so the setup loads the same file after a reload or a quit, and Pick up never downloads; a
     download that ran before the choice is no longer the setup's. The file is the user's: the
     load reads it where it is, without copying it into the dumps folder, and the crate offers no
     "Delete it" for it.
169. **The dumps folder chosen in the app is saved in the library, and `DIGGA_DUMPS_DIR` wins.**
     When the disk is short of space, step 1 of the desktop app offers a folder dialog
     (`POST /api/desktop/dumps-folder`, decision 168). The server writes the folder to
     `dumps-folder.json` in the library, `{ "dumpsDir": "/absolute/folder" }`, and uses it from
     then on; `resolvePaths()` reads the file on every start, so the app, the CLI and later
     launches agree, and `paths.ts` stays the one place that resolves the dumps folder. The
     order is `DIGGA_DUMPS_DIR`, then the chosen folder, then the default; a file that cannot be
     read or names no absolute folder counts as no choice. `digga.config.json` was the other
     place: the paths are resolved before the config is read, and `DIGGA_CONFIG_FILE` can put the
     config outside the library, so the dumps folder would depend on a file the paths locate.
     While `DIGGA_DUMPS_DIR` names the folder, the server refuses another (409) and step 1 keeps
     the browser's message about the variable; while a download or load runs, it refuses too,
     since that job writes or reads the folder it started with. The setup only offers the
     dialog; Settings shows the folder but does not change it.
170. **A history import that macOS keeps Digga out of explains Full Disk Access in a dialog.**
     The desktop gets `historyAccessDenied()`, which the server's job listener calls when a
     history import fails with `HistoryAccessError`; the server knows its error types, and the
     main process decides what to show. On macOS the app shows a message box that says where to
     turn on Full Disk Access, with "Open Privacy & Security", which opens
     `x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles`, and "Not Now".
     macOS offers no way for an app to ask for the permission, and it applies after the app
     starts again, which the box says. Other platforms show nothing more. The job keeps its own
     message, which the page shows as before. A browser folder the import may not list now fails
     with `HistoryAccessError` too, as a file it may not copy did; before, it failed with the bare
     `EACCES` error, which no hint followed.
171. **Digga does not read browser history.** On 2026-10-08 the owner removed the browser history
     import (`digga import history`, step 2's checkbox and browser list, and History in Settings'
     Discogs tab), and with it the Full Disk Access dialog. The signal is weak: opening a
     release's page is not listening to it. Brave and Chrome keep 90 days of history by default,
     so most of what a digger opened years ago is gone anyway. Reading another app's history is
     not something this app should do, and on macOS it needs Full Disk Access, which the app
     cannot ask for and should not want. This supersedes decisions 15 and 170, and the history
     parts of 7. A library keeps the `seen` verdicts the import wrote, with source
     `seed:history`: `filters.skipHistory` still leaves them out of the queue, Settings shows
     its toggle only while the stats count a `seen` verdict, and every decisions backup format
     still restores them. Since no import can bring them back, the daily decisions backup now
     counts any verdict as worth keeping. Rows of the import's jobs stay in the `jobs` table
     and are not listed, so Settings and the job runner read the other jobs as before.
172. **The open observations before the first release, as the owner decided them on 2026-10-08.**
     Each was reproduced against the code first.
     - A video with `embeddable = 0` is left out of the playlist, and the tracklist marks its
       track "no embed"; only videos YouTube refuses (error 100, 101, 150) are skipped with a
       notice. KEYMAP said both had a notice, and now says what the code does.
     - Before Space, the cued track keeps `aria-current`, its hidden text says "cued", and ▶ shows
       only while it plays, so a screen reader no longer hears "playing" from a waiting player.
     - Keys pressed in Settings give the page user activation, so a video cued later reads
       "paused" and Space resumes it. That is the browser's rule for sound and stays as it is.
     - "Read my lists" is disabled while the username is unsaved, and says to save it first,
       since the server reads the lists of the saved username.
     - A count of one reads in the singular everywhere, through `nounFor()` and
       `formatCounted()` in `src/shared/display.ts`.
     - A cancelled import keeps the page that was in flight when the user cancelled: the items it
       read are real, and Cancel stops what comes after it.
     - A setup resumed with a saved token opens at once and says the account is being checked;
       `/oauth/identity` no longer holds the page while an import fills the request queue.
     - A Discogs `401` or `403` on a want ends the push at once with the token message: the
       server passes the status through (`discogsErrorStatus()`), and the session tries again
       after 5 s, 30 s and 2 min only on the `502` of a temporary failure.
     - The Settings import row says "N gone from Discogs" when an import ended wants or owned
       records, as the CLI does.
     - A successful Back up now clears the scheduled backup's failure, since it shows that the
       backups folder takes files again.
     - A video `P` finds joins the tracklist and plays at once only on a record that had nothing
       playable; otherwise the player goes on as it was. A pasted link still plays at once.
     - After a quit stopped the download before any load, step 1 says the download stopped when
       Digga quit and starts over. The job runner records `QUIT_JOB_ERROR` ("Digga quit") on the
       jobs it cancels while the server stops, the smallest change that tells a quit from a
       Cancel the user pressed, which keeps its own error and says nothing new.
     - A dumps folder chosen in the app may be on a disk that is not connected, so a download
       never creates it: step 1 says when it is gone and offers "Choose a folder…" again, and Fetch
       reads the setup again first. A dump file chosen in step 1 that is gone keeps the setup on
       step 1 the same way; before, the load's refusal reached step 4, which offered no way back.
     - Slow exits of the Electron app under test appeared only at load averages of 80 and above,
       and runs at low load killed no app, so the harness's exit handling stays as it is.
173. **Digga looks and behaves like an app, in the browser too.** On 2026-10-08 the owner chose
     to make the Electron window read as an app rather than a website in a window, keeping the
     palette, stamps, grain and key caps. The changes apply to the browser version as well, which
     needs no separate design, and the client still has no platform code.
     - The page's header became a toolbar on sleeve: a segmented control for Triage and Twelves,
       the counts in a recessed readout in the middle, Settings at the right end, and no
       wordmark. On macOS it is the title bar: the window hides macOS's bar, and the toolbar keeps
       clear of the traffic lights through the Window Controls Overlay CSS variables, a web
       standard that `titleBarOverlay` enables and that is unset in a browser. Windows and Linux
       keep the system title bar until a session on each checks the plan in
       `docs/ELECTRON_PLAN.md`.
     - The window opens at its last size and place, never below 1080 x 680, and shows only once
       painted, over the page's ground colour.
     - The menus are an app's: View shows the pages and the keys with `Cmd` accelerators, and
       only an unpackaged run keeps Reload and the developer tools. Single-key accelerators stay
       out of the menu: on macOS Electron cannot show an accelerator without registering it, and
       a registered `A` would take the key from text fields. Right-click opens the native editing
       menu in text fields and Copy on selected text.
     - Controls behave as in a desktop app: the arrow over buttons, labels and disclosure
       triangles instead of the hand; labels, key caps and table headers are not selectable,
       while artists, titles, notes and paths stay so; the app's links and images do not drag
       out of the window; and Cmd+A outside a text field does nothing instead of painting the
       whole page.
     - Twelves is a split view: the shelves in a sidebar with their counts, the filter and the
       order above the shelf, the keys below it, and only the shelf scrolls. The column headers
       became visible and mark the sorted column with `aria-sort`. The order stays a radio group
       with `S`, shown as a segmented control: the six orders do not map one to one onto the
       columns (year sorts the label column, price and most wanted the market), and the Tracks
       shelf has columns for two of them only, so clickable headers would hide orders.
     - Settings takes the same split view, and Esc in it goes back to the page it was opened
       from, as closing a settings window would. Settings stays in the main window: a window of
       its own would need the Triage window to hear each save, which the page has no channel for.
     - The setup takes the same split view instead of a card in the middle of the window, which
       read as a window inside a window. The steps are numbered A1 to B2, as tracks on two sides,
       and the step's actions stay in a bar at the pane's foot while the step scrolls. Step 1 lost
       its second list of the steps, which the sidebar now shows.
     - The drawings made for the README appear in the app's empty and waiting states, at most one
       per screen and never on the desk while digging: the mole, Digga's mascot, at the head of
       the setup's sidebar, the crate on an empty shelf, the press while Triage waits for records,
       the safe beside the backups. The app ships 320 px copies (about 500 KB), enough for twice
       their largest size.
     - The icon is the mole, Digga's mascot, from the waist up in front of a flyer-yellow disc on
       the app's dark ground; it replaced the cube logo the first icon used. The disc keeps the one
       accent colour dominant, which is what tells the app apart in the Dock at 32 px, where a
       plain dark squircle disappeared among others. The mole fills the body down to its waist:
       at full height it was small at Dock sizes. One drawing serves every size, since tighter
       crops for 16 and 32 px made a darker blob while the disc still reads at 16 px. The shape
       and shadow follow Apple's grid, measured against the system's icons. A script draws it
       from the drawing, so the binaries in `build/` have a source.
174. **Leaving Settings with unsaved changes asks first.** Until 2026-10-10 Esc, the page keys and
     the toolbar links left Settings and dropped the draft without a word, although the save bar
     said "Unsaved changes". Now the router asks the page before it leaves (`guardLeaving` in
     `router.svelte.ts`): for navigation by key or `navigate()`, for a click on a `#/` link, and,
     after the fact, for Back and Forward, whose hash it puts back. With a dirty draft Settings
     opens a modal dialog with Save, Discard and Keep editing; Esc keeps editing, and a draft
     that cannot be saved offers only Discard and Keep editing. The page keys stay quiet while a
     dialog has focus.
175. **Shift turns letter shortcuts off and leaves other keys alone, on every page.** Twelves
     ignored every key pressed with Shift, so on layouts that need Shift for `/` or the digits
     (French AZERTY among them) the filter and shelf keys did nothing, while Triage judged a
     record on Shift+A, R, L or D. Since 2026-10-10 one rule in `shortcutKey()` (`keymap.ts`)
     applies to Triage, Twelves and the page keys: a letter with Shift runs no letter shortcut,
     and any other key counts as typed, with or without Shift. Triage's Shift track marks are
     read before that rule and stay as they were.
176. **A year range must be in order.** The config accepted `filters.yearFrom` after
     `filters.yearTo`, and `universe.loadYears` with its ends swapped, so a typo such as 2002 to
     1998 left an empty queue with only the preview count as a hint. Since 2026-10-10 the schema
     refuses both, at `filters.yearTo` and `universe.loadYears`, a range open at one end stays
     valid, and Settings' year fields carry `min` and `max` from each other, so the browser marks
     them and the save bar and the field show the schema's message. The setup's year fields
     already had the same bounds.
177. **A lock from before the last boot is stale.** Decision 129 took over a lock only when its
     process had ended, so after a hard crash and a reboot another process with the same id kept
     Digga out of its library with nothing in the app to recover. Since 2026-10-10 a lock whose
     `since` predates the boot (now minus `os.uptime()`, with a minute's tolerance) is taken over
     whatever its process id; a newer lock still counts as held while its process exists, EPERM
     included. The refusal names the process id and the lock file, so a user can delete it by
     hand.
178. **A pasted link is never refused silently.** A `music.youtube.com` link was not recognised,
     and a pasted link Digga could not attach did nothing at all. Since 2026-10-10 YouTube Music
     links attach like any other YouTube link, and a pasted `http(s)` link to anything else flashes
     "That is not a YouTube link." on Triage and Twelves. Pasted text that is not a link is still
     ignored, so a stray paste outside a field does not interrupt.
179. **Triage reads the queue past what it holds.** The session asked for everything it held plus
     a batch, from the start, up to the 5,000-record limit, and called the queue exhausted when an
     answer brought nothing new. Past about 5,000 passes every answer held only known records, so
     Triage said everything was dug while undecided records remained. Since 2026-10-10 the session
     posts its reads to `POST /api/queue` with `exclude`, the triage keys it holds (buffered,
     passed and with a write unanswered), and the server leaves them out before the limit, so a
     read asks for a plain batch. The queue is exhausted when an answer is shorter than its limit.
     An offset in the seeded order was not enough: an undo still on its way, or a verdict changed
     in Twelves or another tab, shifts the records before it, and reading the queue again after
     Twelves has to find records sent back anywhere in it. `GET /api/queue` stays for one-off
     reads.
180. **A page's Discogs request gives up before the page does.** Without `Retry-After` a `429`
     waited 60, 120 and 180 s, longer than the page's 5-minute Discogs timeout, so the page could
     retry a push the server was still making, and `P` or `A` could wait minutes behind an import.
     Since 2026-10-10 each caller picks a retry policy: the server's requests for pages retry twice
     a minute apart and end after 4 minutes, their wait behind other requests included; a request
     still waiting for its turn then never goes out. Jobs and the CLI keep three retries of 60, 120
     and 180 s. The one serialised transport and its 1.1 s spacing stay.
