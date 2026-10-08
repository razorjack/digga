# E2E implementation history

Read this when investigating an earlier finding, decision or measurement. Start with the [E2E guide](../E2E_TESTING.md)
and its binding rules. This is historical evidence, not current operating instructions. For ongoing work,
read [PLAN](PLAN.md).

The entries retain their original dates, environments, timings and outcomes. A result is
limited to that run; later entries can supersede it. The original entries do not identify
the tested revisions, so no revision has been inferred. New entries should include the tested
revision and exact command along with the date, environment and outcome. Current instructions
belong in their owning reference, not in a new results paragraph.

Search by scenario ID, error or date, or start with:

- [Web spike and implementation results](#spike-results).
- [Gap fixes on 2026-10-02](#closing-the-gaps-web).
- [The setup's remaining scenarios and the Accessibility family](#the-setups-remaining-scenarios-and-the-accessibility-family-web).
- [CI on GitHub Actions](#ci-on-github-actions): Linux findings, workers and durations.
- [The Electron main process](#the-electron-main-process-electron-unpackaged): the rehearsal of
  the unpackaged app, workers and the guard.
- [The packaged app](#the-packaged-app-electron-packaged): electron-builder, fuses, the ad-hoc
  signature, Gatekeeper, `-r` and the `DIGGA_E2E_HOLD` hook, and the suite on the packaged app.
- [The setup's Electron parts](#the-setups-electron-parts-electron-unpackaged-and-packaged): the
  desktop interface, the quit question, the Dock, the dump file and folder dialogs, Full Disk
  Access, and ELEC-07, -08, -09, -12, -14 and -15 on both configurations.
- [The owner's decisions of 2026-10-08](#the-owners-decisions-of-2026-10-08-web-electron-unpackaged-and-packaged):
  the browser history import removed, the open observations settled, and the three configurations'
  final runs.
- [The Electron spike](#the-electron-spike-electron-unpackaged): the held start and navigation, the
  preload's guard in workers, quitting and userData.
- [The Electron host and its scenarios](#the-electron-host-and-its-scenarios-electron-unpackaged):
  the shared suite and the ELEC scenarios on the unpackaged app, with durations per host.
- Original planning records: [product changes](#product-changes-the-harness-needs),
  [running plan](#original-running-plan), [runner choice](#runner-choice-on-2026-09-30),
  [markup audit](#markup-audit-recorded-through-2026-10-02),
  [rollout](#rollout-recorded-on-2026-10-02), [risks](#risks-recorded-on-2026-10-02)
  and [fixture design](#original-fixture-catalogue-design).

The planning records can describe commands or features that were not implemented. Their
obsolete statements are retained as historical context and do not override current references.

## Spike results

The web spike was built on 2026-09-30 on macOS with Node 24.18, Playwright 1.63.0 and its
Chromium 153. GUARD-01, GUARD-02, SHELL-01, TRI-07 and TRI-10 pass. The spike showed:

- **The Node guard works in every call form.** Loaded through `NODE_OPTIONS=--import`, it refused
  fetch to `127.0.0.1`, to `localhost` and to an external host, a redirected fetch, `http.get`,
  `https.get`, `tls.connect`, `net.connect` in both call forms, `socket.connect`, and fetch in a
  worker thread, and let the fakes' port through (`tests/e2e-guard.test.ts`). Without the guard,
  GUARD-01 fails: the server's oEmbed lookup reaches the test's listener.
- **Redirects need the harness's fetch**, and user activation needs the harness's flag; the
  measurements are in [The network and filesystem guard](HARNESS.md#the-network-and-filesystem-guard) and [The fake YouTube IFrame API](FIXTURES.md#the-fake-youtube-iframe-api).
- **The fake player behaves as designed.** Before a key press the player waits for Space; Space
  plays the cued first video with sound at half its length, and the next release and track are
  preloaded muted on the hidden decks. The init script is built from the source of several
  functions and a class, which keeps each within the lint limits, and Playwright's TypeScript
  transform leaves that source usable in the page.
- **The slip's `aria-busy` marks the end of a save.** With `POST /api/verdicts` held by a route,
  the slip reads `aria-busy="true"`, and `"false"` once the answer has arrived. TRI-07 and TRI-10
  synchronise on it; the session's part has a vitest test.
- **Undeclared failures are caught.** A want on `small`, which has no account, fails the test at
  teardown with "POST /api/discogs/wantlist/1101 answered 400". Chromium also logs that response
  as the console error "Failed to load resource: the server responded with a status of 400 (Bad
  Request)".
- **Actions need their precondition.** An early `judge()` hung in 4 of 10 runs when a test
  called it straight after `open()`: the key arrived before Triage showed a record and did
  nothing. Page-object actions now wait for a record first (rule 4).
- **Costs are small.** A server starts in about 200 ms and stops over IPC in about 5 ms; `small`
  builds in 0.2 s and `small-account` in 0.4 s; `route.fetch()` adds about 5 ms to a page load;
  `vp run e2e` takes 7.7 s including the client build. TRI-07 takes about 5 s, most of it two
  1.5 s push graces and the server's 1.1 s gap between Discogs requests.
- **The scenarios are stable so far.** 50 of 50 runs passed at `--repeat-each=10` on five
  workers, and 100 of 100 at `--repeat-each=20` on 16 workers on a 10-core machine.
- **Tooling fits.** Playwright's loader resolves the repository's `.ts` import specifiers, so
  specs import `keymap.ts`, `src/shared` and the Discogs types directly. `digga serve` prints info
  log lines before `digga serving on <url>`, so the helper matches lines by prefix.

The spike left out, for the harness step: data.discogs.com in the fakes (it answers `404`), most
of the Discogs API, and the move to `tools/dev/fake-services.ts`; a 40-release catalogue in two
dumps (the spike has 10 releases in one); checkpoints and product change 4; the clock, which no
spike scenario uses yet; and in the host interface `relaunch()`, `restartServer()`, `cli()`,
`expectExternalOpen()`, `expectDownload()` and every `given` but the saved token.

### The rest of the P0 set (web)

Built on 2026-09-30 on the same machine and versions: SHELL-02, TRI-02, TRI-12, TRI-13, SBX-01,
PER-01 and PER-04, with the clock option, `relaunch()`, fault routes, declared problems, the
sandbox helpers, and the header and Twelves page objects. All twelve P0 scenarios but SETUP-01
pass. The work showed:

- **Pausing needs a time ahead of the page.** Playwright's `pauseAt()` fast-forwards to the time
  it is given and refuses one the page's clock has passed, and that clock keeps running while the
  harness's calls travel. `app.clock.pause()` therefore pauses 1 s ahead of the page's own
  `Date.now()` (see [Time](AUTHORING.md#time)). Reading the time and pausing took 29 ms at the median, 155 ms at the
  95th percentile and 228 ms at most over 80 pauses in a burn-in on 16 workers, so the lead holds
  with room. Once paused, the page's `Date.now()` stayed the same across a verdict's round trip,
  and the fake player's time stayed at the start offset, which TRI-02 compares exactly.
- **The app's timers run on the installed clock.** Time flows until a pause, so the player's
  250 ms tick and the fake player's interval run as usual. `runFor(4500)` produced a logged
  listen (SBX-01), and `runFor(2000)` fired the push grace with the clock paused (TRI-12, TRI-13,
  PER-04). The clock also holds `requestAnimationFrame` while paused: a frame callback requested
  then waited until the test timed out. The client uses none today.
- **Relaunch.** The host closes the context, stops the server over IPC, then starts a new server
  on a free port, a different one in each relaunch logged, and prepares a new context, whose clock
  installs again.
  Without load, closing the context took 144 ms, the graceful stop 5 ms and the new server 205 ms
  (medians of 32 relaunches); on 16 workers on 10 cores, 479 ms, 13 ms and 914 ms. The browser
  log keeps what earlier launches recorded, and the server log attachment has each launch's
  output.
- **Fault routes compose with the base route.** PER-04's route, registered after the base route,
  aborted the one `POST /api/verdicts` and passed every other request back with
  `route.fallback()`, which the base route then fetched. The abort makes Chromium log "Failed to
  load resource: net::ERR_FAILED". The spike's host ignored every console message starting
  "Failed to load resource", which also hid this one; the host now ignores only the "server
  responded with a status of" messages the `/api` status check covers. Without its declarations,
  PER-04 fails at teardown with "a fault route aborted POST /api/verdicts" and that console error.
- **A saved token reaches the fake before the page opens.** `PUT /api/discogs/token` asks the
  fake for `/oauth/identity`, so "the fake got nothing" counts from a mark taken before the key
  press (TRI-13, PER-04).
- **The sandbox sends no digging write.** In SBX-01 a logged listen, a keep mark, a note, `R`,
  `A` and `Z` sent no request to `/api/verdicts`, `/api/track-verdicts`, `/api/listen-log` or
  `/api/discogs/wantlist`, and the fake got no `PUT` or `DELETE`. The sandbox want still makes
  its real `GET /api/releases/:id`.
- **The player region's text is not specific enough.** It says "Nothing playing" while it has no
  track, so `toContainText("playing")` would pass before anything plays. The page object reads the
  status line by its exact text within the region.
- **Node cannot import what the tests would read from a rune module.** Importing
  `router.svelte.ts` fails with "$state is not defined", and the player's copy lived in a
  component. The route table, the player's status copy and the track-mark keys moved into plain
  modules (see [Product changes the harness needs](#product-changes-the-harness-needs)).
- **Stable and quick.** 240 of 240 runs passed at `--repeat-each=20` on 16 workers on a 10-core
  machine, in 1.7 minutes. The twelve scenarios take 7.6 s on five workers, and `vp run e2e` 8.9 s
  including the client build. In steady state TRI-02 takes about 1.1 s, SHELL-02 1.3 s, SBX-01
  1.8 s, PER-01 1.8 s, PER-04 2.2 s, TRI-13 2.7 s and TRI-12 2.9 s; the pushes wait for the
  server's 1.1 s gap between Discogs requests.

### The first-run setup path (web)

Built on 2026-10-01 on the same machine and versions: product changes 3 and 4, data.discogs.com
in the fakes module, the checkpoint builder and the bulk catalogue, the `empty` template, the setup
page object, SETUP-01 with its gap, SETUP-18, SETUP-19 and SETUP-21. All thirteen P0 scenarios
pass. The work showed:

- **Checkpoints give exact states.** Held at `100-to-dig`, the crate counted exactly 100 records
  to dig and 100 releases kept, `/api/stats` said 100, the fake had sent exactly the checkpoint's
  6,112 bytes, the download was still running, and `/api/dumps` listed nothing, since the dump was
  still a `.part` file. The load had read exactly those bytes: the Read bar's value was the
  checkpoint's share of the dump (6,112 of 81,198 bytes), the header read "loading 7%", and "Just
  pulled" named the checkpoint's last release with its catalogue number. At `600-to-dig` it was
  600 and 40%. The builder's bytes match those of a gzip stream flushed with `Z_FULL_FLUSH`
  (compared on the first part), and a vitest case cuts a growing `.part` at a full flush and gets
  exactly the releases before it.
- **The loader change works as intended.** In vitest, an input that stops after three releases,
  fewer than a batch, has them committed and reported about a second after the load starts, and
  the next report comes a second later, not sooner; a dry run commits nothing; a timed commit that
  fails ends the load with its error. Both stalled cases fail on the old loader. In the app, the
  100 records of `100-to-dig`, below a batch, reached `/api/stats` 1.1 to 1.4 s after the load
  started (median 1.23 s over 10 runs on six workers): the worker's start plus the timer.
  Released to `600-to-dig`, the 500 new records fill a batch and commit at once: `/api/stats`
  counted 600 0.22 to 0.31 s after the fake had sent the bytes (median 0.27 s).
- **The crate's count trails the database by up to 3 s.** The setup reads the records to dig
  every 3 s, so the count showed 4.1 to 4.6 s after the load started (median 4.4 s), and 2.6 to
  3.1 s after the bytes for 600 arrived (median 3.1 s). The page object waits up to 15 s.
- **The bulk dump is small.** 1,500 records make 1.39 MB of XML and 81,198 bytes gzipped,
  generated in about 9 ms and compressed in about 16 ms, once per worker and in memory: the fake
  serves it from memory, so no file is written. The loader reads it whole in about 210 ms
  in-process (195 to 223 ms over 5 runs), and a transfer released from `600-to-dig` to the end
  reached READY TO DIG 0.8 to 1.3 s later (median 1.06 s), with the checksum verified. The size
  costs nothing measurable, and the 900 records after `600-to-dig` are there for scenarios that
  release to the end. The 20,000 releases in other styles the design planned wait until a
  scenario needs them.
- **The fake reads as data.discogs.com does.** `newestReleasesDump()`, `checksum()` and
  `download()` read the listing, `CHECKSUM.txt` and the `Content-Length` as they read the real
  site; a whole transfer ended "downloaded … (79 KB), checksum verified". `failAfterBytes` at
  20,000 ended the download job `failed` with "fetch failed", undici's message for a body cut off,
  which SETUP-25's copy would show as the reason.
- **The Download bar can lag while a transfer is held.** The downloader reports only when a chunk
  arrives and a second has passed since its last report, so a held transfer can show fewer bytes
  than have arrived. The loader reads what is on disk, so its numbers are exact. In the runs the
  checkpoint's bytes came in one chunk, and the bar was exact in 10 of 10 runs; SETUP-18 checks
  only that it has a value.
- **A gap: Triage digs a stale queue after "Start digging".** Triage's session reads its queue
  when the picks are saved (`PUT /api/settings`, then `GET /api/queue`, then
  `POST /api/jobs/dump-load` in the page's log), before any record has arrived, and during a load
  it looks again every 10 s. The count reaches 600 within about 5 s, so "Start digging", or `T` at
  any count, can open "You have dug everything loaded so far." with 600 to go. SETUP-01 records
  the gap: the normal test runs the clock 10 s after "Start digging", and its `test.fail` shows the
  design with the clock paused, so Triage cannot look again. With a real dump the first look comes
  10 s into a load that takes about 70 s to reach 500 records, so the owner would rarely see it.
  Closed on 2026-10-01 by decision 112: Triage reads its queue again when it is shown, so both
  SETUP-01 tests are normal tests.
- **A race in the setup's job polling.** The first burn-in failed SETUP-01 once in 20 runs: the
  crate stayed at "starting" with no records to dig, while the header read "loading 40%". The
  trace showed that the page's timers had stalled for 4.6 s under load. When they ran again, the
  poll that was due before "Fill the crate" fired while the answer to the load's `POST` was still
  unprocessed. It found no load, asked only about the download, and wrote the missing load back
  after `#startLoad()` had set it, so from then on it asked about the download alone. Without a
  stall, the same happens whenever a poll's answer arrives after a job the flow started meanwhile.
  `#refreshJobs()` now keeps a job that changed while the answers were on their way; the vitest
  case in `tests/setup-flow.test.ts` fails without the fix.
- **The base route's own fetch failed under load.** One TRI-07 run in 280 and two SETUP-21 runs
  in 100 failed on "Failed to load resource: net::ERR_FAILED" for `GET /api/jobs` or
  `GET /api/stats`. The route caught every fetch error silently, so the harness now records them;
  the SETUP-21 failures were "route.fetch: read ECONNRESET" on `127.0.0.1`: a kept-alive
  connection the server was closing when the harness used it again. Chromium sends such a
  request again, but `route.fetch()` does not. A probe also showed that a fetch of `localhost`
  tries `[::1]` first, where another program with the same port number takes it: with a listener
  there, the fetch failed with `ECONNRESET` and the page with `net::ERR_FAILED`. This machine has
  such listeners (`rapportd` on `*:59685`). The base route now fetches from `127.0.0.1` with
  `Connection: close`; a loopback connection per request did not change the suite's time
  measurably.
- **Stable.** After these fixes the P0 set passed 280 of 280 runs at `--repeat-each=20` on 16
  workers on the 10-core machine, in 2.3 minutes; the setup spec passed 100 of 100 in 1.4 minutes,
  and the whole suite 340 of 340 in each of two runs, in 2.8 and 3.0 minutes. SETUP-01's `test.fail` failed as expected in
  every run.
- **Durations.** On five workers (`vp run e2e`): SETUP-01 9.6 s, its gap test 8.2 s, SETUP-18
  5.5 s, SETUP-19 5.3 s and SETUP-21 7.2 s. The medians on 16 workers in the burn-in were 12.6 s,
  10.9 s, 8.8 s, 7.9 s and 10.2 s. SETUP-01 spends about 3.3 s in the Discogs client's 1.1 s gaps
  between its four requests and about 4.4 s waiting for the crate's count; the gap test spends
  5 s on its failing expectation. `vp run e2e:smoke` takes 12.6 s with the client build, and
  `vp run e2e` 15.2 s.

### The first Triage P1 slice (web)

Built on 2026-10-01 on the same machine and versions: the record, the player and the tracklist,
TRI-01, TRI-03, TRI-04, TRI-05, TRI-06, TRI-11, TRI-17, TRI-18, TRI-26, TRI-27, TRI-28 and TRI-36,
in thirteen tests (TRI-28 has two). TRI-01, TRI-11 and TRI-17 are in `specs/triage.e2e.ts`, the
others in the new `specs/triage-player.e2e.ts`. With them came the catalogue's new records,
`embed="false"` in the dump builder and the fake's release data, `diggaOptions.labels`,
`app.given.listen()`, `end()` and `fail()` on `app.youtube`, Triage page-object actions for
Space, `J`, `K`, listens, notes, marks, pastes and a held key, and `data-video-id` on the "Other
videos" rows. `e2e:smoke` joined `vp run verify`. The work showed:

- **The new records leave the earlier scenarios alone.** The first record gained a third track
  without a video; Echo Chamber gained a release whose three videos are all refused and one whose
  second video has `embed="false"`; Groundwork holds a record with five tracks, and Hardline
  Audio a record that repeats the first record's "Pressure Drop" on another master. All sort
  after the first five records of the default queue, so the queue those scenarios dig starts as
  before. The 17 earlier tests passed on the new catalogue before any new scenario existed.
- **No product bug.** Each scenario passed against the code as it is. The TRI-28 row was wrong
  about where a refused video can reach the notice and is corrected (next point). Three
  observations, left for the owner: `docs/KEYMAP.md` says videos with `embeddable = 0` "are
  skipped with a notice", but the player leaves them out of the playlist without one, and the
  tracklist reads "no embed" (TRI-28 asserts that); the tracklist marks the cued track as current,
  with ▶ and the hidden text "playing", while the player still waits for Space (TRI-01 asserts
  only `aria-current`); and after `N` on the last record, the end of the queue reads "Every
  release under your filters has a verdict." beside "go round the 1 you passed", though the
  passed record has none (TRI-09 and TRI-30 cover that screen; the second slice fixed it).
- **A catalogue video that YouTube refuses reaches the notice only as the first video a page
  plays.** The hidden decks load the next release's first video and `J`'s next track before
  either plays, so they find the refusal first and the player skips the video silently. TRI-04
  waits for that: `J` skips B1 only once its row reads "video would not play", which happens as
  soon as the deck that buffers `J`'s track has tried it. The notice scenario refuses the playing
  video at runtime with `app.youtube.fail(id, 150)`, which goes through the same `onError` path.
- **Listens and positions are exact with the clock paused.** In every run the listen logged after
  `runFor(4500)` said 4 s, the one posted on leaving after `runFor(5500)` said 1.5 s, and the
  first leaving, 0.5 s past its listen, posted nothing. The position slider showed the start
  offset, 2 s past it after `runFor(2500)`, the seek step either way, and each tenth after `1` to
  `9` and a 250 ms run; the fake player's time was the exact sum (202.5 s, then 212.5 s).
- **Negative checks count requests that leave in order.** Each was tried against a broken build,
  restored afterwards: without the key-repeat guard in `Triage.svelte`, TRI-11 failed with three
  `POST /api/verdicts`; with a paste in the note field attaching its link, TRI-26 failed with two
  attachments; with any remainder posted on leaving, TRI-36 failed with four listens.
- **A held key needs no helper.** Playwright's `keyboard.down()` on a key that is already down
  dispatches a keydown with `repeat: true`, as a held key does.
- **Reaching a record by its label is cheap.** `diggaOptions.labels` writes `excludeLabels` into
  the copied config before the server starts, so it adds nothing to the run.
- **Stable and quick.** Each new spec passed `--repeat-each=10` before the next was written (30,
  20, 20, 10, 40 and 10 runs). The whole suite passed 600 of 600 runs at `--repeat-each=20` on 16
  workers on the 10-core machine, twice, in 4.2 and 4.0 minutes. On five workers the 30 tests take
  17.4 s and `vp run e2e` 18.7 s with the client build. The new tests take 0.6 to 1.6 s each on
  five workers: TRI-11 0.6 s, TRI-05 0.7 s, TRI-01 0.8 s, TRI-17 0.8 s, TRI-28's notice 0.9 s,
  TRI-26 1.0 s, TRI-27 1.0 s, TRI-28's refusals 1.1 s, TRI-03 1.2 s, TRI-06 1.2 s, TRI-04 1.3 s,
  TRI-18 1.3 s and TRI-36 1.6 s. Their medians in the burn-in on 16 workers were 2.7 to 5.2 s,
  against 2.8 s for TRI-02 and 7.7 s for TRI-07 in the same runs.
- **`verify` with the smoke set.** `vp run verify` took 9.0 s before and 20.4 s after, in three
  runs out of three; the 14 smoke tests take about 10.5 s of that, and the client build the rest
  of the difference.

### The second Triage P1 slice (web)

Built on 2026-10-01 on the same machine and versions: the verdicts, the queue, scopes, the market,
the seller and the wants, TRI-08, TRI-09, TRI-14, TRI-15, TRI-19, TRI-20, TRI-21, TRI-23, TRI-25,
TRI-30, TRI-32, TRI-33, TRI-34, TRI-39, TRI-40 and TRI-42, in twenty tests: TRI-08 runs without
and with a Maybe list, TRI-23 and TRI-34 live and in the sandbox, and TRI-21 has a gap test. TRI-08
is in `specs/triage.e2e.ts`; the queue, scopes and the seller (TRI-09, TRI-19, TRI-20, TRI-21,
TRI-30, TRI-32, TRI-33, TRI-34 and TRI-40) in the new `specs/triage-queue.e2e.ts`; the pushes, the
market and the links (TRI-14, TRI-15, TRI-23, TRI-25, TRI-39 and TRI-42) in the new
`specs/triage-discogs.e2e.ts`. With them came `expectExternalOpen()` in the web host,
`diggaOptions.config`, `given.verdict()` and `given.sellerShop()`, the fake's
`GET /users/{u}/inventory` and the account `shopkeeper`, track artists and Various in the dump
builder, and Triage page-object actions for pushes, rounds, `F`, `P`, `O`, `S` and the retry. The
work showed:

- **The new records leave the earlier scenarios alone.** Six releases on three labels that sort
  after Hardline Audio: two self-releases on "Not On Label (Dillinja Self-released)", whose
  catalogue number "none" reads "no cat"; a compilation that credits Kestrel, Sub Frame and
  Vantage on its tracks, and a second record on its label, Rollers Archive; and the main release
  and a repress of one master on Tempest Audio, the repress in `shopkeeper`'s shop. The 30
  earlier tests passed on the new catalogue before any new scenario existed. The default queue
  has 18 records on `small` and 16 on `small-account`, enough for a batch of five and for ten
  verdicts.
- **One product bug, fixed.** After `N` on the last record, the end of the queue said "Every
  release under your filters has a verdict." while the passed record, which has none, waited
  behind "go round the 1 you passed". `docs/KEYMAP.md` says the release "stays in the queue and
  comes back later", and the design brief puts the way to go round on the ALL DUG screen, so the
  stamp and the button are as designed and the sentence was wrong. The headline now comes from
  `endOfQueueHeadline()` in `src/client/triage/end-of-queue.ts` and reads "…, apart from the 1
  you passed." while there are passes; `tests/end-of-queue.test.ts` covers it. TRI-09 reads the
  headline with a pass, TRI-30 without.
- **One gap: Esc in `F`'s search field.** The field is `type="search"`. In Chromium, Esc in it
  clears the text and the dialog stays open; a second Esc closes it. With an empty field one Esc
  closes it. `docs/KEYMAP.md` says Esc cancels. The fix would be a keydown handler in
  `ScopePicker.svelte`, which no vitest test can cover, so TRI-21 records it as a gap: its normal
  test presses Esc twice, and its `test.fail` expects one Esc to close the picker. The behaviour
  belongs to the browser's search field, so other engines may differ; the Firefox and WebKit
  projects will show it. Closed on 2026-10-02 by decision 113 (see [Closing the gaps](#closing-the-gaps-web)).
- **Rows corrected.** TRI-40 pushes, so it needs a saved token as well as `small-account`.
  TRI-42 runs on `small-account` with a saved token, where the server could call Discogs with
  the account's token; that is what "no request" is about. The fake's state said `shopkeeper` has
  20 listings; the shop has the two TRI-40 needs, a repress of a loaded master and a release in no
  dump. TRI-09's row now names the headline.
- **The seller's pressing is the one wanted.** The whole queue shows the main release, 2101, for
  the master; digging `shopkeeper` shows the repress, 2102, since the scope filters releases
  before the queue picks one per master, and the fake's `PUT` names 2102.
- **Config and decisions as given state cost nothing visible.** `diggaOptions.config` writes
  `queue.limit`, impossible years and `discogs.maybeListId` into the copied config, as labels
  are written; TRI-32 takes 1.0 s. `given.verdict()` dates TRI-30's snoozes a day apart, so the
  round's order does not depend on the clock. `given.sellerShop()` takes about 2.2 s, all of it
  the Discogs client's spacing (below).
- **`expectExternalOpen()` keeps the guard's promise.** `window.open()` with `noopener` still
  raises the context's `page` event, and the route answered the window's page, so TRI-25 saw no
  refusal and nothing left the machine. Pressing `O` outside the helper failed a probe test with
  "the browser requested https://www.discogs.com/release/1101".
- **Negative checks were tried against broken builds**, restored afterwards: with the session's
  refill threshold at 0, both TRI-34 tests failed on the fifth record, whose "Up next" read
  nothing; without the Maybe-list guard in `Triage.svelte`, TRI-08 without a list failed, since `M`
  judged the record instead of showing the flash; without the tracks' artists in
  `scopesOfRelease()`, TRI-20 failed with one option on the record instead of four.
- **The held requests make in-flight states exact.** With `GET /releases/:id` held at the fake,
  the market line read "asking Discogs…" with `aria-busy="true"` in every run (TRI-23). With the
  `PUT` held, `Z` settled first, and the fake's `DELETE` arrived after the `PUT` had been answered
  (TRI-39).
- **The cost of the Discogs interval.** From the fake's log over three runs of each scenario on
  five workers: the 1.1 s gap binds when one request follows another at once. Reading the shop
  waits twice, 2.2 s in TRI-21 and TRI-40 (the token's identity check, then the profile and the
  inventory page, 1.09 to 1.11 s apart); TRI-39 waits 1.1 s before its `DELETE`; TRI-42's `P`
  waits up to 1.1 s, since its ten verdicts take less than that after the token was saved; TRI-12
  and TRI-13 wait 2.2 s each with the clock paused. A push with time flowing comes after the
  1.5 s grace and waits for nothing: TRI-07's, TRI-14's and TRI-15's requests were 1.8 to 2.6 s
  apart. In this slice the spacing costs about 6.6 s of the 40 s its twenty tests take on five
  workers, two thirds of it in TRI-21 and TRI-40. A `discogsMinIntervalMs` option would save
  that much; it does not decide the suite's time yet.
- **Durations.** On five workers (`vp run e2e`) the 50 tests take 25.4 s, against 18.6 s for the
  30 before, and `vp run e2e` 26.9 s with the client build. The new tests take 0.7 to 6.3 s each:
  TRI-23 0.7 s (1.0 s in the sandbox), TRI-08 1.0 s and 1.0 s, TRI-32 1.0 s, TRI-25 1.1 s, TRI-33
  1.2 s, TRI-09 1.4 s, TRI-19 1.4 s, TRI-20 1.6 s, TRI-30 1.6 s, TRI-42 1.6 s, TRI-34 1.8 s in the
  sandbox and 2.1 s live, TRI-14 2.4 s, TRI-15 2.4 s, TRI-21's gap 2.5 s, TRI-39 3.5 s, TRI-21
  4.7 s and TRI-40 6.3 s. TRI-40 reads the shop and waits for a push's grace, which makes it the
  slowest Triage test on five workers, ahead of TRI-07's 5.3 s.
- **Stable.** Each group passed `--repeat-each=10` on 16 workers before the next was written (100
  of 100 runs each). The whole suite passed 1,000 of 1,000 runs at `--repeat-each=20` on 16
  workers on the 10-core machine, in 7.5 minutes, and again on the final code in 5.7 minutes.
  TRI-21's and SETUP-01's `test.fail` failed as expected in every run. Another project's test suite ran on the machine at the same
  time (load averages of 115 to 216), so these times are slower than the earlier slices'. The
  medians of the new tests in the first burn-in were 2.7 to 7.9 s, against 3.5 s for TRI-02 and
  8.0 s for TRI-07 in the same runs; the slowest single runs were TRI-15 at 13.7 s and TRI-14 at
  13.3 s, inside the 30 s timeout.
- **`verify` has not grown.** The smoke set is still the P0 set; the slice adds P1 tests only.
  Timed alternately against a worktree of the previous commit once the machine was quiet,
  `vp run verify` took 20.9 to 21.1 s against 20.7 to 21.7 s, and its smoke set 10.6 to 10.7 s against
  10.4 to 10.8 s, in three runs each.

### The Settings P1 slice (web)

Built on 2026-10-01 on the same machine and versions: SET-01, SET-02, SET-03, SET-04, SET-07,
SET-16 and SET-20 in `specs/settings.e2e.ts`, which also holds SET-17 and its gap test, and
SET-08, SET-09, SET-10, SET-11, SET-13 and SET-14 in the new `specs/settings-discogs.e2e.ts`:
fifteen tests. With them came the Settings page object (`pages/settings.ts`),
`expectDownload()` in the web host, `diggaOptions.environmentToken` and `diggaOptions.dumpFiles`,
`given.trackMark()`, `dj`'s lists in the fake, the small catalogue's July and September dumps,
and the Settings markup (see [Markup audit](AUTHORING.md#markup-audit)). The work showed:

- **The catalogue's dumps follow the design, and nothing earlier relied on the change.** The
  templates now load the small catalogue as the August dump (`discogs_20260801_releases.xml.gz`,
  until now named for 1 September), and the September dump, which drops "Brass Knuckle" and adds
  three releases on "Upfront Audio", is what data.discogs.com lists for SET-17. The templates do
  not load September, so "Added by the last dump load" still offers every record to dig on `small`
  (TRI-20). No earlier test read the dump's date, and the 50 earlier tests passed on the
  new catalogue and templates before the second group was written. SET-17's update added exactly
  3 releases and did not find 1 in every run.
- **Three product bugs, fixed, each with a vitest case that fails without the fix.**
  - Saving the first token in Settings adopts its account as the username on the server, but
    the form kept the empty username: the lists never loaded, and the next Save wrote the empty
    username back over the adopted one. The setup reads the settings again after a token save;
    Settings did not. `saveToken()` in `Settings.svelte` now reads the settings when the server's
    username changed, and the form takes it unless the field was edited since
    (`usernameAfterTokenSave()` in `settings/discogs.svelte.ts`, `tests/settings-state.test.ts`).
    SET-08 failed on the empty field before the fix.
  - A job that started and ended between two reads of the jobs never refreshed the counts:
    `SettingsJobs` refreshed the stats only when a job it had seen running had ended. The
    Wantlist import, started after the Discogs client's 1.1 s gap had passed, often ended within
    milliseconds, so the Library kept "Discogs wantlist 0" (SET-13 failed once in 60 runs on 16
    workers). `SettingsJobs.load()` now refreshes them when any job ended since its last read,
    and not on the page's first read (`tests/settings-state.test.ts`).
  - The Library said "It did not find 1 releases loaded before". The sentence is now
    `missingReleasesNote()` in `src/client/settings/library.ts`, with
    `tests/settings-library.test.ts`; SET-17 read the wrong copy before the fix.
- **One harness bug, fixed: two responses in order.** The Triage and Settings page objects
  waited for `PUT /api/settings` and then for the next `GET /api/queue`, with a flag set in a
  callback chained to the first wait. When both responses reached Playwright together, both
  events were dispatched before the callback ran, so the second wait missed its response and the
  test hung: SET-11's Save hung once in 60 runs, while the page had sent the `GET` and read
  "Saved. The queue has reloaded.". `waitForResponses()` in `pages/triage.ts` sets the flag in the
  first predicate, which Playwright runs in event order; Save, Cancel and `X`/`Z` on a label use
  it (see [Synchronisation](AUTHORING.md#synchronisation)).
- **One gap, confirmed: SET-17's header indicator.** Settings' "Update from the newest dump"
  does not ask the load status again, so with the transfer held part-way the header shows no
  indicator until a reload, after which it reads "loading N%". The normal test asserts that; the
  `test.fail` waits 5 s for the indicator without a reload and failed as expected in every run.
  Closed on 2026-10-02 by decision 115 (see [Closing the gaps](#closing-the-gaps-web)).
- **Rows corrected.** SET-11's "Read my lists" shows only while no list has loaded: with a
  username saved, Settings reads the lists when it opens, so the scenario starts from a failed
  read (the fake answers `500` once, the page gets a declared `502`). SET-14 holds the import's
  page at the fake instead of delaying it 2 s: the row read running after the cancel and the
  next read of the jobs had answered, and cancelled once the page was released, in every run.
  SET-13 holds its first page too, so the row is seen running. SET-10 counts exactly two requests,
  identity and lists. SET-08 now names the username the form takes, SET-03 the attached message,
  and the rows name their templates and given state.
- **Observations, left for the owner.** Keys pressed in Settings, such as the arrows on the
  start-at slider, give the page user activation, so Triage then shows the cued video as
  "paused" rather than "waiting for Space" (SET-07 resumes it with Space). "Read my lists" is
  enabled by the username typed in the form, but `GET /api/discogs/lists` reads the saved one: with
  `dj` typed and not saved, a probe got `400` "Set your Discogs username in Settings first".
- **Downloads work through the base route.** The export links are same-origin, so the base route
  fetches them with `route.fetch()` and fulfills them; Chromium still treats the
  `Content-Disposition: attachment` answer as a download, and `saveAs()` wrote all three files in
  every run.
- **Durations.** On five workers (`vp run e2e`) the 65 tests take 30.4 s and `vp run e2e` 32.0 s
  with the client build, against 25.4 s and 26.9 s for the 50 before. The new tests take 0.7 to
  5.7 s each: SET-03 0.7 s, SET-20 0.9 s, SET-07 0.9 s, SET-04 0.9 s, SET-01 1.0 s, SET-02
  1.3 s, SET-08 1.4 s, SET-17 2.1 s, SET-16 2.2 s, SET-10 3.0 s, SET-09 3.1 s, SET-11 4.8 s,
  SET-14 5.1 s, SET-13 5.2 s and SET-17's gap 5.7 s, 5 s of it its failing expectation. SET-09
  and SET-10 wait for the Discogs client's 1.1 s gap after the saved token's identity check;
  SET-11, SET-13 and SET-14 wait for it two or three times.
- **Stable.** The first group passed 70 of 70 runs at `--repeat-each=10` on 16 workers, and both
  Settings specs 150 of 150 after the fixes above. The whole suite passed 1,300 of 1,300 runs at
  `--repeat-each=20` on 16 workers on the 10-core machine, in 7.4 minutes; SETUP-01's, TRI-21's and
  SET-17's `test.fail` failed as expected in every run. The medians of the new tests in that
  burn-in were 3.7 to 8.0 s (SET-13 the slowest), against 2.9 s for TRI-02 and 8.0 s for TRI-07.
- **`verify` has not grown.** The smoke set is still the P0 set. Timed alternately against a
  worktree of the previous commit, `vp run verify` took 20.8 to 21.0 s against 20.8 to 21.2 s,
  and its smoke set 10.5 to 10.6 s against 10.4 to 10.8 s, in three runs each.

### The Twelves P1 slice (web)

Built on 2026-10-01 on the same machine and versions: TWL-01, TWL-02 (with a gap), TWL-04,
TWL-05, TWL-06, TWL-12, TWL-13 and TWL-14 in the new `specs/twelves.e2e.ts`, which also holds
TWL-03, and TWL-07, TWL-09, TWL-10 and TWL-11 in the new `specs/twelves-discogs.e2e.ts`: seventeen
tests, since TWL-07 has one per given state, TWL-10 runs without and with a Maybe list, and TWL-02
has a gap test. With them came the Twelves page object's actions (`pages/twelves.ts`), the `bulk`
template, `app.cli()` in the web host, `diggaOptions.decisionsBackup` with `fixtures/decisions.ts`,
`given.verdicts()`, the fake's `GET /lists/{id}` with the Maybe list's items, four named records in
the catalogue and a video to paste for the release without videos, and the markup (see [Markup audit](AUTHORING.md#markup-audit)). The work showed:

- **No product bug fixed; one gap.** With every small record snoozed, `J` to the last row scrolls
  it to the window's bottom edge, where the shelf's sticky footer covers all of it but its top
  pixels (`scrollIntoView({ block: "nearest" })` in `Twelves.svelte` and `TrackTable.svelte`
  does not allow for the footer). A trial `scroll-margin-bottom: 64px` on the rows made the gap
  test pass, so that is the cause; the fix is CSS, which no vitest test can cover, so TWL-02
  records it as a gap, as TRI-21 did. The normal test checks that the row is in the window; its
  `test.fail` checks with `document.elementFromPoint()` that the row's middle is the row and not
  the footer, and failed as expected in every run. Moving back up is not affected: the first row
  is uncovered after `K`. Closed on 2026-10-02 by decision 114 (see
  [Closing the gaps](#closing-the-gaps-web)).
- **The restore runs before the server starts.** See [Libraries](FIXTURES.md#libraries) for why. The bulk template builds
  in 0.42 s (413 to 421 ms over 5 builds: a CLI start and a load of the 81 KB dump, into a
  1.46 MB database); writing the 1,200-verdict backup takes about 3 ms, and `digga restore` 0.24 s
  (240 to 246 ms over 5 runs), most of it the CLI's start, the rest the database copy it takes
  first and one transaction of 1,200 upserts. Copying the template takes about 1 ms. TWL-03 takes
  3.5 s on five workers, the template build included on the worker that builds it.
- **Rows corrected.** The section's heading put every scenario on `small-account`; the scenarios
  that need no account run on `small`, and those that push need a saved token as well (TWL-07, TWL-09, TWL-10
  with a list, TWL-11), which the rows now say. TWL-07's want "on the wantlist" is a want given in
  Digga for the release on `dj`'s wantlist (`ON_WANTLIST`): `onWantlist` comes from the wantlist
  seeds, so a want given only through `POST /api/verdicts` is never on it. TWL-02's row says what
  "in view" means and records the gap, and TWL-03's how the verdicts arrive and how `J` crosses a
  page.
- **Observations, left for the owner.** Triage's session starts when the app opens, also on
  Twelves, and reads its queue then. A record a pasted link sends back to the queue in Twelves is
  in `/api/queue` at once, but Triage, opened with `T` afterwards, shows the record after it and
  offers the requeued one only after a reload or at the end of the queue (a probe with Echo
  Chamber, the record before it judged). TWL-14 reads the queue through the API. The owner
  decided to fix this: Triage now reads its queue again when it is shown
  (`TriageSession.readAgain()` in `src/client/triage/session.svelte.ts`, decision 112), which
  TRI-44 covers and which also closed SETUP-01's gap. The re-judging copy reads "grail" and
  "skip" as the stamps do, so "Kestrel – Day Break: skip. Taken off your Discogs wantlist. Z
  undoes it." is the whole sentence. The owner changed it: the flash now says where the
  record went, by the shelf's name from `SHELVES`, as in "Kestrel – Day Break skipped, off the
  shelves. Taken off your Discogs wantlist. Z undoes it." or "… moved to Grail."
  (`rejudgedSentence()` in `src/client/twelves/model.ts`), and TWL-07 and TWL-11 read it.
- **Synchronisation follows the flash.** Twelves shows a re-judgement's, a retry's, `I`'s and `Z`'s
  flash only after the work it reports, so the page object waits for the request, the shelf's
  reload after it (matched in order with `waitForResponses()`), and the flash; the fake's log is
  complete by then (see [Synchronisation](AUTHORING.md#synchronisation)). "Add all" pushes one release at a time, each after the
  server's 1.1 s gap.
- **Negative checks were tried against broken builds**, restored afterwards: with the undo's
  wantlist request left out, TWL-11 failed on the missing `DELETE`; with a grail re-judgement that
  pushed although the want was on the wantlist, TWL-07's grail test failed on the flash, which
  said it was added again.
- **Waiting after every key press costs time under load.** The first whole-suite burn-in, at load
  averages of 170 to 240 from another project's test suite on the same machine, timed out TWL-02
  twice and TWL-03 twice at 30 s, and failed SET-10 once (its lists read, which waits for the
  Discogs client's 1.1 s gap, still read "Reading lists…" after 5 s). `move()` waited for each
  step with `expect.poll()`, which checks at most every 100 ms, and read the selected key twice,
  so TWL-02's two walks over 19 rows took 8.3 s at the median. Each key press moves the selection
  in its own handler, so `select()` now presses `J` or `K` as often as needed and waits once, and
  `move()` waits with a web-first assertion on the selected row's key; TWL-03 re-renders five
  500-row pages instead of six. TWL-02's median fell to 4.4 s under the same load, and SET-10 did
  not fail again in 20 more runs.
- **Durations.** On five workers (`vp run e2e`) the 82 tests take 39.4 s and `vp run e2e` 41.2 s
  with the client build, against 30.4 s and 32.0 s for the 65 before. The new tests take 0.6 to
  5.1 s each: TWL-04 0.6 s, TWL-10 without a list 0.8 s, TWL-13 0.8 s, TWL-05 0.8 s, TWL-14 0.8 s,
  TWL-12 0.9 s, TWL-01 0.9 s, TWL-06 1.0 s, TWL-02 1.1 s, TWL-07's grail 1.3 s, its snooze 1.7 s
  and its skip 2.0 s, TWL-10 with a list 2.0 s, TWL-11 2.6 s, TWL-03 3.5 s, TWL-02's gap 3.7 s
  (3 s of it its failing expectation) and TWL-09 5.1 s. TWL-09 pushes four releases, each after
  the Discogs client's 1.1 s gap; TWL-07, TWL-10 and TWL-11 wait for it once or twice after the
  saved token's identity check.
- **Stable.** Each group passed `--repeat-each=10` on 16 workers before the next was written (90
  of 90 runs, the gap test failing as expected, then 80 of 80), and both Twelves specs 340 of 340
  at `--repeat-each=20` after the change above. The whole suite then passed 1,640 of 1,640 runs at
  `--repeat-each=20` on 16 workers on the 10-core machine, in 9.5 minutes, at load averages of 217
  to 268; SETUP-01's, TRI-21's, SET-17's and TWL-02's `test.fail` failed as expected in every run.
  The medians of the new tests in that burn-in were 2.8 to 7.9 s (TWL-03 the slowest, then
  TWL-09 at 7.0 s), against 3.1 s for TRI-02 and 8.4 s for TRI-07.
- **`verify` has not grown.** The smoke set is still the P0 set; `e2e:smoke` never builds `bulk`.
  Timed alternately against a worktree of the previous commit, `vp run verify` took 21.2 to
  21.9 s against 21.3 to 21.9 s, and its smoke set 10.6 to 10.8 s against 10.7 to 10.9 s, in three
  runs each.

### The Shell, Sandbox and Persistence P1 slice (web)

Built on 2026-10-01 on the same machine and versions: SHELL-03, SHELL-04, SHELL-05, SHELL-07 and
SHELL-09 in `specs/shell.e2e.ts`, SBX-02, SBX-03, SBX-04, SBX-05 and SBX-07 in
`specs/sandbox.e2e.ts`, and PER-05 in `specs/persistence.e2e.ts`: eleven tests, tagged P1. With
them came `restartServer()` in the web host, the Keys dialog's page object (`pages/dialogs.ts`),
Settings' `switchSandbox()` and `chooseColorScheme()`, Triage's `retryQueue()`, aborts that last
until lifted, and the move of the fake services to `tools/dev/fake-services.ts`. The work showed:

- **No product bug, and no markup needed.** Each scenario passed against the code as it is. Rows
  corrected: SBX-04 names its template, `small-account` with a saved token, without which no
  push could happen at all, and SBX-05 its given state; SHELL-04 adds `?` as a fourth way to
  close the dialog and says where focus goes; SHELL-05 says how the highlight is read; SHELL-07
  and PER-05 say how they synchronise.
- **Observation, left for the owner: the Sandbox section's highlight is drawn only.**
  `#/settings/sandbox` adds a class that draws a background and an inset bar, with no attribute
  that assistive technology reads; focus moving to the switch is what a screen-reader user gets.
  SHELL-05 reads the computed `box-shadow`, which is `none` without the anchor.
- **Negative checks were tried against broken builds**, restored afterwards: without
  `isTyping()` and `hasCommandModifier()` in `App.svelte`, SHELL-03 failed on the text field's
  value; without the `ui.helpOpen` guard, SHELL-04 failed on the hash, which read `#/twelves`;
  with a colour scheme save that bumps `settings.version`, SHELL-09 counted 3 queue reads instead
  of 1; without the session's mode checks (`#apiGeneration` in `#pushAfterGrace()` and
  `#syncWantlist()`), SBX-07 failed on `POST /api/discogs/wantlist/1101`, which the server refused
  with `409`. SBX-04 still passed against that build, since the want's push goes through the
  sandbox client it was pinned to (decision 55), and a live client would have found no saved
  want; it failed on the page's `POST` only once the mode checks, the pinned client and the
  saved-verdict check were all removed.
- **Lasting aborts.** SHELL-07 aborts `GET /api/queue` and `GET /api/stats` with
  `times: Infinity`: the app reads the stats at start, on every page change and after verdicts,
  so a count would be a guess. `lift()` unroutes the handler; the aborts so far stay recorded and
  declared.
- **`restartServer()`.** Over 20 restarts in a row on one worker each took 205 to 209 ms (median
  207 ms): the stop over IPC, a new `digga serve --port <the same port>`, and its first answer to
  `/api/health`. Binding the same port again never failed in the restarts or the burn-ins. A probe
  that stopped the server and listened on its port itself made the restart fail with "another
  process took port … while the server restarted", and the page's next requests then failed with
  `net::ERR_FAILED` and failed the probe at teardown, as undeclared problems should.
- **Requests while the server is down: a quiet moment, not declarations.** `restartServer()`
  waits until none of the page's `/api` requests is in flight, and PER-05 first waits for the
  stats refresh its verdict schedules 0.5 s later, the only timer behind a request on an idle
  Triage page: the player waits for Space, and the header polls the jobs only while a dump job
  runs. A request that still met the stopped server would fail the test as an undeclared
  `net::ERR_FAILED`, so the choice is checked on every run; declaring those errors would also
  have hidden a page that kept polling a stopped server.
- **The Keys dialog closes in two steps.** The browser hides it, then fires `close`, which is
  when the app learns of it. The page object's first version armed its wait with an unawaited
  `locator.evaluate()`; the key press won the race, the hidden dialog no longer matched the
  locator, and SHELL-04 hung until its timeout. The wait is now installed with
  `evaluateHandle()` before the press (see [Synchronisation](AUTHORING.md#synchronisation)).
- **The move.** The harness imports `FakeServices`, `memoryDump()` and `ServiceUrls` from
  `tools/dev/fake-services.ts`; the harness's own copy and the earlier dump-only tool are gone.
  The transfer writes at most 1 MiB at a time, more than any test dump (the bulk dump is 81,262
  bytes today), so a held or failing transfer still sends everything up to its next stop in one
  write, as before; the whole suite passed on the moved module, 95 of 95, before the burn-in.
  The standalone mode serves the old tool's URL under `/dumps/` (`DIGGA_DUMPS_URL` was the root
  before), beside `/discogs` and `/youtube/oembed`.
- **The rehearsal, with the CLI and no browser.** In a temp folder: a working directory without
  a `.env`, an environment built from `PATH`, `HOME`, `TZ` and `LANG`, throwaway
  `DIGGA_DATA_DIR`, `DIGGA_DUMPS_DIR` and `DIGGA_CONFIG_FILE`, and the three service URLs, checked
  to point at the fake before the start. The harness's builder wrote the bulk dump,
  `discogs_20260901_releases.xml.gz`, 81,262 bytes, to a file; `node tools/dev/fake-services.ts
<file> --port 45678 --mbps 0.02` hashed it and listed it as 79.4 KB. `digga dump update`
  downloaded it in 3.78 s, 0.0205 MiB/s for the 0.02 asked (the fake's transfer took 3,879 ms),
  with "checksum verified" (`d976249f…7319`, the file's own SHA-256), and loaded it: 1,500
  releases scanned, 1,500 matched and 1,500 upserted, 0 by coverage, 0 not found; the whole
  command took 4.37 s. With `discogs.username` set to `dj` in the throwaway config and
  `DISCOGS_TOKEN=e2e-token-dj`, `digga import collection` read 1 item and `digga import wantlist`
  2 from the fake Discogs API. The first try found a bug in the new pacing: the fake waited after
  writing each chunk, and a chunk was 1 MiB, so the whole dump left at once and the download
  ended in 1 ms. The fake now waits before each write and writes about a tenth of a second's
  bytes at a time.
- **Durations.** On five workers (`vp run e2e`) the 95 tests take 38.6 s, and `vp run e2e` 40.3 s
  with the client build. The new tests take 0.6 to 5.0 s each: SHELL-07 0.6 s, SHELL-03 0.8 s,
  SHELL-05 0.9 s, SHELL-04 1.0 s, SBX-04 1.1 s, SBX-02 1.2 s, SHELL-09 1.3 s, SBX-07 1.3 s,
  SBX-03 1.5 s, PER-05 2.3 s and SBX-05 5.0 s. SBX-05 runs an import and `P` against the fake
  Discogs, each after the Discogs client's 1.1 s gap; PER-05 waits 0.5 s for the stats refresh
  before it restarts the server.
- **Stable.** Each group passed `--repeat-each=10` on 16 workers before the next was written
  (the five Shell scenarios 50 of 50, SBX-02 and SBX-03 20 of 20, PER-05 10 of 10, SBX-04,
  SBX-05 and SBX-07 30 of 30). After the move the whole suite ran at `--repeat-each=20` on 16
  workers on the 10-core machine, at load averages of about 90 from the run itself. The first
  run passed 1,899 of 1,900 in 10.4 minutes: SET-08, an earlier scenario, timed out once. Its
  trace shows the page stalled: the filter preview's 300 ms timer, set when the first token save
  changed the form, fired about 9 s late, and the refused token's `PUT` left the page 30.5 s after
  the click, when the test had already timed out; the base route, the server and the fake each
  answered within milliseconds once asked. That is CPU starvation of the page, of the kind the
  Twelves slice saw at higher load, not a wait the test lacks. The second run passed 1,900 of
  1,900 in 10.1 minutes. SETUP-01's, TRI-21's, SET-17's and TWL-02's `test.fail` failed as
  expected in every run. The medians of the new tests in the second run were 3.0 to 7.5 s (SBX-05
  the slowest), against 3.0 s for TRI-02 and 8.1 s for TRI-07.
- **`verify` has not grown.** The smoke set is still the P0 set. Timed alternately against a
  worktree of the previous commit, `vp run verify` took 20.5 to 21.9 s against 20.4 to 21.5 s,
  and its smoke set 10.2 to 11.1 s against 10.2 to 10.9 s, in six runs each. In the first three
  pairs the working tree ran second and was 0.4 to 0.6 s slower; in the three with the order
  reversed it took 20.5 to 20.8 s against 20.5 to 20.9 s.

### The setup's steps 1 to 3 P1 slice (web)

Built on 2026-10-01 on the same machine and versions: SETUP-02, SETUP-03, SETUP-04, SETUP-05,
SETUP-06, SETUP-07, SETUP-11, SETUP-15, SETUP-16, SETUP-17 and SETUP-30 in the new
`specs/setup-steps.e2e.ts`, and SETUP-08, SETUP-09, SETUP-13 and SETUP-14 in the new
`specs/setup-discogs.e2e.ts`: fifteen tests, tagged P1. With them came the setup page object's
actions for steps 1 to 3 (Try again and Check again, Continue on step 1, a refused token, Skip,
Continue with its imports, the style search, "Often tagged with", removing a style, a genre, the
years, the load-years disclosure, Vinyl only, Back and a reload on a step), `LiveRegionWatch`, the
fake's `503` for every request, `dj`'s currency, the markup of accessibility bugs 3 and 4 for
steps 1 to 3 (see [Markup audit](AUTHORING.md#markup-audit)), and the step titles in `src/client/setup/steps.ts`. SETUP-01
now waits for its two import jobs to start. The work showed:

- **One product bug, fixed: a catalogue already in the dumps folder skipped step 1.** The setup
  resumed at step 2 whenever the newest dump was in the dumps folder, also on a first visit, so
  "Digga has the 1 September 2026 catalogue already" and its Continue (docs/FIRST_RUN.md, step 1)
  showed only after Back. SETUP-06 failed on it. `#resumeStep()` in
  `src/client/setup/flow.svelte.ts` now opens step 1 for a catalogue that was in the folder before
  any download, unless the address asks for step 2 or 3, so a reload on a later step stays there;
  a download that runs or has finished still resumes at step 2. Three vitest cases in
  `tests/setup-flow.test.ts` cover where the setup resumes; the first fails without the fix.
  Decision 109 and SETUP-28's row say so.
- **Rows corrected.** SETUP-08's counts follow the account, 1 and 2 (see [The fake services](FIXTURES.md#the-fake-services) for
  the decision; no earlier scenario relied on 5 and 6, which no fixture ever had), and its
  currency is GBP so that it visibly comes from the profile. SETUP-14: the shipped census has no
  Techstep, the fixture's second style, so only Drum n Bass is suggested ("mostly Drum n Bass, so
  it is picked"), and with 3 imported releases, fewer than the 10 per-style counts
  `defaultYearSpan()` needs, the years come from the census. SETUP-15 checks Breakbeat, not
  Techstep, in the Electronic genre for the same reason. SETUP-07's Back is the step's button;
  the browser's Back stays SHELL-10. SETUP-04, SETUP-05, SETUP-09, SETUP-11, SETUP-13, SETUP-16
  and SETUP-17 now say how they are reached and what they read back.
- **The markup checks catch the old markup.** Against the components as they were, restored
  afterwards: SETUP-05, SETUP-08 and SETUP-09 failed on `LiveRegionWatch`, which recorded the space
  alert, "Connected as dj." and the refusal as regions inserted with their text; SETUP-16 failed
  on the missing `aria-invalid`, and SETUP-15 on the second "to" field, which had no name of its
  own. The watch also records the regions a page inserts with text when it first renders, such
  as Triage's hidden slip and step 1's "Asking data.discogs.com…", so the scenarios check only
  their own message.
- **Free space and the listing.** SETUP-03 reads the real free space only by its shape; SETUP-05
  lists 900 TB (`listedBytes`), and the alert asks for "921601 GB", the size and 1 GiB. The
  listing is read on the first `GET /api/setup` and kept for an hour, so Check again reads the
  free space again and the cached size; a failed read is not kept, so SETUP-04's Try again reads
  the recovered listing. The `503` reaches the page as "Digga can't reach data.discogs.com:
  127.0.0.1:<port> answered 503." in step 1's `aria-live` line, which is in the page from the start.
- **Holds keep in-flight states exact.** SETUP-13 holds the wantlist page at the fake: step 3
  showed while that import was running in every run, and both imports ended `done` once
  released, with one page each for `dj`. SETUP-07 and SETUP-17 hold the transfer at `100-to-dig`,
  so the strip has a running download over two reloads and the load is `running` when its row is
  read; the fake sent one transfer in every run of SETUP-07.
- **The rehearsal, and a mistake in its first try.** The change to the fake's data.discogs.com
  part was rehearsed with the CLI as in the previous slice, now with the harness's guard loaded
  through `NODE_OPTIONS` and the process's environment printed first: `digga dump update`
  downloaded the bulk dump (81,198 bytes) from `node tools/dev/fake-services.ts <file> --port
45678 --mbps 0.02` in 3.87 s with "checksum verified" and loaded 1,500 releases, 4.5 s in all;
  `import collection` read 1 item and `import wantlist` 2. The first try built its environment in
  a shell variable that zsh did not split, so `env -i` passed one malformed variable, and the CLI
  ran with the default library and the real data.discogs.com: it recorded a `dump_update` job in
  the owner's library and downloaded 3.78 GB of the October dump into a `.part` file in
  `~/Library/Caches/Digga/dumps` before it was stopped. The guard would have refused the
  connection; [The fake services](FIXTURES.md#the-fake-services) now asks rehearsals to load it.
- **Durations.** On five workers the 110 tests take 45.3 s, and `vp run e2e` 46.9 s with the
  client build, against 38.6 s and 40.3 s for the 95 before. The new tests take 0.6 to 5.5 s each:
  SETUP-02 0.6 s, SETUP-06 0.6 s, SETUP-03 0.7 s, SETUP-04 0.7 s, SETUP-05 0.7 s, SETUP-09 0.8 s,
  SETUP-11 0.8 s, SETUP-30 0.8 s, SETUP-16 1.6 s, SETUP-15 1.7 s, SETUP-17 1.7 s, SETUP-08 2.0 s,
  SETUP-07 2.9 s, SETUP-13 4.0 s and SETUP-14 5.5 s. SETUP-08, SETUP-13 and SETUP-14 wait for the
  Discogs client's 1.1 s gaps after the token's identity check; SETUP-14 also waits for the setup's
  next read of the jobs after the imports end, and for its read of the setup.
- **Stable; the failures were starvation.** Each new spec passed `--repeat-each=10` on 16
  workers before the next was written (110 of 110, then 90 of 90 with the changed
  `setup.e2e.ts`). The whole suite then ran five times at `--repeat-each=20`, 2,200 tests a run.
  The fifth run, on 11 workers, passed 2,200 of 2,200 in 12.3 minutes. The first four each failed
  one to three earlier scenarios, never a new one: on 16 workers 2,197 (SBX-05, SET-11, SET-13)
  and 2,199 (SET-01), on 12 workers 2,199 (SET-16) and 2,198 (SET-11, SET-13). The third run
  overlapped another project's Rails test suite on 10 workers, which alone held the load average
  at about 187; the others ran at load averages of up to 220 from the run itself, more than the
  previous slice measured, with Spotlight busy beside it. Every failure's trace shows a starved
  page rather than a missing wait: a click that took 48.5 s, a `selectOption()` 24.8 s, a
  `page.reload()` 30.2 s, a `getAttribute()` on a record that was on screen 30 s, and screencast
  gaps of 25 to 33 s. In SET-13 and SET-16 the page had read the job's `done` and acted on it (the
  stats refresh that follows a job's end, and in the trace's last DOM the row reads `done`),
  while the assertion's call log has no completed query of the page in its 15 s. SET-17's,
  TRI-21's and TWL-02's `test.fail` failed as expected in every run. The medians of the new tests
  in the clean run were 1.4 to 6.7 s (SETUP-14 the slowest), against 2.0 s for TRI-02 and 6.8 s
  for TRI-07.
- **`verify` grew by about 0.9 s, all of it SETUP-01's poll phase.** The smoke set is still the
  P0 set. Timed alternately against a worktree of the previous commit, `vp run verify` took 21.7
  to 22.2 s against 20.8 to 22.7 s, and its smoke set 11.3 to 11.4 s against 10.3 to 11.2 s, in
  three runs each; the smoke set alone, six runs each, 11.2 to 11.4 s against 10.3 to 10.5 s.
  SETUP-01's first test went from 9.3 to 9.5 s to 10.2 to 10.3 s; nothing else changed. Its
  traces show why. `connect()` now returns once the profile has answered, where it used to
  return at the "Connected as" status and leave the wait to an assertion's retries, so Enter on
  step 2 comes about 0.3 s earlier. The setup reads the jobs every second from that Enter, while
  the imports end on the Discogs client's 1.1 s gaps from the token's identity check, so the read
  that used to see the wantlist import end now comes just before it ends, and the suggestions wait
  one more read. A trial delay of 300 ms before Enter, removed again, brought the test back to 9.3
  to 9.4 s. A fixed delay is not allowed, and nothing in the product is wrong, so the second stays.

### Closing the gaps (web)

Done on 2026-10-02 on the same machine and versions, in eight commits, one per gap and one each
for the SETUP-24 and SETUP-28 pair and the SETUP-25 and SETUP-32 pair. TRI-21, TWL-02 and SET-17
lost their `test.fail` and became normal tests; SHELL-12, SETUP-24, SETUP-25, SETUP-26, SETUP-28,
SETUP-29 and SETUP-32 were built with their fixes, tagged with their rows' priorities. Each new or
changed test failed against the code before its fix, which was put back afterwards, and each
fix with logic has a vitest case that fails without it. Decisions 113 to 120 record the choices.
The work showed:

- **TRI-21: Esc belongs to the picker.** The dialog's keydown handler now cancels Esc's default
  action and closes the dialog itself, so the search field's own Esc, which Chromium uses to
  clear it, never runs; the field stays `type="search"`. Both TRI-21 tests failed on the old
  component, the closing one in its first Esc.
- **TWL-02: the footer's height, measured.** `bind:offsetHeight` on the footer sets
  `--foot-height`, which the rows of both tables take as `scroll-margin-bottom`. A second test
  reaches the Tracks shelf's last row in a 480 px window, since the small catalogue's tracks do
  not fill 1,000 px; both tests failed on the old CSS, the first one on the last row's middle.
- **SET-17: Settings follows the jobs it starts.** `loadStatus.follow(job)` checks again for a
  dump job. Writing its test showed a second gap in the same store: a check overtaken by a later
  one wrote its older answer last, which could hide a job started meanwhile; a check now drops
  such an answer (`tests/load-status.test.ts`).
- **SHELL-12: a retry for the settings.** Triage says "The settings did not load." with the
  reason and `Enter`, and Settings has "Try again"; `settings.retry()` shares a read already
  out. Both tests take 0.6 to 0.7 s.
- **SETUP-24 and SETUP-28: confirmed picks.** `setup.picksConfirmed` in the config marks the
  picks step 3 wrote. Building SETUP-28 showed that with a saved token, a setup page opened while
  an import's page is held waits for that page before it shows any step: the server sends Discogs
  one request at a time, and the setup's account check (`/oauth/identity`) queues behind the
  import. With a real wantlist of 13 pages, that is up to about 15 s of step 1's "Asking
  data.discogs.com…". Left for the owner; SETUP-28 connects by username, which asks Discogs
  nothing for the account, and checks the account's resume before the imports start.
- **SETUP-25 and SETUP-32: where a download stopped.** Three findings. The figure in "stopped at
  … of …" is what the downloader took from the transfer: when the fake closes the connection
  right after a write, undici drops the bytes still queued in the body stream, so a first test
  read "6 KB" where the fake had sent 32 KB, and once "The download stopped: fetch failed." with
  nothing at all. The job now reports its exact count when the transfer fails, and the tests
  close the transfer at a hold once the `.part` file shows every byte sent; Node then names the
  reason "terminated". Second, the app sent every page back to the setup until a load finished,
  so the releases a stopped load kept could not be dug as the design says; the pages now open
  once there are records to dig and the setup has shown (decision 118). Third, the new alert was
  in the page before its text but had no box of its own, since its only child was
  `position: fixed`, and Playwright read it as hidden; the region is positioned instead. The
  strip's locator also had to become exact, since `{ name: "Download" }` matched the notice's
  first label, "Download stopped". `set({ contentLength })` came to the fake for SETUP-32.
- **SETUP-26: the download job retries.** The second download runs in the server, so it happens
  while the user digs in Triage, where the setup page is unmounted (decision 119). The load's
  follower checks the job's `checksumMismatches` before "done": in the first version the check
  came after it, and a load could take a second download that had already finished for the file
  it had read. The fake gained `set({ wrongChecksums })`, holds for one transfer
  (`holdAt(name, { transfer: 2 })`), which keep the second download at a checkpoint while the
  first runs to its end, and `transfers`; the standalone mode gained `--wrong-checksums`.
- **SETUP-29: nothing kept.** The crate decides from the finished load's count of releases kept,
  not from the stats, which can lag the load's end; "Change your picks" then skips
  `DELETE /api/setup/load`, which the server refuses after a finished load.
- **Rehearsals.** After each change to the fake's data.discogs.com part, as [The fake services](FIXTURES.md#the-fake-services)
  says: a throwaway folder with an empty working directory, an environment built from nothing
  with `env -i` and one argument per variable, printed with the same command line first, the
  harness's guard in `NODE_OPTIONS` and `DIGGA_E2E_ALLOWED_PORT=45678`. With `--mbps 0.02`,
  `digga dump update` downloaded the bulk dump (81,198 bytes) in 3.78 s with "checksum verified"
  and loaded 1,500 releases, 4.60 s in all; `import collection` read 1 item and `import wantlist` 2. With `--mbps 0.05 --wrong-checksums 1`, the fake's log showed two reads of `CHECKSUM.txt`
  and two transfers of 1,549 and 1,550 ms, and the update ended "checksum verified" with 1,500
  releases loaded, 3.67 s in all. The owner's library and dumps folder kept their modification
  times.
- **Durations.** On five workers the 119 tests take 54.8 s, and `vp run e2e` 55.4 s with the
  client build, against 45.3 s and 46.9 s for the 110 before. The new and changed tests take 0.6
  to 11.5 s each: SHELL-12 0.6 s and 0.7 s, TWL-02's Tracks test 0.6 s and its first 1.3 s,
  TRI-21's Esc test 1.2 s, SETUP-32 1.9 s, SET-17 2.1 s, SETUP-29 3.9 s, TRI-21's search test 4.3
  s, SETUP-24 6.3 s, SETUP-26 7.4 s and 8.9 s, SETUP-25 7.6 s and 8.8 s, and SETUP-28 11.5 s.
  SETUP-28 opens seven new pages and waits for the Discogs client's gaps; SET-17, TRI-21 and
  TWL-02 no longer spend 3 to 5 s on a failing expectation.
- **Stable.** Every new or changed spec passed `--repeat-each=10` on 11 workers before its commit
  (TRI-21 20 of 20, TWL-02 20 of 20, SET-17 10 of 10, SHELL-12 20 of 20, SETUP-24 and SETUP-28
  20 of 20, SETUP-25 and SETUP-32 30 of 30, then 50 of 50 with SETUP-26, and SETUP-29 10 of 10).
  The whole suite then passed 1,190 of 1,190 runs at `--repeat-each=10` on 11 workers on the
  10-core machine, in 7.0 minutes, at one-minute load averages of 8 to 49 from the run itself;
  nothing else ran.
- **`verify` has not grown.** The smoke set is still the P0 set. `vp run verify` took 21.6 to
  22.2 s in three runs, and its smoke set 11.2 to 11.3 s, as in the previous slice.

### The setup's remaining scenarios and the Accessibility family (web)

Built on 2026-10-02 from `d20a189`, measured at `2a567c9` with SETUP-10 and SETUP-20 in the
working tree, on the same 10-core Mac (macOS 27.0.1), Node 24.18.0, Playwright 1.63.0 with its
Chromium, and `@axe-core/playwright` 4.13.0 (axe-core 4.13.0), new as a devDependency. Ten commits:
SETUP-22, SETUP-23, SETUP-27, SETUP-31 and SETUP-33 (P1) in `specs/setup.e2e.ts`; A11Y-01, A11Y-02
and A11Y-04 (P1), A11Y-03 (P2) and the new A11Y-05 and A11Y-06 (P2) in the new
`specs/accessibility.e2e.ts`; SETUP-10, SETUP-12 and SETUP-20 (P2) in `specs/setup-discogs.e2e.ts`.
With them came the practice card's page object (`PracticeCard` in `pages/dialogs.ts`), the setup
page object's practice, Pick up, Start without it and finished-crate actions, the axe helper
(`support/axe.ts`), and the browser history fixtures (`fixtures/history.ts`,
`diggaOptions.browserHistory` and `unreadableBrowsers`). The work showed:

- **One product bug, fixed: a crash read "interrupted".** After Digga closed during the load, the
  crate said "The catalogue stopped loading: interrupted.", the job's raw error, where
  docs/FIRST_RUN.md says "The catalogue stopped loading when Digga closed". SETUP-27 failed on it.
  `stoppedLoadMessage()` in `src/client/setup/model.ts` now says that; its vitest cases in
  `tests/setup-model.test.ts` are new with the function.
- **Markup, each check failing on the old markup.** The finished crate's headline became
  `h1#crate-title`, so the region is named "The catalogue is in: …"; SETUP-23 failed on the
  missing heading. The crate's error paragraph is an empty `role="alert"` until it has text;
  SETUP-23 aborts the first "Delete it" and `LiveRegionWatch` recorded "alert: Failed to fetch" as
  inserted with its text against the old `{#if flow.error}`. The header hides the sandbox's
  explanation and the ETA as `.visually-hidden` does instead of `display: none`, the scope
  picker's dig button declares `Enter` and "Start digging" `T Enter` (A11Y-05, A11Y-06). Settings'
  Sandbox region has `aria-current="location"` when opened from the stamp, which also draws the
  highlight; SHELL-05 reads it instead of the computed `box-shadow`, and the observation is closed.
  All four tests failed against the components as they were.
- **What axe found.** In the dark scheme, with every rule, over 21 states: one violation,
  `page-has-heading-one` on Triage's end of the queue, whose headline was a paragraph; A11Y-01
  failed on it. The fix makes every state headline of Triage (end of the queue, the end of what has
  loaded, no releases, filters that match nothing, the end of a scope, and the settings and queue
  errors) an `h1`, as a record's artist already is. axe also left `aria-prohibited-attr` incomplete
  on the crate's "Keys while you dig" `div`, whose `aria-label` assistive technology ignores; the
  label is gone, and the visible "Keys while you dig:" leads the list. Its incomplete
  `color-contrast` checks are key caps (no text to measure) and text whose background it could
  not determine (the photocopy grain, overlapping rows); they stay in the attached results. No
  serious or critical violation, no `landmark-unique`, and no rule excluded anywhere.
- **The light scheme, and a false finding.** The first light scans reported `color-contrast`
  failures of 1.03 to 2.09, such as #a8a294 on #eee9dc: the dark scheme's `--fg-muted` on the light
  `--bg`. Chromium applies `emulateMedia()` at the next frame, and a computed style read before then
  still resolves the custom properties of the previous scheme; a read 0 ms after the switch gave
  `rgb(168, 162, 148)`, later ones `rgb(79, 75, 66)`, and the same states then had no violation.
  `matchMedia()` already matched in between, so the helper waits for the body's background to
  change instead, both ways. Once settled, the light scheme had no violation either, so no colour
  needs the owner's decision.
- **The cost of the scans, and the light-scheme choice.** One worker, A11Y-01 alone: 15.3 s without
  scans, 23.5 s with the dark scans, 32.3 s with a light contrast scan of every state. A full dark
  scan took 280 to 680 ms per state (Settings the slowest), and a light scan of `color-contrast`
  alone 320 to 770 ms, about the same, since contrast is axe's slowest rule. Scanning every state
  in light would double the scans' cost; the seven record shelves after Everything reuse its table
  and tokens, so they are scanned in the dark scheme only, and every other state in both, which
  covers each component in both palettes for about 60% more than the dark scans alone.
- **Rows corrected or completed.** SETUP-27 now names the copy FIRST_RUN gives. SETUP-31 and SETUP-33
  pick Drum n Bass from 1998 alone: 18 records to dig at `100-to-dig`, 108 at `600-to-dig`, and 305
  in the whole bulk dump, fewer than the 500 that enable "Start digging" during a load. SETUP-22,
  SETUP-23, SETUP-10, SETUP-12 and SETUP-20 now say what they read back. The SHELL-05 row reads the
  ARIA state. FIXTURES' fault and request-log examples called `fakes.discogs.…`, which does not
  exist; they now call `fakes.fail()`, `fakes.hold()` and `fakes.requests()`.
- **SETUP-10: a refused push is not tried again.** With the clock run past the first retry delay
  (5 s), the page had sent one `POST /api/discogs/wantlist/:id`, answered `400` ("Set your Discogs
  token in Settings first"), and the fake no `PUT`. With `mayPassLater()` returning true the slip
  read "trying again in 5 s" and the test failed.
- **SETUP-12: history in the fake home.** The fixture writes the folders per platform itself;
  `chmod 000` on Chrome's folder, applied after the server started and undone before the folder is
  deleted, made the setup list Chrome as unreadable, with the Full Disk Access hint. With the
  server listing nothing for an unreadable folder, the second test failed on the browser list. The
  run's temp root was empty after every run.
- **A11Y-02 against broken builds.** Without `inert` on the player hosts, the first Tab put the
  focus in a player's frame ("IFRAME" as the active element). Without the track buttons'
  `preventDefault()` on `mousedown`, the clicked track's button kept the focus.
- **`pass()`'s wait.** `TriagePage.pass()` waited for the record to change its key, which fails at
  the last record of the queue, where the record goes; it now waits until no record carries the
  passed key. SETUP-31 passes the 18 records to the end.
- **No rehearsal.** The fake services did not change, so no manual run of the CLI was needed.
- **Durations.** On five workers (`vp run e2e --workers 5`) the 144 tests take 1.3 minutes, and the
  command 76.6 s with the client build, against 54.8 s for the 119 before. The new tests take 0.7 to
  17.1 s: SETUP-12 0.8 s twice, SETUP-22 2.6 and 2.8 s, SETUP-23 2.7 s, SETUP-33 3.0 s, SETUP-20 5.6
  s, SETUP-31 6.9 s, SETUP-27 7.9 s, SETUP-10 9.5 s; A11Y-05 0.7 and 1.2 s, A11Y-06 0.7 s, A11Y-04 1.0
  and 1.3 s, A11Y-02 1.5 s, A11Y-03 2.6 s, and A11Y-01's six tests 2.5 s (end of the queue), 2.6 s
  (no audio), 4.1 s (Settings), 5.2 s (Triage, Keys and the scope picker), 8.4 s (nine shelves) and
  17.1 s (four steps, two crates and the practice card, through a whole setup).
- **Stable.** Each new or changed spec passed `--repeat-each=10` on 11 workers before its commit
  (the setup scenarios 60 of 60, then `setup.e2e.ts` 170 of 170; `accessibility.e2e.ts` 60, 100
  and, with `shell.e2e.ts`, 220 of 220; `setup-discogs.e2e.ts` 70 and 90 of 90). The whole suite
  then passed 1,440 of 1,440 at `--repeat-each=10` on 11 workers in 9.7 minutes, at one-minute
  load averages of 11 to 96 from the run itself; nothing else ran.
- **`verify` has not grown.** The smoke set is still the P0 set. Timed alternately against a
  worktree of the previous commit, `vp run verify` took 22.1 to 22.8 s against 22.6 to 23.0 s, and
  its smoke set 11.4 to 11.5 s against 11.4 to 11.9 s, in three runs each.

### CI on GitHub Actions

Added on 2026-10-02 on the branch `ci`, from `65680cc`, as the
[CI workflow](../../.github/workflows/ci.yml); the owner decided the same day on no scheduled or
nightly runs. Every run used GitHub's `ubuntu-24.04` image, version 20260927.320 (Ubuntu 24.04.5
LTS, 4 vCPUs), Node 24.18.0 with npm 11.16.0, and Playwright 1.63.0 with Chrome for Testing
153.0.8010.12 (Playwright's chromium v1243). The runs are on
`https://github.com/razorjack/digga/actions/runs/<id>`; the revisions they tested were rewritten
when the branch's workflow fixups were folded in before the merge. The work showed:

- **npm refused the runner's Node.** In the first run (37065981631) every job stopped in
  setup-node, before any test: setup-node's Node 24 was 24.21.0 with npm 11.19.0, and
  `devEngines.packageManager` in package.json requires npm 11.16.0 with `onFail: "download"`. npm
  does not download that version; it stops every command in the project with `EBADDEVENGINES`,
  including setup-node's own `npm config get cache`. Node 24.18.0 and 24.18.1 are the releases
  that bundle npm 11.16.0, and 24.18.0 is the local version, so the workflow pins it. A newer Node
  in CI needs the npm pin in package.json to move with it.
- **Nothing else failed on Linux.** With two workers, all 144 tests passed in every run, P0 to P2,
  with no retry. That includes the guard (GUARD-01 and GUARD-02, and no test recorded an
  undeclared abort although the runner has internet access) and SETUP-12's Linux folders, which
  had never run: the setup found Brave's history in `.config/BraveSoftware/Brave-Browser` and
  Firefox's in `.mozilla/firefox`, and the import marked their releases as seen. The runner's user
  is not root, so the unreadable-folder test ran rather than skipped, and `chmod 000` on
  `.config/google-chrome` made Chrome unreadable as on macOS. No product or test change was
  needed.
- **Workers.** Run 37066093592 had a temporary job per worker count, each on its own runner: the
  whole suite once with the list reporter, then three times with `--repeat-each 3`. The sum is of
  the test durations the reporter printed for the single run.

  | Workers | Whole suite | Sum of test durations | A11Y-01 Twelves shelves | A11Y-01 setup | `--repeat-each 3`        |
  | ------- | ----------- | --------------------- | ----------------------- | ------------- | ------------------------ |
  | 2       | 231.6 s     | 455 s                 | 11.6 s                  | 23.4 s        | 432 of 432 in 679.8 s    |
  | 3       | 213.9 s     | 622 s                 | 19.5 s                  | 32.2 s        | 432 of 432 in 631.6 s    |
  | 4       | 205.4 s     | 788 s                 | 29.5 s                  | 41.1 s        | 431, 1 flaky, in 625.6 s |

  The runner is saturated at two workers: each further worker lengthens every test about as much
  as it adds in parallel. On four, A11Y-01's "each Twelves shelf" reached its 30 s timeout once
  and passed on retry, which `failOnFlakyTests` counts as a failure. Its trace shows no stalled
  page: 4.5 s of fixture setup, then the eleven axe scans of the shelves at a steady 0.3 to 1.3 s
  per call until the timeout, where locally the whole test takes 8.4 s. That is contention, not a
  missing wait, so the test is unchanged and the configuration sets two workers under `CI`. Three
  workers would save 18 s a run but leave that test at two thirds of its timeout.

- **Durations.** The smoke set took 26.7 s and 25.0 s inside `vp run verify`, well within its
  minute, and the whole suite about 3.8 minutes on two workers, within the six-minute budget, so
  the suite is not sharded. On two workers A11Y-01's Twelves shelves took 11.6 to 14.4 s against
  8.4 s locally, and its setup journey, the slowest test, 23.4 to 27.7 s against 17.1 s.

  | Step                                  | Browser cache miss (37066093592) | Hit (37067890732) |
  | ------------------------------------- | -------------------------------- | ----------------- |
  | setup-node, with the npm cache        | 5 s                              | 7 s               |
  | `npm ci`                              | 8 s                              | 6 s               |
  | Restore Chromium                      | 0 s                              | 4 s               |
  | Install Chromium, `--with-deps`       | 31 s                             | skipped           |
  | `playwright install-deps chromium`    | skipped                          | 15 s              |
  | `npx vp run verify`                   | 52 s                             | 48 s              |
  | The rest of the suite, `@P0` excluded | 242 s                            | 225 s             |
  | Saving the browser cache              | 3 s                              | none              |
  | Job                                   | 5 min 48 s                       | 5 min 12 s        |

- **Before the merge.** The branch's final head, `12d866e`, passed in run 37068618488 and in its
  two reruns, in 5 min 31 s, 4 min 23 s and 4 min 44 s, all with the browser cache. Master was
  fast-forwarded to it, and master's run 37070141054 passed in 5 min 32 s.
- **The burn-in passed.** `gh workflow run ci.yml --ref master -f repeat_each=5` (run
  37070714880, `12d866e`, 2026-10-02) ran verify, with the smoke set's 14 tests in 25.4 s, then
  the whole suite five times on two workers: 720 of 720 passed with no retry, in 22.1 minutes.
  The job took 23 min 38 s, within its 45-minute timeout. The slowest runs of the two long
  A11Y-01 tests were 14.1 s for the Twelves shelves and 27.1 s for the setup journey, as in the
  single runs. On 2026-10-03 the owner decided that burn-ins run locally, not on GitHub's free
  compute, and the workflow's `repeat_each` input and burn-in step were removed; this was the
  only CI burn-in.

### The remaining P2 scenarios outside Triage (web)

Built on 2026-10-03 from `50bd227` and measured at `f98c45e`, on the same 10-core Mac (macOS
27.0.1), Node 24.18.0 and Playwright 1.63.0 with its Chromium. Eight commits: the browser guard
lets the app's port through on `127.0.0.1` (`6f7e98f`); SHELL-06, SHELL-08, SHELL-10 and SHELL-11
(`02b7143`); SBX-06 and TWL-18 (`4c44f13`); a second library for a test, with PER-02 (`353c929`);
the job runner's stop log (`d3a0429`) and PER-03 (`a4701f8`); TWL-08, TWL-15, TWL-16 and TWL-17
(`82fa11b`); SET-05, SET-06, SET-12, SET-15, SET-18 and SET-19 (`f98c45e`). All are P2. That
completes every family but Triage. The work showed:

- **No product bug.** Every scenario passed against the code as it was. One product change makes a
  stop observable: `JobRunner.stop()` logs "stopping: cancelled N running job(s), waiting for
  them" after aborting the jobs, with a case in `tests/jobs.test.ts`. No gap was recorded.
- **SHELL-06 needed the guard.** The base route let only `http://localhost:<port>` through, so
  the page on `127.0.0.1` was refused. It now passes the same port on `127.0.0.1` too; Chromium's
  resolver rule already kept that address. The warning's link leads to the same hash on localhost,
  where the warning is gone.
- **SHELL-11's row was wrong about the header.** At 840 px the default header (wordmark, three
  page links, two counts) fits one row on macOS; it wrapped onto two only with the sandbox stamp
  and a session count. The test uses that state and checks what holds on one row or two: each
  item whole inside the window, no two overlapping. Against a build without the 860 px
  `flex-wrap`, "+1 this session" ended at 858 px of 840 and the test failed; at 1600 px the stacked
  check failed (the player started at 86 px, above the tracklist's end at 835 px). The rest
  compares boxes too: no horizontal scroll, the verdict bar's buttons whole, uncovered and keyed,
  and each Tab stop in the window. Fonts on CI's Linux differ, so there the header may stay on one
  row; then a missing wrap would go unnoticed unless the items overflow.
- **TWL-18 is about the first load.** The app starts in the sandbox until the settings arrive, so
  Twelves opened at `#/twelves` mounts first in the sandbox and again in live mode, as the
  header's stamp goes. Without the `{#key settings.sandbox}` block the live re-judgement sent no
  `POST /api/verdicts` and the test timed out at it. Switching the sandbox in Settings remounts
  the shelf by the route anyway; the test checks that case's empty undo history and kept-in-tab
  re-judgement as well. The row now says so.
- **PER-02 needed a second library.** `newLibrary(template)` copies a template into the test's
  folder, `app.cli(args, { library })` runs a command on it and `app.relaunch({ library })` moves
  the app to it ([HARNESS](HARNESS.md#the-app-host)). The test folder became its own fixture, so it
  is deleted after the app has stopped. The test waits for the server's start copy of the
  database before `digga backup`, which writes the day's copy to the same `.partial` path, then
  restores the file the command named into a fresh `small` library.
- **PER-03: a graceful stop waits for the page in flight.** `stopServer()` closes the listener,
  then `jobs.stop()` aborts the import and waits for it, and the Discogs request takes no signal.
  The test releases the held page once the stopping server has logged the abort, while
  `relaunch()` is still pending; a release before the abort would let the import end done. The
  job then reads cancelled after one page request. The crash variant reads failed, "interrupted".
- **TWL-16's verdict comes from a decisions backup.** The verdict for a release in no dump is a
  snooze for `NOT_IN_ANY_DUMP` (`r:9001`, dj's second want), restored with `digga restore` before
  the server starts (`diggaOptions.decisionsBackup`). The wantlist import cannot give one: it
  writes a stub release from what Discogs sends (`applySeedItem()`), so that verdict has a release. The row reads "Not in
  the loaded dump (r:9001)", has no `data-release-id`, and Enter says Triage cannot play it.
- **TWL-17.** `A` and `R` pressed without a wait ran one after the other: the page sent
  `POST /api/verdicts`, `POST /api/discogs/wantlist/1101`, `POST /api/verdicts` and
  `DELETE /api/discogs/wantlist/1101` in that order, the fake got the `DELETE` after the `PUT` had
  answered, and the export said skip.
- **Rows corrected or completed.** SHELL-11 (above). SET-06: every small record is from the UK
  and the label sweep's first record is also the oldest, so neither By country nor By year moves
  it on all labels; the test digs Cold Storage and Echo Chamber, where By year starts on Echo
  Chamber's 1999 record. Its shuffle check compares two reads with the same `seed` and starts
  again when UTC midnight passed between reads. SBX-06, TWL-08, TWL-15 to TWL-18, PER-02, PER-03,
  SET-05, SET-12, SET-15 and SET-18 now say what they read back.
- **A new observation.** A collection import cancelled while its page was held read cancelled with
  "page 1 of 1, 1 items", and the collected release had its `seed:collection` verdict: the
  importer applies the page it received before it checks the signal. Recorded in
  [PLAN](PLAN.md#observations-awaiting-a-decision); SET-14 and PER-03 do not depend on it.
- **No rehearsal.** The fake services did not change, so no manual run of the CLI was needed.
- **Durations.** On five workers (`vp run e2e --workers 5`) the 164 tests take 1.4 minutes, and
  the command 84.0 s with the client build, against 1.3 minutes and 76.6 s for the 144 before. The
  new tests take 0.6 to 5.9 s: TWL-08 0.6 s, SHELL-08 0.8 s, TWL-15 0.9 s, SHELL-06 1.0 s, SHELL-10
  1.1 s (pages) and 1.2 s (setup steps), TWL-18 1.2 s, SET-06 1.3 s, TWL-16 1.3 s, SHELL-11 1.4 s,
  SET-19 1.4 s, SET-05 1.5 s, PER-02 2.3 s, SET-18 2.3 s, TWL-17 2.7 s (Discogs' 1.1 s spacing
  between the `PUT` and the `DELETE`), SET-12 3.7 s, SBX-06 4.1 s, PER-03 4.5 s (crash) and 4.9 s
  (graceful), SET-15 5.9 s.
- **Stable.** Each new or changed spec passed `--repeat-each=10` on 11 workers before its commit
  (`shell.e2e.ts` 140 of 140; `sandbox.e2e.ts` with `twelves.e2e.ts` 180 of 180; `persistence.e2e.ts`
  40 and 60 of 60; both Twelves specs 220 of 220; both Settings specs 210 of 210). The whole suite
  then passed 1,640 of 1,640 at `--repeat-each=10` on 11 workers in 10.4 minutes, at one-minute load
  averages up to about 60 from the run itself; nothing else ran.
- **`verify` has not grown.** The smoke set is still the 14 P0 tests, 11.3 to 11.5 s inside
  `vp run verify` in this session's runs.

### The Triage P2 scenarios and the 2026-10-03 changes (web)

Built on 2026-10-06 from `e55771a` and measured at `f811498`, on the same 10-core Mac with 32 GB
(macOS 27.0.1), Node 24.18.0 and Playwright 1.63.0 with its Chromium. Nineteen commits: the
pooled pressings and the undated wanted-label record (`7a86461`); TRI-37 and TRI-38 (`2614971`);
`app.youtube.blockSound()` (`8db9e12`); TRI-22, TRI-29, TRI-31 and TRI-35 (`a7e8018`); TRI-16,
TRI-24, TRI-41 and TRI-43 (`4d7339f`); `app.openPage()` (`870e2e4`); PER-10 (`8d616c1`); PER-11
(`eb6101b`); SET-22 (`dd2a08e`); TWL-24 (`8adc983`); PER-12 (`b9374d5`); SET-23 (`21f276e`); a
video Discogs lists after the dumps (`a653ea6`); TRI-23 extended (`f96f1aa`); every spec file in
the scenario table (`95a425d`); waits in SET-18 (`0cd3ff6`) and in Twelves' replay (`f811498`); a
longer poll in `tests/daily-backups.test.ts` (`cafa96f`); and this record. That completes the
Triage family, so every specified web scenario has a test. The work showed:

- **The catalogue moved two tests.** The pooled master (`POOLED_MAIN` and `POOLED_REPRESS` on
  Transit Audio) adds one record to dig on `small`, and its repress, from 2001, represents it, so
  it also counts from 2000 on. SET-02's preview counts and SET-05's "These filters match 19
  records" changed by one; nothing else moved. `UNDATED_ON_WANTED_LABEL` is on White Label, which
  `NOT_IN_ANY_DUMP` now uses, and changed no count, since undated records are left out unless a
  label is wanted. The later video (`laterVideos` on the first record) moved nothing.
- **The changes of 2026-10-03, one row each.** Two pages (decision 139): PER-10, an undo and a
  Twelves change refused with `409` once another page has re-judged the record. The library lock
  (decision 129): PER-11, `digga restore` refused while the server runs, `stats` and `backup`
  beside it, and a relaunch after a crash. Forgetting the account (decision 138): SET-22. A want
  an import finds gone (decision 137): TWL-24. A database copy restored into a fresh library
  (decision 135): PER-12, next to PER-02. A failed scheduled backup (`c06f2ef`): SET-23, with the
  `backups` folder read-only; that a later check that succeeds clears the message stays with
  `tests/daily-backups.test.ts`, since the next check runs 15 minutes later on the server's
  clock. The videos `P` brings (`18b1193`): TRI-23 now checks that the first record's later video
  reaches the tracklist and the player.
- **No product bug, no gap.** Every scenario passed against the code as it was, so no product
  code changed and no `test.fail` was added. Four observations went to
  [PLAN](PLAN.md#observations-awaiting-a-decision): a want Discogs refuses for its token is tried
  three more times (TRI-16), Settings' import row does not count what an import found gone
  (TWL-24), Back up now leaves a scheduled backup's failure shown (SET-23, probed with a
  temporary test that was not kept), and `P` plays the video it finds (TRI-23).
- **Rows corrected.** TRI-16 now starts from `small` with the username `dj`: on `small-account`
  the server refuses another account's token (decision 138). TRI-22 says what "go round" brings
  back and where Esc returns; TRI-31 builds its empty library with `newLibrary("empty")` and a
  dump without releases; TRI-35 follows the tabbed Settings, where the seek step saves through the
  save bar and the color scheme at once; TRI-38 says what `small` shows; TRI-41 and TRI-43 give
  the key presses and clock steps; TRI-24 says what a successful `P` would have changed.
- **Two missing waits, found by the whole-suite burn-in.** SET-18 read the dump file datalist
  once, before `GET /api/dumps` had filled it, and now polls it. `replaySelected()` pressed Enter
  before the Tracks shelf had selected its row, while `GET /api/track-marks` was in flight, and
  now waits for the selection, as `hearAgain()` does. Each failed once in 1,740 runs. Under the
  same load `vp run verify` failed once in vitest: `tests/daily-backups.test.ts` waited the
  default 1 s for a check that succeeds, which copies the database; it now waits up to 5 s.
- **No rehearsal.** The fake Discogs API's release answer now lists `laterVideos`; no manual run of
  the CLI or the server outside the harness was needed.
- **Load.** Another session, in a different project, ran CPU-heavy work in parallel through all
  the measurements below, with one-minute load averages of 40 to 350. The durations are upper
  bounds.
- **Durations.** On five workers the 174 tests took 1.9 and 1.7 minutes (114.6 s and 100 s, after
  `vp build`), against 1.7 minutes for the 156 at `e55771a` and 1.4 minutes
  for 164 on 2026-10-03, before sandbox mode was removed. The new tests take 1.2 to 9.5 s: TRI-38
  1.2 s (`small`) and 1.4 s (`small-account`), PER-10 1.3 s (undo) and 1.3 s (Twelves), TRI-29
  1.6 s, TRI-41 1.8 s, TRI-43 1.8 s, TRI-22 2.0 s, TRI-24 2.1 s, TRI-37 2.2 s, PER-11 2.3 s, PER-12
  2.4 s, TRI-35 2.5 s, SET-23 2.6 s, TRI-31 3.2 s, SET-22 3.6 s, TWL-24 4.5 s, TRI-16 9.5 s (the
  token check and four `PUT`s, which the Discogs client spaces 1.1 s apart). Together they take 47 s; TRI-23 takes 2.2 s.
- **CI estimate.** CI took 3.8 minutes on two workers for 144 tests, where tests ran about 1.4
  times as long as locally. The 18 new tests should add about 66 s of test time there, about
  half a minute on two workers; scaled by test count, the whole suite should take about 4.6
  minutes, within the six-minute budget.
- **Stable.** Each new or changed spec passed `--repeat-each=10` on 11 workers before its commit
  (`triage-player.e2e.ts` with `triage-queue.e2e.ts` 250 of 250, `triage-queue.e2e.ts` 180 of
  180, `triage-discogs.e2e.ts` with `triage-player.e2e.ts` 220 of 220, `triage-discogs.e2e.ts` 90
  of 90, `persistence.e2e.ts` 80, 90 and 100, `settings-discogs.e2e.ts` 90, `twelves-discogs.e2e.ts`
  100, `settings.e2e.ts` 130 and 140, both Twelves replay specs 140). The whole suite at
  `--repeat-each=10` on 11 workers then ran three times: 1,739 of 1,740 in 15.5 minutes (SET-18),
  1,739 of 1,740 in 12.9 minutes after its fix (TWL-23), and 1,740 of 1,740 in 15.0 minutes
  after the second.
- **`verify` has not grown.** The smoke set is the 13 P0 tests, 11.2 to 12.3 s inside
  `vp run verify` in this session's runs.

### The Electron main process (Electron, unpackaged)

Rehearsed by hand on 2026-10-06 at `7a8c266`, on the same Mac, with Node 24.18.0 for the tools,
Electron 44.5.1 (Chromium 152, Node 24.21.0, Node-API 10) and Playwright 1.63.0's
`chromium.connectOverCDP()` to read the window. No spec changed. This is evidence for the
Electron spike in [PLAN](PLAN.md#electron), not the spike itself.

- **Spikes first,** in scratch folders under `/tmp`, outside the repository: an ES module
  `main.ts` importing `src/server/db/db.ts`, and a `.ts` worker doing the same. Electron stripped
  the types in both, and the repository's better-sqlite3 prebuild opened databases in both
  (decisions 153 and 154). With `productName` "Digga" the app's name was Digga and userData
  `~/Library/Application Support/Digga`. A `-r` preload ran before the main entry.
- **The guard and workers.** `NODE_OPTIONS=--import=tests/e2e/support/guard.ts` loaded in
  Electron's main process and refused `example.com:80`. A worker started from a file inherited it,
  in Electron and in Node; an `eval` worker did not, in either. The guard loaded by a `-r` preload
  was not inherited by a file worker, so the Electron host's preload must wrap `Worker`
  ([ELECTRON](ELECTRON.md#startup-order)). Before this was understood, two spike runs' `eval`
  workers opened TCP connections to `example.com:80`; no request went to Discogs,
  data.discogs.com or YouTube.
- **One spike ran without `--user-data-dir`.** With `productName` "Digga", Electron's userData was
  the owner's library folder for that run, about 20 s with its slow exit, and Chromium may have
  written its profile files there. No Digga code ran in it and no database was opened; the folder was not inspected,
  since that needs the owner's permission. Every later run passed `--user-data-dir` in its temp
  folder, and the app now keeps Chromium's files in `userData/Chromium` (decision 155).
- **Quitting takes long in minimal apps.** A spike app that only opened a hidden window took 20 s
  to exit after `quit` (35 s with `--disable-gpu`), and Digga, after Playwright's
  `browser.close()` over CDP had closed its window, had stopped its server but not exited 20 s
  later, when it was killed. Digga's own quits below took 1 to 2 s. SIGTERM never
  reached a Node `process.on("SIGTERM")` handler: Chromium handles it as a quit, which runs
  `before-quit`, so the main process has no signal handlers.
- **Setup.** The fakes standalone, on a dump of the bulk catalogue
  (`writeDump(folder, bulkDump())`, 81,198 bytes, 1,500 releases) named
  `discogs_20260901_releases.xml.gz`, with an allowlisted environment:
  `env -i PATH=<node's folder>:/usr/bin:/bin HOME=<root>/home node tools/dev/fake-services.ts <dump> --port 4567 --mbps 0.002`.
  The app started from a script that passes every variable as its own `env -i` argument and
  prints them, with the command line, before the start:
  `PATH`, `HOME=<root>/home`, `TMPDIR=<root>/tmp/`, `LANG=en_US.UTF-8`, `TZ=UTC`,
  `DIGGA_DATA_DIR=<root>/library`, `DIGGA_DUMPS_DIR=<root>/dumps`,
  `DIGGA_CONFIG_FILE=<root>/config/digga.config.json`,
  `DIGGA_DUMPS_URL=http://127.0.0.1:4567/dumps/`,
  `DIGGA_DISCOGS_API_URL=http://127.0.0.1:4567/discogs`,
  `DIGGA_YOUTUBE_OEMBED_URL=http://127.0.0.1:4567/youtube/oembed`, `DIGGA_LOG_LEVEL=debug`,
  `NODE_OPTIONS=--import=<repo>/tests/e2e/support/guard.ts` and `DIGGA_E2E_ALLOWED_PORT=4567`;
  then `<repo>/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron -r <tools>/preload.cjs <repo> --user-data-dir=<root>/user-data --use-mock-keychain --password-store=basic "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1" --remote-debugging-port=9333`,
  from `<root>/cwd`, which has no `.env`. `<root>` was `mktemp -d /tmp/digga-rehearsal.XXXX`. The
  `-r` preload replaced `shell.openExternal` with a line on stdout, and, for the second start,
  `dialog.showMessageBox` too. The scripts stayed in `/tmp`, apart from the data.
- **The window.** The setup's first step opened at `http://localhost:<port>/#/setup/catalogue`,
  titled "Fetch the catalogue – Digga setup", with a Chrome user agent naming neither Electron
  nor Digga. The log was in `<root>/user-data/digga.log`, Chromium's files in
  `<root>/user-data/Chromium`, and the library held only `digga.sqlite`, `backups/`,
  `secrets.env` and, while running, `digga.lock`.
- **The token.** `e2e-token-dj`, typed into the setup's Discogs step, saved as
  `DISCOGS_TOKEN_ENCRYPTED=djEw...` (`v10`, Chromium's format, under the mock keychain) in a
  `0600` `secrets.env` without the token's text, and `GET /api/discogs/account` answered
  `tokenSource: "saved"`, `tokenEncrypted: true`, `tokenUsername: "dj"`. After a relaunch the same
  request answered the same, so the token was read back and the fake Discogs accepted it.
- **The worker.** "Fill the crate" loaded the dump through the dump-load worker: its
  `[dump-load-worker]` lines reached the terminal, the job ended `done` with 1,500 releases
  upserted in 0.23 s, and `GET /api/stats` counted 1,500.
- **The lock.** With a slower newer dump (`discogs_20261001_releases.xml.gz` at 0.0002 MiB/s) a
  download and a load following it were running when a second app started on the same library
  and userData. It showed "Another Digga is using the library." with "The library is in use by
  the Digga app (process 68382, since 2026-10-06T18:12:26.742Z). Stop it first.", quit, and left
  the first app's jobs and `digga.lock` as they were.
- **Quitting during the jobs.** Closing the window logged "stopping: cancelled 2 running job(s),
  waiting for them", then "stopped" 0.25 s later, removed `digga.lock`, and the process exited.
  After a relaunch `GET /api/jobs` listed both jobs as `cancelled`, not interrupted. The runner's
  log line for a cancelled job reads "failed: Cancelled" while the job is stored as `cancelled`.
  SIGTERM to the relaunched app also stopped the server and exited within 2 s.
- **Links and permissions.** `window.open("https://www.discogs.com/release/1201", "_blank",
"noopener,noreferrer")`, as the client's `openExternal()` calls it, a `target="_blank"` link,
  and `location.href = "https://example.com/elsewhere"` each logged "opening ... in the browser"
  and reached the stubbed `shell.openExternal`; the page stayed where it was. Chromium refused
  `window.open("file:///etc/hosts")` before the handler. `Notification.requestPermission()`
  answered `denied`.
- **Colour scheme.** With `appearance.colorScheme: "dark"` in the config, the relaunched page
  matched `prefers-color-scheme: dark` once Playwright's default light emulation was cleared with
  `page.emulateMedia({ colorScheme: null })`.
- **Not rehearsed.** The native menu (unit tests cover its template; CDP cannot click it), a
  download through the save dialog, SIGINT, the real Keychain, a lock dialog on screen (it was
  stubbed), and YouTube playback, which needs real videos. The guard refused nothing during the
  app runs, and the fakes reported no problem.

### The Electron spike (Electron, unpackaged)

Run on 2026-10-07 at `cb3774f` with the harness preload committed with this entry, on the same 10-core
Mac (macOS 27.0.1, a 3024 x 1964 display, 1512 x 982 points), Node 24.18.0, Electron 44.5.1 and
Playwright 1.63.0's `_electron.launch()`, against `electron/main.ts` unpackaged. One-minute load
averages were 2.6 to 4.7 during the spike runs; another project shares the machine, and the load
rose to 18 during the later suite runs. This answers the questions [PLAN](PLAN.md#electron) left
after the [rehearsal](#the-electron-main-process-electron-unpackaged), except the packaged `-r`
behaviour and the other operating systems.

- **Isolation of the runs.** Every Electron start went through a scratch launcher outside the
  repository (`/tmp/digga-spike-tools/launch.ts`), which refused to start unless the root was a
  `mktemp -d /tmp/digga-spike.XXXXXX` folder, `--user-data-dir`, `HOME`, `TMPDIR` and every `DIGGA_*`
  path lay under it and the three `DIGGA_*_URL`s named the fakes, and which printed the whole
  environment (built from nothing: `PATH=/usr/bin:/bin`, `HOME`, `TMPDIR`, `LANG`, `TZ`, the
  `DIGGA_*` paths and URLs, `DIGGA_LOG_LEVEL=debug`, `DIGGA_E2E_ALLOWED_PORT`,
  `DIGGA_E2E_TEMP_ROOT`, `DIGGA_E2E_DOWNLOADS_DIR`) and the command line before the start. The
  fakes ran in the script's process (`FakeServices.start()`). No run used the owner's environment
  or library, and the fakes reported no violation.
- **Playwright's command line.** `_electron.launch()` runs
  `Electron -r <playwright>/loader.js --inspect=0 --remote-debugging-port=0 <args>`; with
  `-r tests/e2e/support/electron-preload.cjs <repo> --user-data-dir=…` as `<args>`, both preloads
  ran, Playwright's first, and the app path was the repository. Playwright's loader holds Electron's
  `ready` until it has attached, and Playwright deletes `NODE_OPTIONS` from the environment it is
  given.
- **The held first navigation.** Wrapping `BrowserWindow.prototype.loadURL` in the preload held
  the first call: the server was listening, the held URL was `http://localhost:<port>`, the fakes
  had logged no request, and Playwright reported no window. After `release()` the page loaded at
  `#/setup/catalogue`, titled "Fetch the catalogue – Digga setup", about 0.15 s later.
- **The context must be ready before the window exists.** With the window created and its first
  navigation held, `context.route()` (from `guardContext()`) did not return, and the run stopped
  there until it was killed: Playwright waits for the window's first navigation before it routes
  its requests. `firstWindow()` likewise waits for a navigation, so the page object exists only
  after the release. Installed right after `_electron.launch()`, before the app created its window,
  the routes, the fake YouTube init script (`window.__fakeYouTube` was an object in the page) and
  `context.clock.install()` were all in place at the release, and the clock then ran 60 s
  through `runFor()`. That order held by 150 ms of timing alone, so the preload also holds the
  app's `whenReady()` until the host has prepared the context.
- **The page's settings.** `locale`, `timezoneId` and `colorScheme` given to `_electron.launch()`
  reached the page (`en-US`, `UTC`, dark). `reducedMotion` is not a launch option, and Chromium's
  `--force-prefers-reduced-motion` switch had no effect; `page.emulateMedia({ reducedMotion })`
  after `firstWindow()` worked. `setContentSize(1600, 1000)` gave 1600 x 917: macOS keeps the
  window within the 1512 x 949 work area. `page.setViewportSize()` then gave 1600 x 1000. The
  user agent was Chrome's (`… Chrome/152.0.7977.130 Safari/537.36`).
- **The guard in the main process and in workers.** The preload's guard refused a main-process
  `fetch()` to a loopback port the spike owned ("digga-e2e guard: refused a connection to
  127.0.0.1:<port>"). Replacing `worker_threads.Worker` with a subclass that adds the guard's
  `--import` to each worker's `execArgv`, then calling `syncBuiltinESMExports()`, gave the ES
  module binding the subclass (`Worker.name` was `GuardedWorker`), and a file worker's connection
  to the forbidden port was refused while one to the fakes connected. The forbidden listener saw
  no connection. The context's routes refused a page `fetch()` to the forbidden port.
- **Relaunch on the same library.** A token saved through `PUT /api/discogs/token` under the mock
  keychain was `DISCOGS_TOKEN_ENCRYPTED=djEw…` in `secrets.env`; after a quit and a second launch
  on the same library and userData, `GET /api/discogs/account` answered `tokenSource: "saved"`,
  `tokenEncrypted: true` and `tokenUsername: "dj"`.
- **Quitting.** `app.quit()` through `evaluate()` ran `before-quit`: the server logged "stopped"
  86 ms and 107 ms after the call, and the process exited after 232 ms and 235 ms. No kill was
  needed. The rehearsal's 20 s exits came after `browser.close()` over CDP.
- **userData and the preload's refusal.** With `--user-data-dir`, `userData` was that folder,
  `sessionData` its `Chromium` folder (decision 155) and `crashDumps` its `Crashpad` folder. On
  macOS `HOME` and `TMPDIR` moved neither `appData`, `home`, `downloads` nor `temp`, which stayed
  the owner's (`~/Library/Application Support`, `~`, `~/Downloads`, `/var/folders/…/T/`); the
  spike did not open or list them. Started with `--user-data-dir` in a second mktemp folder outside
  `DIGGA_E2E_TEMP_ROOT`, the preload printed "digga-e2e preload: refused to start: userData … is
  not inside the test's folder" and Electron exited with 78 after 133 ms. Electron had created the
  userData folder before the preload ran; it was empty. In the first suite run the check refused
  every launch: Electron reports userData as `/private/var/folders/…`, the test's folder is under
  `/var/folders/…`, so the preload compares real paths.
- **Not covered.** The packaged app's `-r` behaviour (no packaged build exists), Windows and
  Linux, the real keychain, and `safeStorage` under the basic store on Linux.

### The Electron host and its scenarios (Electron, unpackaged)

Built and measured on 2026-10-07, on the same 10-core Mac with 32 GB (macOS 27.0.1, a 1512 x 982
point display), Node 24.18.0, Electron 44.5.1 and Playwright 1.63.0 with its Chromium; the final
runs were at `e6dfa5d`. Four commits: the preload and the spike (`8d34628`), the host, its
configuration and GUARD-03 (`eb62deb`), the shared suite on Electron (`ad7b0e7`), and ELEC-01,
ELEC-02, ELEC-04, ELEC-05, ELEC-06, ELEC-10, ELEC-11 and ELEC-13 (`e6dfa5d`). Another project
shared the machine; the one-minute load averages are given with each run, and durations compare
only within this session.

- **The first run on Electron.** 155 of 170 tests passed at once (4 workers, 122 s, load 3.2 to
  18.0). The 15 failures were the host's, and none was a product bug:
  - six A11Y-01 tests: `AxeBuilder.analyze()` opens a page in the context to finish its scan, which
    Electron refuses (`Target.createTarget: Not supported`); `support/axe.ts` uses axe's legacy
    mode for a context without a browser;
  - PER-02, PER-12 and TRI-31, which relaunch on a second library: the host's library check read the
    first `library:` line of `digga.log`, which keeps every launch's lines; it reads the last;
  - PER-03's graceful relaunch: the host quit the app while the page still polled `/api/jobs`,
    whose request failed ("net::ERR_FAILED"). The web host closes its context before it stops the
    server; the Electron host now blanks the page first;
  - SET-16 and SET-22, which answer a `confirm()`: Electron shows a page's dialog through
    `dialog.showMessageBox`, which the preload's stub answered at once with OK, so a dismissed
    delete went ahead and Playwright's `dialog.dismiss()` found no dialog. The stub leaves a
    dialog that carries an abort signal (a page's) unanswered, and Playwright's answer reaches it
    over CDP, as in a browser;
  - PER-11: the library lock names "the Digga app" in Electron (decision 151), where the test
    expected "the Digga server"; it takes the name from the `host` fixture now, and its row says
    so;
  - PER-10's two tests: `openPage()`, a second window the app never opens; tagged `@web`.
- **Web only.** Seven of the 174 shared tests are `@web`, each with its reason in the spec: PER-05
  (`restartServer()`), PER-10 (two, `openPage()`), SHELL-06 (the app always opens `localhost`),
  SHELL-10 (two; the window keeps history but offers no Back or Forward), and GUARD-02 (a Chromium
  context of its own, without the app). SHELL-10's row said "Electron if the window keeps
  history"; it now gives the reason.
- **Rows corrected.** ELEC-02 said userData holds the token file; the token is in the library's
  `secrets.env` (decision 152). ELEC-06 said menu items start jobs; they open the Settings tab that
  starts each job (decision 157). ELEC-01, ELEC-04, ELEC-05, ELEC-10, ELEC-11 and ELEC-13 now say
  what their tests observe.
- **Writes outside the test's folder.** During a test the app's processes held open for writing,
  outside the test's folder, only a file in the real temp folder (`/var/folders/…/T/.com.github.Electron.*`)
  and macOS's Metal shader cache for the Electron binary (`/var/folders/…/C/com.github.Electron.helper/`),
  both outside the home folder, where every userData lies. ELEC-02 checks that through `lsof`;
  it cannot see a file written and closed before.
- **Quitting.** Over a whole run (183 quits, load 6.0 to 13.5), the server logged "stopped" a median
  90 ms after `app.quit()` (95th percentile 134 ms, at most 306 ms) and the process exited a median
  261 ms after it (95th percentile 338 ms, at most 909 ms). The host never needed to kill an app.
  No Electron or helper process was left after the runs, crash relaunches included.
- **No product bug, no gap, no product change.** Nothing in `src/` or `electron/` changed, so
  DECISIONS has no new entry.
- **Burn-ins before the commits,** on the working tree that became the four commits:
  `guard.e2e.ts` 20 of 20 on the web project (5 workers) and 30 of 30 on Electron (4 workers),
  load 2.3 to 4.4; `persistence.e2e.ts`, `shell.e2e.ts` and `accessibility.e2e.ts` 360 of 360 on
  the web project in 191 s (5 workers, load 4.0 to 13.7) and 300 of 300 on Electron in 239 s
  (4 workers, load 13.7 to 15.7); `electron.e2e.ts` 90 of 90 on Electron in 46 s (4 workers,
  load 14.8 to 18.4).
- **Final runs at `e6dfa5d`,** after `vp build`:
  - `npx playwright test --config tests/e2e/playwright.electron.config.ts --workers 4`: 178 of 178
    (167 shared, GUARD-03's two and the ELEC scenarios' nine) in 133 s, load 12.6 to 29.1. Tests
    took a median 2.0 s (90th percentile 6.2 s, at most 16.1 s, A11Y-01's setup steps); the ELEC
    tests 1.0 to 1.3 s, ELEC-06 5.1 s, GUARD-03 0.15 s.
  - The same with `--repeat-each=3`: 534 of 534 in 397 s, load 29.1 to 24.4.
  - `vp run e2e` (web, 5 workers): 174 of 174 in 94 s with the build, load 24.4 to 13.4; tests
    took a median 1.5 s (90th percentile 5.9 s, at most 17.0 s).
  - `vp run verify` passed before each commit, and on each commit's own content, exported from the
    index into a scratch folder.
- **Workers.** Four for Electron throughout: each test runs a whole app with its GPU, network and
  renderer processes, and four kept every page answering at loads up to 29. The load stayed far
  below the 150 expected, so a ×10 burn-in on a quiet machine is left to the owner
  ([PLAN](PLAN.md#electron)).

### The packaged app (Electron, packaged)

Built and measured on 2026-10-08, on the same 10-core Mac with 32 GB (macOS 27.0.1, 26A434), Node
24.18.0, Electron 44.5.1, electron-builder 26.15.3, @electron/fuses 2.1.3 and Playwright 1.63.0;
the final runs were at `fa2f5c0`. Another project shared the machine and at times used eight
cores; the one-minute load averages are given with each run, and durations compare only within
this session.

Commits: the signing decision (`e79855a`), packaging with electron-builder, which needed no
TypeScript step (`cc38a46`), the fuses and the inspectable variant (`0ccacd0`), the
undecryptable-token tests and the drafted install steps (`d96b706`), the host's packaged mode and
the `DIGGA_E2E_HOLD` hook (`5b64b3f`), the health check (`ae74ab5`), the workers' log lines and
rotation (`71b1da2`), the plans (`9d78ed0`), the quit during the start (`61a280c`) and the health
check's exit policy (`fa2f5c0`).

- **Isolation.** Every start of a packaged build went through a launcher that refused to start
  unless `--user-data-dir`, `HOME`, `TMPDIR`, the working folder and every `DIGGA_*` path lay in a
  `mkdtemp` folder, and that printed the environment, built from nothing, and the command line
  first: a scratch launcher in `/tmp` for the experiments, `scripts/electron-health-check.ts` and
  the E2E host. Each passed `--use-mock-keychain` and `--password-store=basic`, and the service
  URLs named fakes on loopback. No build was opened from Finder or with `open`, none was copied to
  `/Applications`, and the fakes reported no violation. electron-builder downloaded Electron's
  darwin-arm64 zip from GitHub into its cache; nothing reached Discogs, data.discogs.com or
  YouTube.
- **TypeScript in the archive** (decision 160). The first build, unfused, started from `app.asar`:
  `electron/main.ts` and the server ran from their `.ts` files, `GET /api/health` answered
  `{"ok":true,"name":"digga"}`, a dump-load job loaded the bulk dump's 1,500 releases through its
  worker, and Back up now wrote a decisions backup through the backup worker. The fused builds
  did the same. No transpile step and no `asarUnpack` for the sources.
- **The native module.** electron-builder unpacked better-sqlite3 into `app.asar.unpacked` and
  signed `darwin-arm64.node` ad-hoc (`flags=0x2(adhoc)`; the repository's copy is
  `adhoc,linker-signed`); it loaded in the main process and in both workers.
- **Signing.** `codesign --verify --deep --strict --verbose=2 release/mac-arm64/Digga.app`:
  "valid on disk" and "satisfies its Designated Requirement", for the inspectable variant too.
  `codesign -dv`: `Identifier=io.github.razorjack.digga`, `Format=app bundle with Mach-O thin
(arm64)`, `flags=0x2(adhoc)`, `Signature=adhoc`, `TeamIdentifier=not set`.
- **Fuses.** `npx @electron/fuses read --app release/mac-arm64/Digga.app`: RunAsNode,
  EnableCookieEncryption, EnableNodeOptionsEnvironmentVariable, EnableNodeCliInspectArguments and
  LoadBrowserProcessSpecificV8Snapshot disabled; EnableEmbeddedAsarIntegrityValidation,
  OnlyLoadAppFromAsar, GrantFileProtocolExtraPrivileges and WasmTrapHandlers enabled. The
  inspectable variant differs only in EnableNodeCliInspectArguments; both `Info.plist` files hold
  the same `ElectronAsarIntegrity` hash. The release build ignored `--inspect=0` (no "Debugger
  listening" line); the inspectable one printed it.
- **Integrity.** A copy of the inspectable app with one byte of `app.asar` changed exited with 1
  and "ASAR Integrity Violation: got a hash mismatch". A copy with a line added to a file in
  `app.asar.unpacked` started and answered `/api/health`, while `codesign --verify` reported "a
  sealed resource is missing or invalid" (decision 161).
- **`-r`.** A probe preload that writes a line to stderr never ran in the unfused build, the
  fused release build or the inspectable variant, with or without `--inspect=0`. The host now
  prepares a packaged build through the `DIGGA_E2E_HOLD` hook (decision 162). A first version of
  the hook waited with a top-level `await`; Electron then printed "Debugger listening" but never
  "DevTools listening", and `_electron.launch()` timed out after 15 s, so the wait is a promise.
- **GUARD-03 on the packaged app.** With the refused folder as `--user-data-dir`, Chromium had
  written its `Chromium` folder there before the host could load the preload, which then exited
  with 78; the library was not created. The test expects the folder on that configuration.
- **Gatekeeper.** A `ditto` copy of the release app and a copy of the dmg, each given
  `com.apple.quarantine` (`0083;…;Safari;…`), never opened: `spctl --assess --verbose` on the
  app answered "rejected" (exit 3), also without the attribute; on the dmg,
  `spctl --assess --verbose --type open --context context:primary-signature` answered "rejected,
  source=no usable signature" (exit 3), since the dmg is not signed. `syspolicy_check
distribution` failed the app with "Adhoc Signed App" (Warning) and "Notary Ticket Missing"
  (Fatal). The README's install steps are a draft until the owner opens a downloaded copy.
- **Rosetta** is not installed on the Mac (`arch -x86_64 /usr/bin/true`: "Bad CPU type in
  executable"), so no x64 build was made (decision 159).
- **Sizes.** `Digga.app` 249 MB (`du -sh`), of which `app.asar` 8.6 MB and `app.asar.unpacked`
  2.0 MB; `Digga-0.0.0-arm64.dmg` 116,684,062 bytes. Keeping only the English locale took the
  first build's 300 MB to 251 MB.
- **Build durations.** The release build with its dmg took 15.6 to 43.8 s and the inspectable
  variant 5.4 to 13.4 s (load 8 to 121); the first, unfused build 41.4 s (load 24).
  `vp run electron:package`, with the client's build and the health check, took 43.1 s at load
  21 to 25 and 54.2 s at load 5.7 to 78.
- **A product bug the health check found.** At loads of 80 to 145 the check sent SIGTERM 0.6 s
  after the start, while the window was still loading the app: the server stopped, `loadURL()`
  failed with `ERR_CONNECTION_REFUSED`, and the start's error handler showed "Digga could not
  start." as a modal dialog, which kept the app from exiting (still running 34 s later, then
  killed). A quit during the start now shows no dialog (`61a280c`); three probes under load 104
  to 129 then exited, one of them after a failed load.
- **Slow exits under load.** After SIGTERM the server logged "stopped" within 1.6 s in every
  health check, but the Electron process took 0.8 to 1.3 s at loads under 50 and 4 to 25 s at
  loads around 100 to 130. The check kills it 10 s after its server stopped and says so, as the
  host does (`fa2f5c0`). In the final run 1 below, the host killed 22 such apps at load up to 185.
- **The health check.** `node scripts/electron-health-check.ts` on the release build: health
  answered after 0.5 to 2.5 s, the server stopped after 0.7 to 2.8 s, and the app exited after 0.8
  to 3.3 s, or was killed 10 s after its server stopped in two of four runs at load 45 to 67.
- **Undecryptable token.** `tests/setup-http.test.ts` gives the server a `safeStorage` stand-in
  that cannot decrypt the saved token: `GET /api/discogs/account` answered no token twice with one
  decryption, `PUT /api/discogs/token` saved the new one encrypted, and the library kept its
  releases; with encryption unavailable it saved the token as text. The real prompt is left to the
  owner across two builds.
- **Burn-ins before the commits,** `guard.e2e.ts` at `--repeat-each=10` with 4 workers, load 15
  to 19: web 20 of 20 in 6.2 s, unpackaged Electron 30 of 30 in 7.2 s, packaged 30 of 30 in 8.9 s.
- **First runs of the whole configuration** on the working tree that became `5b64b3f`: packaged
  178 of 178 in 2.3 min (4 workers, load 6.8 to 22), unpackaged 178 of 178 in 2.4 min (4 workers,
  load 19.8 to 16.6).
- **Final runs at `fa2f5c0`,** after `vp run electron:package`:
  - `vp run electron:package`: 54.2 s at load 5.7 to 78, then the health check (above).
  - `npx playwright test --config tests/e2e/playwright.packaged.config.ts --workers 4`: 178 of 178
    (167 shared, GUARD-03's two and the ELEC scenarios' nine) in 3.7 min, load 53 to 185; the
    host killed 22 apps still running 10 s after their server stopped.
  - The same with `--repeat-each=3`: a first attempt with 3 workers at load 146, while the other
    project used eight cores, ran A11Y-01's setup test in 28.9 s of its 30 s and was stopped after
    9 tests, before any failure. With 2 workers: 534 of 534 in 30.1 min, load 126 to 43; 151
    kills of lingering apps, and no Electron process left afterwards.
  - `vp build`, then `npx playwright test --config tests/e2e/playwright.electron.config.ts --workers 4`
    (unpackaged): 178 of 178 in 2.1 min, load 37 to 14, no kills.
  - `vp run e2e` (web, 5 workers): 174 of 174 in 1.8 min with the build, load 59 to 31.
  - `vp run verify` passed before each commit.
- **The kills come from the load, not the package.** A second packaged run, 178 of 178 in
  4.2 min while the load rose from 14 to 138, killed 45 apps, in Triage's tests, which play the
  fake player. `triage.e2e.ts` and `triage-queue.e2e.ts` back to back, 4 workers: packaged 0 and 1
  kills, unpackaged 0 and 14, the last at load 51 rising. ELEC-01 and ELEC-11 ×5 on 2 workers
  killed none on either at load 86 to 128.
- **Workers.** Four for single runs and burn-ins below a load of about 50; two for the ×3 run,
  which kept every test within its timeout at loads to 126. The ×10 burn-in on a quiet machine
  is still the owner's ([PLAN](PLAN.md#electron)).

### The setup's Electron parts (Electron, unpackaged and packaged)

Built and measured on 2026-10-08, on the same Mac (macOS 27.0.1, 26A434), Node 24.18.0, Electron
44.5.1 and Playwright 1.63.0; the final runs were at `d2bfb33`. Another project shared the
machine, at times heavily; the one-minute load averages are given with each run, and durations
compare only within this session.

Commits: the regression test for `61a280c` (`886068d`), the desktop interface (`1ba7dcd`), the
quit question (`c41539a`), the Dock's progress bar, the power save blocker and the notification
(`35ee816`), "Use a dump file I have" (`3820ad0`), the dumps folder picker (`6c7f825`) and the
Full Disk Access dialog (`d2bfb33`); decisions 165 to 170.

- **Isolation.** Every start of the app went through the E2E host or
  `scripts/electron-health-check.ts`, with the mock-keychain switches. Once, `npx electron
--version` started the repository's Electron binary with no app to read its version; it printed
  `v24.21.0` and exited, loaded no Digga code and opened no window, and
  `~/Library/Application Support/Electron` kept its date of 2026-10-06. A throwaway spec, deleted
  afterwards, read the main process's functions on the unpackaged app (the preload) and on the
  packaged one (the hold path) and found the preload's: before ELEC-08's first run,
  `Notification.isSupported` (which answers false, so the app creates no notification),
  `BrowserWindow.prototype.setProgressBar` and `powerSaveBlocker.start` and `stop`; before
  ELEC-09's, `dialog.showOpenDialog`; before ELEC-12's, `shell.openExternal` and
  `dialog.showMessageBox`. The quit question used the message box stub that already recorded the
  startup error's box. No native dialog, notification or System Settings pane appeared. ELEC-12's history import read
  the fake home, whose Brave folder the job's message names.
- **ELEC-14** (`886068d`) holds the wantlist import, quits during the start and checks that the
  held navigation failed, that no message box was shown and that the app exited with 0. With
  `61a280c`'s `if (quitting) return;` taken out, it failed on the "Digga could not start." box.
- **Burn-ins** (`--repeat-each=10`), each before its commit:
  - ELEC-14: unpackaged 10 of 10 in 11.8 s, 2 workers, load 48 to 53; packaged 10 of 10 in
    12.9 s, 2 workers, load 54 to 57.
  - ELEC-07: unpackaged 10 of 10 in 105 s, 3 workers, load 81 to 128; ELEC-07 and ELEC-14
    packaged 20 of 20 in 1.0 min, 2 workers, load 150 to 132.
  - ELEC-08's two tests: unpackaged 20 of 20 in 53.3 s, 3 workers, load 38 to 26; packaged 20 of
    20 in 54.3 s, 3 workers, load 16 to 8.
  - ELEC-09: unpackaged 10 of 10 in 14.8 s, packaged 10 of 10 in 15.1 s, 3 workers, load 6 to 8.
  - ELEC-15 and SETUP-05: unpackaged 20 of 20 in 15.6 s, load 2 to 5; packaged 20 of 20 in
    17.5 s, load 12 to 19; 3 workers.
  - ELEC-12: unpackaged 10 of 10 in 7.3 s, packaged 10 of 10 in 9.1 s, 3 workers, load 6 to 8.
- **Other runs.** The three setup spec files on the unpackaged app, after the quit question:
  36 of 36 in 2.1 min, 3 workers, load 130 to 225. With step 1's new controls, the setup spec
  files and `accessibility.e2e.ts` on the unpackaged app: 49 of 49 in 1.2 min, 3 workers, load 7
  to 5. Each `vp run electron:package` took 35 to 52 s, and its health check answered after 2.2
  to 3.1 s and exited with 0.
- **Slow exits.** At loads of 80 to 225, during ELEC-07's burn-in and the setup specs, the host
  killed at least 21 apps still running 10 s after their server stopped; no test failed. No run
  below a load of about 60 killed one.
- **Product bugs found and fixed,** each with a vitest test: after a quit cancelled the load, the
  crate said "The catalogue stopped loading: Cancelled." (`c41539a`); a browser folder the
  history import may not list failed with the bare `EACCES` error instead of
  `HistoryAccessError` (`d2bfb33`).
- **Final runs at `d2bfb33`,** each once, 5 workers:
  - `vp run e2e`: 174 of 174 in 1.5 min, 92 s with the build, load 7.8 to 7.6.
  - `vp run e2e:electron`: 185 of 185 (167 shared, GUARD-03's two and the ELEC scenarios' 16) in
    2.0 min, 120 s with the build, load 7.3 to 17.6, no kills.
  - `vp run e2e:packaged`: the package and its health check (2.3, 2.5 and 2.6 s, exit 0), then
    185 of 185 in 2.0 min, 153 s in all, load 17.1 to 28.0, no kills.
  - `vp run verify` passed before each commit, in 22 to 23 s.

### The owner's decisions of 2026-10-08 (web, Electron unpackaged and packaged)

Built and measured on 2026-10-08, on the same Mac (macOS 27.0.1, 26A434), Node 24.18.0, Electron
44.5.1 and Playwright 1.63.0; the final runs were at `84ffcca`. Other work shared the machine,
Spotlight's indexing among it; the one-minute load averages are given with each run.

Commits, each passing `vp run verify` (about 22 s): the browser history import removed
(`c79a3b1`) and the docs without it (`ed1ddf4`); the cued track (`2c4ab28`), Read my lists
(`a57f535`), the singular count (`342597f`), the account check (`4c2b35f`), the refused token
(`ed98f0e`), "N gone from Discogs" (`5856024`), Back up now (`e29603f`), the track of a second
video (`34d2651`, a bug found on the way), `P`'s videos (`75dc14e`), the quit-stopped download
(`5046738`), the chosen folder or file that is gone (`7131879`), and the decisions (`84ffcca`);
decisions 171 and 172.

- **The removal** took out, in `c79a3b1`, 617 lines of production code (63 added), 740 of tests
  (252 added, among them `tests/library-with-history.test.ts` for libraries from before it) and
  70 of docs (32 added); `ed1ddf4` changed 45 more lines of docs into 30. SETUP-12 and ELEC-12
  are retired; TRI-47 is two tests, one of them for a library with no `seen` verdict, where
  Settings shows no toggle.
- **Isolation.** Every start of the app went through the E2E host or
  `scripts/electron-health-check.ts`, with the mock-keychain switches; the Electron version came
  from `node_modules/electron/package.json`. No native dialog or notification appeared, and every
  run used a throwaway library and the fakes.
- **Burn-ins** (`--repeat-each=10`), web with 4 workers and unpackaged Electron with 3, each
  before its commit:

  | Tests                                   | Web             | Electron        | Load         |
  | --------------------------------------- | --------------- | --------------- | ------------ |
  | TRI-47 and SET-15                       | 30 in 25.2 s    | 30 in 34.2 s    | 5.9 to 11.9  |
  | TRI-01                                  | 10 in 5.4 s     | 10 in 7.6 s     | 11.7 to 20   |
  | SET-11                                  | 10 in 17.6 s    | 10 in 24.0 s    | about 9      |
  | SET-05 and SET-13                       | 20 in 22.5 s    | 20 in 31.4 s    | 8.6 to 13    |
  | SETUP-28                                | 20 in 48.6 s    | 20 in 1.1 min   | 5.1 to 5.2   |
  | TRI-16                                  | 10 in 23.2 s    | 10 in 31.2 s    | 7.8 to 9.4   |
  | TWL-24                                  | 10 in 16.6 s    | 10 in 22.3 s    | 7.6 to 7.7   |
  | SET-23                                  | 10 in 8.0 s     | 10 in 12.0 s    | 6.1 to 8.7   |
  | TRI-23                                  | 20 in 9.6 s     | 20 in 13.0 s    | 4.5 to 13.2  |
  | ELEC-16                                 | (Electron only) | 10 in 13.5 s    | 7.4 to 9.6   |
  | SETUP-04 and SETUP-05                   | 20 in 8.9 s     | in the next row | 11.6 to 15.9 |
  | SETUP-04, SETUP-05, ELEC-09 and ELEC-15 | (Electron only) | 40 in 36.6 s    | 15.0 to 20.9 |

- **Other runs.** ELEC-07 and ELEC-14 after the runner's change, 2 of 2 in 9.0 s, load 9.6 to
  9.8; the setup spec files and `accessibility.e2e.ts` on the web, 47 of 47 in 46.7 s; the
  Triage specs, 55 of 55; `electron.e2e.ts` on Electron, 15 of 15 in 15.5 s.
- **Final runs at `84ffcca`,** each once, one after the other, with the configurations' workers:
  - `vp run e2e`: 175 of 175 in 1.7 min, 101 s with the build, load 33.9 to 66.7.
  - `vp run e2e:electron`, started once the load had fallen below 15: 186 of 186 (168 shared,
    GUARD-03's two and the ELEC scenarios' 16) in 2.2 min, 130 s with the build, load 12.7 to
    39.7, no kills.
  - `vp run e2e:packaged`: the package and its health check (answered after 2.4 s, exit 0 after
    2.8 s), then 186 of 186 in 2.3 min, 175 s in all, load 39.7 to 48.6. The host killed five
    apps still running 10 s after their server stopped, all in the first `accessibility.e2e.ts`
    tests, which started as packaging ended; no test failed.

## Original status on 2026-10-02

Status: proposed on 2026-09-30 and revised the same day after two rounds of review. The web spike
(Rollout, step 0) is built, and so is the whole P0 set, with the first-run setup (SETUP-01) and
the checkpoint scenarios SETUP-18, SETUP-19 and SETUP-21, Triage's P1 set: the record, the
player and the tracklist first, then the verdicts, the queue, scopes, the market, the seller and
the wants, Settings' P1 set, Twelves' P1 set with the `bulk` template, and the P1 sets of Shell,
Sandbox and Persistence with `restartServer()`, and the setup's P1 scenarios for steps 1 to 3,
before the load starts; the fake services have moved to `tools/dev/fake-services.ts`. On
2026-10-02 the ten product gaps the suite recorded were closed, with SHELL-12, SETUP-24, SETUP-25,
SETUP-26, SETUP-28, SETUP-29 and SETUP-32 built for them; no scenario is a gap now. The results
are recorded in [Spike results](#spike-results). The rest is not built yet. This is the design of Digga's
end-to-end (E2E) tests: the tool, the harness, the fake services, the markup the tests rely on,
and the scenarios the suite should cover. The same tests must run against the browser app now and the Electron app later
(`docs/ELECTRON_PLAN.md`).

## Product changes the harness needs

In the order they are needed:

1. **Service URLs.** `CreateServerOptions` gains `discogsApiUrl` (passed to
   `createDiscogsClient({ baseUrl })`) and `youtubeOembedUrl` (passed to
   `createVideoTitleLookup()`), beside the existing `dataDumpsUrl`. The CLI's `boot()` reads
   `DIGGA_DISCOGS_API_URL` and `DIGGA_YOUTUBE_OEMBED_URL` next to `DIGGA_DUMPS_URL`, and
   `discogsFor()` passes the first, so `digga import …` reaches the fake too. `.env.example`
   lists them under "Development". They also serve a manual rehearsal against
   `tools/dev/fake-services.ts`.
2. **`digga serve` stops on request.** When started with an IPC channel, `cmdServe()` stops the
   server on a `shutdown` message or when the channel closes, as it does on `SIGINT` and
   `SIGTERM`. A CLI test pins that and the two lines the harness reads (`digga serving on <url>`,
   `library: <dir>`).
3. **`readSetup()` takes its free-space function as a dependency**, for the vitest case above.
4. **The loader commits and reports while it waits.** It committed every 500 kept releases and
   reported every 1,000 scanned releases once a second had passed, so while a download stalled,
   up to 499 kept releases stayed uncommitted and the progress stayed stale. The loader commits
   its pending batch and reports progress at least once a second while it runs. The setup then
   shows what has arrived during a slow download, and checkpoints give exact states.
5. **The markup changes** in the [dated markup audit](#markup-audit-recorded-through-2026-10-02).
6. **For Electron:** the main process honours `DIGGA_DATA_DIR`, `DIGGA_DUMPS_DIR`,
   `DIGGA_CONFIG_FILE` and the service URLs, as the CLI does; its `Secrets` lets `DISCOGS_TOKEN`
   win over the `safeStorage` token, as the CLI's does; it handles `window.open` with
   `setWindowOpenHandler` and `shell.openExternal`, and downloads in `will-download`; and quitting
   waits for `server.stop()`, which the plan's `before-quit` handler does not, so jobs end
   `cancelled` and the database closes. The app needs all of these anyway.

No product code exists only for tests, unless the Electron spike shows that packaged builds
ignore `-r` (see [Startup order](HARNESS.md#startup-order)).

The web spike built changes 1 and 2, and the markup its scenarios use: the slips' group names,
the last slip's `aria-busy`, and `data-release-id` and `data-triage-key` on the record's facts.
`createVideoTitleLookup()` now takes an options object with the oEmbed address.

The rest of the P0 set added more of item 5, and moved keys and copy the tests read into plain
modules, since Node imports neither a component nor a `.svelte.ts` module: the flash's `label`,
which names "Triage messages" and "Player notices"; `data-position` on the tracklist's track
rows; `PLAYER_STATUS_COPY` in `src/client/player/status.ts`; the header's pages and their keys
(`ROUTES`) in `src/client/routes.ts`; and the track-mark keys (`TRACK_MARK_KEYS`) in `keymap.ts`.

The first Triage P1 slice added `data-video-id` on the tracklist's "Other videos" rows. The second
needed no markup: its scenarios locate everything by role, name, `aria-keyshortcuts`, the
existing handles and visible text.

The Settings P1 slice added the rest of the Settings markup: `data-job-id` on the job rows, the
names of the five sections, and the two Settings bullets of accessibility bug 3 (see [Markup audit](AUTHORING.md#markup-audit)).

The Twelves P1 slice added `data-triage-key` and `data-release-id` on Twelves' rows,
`data-release-id` and `data-position` on the Tracks shelf's rows, and the pager's name of
accessibility bug 2 (see [Markup audit](AUTHORING.md#markup-audit)).

The setup path built items 3 and 4. `readSetup(deps, { freeBytes })` takes the dependencies it
reads (`db`, `paths`, `dataDumps`) and the free-space function, whose default is the download's
`freeBytesIn()`. In the loader, a timer reports whenever a second passes without a report, and
every scanning report commits the pending batch first, so what the progress says is in the
database; the batch size, the final flush, the dry run and the limit are as they were, and the
per-1,000 clock check is gone, since the timer covers it. A timed commit that fails ends the load
with its error, through the input stream. Its vitest cases are in `tests/dump-load.test.ts` and
`tests/growing-dump.test.ts`. The burn-in also found a race in the setup's job polling, fixed in
`src/client/setup/flow.svelte.ts` with `tests/setup-flow.test.ts` (see [The first-run setup path](#the-first-run-setup-path-web)). The setup needed no markup change.

The setup's steps 1 to 3 slice added the setup's part of accessibility bugs 3 and 4 for those
steps, the name "load to" (see [Markup audit](AUTHORING.md#markup-audit)), and moved the steps and their titles
(`SETUP_STEPS`) from the rune module `flow.svelte.ts` into the plain module
`src/client/setup/steps.ts`, which the page object imports.

## Original running plan

This records both implemented and proposed commands. Use the [current commands](../E2E_TESTING.md#running)
when running tests.

```sh
vp run e2e:smoke                 # @P0 on web-chromium
vp run e2e                       # @P0 and @P1 on web-chromium
vp run e2e -- --grep "@TRI-12\b"  # one scenario (without \b, @TRI-1 also selects TRI-10 to 19)
vp run e2e:nightly               # all but the contract checks, on the web projects
vp run e2e:electron              # the shared suite and ELEC-*, once the shell exists
vp run e2e:contract              # the real services, by hand only
```

The scripts build the client first (`vp build`): the app serves `dist/`, and E2E tests the
bundle a user runs. Every script passes `--config tests/e2e/playwright.config.ts`, except
`e2e:contract`, which passes the contract configuration. Playwright's browsers install with
`npx playwright install chromium` (`--with-deps` on Linux CI).

**Configuration.** `testDir: "specs"` and `testMatch: "**/*.e2e.ts"`, since `.e2e.ts` is outside
Playwright's default pattern. Tests end in `.e2e.ts`, so vitest's `tests/**/*.test.ts` never picks
them up. Scenario IDs and priorities are tags (`{ tag: ["@TRI-12", "@P0"] }`); `@web` and
`@electron` mark host-specific tests. `tsconfig.e2e.json` adds the DOM library for the fake YouTube
script and page objects, `tsconfig.node.json` leaves `tests/e2e/` to it, and the root
`tsconfig.json` references it, so `vp check` type-checks the suite. The lint override that exempts
`*.test.ts` from the length and complexity limits also covers `*.e2e.ts`. The test timeout is 30 s,
which covers fixture setup; setup journeys call `test.slow()`, and the host enforces the 15 s limit
on a server's stop itself.

```
tests/e2e/
  playwright.config.ts, playwright.contract.config.ts
  fixtures/     catalogue.ts, dump builder with checkpoints, history databases, decisions backups
  support/      test.ts (fixtures), global-setup.ts, spawn.ts, app.ts (the host interface, the
                API client and the clock), hosts/web.ts, hosts/electron.ts, electron-preload.cjs,
                templates.ts, fake-youtube.ts, guard.ts, browser-guard.ts, browser-log.ts (the
                page's requests and problems, and the declarations), fault-routes.ts,
                live-regions.ts (live regions inserted with their text)
  pages/        triage.ts, twelves.ts, settings.ts, setup.ts, header.ts, dialogs.ts
  specs/        guard, shell, setup, triage, triage-player, sandbox, twelves, settings,
                persistence, a11y, electron
  contract/     the real-service checks
tools/dev/fake-services.ts   the fakes, used by the harness and for rehearsals by hand
```

**Projects.** `web-chromium` runs every test not tagged `@electron`. `web-firefox` and
`web-webkit` join the nightly run once the Chromium suite has been stable for a few weeks.
Firefox and Safari get a cheap effort only, since Digga's main target is the Electron app (owner,
2026-10-02): fix what is quick, tag the rest as Chromium-only with the reason, and do no larger
product or harness work for those engines. The `closedby` fallback on dialogs is one thing to
check. `electron` runs every test not tagged `@web`.

**CI** (there is none yet; GitHub Actions is assumed): on each pull request, `vp run verify` and
`vp run e2e` on Ubuntu with Node 24, with the HTML report and failure artifacts uploaded; sharding
once the run exceeds its budget. `verify` includes `e2e:smoke`, so the CI's `e2e` step leaves out
`@P0` and the smoke set does not run twice. Nightly: P2, and once stable, the other browsers
and a burn-in with `--repeat-each=5`. With the shell: `electron` on macOS, Windows and Linux.

**Flakiness.** `retries: 0` locally. In CI `retries: 1` with `failOnFlakyTests: true`, so a test
that passes only on retry still fails the run and is reported as flaky. A new or changed spec
passes `--repeat-each=10` before it is committed.

**Budget.** About 150 scenarios. Most take 1 to 5 s including the server start; setup journeys
take 5 to 10 s, most of it waiting for the crate's 3 s reads of the records to dig. On four
workers the P0 and P1 sets should finish in about six minutes. In the spike a server started in
about 200 ms and stopped over IPC in about 5 ms, so per-test servers stay; the five spike
scenarios took 6.3 s on five workers. The P0 set with SETUP-01 takes 10.9 s, and all 17 tests
14.0 s; SETUP-01 sets the smoke set's pace. A slow suite is sharded.

## Runner choice on 2026-09-30

### Original comparison

Playwright Test is the only mainstream runner that drives both a browser and an Electron app
with the same `Page`, locator and assertion API (`_electron.launch()` returns an
`ElectronApplication` whose windows are ordinary `Page` objects). Electron runs Chromium, so the
web project on Chromium already exercises the engine the packaged app will use. Playwright also
brings what this app needs: web-first assertions that wait, `clock` for the player's 4 s listen and
the 10 s look-again timer, `route()` for fault injection at the transport, traces, ARIA
snapshots, `@axe-core/playwright`, and parallel workers. Pin a version of 1.52 or later, which
has `failOnFlakyTests`.

Alternatives considered:

- **Cypress** cannot drive an Electron app, runs inside the page and handles one tab. Rejected.
- **WebdriverIO with `wdio-electron-service`** can drive Electron, but the web and Electron
  suites would share less, and its tooling for tracing and ARIA queries is weaker. Rejected.
- **Vitest browser mode** tests components in a browser, not the app with its server and jobs. It
  can complement E2E later for component-level cases; it does not replace it.

`_electron` is marked experimental in Playwright's docs. Only the Electron host depends on it, so
a change in that API touches one module.

## Markup audit recorded through 2026-10-02

In short, the markup is already friendly to automation because it is accessible. Native
elements carry roles and names: `<dialog>` with `aria-labelledby` for the keys, the scope picker
and the practice card; labelled form fields in Settings and the setup; `<progress>` with names;
`<table>` with captions and header cells; `aria-current` for the page, the setup step, the playing
track and the selected Twelves row; `aria-keyshortcuts` on nearly every key-bound control;
`hidden` on the inactive Triage page, while the other pages are unmounted; `inert` player hosts.
Most tests can locate everything with `getByRole` and `getByLabel`.

The audit found four accessibility bugs, a few places where identity or state has no handle,
and some names that are missing or ambiguous.

### Accessibility bugs (fix regardless of testing)

1. **`src/client/setup/CrateStep.svelte`:** the section is `aria-labelledby="crate-title"`, but
   once the load is done the `h1#crate-title` is not rendered, so the region loses its name and
   the page has no `h1`. Keep an `h1` in both states: when the load is done, the headline
   paragraph ("The catalogue is in: …") becomes the `h1` with that id. The "ready to dig" stamp
   stays a `span`. Fixed in [the setup's remaining scenarios and the Accessibility family](#the-setups-remaining-scenarios-and-the-accessibility-family-web): the headline is `h1#crate-title`, so the
   region is named "The catalogue is in: …" (SETUP-23).
2. **`src/client/twelves/Pager.svelte`:** `<nav aria-label="Pages">` repeats the header's
   `<nav aria-label="Pages">`, so Twelves has two navigation landmarks with the same name. Name
   the pager "Shelf pages". Fixed in the Twelves P1 slice; TWL-03 reads the pager by that name.
3. **Field errors not tied to their fields.** AGENTS.md asks for `aria-invalid` on invalid fields
   and the message attached with `aria-describedby`.
   - The setup's token and username fields (`DiscogsStep.svelte`): a refused token or unknown
     user shows in the step's `role="alert"` paragraph, but the field gets no `aria-invalid` and
     does not reference the message. Set `aria-invalid` with the custom validity, clear both on
     input, and add the alert's id to `aria-describedby` after the hint. Fixed in the setup's
     steps 1 to 3 slice: after a refusal the field has the step's error as its custom validity,
     `aria-invalid="true"`, and `aria-describedby` with `discogs-error`, the alert, after its
     hint; editing the field, or the error clearing, removes all three (SETUP-09). The username
     field does the same after an unknown user, for which `flow.useUsername()` now says whether
     the profile was found; no scenario of the slice reaches it (SETUP-10 is P2).
   - The style search (`StylePicker.svelte`): "Pick at least one style" exists only in the native
     validation bubble, which disappears, and the field gets no `aria-invalid`. Render the message
     in an element the field references, after `style-search-hint`. Fixed in the same slice: the
     message is in `style-search-problem`, `hidden` while there is none, which the field
     references after its hint while it has the problem, with `aria-invalid`; a pick clears both
     (SETUP-16). Both components report through `reportProblem()` and `describedBy()` in
     `src/client/setup/field-problem.ts`, as Settings' fields report theirs.
   - Settings' `reportProblem()` sets the custom validity and `aria-invalid`, but the message
     appears only in the save bar's status, not attached to the field. Give each problem an
     element the field references, keeping its hint id. Fixed in the Settings P1 slice: the
     batch and seek step fields reference `…-batch-problem` and `…-seek-problem` after their
     hints, elements that show the field's message and are `hidden` while it has none (SET-03).
   - Settings' token field references its status line, but a refused token only adds the
     `problem` class; the field gets no `aria-invalid`. Fixed in the Settings P1 slice: the
     field has `aria-invalid="true"` while the status line says why the token was not saved
     (SET-08).
4. **Live regions inserted together with their text.** The setup's error paragraphs
   (`{#if flow.error}<p role="alert">` in each step), the space alert in `CatalogueStep.svelte`,
   the "Connected as" status in `DiscogsStep.svelte` and the "stopped loading" notice in
   `CrateStep.svelte` appear with their text, so screen readers may not announce them. Each
   region stays in the DOM, empty until it has something to say, and an error's field
   association is cleared with it. Fixed for steps 1 to 3 in the setup's steps 1 to 3 slice: the
   error paragraph of each step and the space alert are empty `role="alert"` paragraphs until
   they have text, and the "Connected as" status an empty `role="status"` until the account is
   connected, with the token form beside it. An empty paragraph takes no room: each step's
   alerts and buttons share a column whose alerts take a margin only when not `:empty`. SETUP-05,
   SETUP-08 and SETUP-09 check that their message's region was in the page before the message
   (`LiveRegionWatch`, see [Synchronisation](AUTHORING.md#synchronisation)); against the old markup all three failed. The
   crate's "stopped loading" notice and error paragraph were still inserted with their text. The
   notices later moved into a persistent `role="alert"` container (SETUP-25); in the setup's
   remaining scenarios slice the error paragraph became an empty `role="alert"` paragraph too, which
   SETUP-23 checks with `LiveRegionWatch` after a failed "Delete it".

Related, smaller:

- The header hides "verdicts are not saved" and the ETA with `display: none`, which also removes
  them from the accessibility tree. The visually hidden class would keep them for screen readers
  while the layout stays the same.
- The scope picker's Enter button and "Start digging", which Enter also starts, do not declare
  Enter in `aria-keyshortcuts`.

Both were fixed in [the setup's remaining scenarios and the Accessibility family](#the-setups-remaining-scenarios-and-the-accessibility-family-web): the header hides them as
`.visually-hidden` does (A11Y-06), and the dig button declares `Enter`, "Start digging" `T Enter`
(A11Y-05).

### Handles for identity and state

The rule: start with identity, which has no semantic equivalent, and add a state attribute only
where a scenario needs state that no role, name, ARIA attribute or text exposes. Values are the
domain's own (triage keys, release ids, track positions, video ids), not test ids. `data-*`
attributes are handles for tests; they do not replace the ARIA or text a screen reader needs.

**Identity:**

| Where                                              | Attributes                           |
| -------------------------------------------------- | ------------------------------------ |
| `triage/ReleaseFacts.svelte`, `<header>`           | `data-release-id`, `data-triage-key` |
| `triage/Tracklist.svelte`, each track row          | `data-position`                      |
| `triage/Tracklist.svelte`, each "Other videos" row | `data-video-id`                      |
| `pages/Twelves.svelte`, each `<tr>`                | `data-triage-key`, `data-release-id` |
| `twelves/TrackTable.svelte`, each `<tr>`           | `data-release-id`, `data-position`   |
| `pages/Settings.svelte`, each job `<tr>`           | `data-job-id`                        |

Twelves' rows got theirs in the Twelves P1 slice; the row of a verdict whose release is in no dump
has no `data-release-id`.

Pages need no handle: there is one `main`, the other pages are unmounted, and the hidden Triage
page drops out of role queries, so `getByRole("main")` scopes to the visible page.

**State.** No state attribute is needed. The slip's verdict and push state and the player's
status each have their own copy, one phrase per state: the slip uses `STATUS_COPY` from
`keymap.ts` and one sentence per push state, the player `PLAYER_STATUS_COPY` from
`src/client/player/status.ts`, a plain module beside the player, so tests import it as they import
`STATUS_COPY`. A test reads the player's status by its exact text within the Player region: the
region also says "Nothing playing" while it has no track, which contains "playing". Exact
text also tells the Twelves stamp "want" from the market cell's "1,210 want":
`getByText("want", { exact: true })` within the row.

Not added either, because something already exposes them: track state (each track's button
carries "playing", "has a video", "video would not play" or "no video" as text, and
`aria-current` on the playing one), job status (visible text in its cell), dumps (each Delete
button's name includes the file name), the header counts (their text), and queue loading
(`aria-busy`, below).

`data-testid` is not needed anywhere. If a future element has neither a role and name nor domain
identity or state to expose, a `data-testid` is the last resort, and the reason goes in a comment.

### Names

- **Settings sections** have `<h2>` headings but no accessible name, so they are not regions.
  `aria-labelledby` on the sections tests scope into (Sandbox, Library, Backups and exports,
  Discogs, Jobs) makes `getByRole("region", { name: "Jobs" })` work and gives screen-reader users
  landmarks on a long page. Discogs is inside the settings form; the form's other sections stay
  unnamed. Built in the Settings P1 slice.
- **The slips** (`Slip.svelte`): the last slip shows verdicts, passes, hidden labels and undos,
  so its name is "Last action". It becomes `role="group"` with that `aria-label`, keeping its
  `aria-live`. The next slip becomes a group labelled by its visible "Up next". A group gives the
  handle without adding landmarks, which a named `<section>` would.
- **The last slip is busy while its write is in flight.** It carries `aria-busy="true"` from the
  key press until the verdict's or the undo's request has been answered and the page has acted
  on the answer. Screen readers can wait for a confirmed action, and tests get the end of the
  work (see [Synchronisation](AUTHORING.md#synchronisation)). On a failed save the slip clears and the busy state goes with it.
- **`Flash.svelte`** takes an optional `label` for `aria-label`. The Triage screen has up to five
  `role="status"` regions: the header's announcement, the market line, the session flash, the
  player notice and, while it is open, the scope picker's status. Naming the flash ("Triage
  messages") and the player notice ("Player notices") lets a test assert on one of them.
- **The queue** (`.record` in `Triage.svelte`) gets `aria-busy` while the queue loads.
- **The years the load keeps** (`SoundStep.svelte`): the disclosure's fields read "load from" and
  "to", so with it open the step had two spinbuttons named "to". The second label holds a
  visually hidden "load", so it is "load to" for assistive technology and reads as before.
  Built in the setup's steps 1 to 3 slice (SETUP-15).

### Kept as they are

- `aria-keyshortcuts` is a stable locator for key-bound buttons: `[aria-keyshortcuts="A"]` finds
  the want button whatever its copy. Verdict buttons take the value from `src/client/keymap.ts`;
  other controls write it in the component.
- Twelves rows use `aria-current="true"` for the selection. A grid with `aria-selected` would be
  the fuller pattern, but J and K replace arrow-key navigation inside the table, and
  `aria-current` is accurate for "the current item of a set".
- The hardcoded ids in the setup (`id="token"`, `id="style-search"`, `practice-done-title`) are
  unique today. `$props.id()` would be safer if a component is ever mounted twice; tests do not
  use ids.

## Rollout recorded on 2026-10-02

0. **Spikes (one session each, independent).**
   - Web, done on 2026-09-30 (see [Spike results](HISTORY.md#spike-results)): `@playwright/test`; `spawnDigga()` with the
     isolated environment and the socket guard and its vitest test; the base route with
     `route.fetch()`; the fake YouTube script with its user-activation object; the `small` and
     `small-account` templates from a hand-written dump; GUARD-01, GUARD-02, SHELL-01, TRI-07 and
     TRI-10.
   - Electron, throwaway: a minimal main process that follows the plan's startup, outside the
     product. Check the preload's guard in the main process and in a worker it starts, the held
     first `loadURL()` (no request before release), routes, init scripts and the clock on
     `electronApp.context()`, the host-resolver switch, the safeStorage round trip with the
     keychain switches, `relaunch()`, and whether a packaged build honours `-r`. Record the
     results in [HISTORY](HISTORY.md) before the host interface is fixed.
1. **Harness.** The rest of product changes 1 to 5; the fake services with data.discogs.com,
   checkpoints and the rest of the Discogs API, moved to `tools/dev/fake-services.ts`; the `empty`
   and `bulk` templates; the rest of the host interface; page objects; the rest of the P0 set; the
   commands and the `tests/e2e/` layout in AGENTS.md. `e2e:smoke` joins `vp run verify` after it has
   passed a burn-in of `--repeat-each=20`, since `verify` must be green before every commit.
   Done on 2026-10-01: product changes 3 and 4; data.discogs.com in the fakes module with the
   listing, the checksum, holds at checkpoints and `failAfterBytes`; the checkpoint builder and the
   bulk catalogue; the `empty` template; the setup page object; the whole P0 set, which passed
   its burn-in; the layout in AGENTS.md. `e2e:smoke` joined `verify` on 2026-10-01, as the owner
   decided. The `bulk` template and `app.cli()` followed with Twelves' P1 set on 2026-10-01, and
   with the Shell, Sandbox and Persistence P1 sets the same day: the move of the fake services to
   `tools/dev/fake-services.ts`, which replaced the earlier dump-only tool and runs standalone
   for rehearsals; `restartServer()` in the web host; the dialogs page object (`pages/dialogs.ts`,
   the Keys dialog; the scope picker stays in `TriagePage`); and aborts that last until lifted.
   `503` for every request followed with the setup's steps 1 to 3, and a `Content-Length` other
   than the size, a wrong checksum and holds for one transfer with closing the gaps on 2026-10-02.
   Still to do: the rest of the Discogs API (the masters) and the practice card's page object,
   with the scenarios that need them.
2. **Coverage.** The P1 scenarios, axe scans, failure artifacts and the CI workflow. Started on
   2026-10-01 with the first half of Triage's P1 scenarios, the record, the player and the
   tracklist: TRI-01, TRI-03, TRI-04, TRI-05, TRI-06, TRI-11, TRI-17, TRI-18, TRI-26, TRI-27,
   TRI-28 and TRI-36 (see [The first Triage P1 slice](HISTORY.md#the-first-triage-p1-slice-web)). Triage's P1 set was done on 2026-10-01
   with the other half, the verdicts, the queue, scopes, the market, the seller and the wants:
   TRI-08, TRI-09, TRI-14, TRI-15, TRI-19, TRI-20, TRI-21 (with a gap), TRI-23, TRI-25, TRI-30,
   TRI-32, TRI-33, TRI-34, TRI-39, TRI-40 and TRI-42 (see [The second Triage P1 slice](HISTORY.md#the-second-triage-p1-slice-web)). With them
   came `expectExternalOpen()`, `diggaOptions.config`, `given.verdict()` and `given.sellerShop()`,
   and the fake's inventory. Settings' P1 set was done on 2026-10-01: SET-01, SET-02, SET-03,
   SET-04, SET-07, SET-16 and SET-20, then SET-08, SET-09, SET-10, SET-11, SET-13, SET-14 and
   SET-17 (with a gap; see [The Settings P1 slice](HISTORY.md#the-settings-p1-slice-web)). With them came the Settings page object,
   `expectDownload()` in the web host, `diggaOptions.environmentToken` and `dumpFiles`,
   `given.trackMark()`, the fake's lists, and the small catalogue's July and September dumps.
   Twelves' P1 set was done on 2026-10-01: TWL-01, TWL-02 (with a gap), TWL-04, TWL-05, TWL-06,
   TWL-12, TWL-13 and TWL-14, then TWL-07, TWL-09, TWL-10, TWL-11 and TWL-03 (see [The Twelves P1 slice](HISTORY.md#the-twelves-p1-slice-web)). With them came the Twelves page object's actions, the `bulk` template,
   `app.cli()`, `diggaOptions.decisionsBackup` with `fixtures/decisions.ts`, the fake's
   `GET /lists/{id}`, and the markup of accessibility bug 2. The P1 sets of Shell, Sandbox and
   Persistence were done on 2026-10-01: SHELL-03, SHELL-04, SHELL-05, SHELL-07, SHELL-09, SBX-02,
   SBX-03, SBX-04, SBX-05, SBX-07 and PER-05 (see [The Shell, Sandbox and Persistence P1 slice](HISTORY.md#the-shell-sandbox-and-persistence-p1-slice-web)).
   With them came `restartServer()`, the Keys dialog's page object, Settings' sandbox switch and
   Appearance actions, Triage's queue retry, and lasting aborts. The setup's P1 scenarios for
   steps 1 to 3, before the load starts, were done on 2026-10-01: SETUP-02, SETUP-03, SETUP-04,
   SETUP-05, SETUP-06, SETUP-07, SETUP-11, SETUP-15, SETUP-16, SETUP-17 and SETUP-30, then
   SETUP-08, SETUP-09, SETUP-13 and SETUP-14 (see [The setup's steps 1 to 3 P1 slice](HISTORY.md#the-setups-steps-1-to-3-p1-slice-web)). With them
   came the setup page object's actions for steps 1 to 3, `LiveRegionWatch`, the fake's `503`
   for every request and `dj`'s currency, and the markup of accessibility bugs 3 and 4 for those
   steps. The ten gaps were closed on 2026-10-02 (see [Closing the gaps](HISTORY.md#closing-the-gaps-web)): TRI-21, TWL-02 and
   SET-17 became normal tests, and SHELL-12 (P2), SETUP-24, SETUP-25 and SETUP-28 (P1), and
   SETUP-26, SETUP-29 and SETUP-32 (P2) were built with their fixes. Next: the setup's remaining P1
   scenarios, SETUP-22, SETUP-23, SETUP-27, SETUP-31 and SETUP-33, with the practice card's page
   object, accessibility bug 1 and the rest of the crate's part of bug 4 (its alerts are in the
   page before their text now); then the Accessibility family with axe. Still to do for the
   setup: its other P2 scenarios, SETUP-10, SETUP-12 and SETUP-20. Still to do for Triage,
   Settings, Twelves, Shell, Sandbox and Persistence: their P2 scenarios (for these three families
   SHELL-06, SHELL-08, SHELL-10, SHELL-11, SBX-06, PER-02 and PER-03), and in the fake the
   masters, when a scenario needs them.
3. **Breadth.** P2 scenarios, the contract configuration, and once the Chromium suite is stable,
   the Firefox and WebKit projects and the nightly burn-in. Optional: a few `toHaveScreenshot`
   checks of the main screens, on Linux only, where snapshot updates need a human review. The
   owner decided on 2026-10-02 to build every P2 scenario and then review the whole suite to
   consolidate it, rather than prune P2 first. Firefox and WebKit get a cheap effort only (see
   [Running](../E2E_TESTING.md#running)).
4. **Electron** (with session 7). Product change 6, the Electron host and preload, the ELEC
   scenarios, and the shared suite on the unpackaged app and the inspectable release candidate.

## Risks recorded on 2026-10-02

- **Per-test server processes** keep tests isolated but cost a Node start each, about 200 ms in
  the spike.
- **Real timers on the server.** The Discogs client's 1.1 s gap makes tests that touch Discogs
  several times slower. If the suite exceeds its budget, a `discogsMinIntervalMs` server option
  set by the harness would help, at the cost of not running production spacing in E2E. Measured
  in the second Triage slice: the gap binds only where requests follow each other at once, and
  costs about 6.6 s of that slice's 40 s of test time, 2.2 s each in the scenarios that read a
  seller's shop; a push after the 1.5 s grace does not wait for it.
- **Real disk space** stays a precondition of the run rather than something the tests control;
  see [Disk space](HARNESS.md#disk-space).
- **Fakes drift from the services.** The contract checks catch drift, but only when someone runs
  them.
- **Test-facing product surface:** two environment variables for service URLs, the IPC shutdown,
  the slip's `aria-busy`, and `DIGGA_E2E_HOLD` only if packaged builds ignore `-r`. The
  alternative, a test-only host that calls `createServer()` with a `fetchImpl`, would skip the
  CLI's boot and could not reach a packaged Electron app.
- **The Electron preload patches Electron's API** (`BrowserWindow.prototype.loadURL`, `shell`,
  `dialog`). A product change to how the window loads, such as `loadFile()`, needs the preload
  changed too; ELEC-13 fails first if it is not.
- **Playwright's Electron support** is experimental, and fuses and keychains limit what runs on
  release builds.
- **`verify` runs the smoke set.** The owner decided on 2026-10-01 that `e2e:smoke` joins
  `vp run verify`. `verify` now takes about 20 s instead of 9 s, and every machine that commits
  needs Playwright's Chromium (`npx playwright install chromium`).
- **Other browsers.** The owner decided on 2026-10-02 that Firefox and Safari get a cheap effort
  only, since the Electron app is the main target (see [Running](../E2E_TESTING.md#running)).
- **Open:** Is a CI provider other than GitHub Actions planned? Are visual snapshots wanted at all? What does the Electron app do when
  `safeStorage` cannot encrypt, as on Linux without a keyring: refuse to save the token, or save
  it with the plain-text key?

## Original fixture catalogue design

This snapshot includes an illustrative record, planned data and the original mistaken
description of `EVENT_HORIZON` as absent from the dump. The current catalogue contract is in
[FIXTURES](FIXTURES.md#the-fixture-catalogue).

### Catalogue before reconciliation

One typed module, `tests/e2e/fixtures/catalogue.ts`, describes every release, master, label,
artist, track and video the tests use. It is the single source for the dump files, the fake
Discogs API's release data and the fake YouTube player's titles and durations, so the three agree.
A small builder writes it as Discogs dump XML.

```ts
export const WORMHOLE = release({
  id: 1001,
  master: { id: 501, main: true },
  artists: ["Ed Rush (2)", "Optical"],
  title: "Wormhole",
  labels: [{ id: 77, name: "Renegade Hardware", catno: "RH 20" }],
  year: 2000,
  country: "UK",
  format: { name: "Vinyl", qty: 2, descriptions: ['12"'] },
  styles: ["Drum n Bass", "Techstep"],
  tracks: [track("A1", "Wormhole", "6:12"), track("B1", "Watermelon", "7:01")],
  videos: [video("wormhole-a1", "Ed Rush & Optical - Wormhole", 372)],
  market: { lowestPrice: 18.5, numForSale: 4, want: 1210, have: 890 },
});
```

**The small catalogue** has about 40 named records, each there for a reason: a label with
several records for the label sweep and `F`; a master with a main release without video and a
repress with one (pooled videos, decision 72); two releases sharing a tune on different masters
(heard greying); a compilation with track artists; a release without videos; one whose only
video YouTube refuses; one whose several videos all are refused; one with `embed="false"` from
the dump; a record with a run of tracks for `J`, `K`, `1` to `9` and a video's end;
`Not On Label (Dillinja Self-released)` for `X` and bracketed variants; undated records on a
label the account wants (decision 91); a record the seller `shopkeeper` has in a different
pressing from the main release; Jungle and House records for the style picker and census; a
release outside the default years for filter tests. The September dump adds three releases and
drops one, so a load of it has small exact "added" and "missing" counts, and puts one release that
had no master on a master (SET-21). Videos
that YouTube has and no release lists, one titled after a track that has none, are there to be
pasted (TRI-26), and one titled after the release without videos (TWL-14).

Records that only some scenarios reach sit on labels that sort after those of the first records,
so the default queue starts as before, and a scenario digs them with `diggaOptions.labels`. The
catalogue names the records that scenarios refer to (`FIRST_RECORD`, `TRACK_RUN`,
`SAME_TUNE_ELSEWHERE` and so on) and says in a comment which scenarios they serve. Built so far:
20 releases in the August dump, of which Twelves' scenarios name `THIRD_RECORD`, `IN_COLLECTION`,
`ON_WANTLIST` (on `dj`'s wantlist, so a want of it given in Digga is on the wantlist) and
`EVENT_HORIZON`, the release in no dump (see [The first Triage P1 slice](HISTORY.md#the-first-triage-p1-slice-web) and [The second Triage P1 slice](HISTORY.md#the-second-triage-p1-slice-web)), and the September dump (`SMALL_SEPTEMBER`): the August releases but
"Brass Knuckle" (1902), and three releases on "Upfront Audio", a label that sorts after every
other (`SEPTEMBER_ADDITIONS`). The templates load August only, so "Added by the last dump load"
offers every record still to dig, as TRI-20 expects. data.discogs.com lists September for SET-17,
whose update adds 3 releases and does not find 1; a held transfer stops at its `part-way`
checkpoint, after 10 releases. A July dump with August's releases exists only as a file in a
dumps folder (SET-16). `smallDump(month)` builds each once per worker (`fixtures/dump.ts`). Tracks can
credit their own artists, as a compilation does, and the builder writes "Various" with Discogs'
id 194, which Digga does not offer to dig. Every release has the same market data in the fake
(`MARKET` in `tools/dev/fake-services.ts`); per-release prices wait for a scenario that compares two.

**The bulk catalogue** has 1,500 generated Drum n Bass records from 1998 to 2002 on vinyl,
deterministic from a seed, on 30 labels no other fixture uses, in id order as in a Discogs dump,
so more than 500 records to dig arrive in the first 40% of the file. The generated releases have
no master and match the picks the setup scenarios make (Drum n Bass, the census's middle years,
vinyl), so each is one record to dig. Releases in other styles, which the census and the filter
preview need, join when a scenario needs them; the setup scenarios need none. The dump is 81 KB
and is built in memory once per worker, in about 25 ms (see [The first-run setup path](HISTORY.md#the-first-run-setup-path-web)).

**Checkpoints.** The builder (`fixtures/dump.ts`) compresses the dump with a full flush at named
points, `100-to-dig` and `600-to-dig`, and records for each its compressed offset, the number of
records to dig before it and the last release before it. It deflates each part on its own; a
full flush resets the compressor, so these are the bytes a gzip stream flushed with
`Z_FULL_FLUSH` between the parts would write. A gunzip stream given the bytes up to a full flush yields all the
XML before it, so at a held transfer the loader has parsed every release before the point. The
loader then commits them and reports progress within a second (product change 4), and tests
wait for the recorded count in the UI or `/api/stats` before they release the transfer. The fake
data.discogs.com holds and releases transfers (see [The fake services](FIXTURES.md#the-fake-services)). The runs confirmed all
of this; see [The first-run setup path](HISTORY.md#the-first-run-setup-path-web).

Video ids follow YouTube's 11-character shape (`[\w-]{11}`, which `deck.ts` checks). A prefix
tells the fake player how to behave: `e150…` refuses with error 150, `e100…` with 100, anything
else plays.
