# E2E fixtures and fake services

Read this when changing fixture data, fake behavior or a manual rehearsal. Start with the [E2E guide](../E2E_TESTING.md)
and its binding rules. For process isolation, also read the [harness](HARNESS.md).

## Libraries

Building a library through the real loader for every test would cost seconds. A few templates
are built once per run with the real CLI, against their own fake services, and each test copies
one. A worker-scoped fixture builds a template the first time a test asks for it, so
`e2e:smoke` does not pay for `bulk`. It builds in a folder of its own and renames it into place;
a worker that finds the template already there discards its copy. A template is published only
after each of its CLI commands has exited successfully, which also means SQLite has
checkpointed the WAL and closed the file; it is read-only afterwards. A test never copies a
database that a process still has open.

| Template        | Built with                                                                           | Used by                            |
| --------------- | ------------------------------------------------------------------------------------ | ---------------------------------- |
| `empty`         | nothing, not even a config file                                                      | the setup                          |
| `small`         | `dump load` of the August small dump                                                 | Triage, Twelves, Settings          |
| `small-account` | `small`, then `import collection` and `import wantlist` for `dj`; username in config | wantlist, Maybe list, seller tests |
| `bulk`          | `dump load` of the bulk dump                                                         | paging, strategies                 |

There is no cache across runs; [historical measurements](HISTORY.md#the-twelves-p1-slice-web)
record the build costs. The bulk dump has the September small dump's name, so the `bulk`
build writes it into a fixtures folder of its own. If
a larger catalogue makes the build slow, a cache keyed by a hash of every input (the catalogue,
the fake services, the migrations, the loader, the importers and the CLI) can follow, still
published only after success.

Per-test state goes on top, through documented paths only:

- **Config.** `empty` has no config, so the first start creates it from the schema defaults with
  the sandbox on, as for a real new user. For the loaded templates the host writes
  `digga.config.json` from `DEFAULT_CONFIG` with the test's overrides, `sandbox: false` unless the
  test asks for the sandbox, since the setup turns it off and live mode is the path most digging
  takes. A test that needs live given state and then the sandbox turns the sandbox on in
  Settings, as SET-20 does. `diggaOptions.labels` digs only the labels it names: the config leaves every other label
  of the small catalogue out (`filters.excludeLabels`), as `X` would, so a test reaches the
  records it is about without digging past others. `diggaOptions.config` changes any other
  setting, section by section (`{ queue: { limit: 5 } }`), typed against `Config`; the host
  merges it into the copied config and parses the result with `ConfigSchema`, so a value the app
  would refuse fails before the server starts. One function writes all of it, before the server
  starts, so a test's config has a single source.
- **Credentials.** Templates hold none. The `small-account` build passes `DISCOGS_TOKEN` to its
  import commands only. A test that wants a saved token calls `app.given.savedToken(token)`,
  which goes through `PUT /api/discogs/token` before the page opens, so the token lands wherever
  the host's `Secrets` keeps it: `secrets.env` in the web app and, in the [Electron plan](ELECTRON.md), `safeStorage`. The
  environment token is `DISCOGS_TOKEN`; the planned Electron `Secrets` must give it the same
  precedence as the CLI's. A test asks for it with `diggaOptions.environmentToken`, which the
  fixture passes to the server only when it starts with `e2e-` (SET-09).
- **Decisions.** `app.given` writes verdicts, track marks and listens through the app's own
  `/api` before the page opens. The server refuses digging writes while the sandbox is on, so
  `given` writes with the sandbox off and switches it on afterwards when the test asks for it.
  Available helpers: `given.listen()`, `given.verdict()`, which takes the verdict's `decidedAt` so a
  test can date its snoozes in order, `given.verdicts()` for several, and `given.trackMark()`.
  `datedVerdicts()` in `fixtures/decisions.ts` dates a list of verdicts a day apart, the first one
  newest, so Twelves' newest-first order is the list's order whatever the clock says.
- **Dump files.** `diggaOptions.dumpFiles` names small dumps by month (`july`, `august`,
  `september`), which the fixture writes into the library's dumps folder before the server
  starts (SET-16). The templates load their dump from a fixtures folder of their own, so a test's
  dumps folder is otherwise empty.
- **Jobs as given state.** A seller's shop is read through the job Settings' "Read shop" starts
  (`POST /api/jobs/import/seller`), and `given.sellerShop()` returns once `GET /api/jobs/:id`
  says `done`; a job that ends otherwise fails the test with its error.
- **Bulk decisions** (1,200 verdicts for paging) go through `digga restore` with a generated
  decisions backup, the documented restore path. `diggaOptions.decisionsBackup` takes the backup
  (`fixtures/decisions.ts` builds one in the format of `src/shared/decisions-backup.ts` and writes
  it with the server's own `formatDecisionsBackup()`), and the fixture runs `digga restore` on the
  test's library before the server starts. Restoring while the server runs would work at the
  SQLite level (WAL, a 5 s busy timeout, and an online backup for the copy `cmdRestore` takes
  first), but the README tells users to stop the server before a restore, and the server's start
  writes the day's database copy to the same `digga-YYYY-MM-DD.sqlite.partial` path the restore's
  copy uses, so a restore straight after the start could interleave the two writes. Restoring
  first follows the documented path and has no such window; `app.cli()` stays for commands that
  run beside the server.

- **Browser history.** `diggaOptions.browserHistory` writes a history database for each browser
  it names into the fake home before the server starts, and `diggaOptions.unreadableBrowsers`
  takes the permissions from a browser's folder once the server runs (see
  [Browser history](#browser-history)).

Tests never open the SQLite file. Assertions read the UI first and the public API second
(`/api/twelves`, `/api/stats`, `/api/export/decisions.json`), which keeps them independent of the
schema and lets the Electron host run them unchanged.

## The fixture catalogue

[catalogue.ts](../../tests/e2e/fixtures/catalogue.ts) is the source for releases, labels,
masters, artists, tracks, videos and accounts. Its `FixtureRelease` type and named records
are the examples to follow. The dump builder, fake Discogs API and fake YouTube player read
this module, so their identities, titles and durations agree.

The August `SMALL` dump has 20 releases. Names such as `FIRST_RECORD`, `TRACK_RUN` and
`SAME_TUNE_ELSEWHERE` describe the role of a record, and source comments name its scenarios.
Records needed by later scenarios use labels that sort after the original records; use
`diggaOptions.labels` to reach them without changing the earlier queue. The catalogue covers
label sweeps, shared tunes, compilations, missing and refused videos, embedding disabled in
the dump, track navigation, self-released labels, seller pressings and out-of-range years.
Add the remaining planned cases with the [scenarios that need them](PLAN.md#remaining-web-p2-coverage).

`THIRD_RECORD`, `IN_COLLECTION`, `ON_WANTLIST` and `EVENT_HORIZON` are in `SMALL`.
`NOT_IN_ANY_DUMP` is the account's wanted release missing from every dump. A verdict given for
`ON_WANTLIST` is already on the wantlist because the imported seed establishes that state;
a verdict given only through `/api/verdicts` does not establish Discogs membership.

The monthly dumps have distinct roles:

| Dump      | Contents and use                                                                                                      |
| --------- | --------------------------------------------------------------------------------------------------------------------- |
| July      | August's releases, present only as an older file for Settings' dump management                                        |
| August    | The `small` and `small-account` templates' input; all remaining records count as added by the last load               |
| September | August minus Brass Knuckle (1902), plus three `SEPTEMBER_ADDITIONS` on Upfront Audio; `PULSAR_REMIXES` gains a master |

`smallDump(month)` in [dump.ts](../../tests/e2e/fixtures/dump.ts) builds each once per worker.
SET-17 lists September, whose update adds three releases and does not find one; SET-21 checks
the changed master key. September's `part-way` checkpoint follows ten releases. Compilation
tracks can credit their own artists; the builder writes Various as Discogs artist 194, which
Digga does not offer as an artist to dig. All releases use `MARKET` in the fake; per-release
prices can be added when a scenario needs to compare them.

`YOUTUBE_ONLY` supplies videos that no release lists: one matches the first record's unlinked
track, one matches no track, and one matches the release without videos. Video IDs have
YouTube's 11-character shape (`[\w-]{11}`), checked by `deck.ts`; prefixes `e150` and `e100`
make the fake refuse playback with the corresponding error, while other IDs play.

The bulk catalogue has 1,500 generated Drum n Bass vinyl releases from 1998 to 2002 on 30
otherwise unused labels, deterministic from a seed and in ID order. They have no masters and
match the setup's selected styles, census years and format, so each contributes one record
to dig. More than 500 arrive in the first 40% of the dump. The roughly 81 KB gzip is generated
in memory once per worker. Other styles are added only when coverage needs them.

### Dump checkpoints

The builder compresses independent parts with full flushes at `100-to-dig` and `600-to-dig`.
Each checkpoint records its compressed offset, record count and last release. Resetting the
compressor at each part produces the bytes a gzip stream flushed with `Z_FULL_FLUSH` would
write. Gunzip given bytes through a checkpoint emits every preceding release.

The loader commits and reports at least once a second while waiting for more bytes. A timed
report commits its pending batch first, so reported progress is in SQLite. Scanning still
commits full batches; final flush, dry-run and limit behavior are unchanged. A timed commit
failure ends the load through its input stream. The regression cases are in
[tests/dump-load.test.ts](../../tests/dump-load.test.ts) and
[tests/growing-dump.test.ts](../../tests/growing-dump.test.ts).

Wait for the committed count through the UI or `/api/stats` before releasing the transfer.
The fake's sent-byte count or byte rate does not prove that the loader committed, and a page
clock cannot advance the worker. [Historical measurements](HISTORY.md#the-first-run-setup-path-web)
record the checkpoint validation and costs.

### Browser history

[history.ts](../../tests/e2e/fixtures/history.ts) writes the databases the setup finds and the
history import reads (`discoverHistoryFiles()` and `readHistoryUrls()` in
`src/server/importers/history.ts`). The folders are written out per platform in the fixture,
not taken from the importer, so a change to where Digga looks fails the tests:

| Browser | Folder Digga lists, on macOS                              | On Linux                              | On Windows                                            |
| ------- | --------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------- |
| Brave   | `Library/Application Support/BraveSoftware/Brave-Browser` | `.config/BraveSoftware/Brave-Browser` | `AppData/Local/BraveSoftware/Brave-Browser/User Data` |
| Chrome  | `Library/Application Support/Google/Chrome`               | `.config/google-chrome`               | `AppData/Local/Google/Chrome/User Data`               |
| Firefox | `Library/Application Support/Firefox/Profiles`            | `.mozilla/firefox`                    | `AppData/Roaming/Mozilla/Firefox/Profiles`            |

The fixture writes Chromium's history as `Default/History` and Firefox's as
`e2e.default-release/places.sqlite` inside that folder, under the fake home.

A Chromium history is the `urls` table with `last_visit_time` in microseconds since 1601, and
Firefox's the `moz_places` table with `last_visit_date` in microseconds since 1970; each has the
columns Digga reads and a few that Chrome and Firefox also have. `releaseVisit(release, time)` is
a visit to the release's page on discogs.com, as a browser records it. The databases are opened
through `openDb()` with `foreign: true`, so the native module stays behind `db/db.ts`, and are
not in WAL mode, so a copy of the one file is complete.

`lockBrowserFolder()` sets the browser's folder, the one Digga lists profiles from, to mode
`000`, as macOS answers a process without Full Disk Access: Digga finds the folder and cannot
list it, so the setup lists the browser as unreadable. It locks after the server has started and
gives the permissions back before the test's folder is deleted. It means nothing on Windows or
to root, so SETUP-12's test of it skips there.

## The fake services

The server talks to three external HTTP services. E2E replaces each with a fake served by one
`node:http` server inside the Playwright worker, started per test on `127.0.0.1:0`. Running it in
the worker, not in the app, means the fakes work unchanged when the app is an Electron process,
need no native module, and let tests read and change their state as typed objects.

The implementation is [tools/dev/fake-services.ts](../../tools/dev/fake-services.ts).
For use outside the harness, follow [Manual rehearsals](#manual-rehearsals).

The module imports the catalogue and the dump types from `tests/e2e/fixtures/`. That direction
is acceptable: both folders are for development only, nothing in `src` imports either and
neither ships, and the fixtures import nothing from the harness or from `tools`, so there is no
cycle. The catalogue belongs to the suite, whose scenarios name its records; moving it under
`tools/` would only make the tests read their own data from a tool's folder. `vp check`
type-checks the module twice, in the node project (`tools/**`, which pulls the fixtures in) and
in the e2e project through the harness's imports, and `check:portability` scans `tools/`.

Digga's own `/api` is never faked. Tests reach a state by driving the real server into it. The
only exception is transport failure: a `route()` can abort or delay one request to test the "did
not load" and "not saved" states, since a real server does not fail on demand.
`app.abortRequests({ method, path }, { times })` registers such a route on the context; the test
declares the abort and the console error it causes with `app.expectProblems()`. With
`times: Infinity` the route aborts every match until the test calls `lift()` on the handle it
returns, for requests whose number the page's polling makes unknown (SHELL-07). Every abort is
still recorded and must be declared.

### Discogs API

Implemented requests for `https://api.discogs.com`, as used by
`src/server/discogs/client.ts`. `GET /masters/{id}` is planned and must be added with the
scenario that needs it; an unimplemented request fails as unplanned.

| Request                                        | Fake behaviour                                                                               |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `GET /oauth/identity`                          | The account the token names; `401` for a refused or missing token                            |
| `GET /users/{u}`                               | Profile with `num_collection`, `num_wantlist`, `curr_abbr`; `404` for unknown users          |
| `GET /users/{u}/collection/folders/0/releases` | Pages of `basic_information` from the account's collection, honouring `per_page`             |
| `GET /users/{u}/wants`                         | Pages of the wantlist, including releases that are not in any dump                           |
| `PUT /users/{u}/wants/{id}`                    | Adds to the wantlist and stores the `notes`; `401` or `403` when the token is another user's |
| `DELETE /users/{u}/wants/{id}`                 | Removes; `404` when absent (the client counts that as removed)                               |
| `GET /users/{u}/inventory`                     | Pages of For Sale listings for a seller                                                      |
| `GET /users/{u}/lists`, `GET /lists/{id}`      | The account's lists, private ones only for its own token, and their items                    |
| `GET /releases/{id}?curr_abbr=`                | Market data and videos from the catalogue, price in the asked currency; `404` when asked     |

The accounts and lists are declared in the catalogue:

- `dj` has one collected release, two wants (one absent from every dump), and GBP as its
  profile currency instead of the config's EUR. SETUP-08 reads that currency from the profile.
- The private Maybe list 9001 contains the first two small records; the public Played out
  list 9002 is empty. List enumeration and list contents are each one page. Private lists are
  visible only to their owner's token; fetching one with another token returns `404`.
- `shopkeeper` has two For Sale listings on one page: a repress of a loaded master and a
  release absent from every dump.

With three imported releases, the setup uses the census for its default years (SETUP-14).
The imported year-span policy remains a unit test in `tests/setup-model.test.ts`. Historical
plans for larger accounts are superseded by these fixtures.

Tokens: `e2e-token-<username>` identifies as that user; `e2e-token-refused` gets `401`. Any token
not starting with `e2e-` makes the fake fail the test with "a non-test token reached the fake",
so a real token that leaks into a test run is caught instead of logged. The fake also checks the
`User-Agent` header the transport sends. Every response carries
`X-Discogs-Ratelimit-Remaining: 59`; the 60 s pause at `<= 1` stays a vitest concern.

### data.discogs.com

The fake serves the `?prefix=data/` and `?prefix=data/2026/` listing pages, file sizes,
`CHECKSUM.txt`, and dump downloads with `Content-Length`, as
`src/server/discogs/data-dumps.ts` reads them.

| Control on `fakes.dumps`            | Behavior                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `diggaOptions.listedDump`           | Selects the bulk or small September dump before the app's first request; without it the listing answers `404` |
| `list(dump, { listedBytes })`       | Overrides the listed size; `null` means no size                                                               |
| `holdAt(name)` and `release(name?)` | Hold at a checkpoint, then release to another checkpoint or the end                                           |
| `holdAt(name, { transfer: 2 })`     | Holds only the named transfer, for example the retry after a checksum mismatch                                |
| `set({ failAfterBytes })`           | Fails the transfer after the specified byte count                                                             |
| `set({ unavailableStatus: 503 })`   | Returns `503` for every dump-service request until reset to `null` (SETUP-04)                                 |
| `set({ bytesPerSecond })`           | Controls transfer speed for standalone rehearsals; tests synchronize on checkpoints                           |
| `set({ contentLength })`            | Overrides the transfer's announced size; `null` uses the dump's size (SETUP-32)                               |
| `set({ wrongChecksums: N })`        | Gives a wrong hash on the next N reads of `CHECKSUM.txt` (SETUP-26); standalone mode has `--wrong-checksums`  |
| `transfers`, `sentBytes`            | Count transfers started and bytes sent so far                                                                 |

Set listing changes before opening the page: the server first reads the listing for
`GET /api/setup` and caches success for an hour. It does not cache failures, so SETUP-04's
Try again reads the recovered listing. A listed dump is a `DumpSource`: `memoryDump()` wraps
one from the builder and `fileDump()` reads one from disk. Add controls with the scenarios
that need them.

A transfer can be held at a checkpoint and released, to the end or to the next checkpoint:

```ts
const point = fakes.dumps.checkpoint("100-to-dig");
fakes.dumps.holdAt(point.name);
// ... the setup starts the download; the load reads what has arrived ...
await setup.waitForRecordsToDig(point.recordsToDig);
fakes.dumps.release("600-to-dig"); // or release() for the rest of the dump
```

The byte rate is for realism, never for synchronisation: it does not say when
the loader's worker has committed what it read, and a browser clock cannot hurry the worker.
Tests wait for the committed state through the UI or `/api/stats`, then release.

### YouTube oEmbed

`https://www.youtube.com/oembed`: the title the catalogue gives a video id,
else `404`, with an optional delay past the server's 4 s lookup timeout.

### Fault injection

Fault injection is the same for every API route:

```ts
fakes.fail("PUT /users/:user/wants/:id", { status: 500, times: 1 });
fakes.delay("PUT /users/:user/wants/:id", { ms: 2000 });
fakes.dumps.set({ failAfterBytes: 400_000 });
```

A delay is for realism. A test that needs a request to stay in flight while it acts holds the
request instead:

```ts
const push = fakes.hold("PUT /users/:user/wants/:id");
// ... the app pushes ...
await push.received; // the request has reached the fake and waits
// ... the test acts while the push is in flight ...
push.release();
```

### Request log

The request log records method, path, query, whether the request was authenticated, the JSON
body, when the request arrived and when the fake answered. Tests read it after the app's own
request to the server has completed (see [Synchronisation](AUTHORING.md#synchronisation)):

```ts
await expect
  .poll(() => fakes.requests("PUT /users/dj/wants/:id"))
  .toEqual([
    expect.objectContaining({
      params: { id: "1001" },
      body: { notes: "grail A1; bought at Ninja" },
    }),
  ]);
```

## The fake YouTube IFrame API

`src/client/player/youtube.ts` loads `https://www.youtube.com/iframe_api` only when `window.YT`
has no `Player` yet. The host defines `window.YT` in an init script before any app code runs, so
no product code changes. The fake implements the slice of the API `YTPlayer` declares:

- `new YT.Player(slot, options)` replaces the slot with an iframe titled after its video id
  whose `srcdoc` holds a focusable button, as the real API replaces it with a focusable iframe.
  Only the host's `inert` keeps focus out of it, so A11Y-02 fails if `inert` is lost. `onReady`
  fires on the next task.
- `cueVideoById` sets `CUED` and keeps its `startSeconds`; a later `playVideo()` starts there.
  The first record's video arrives this way, and Space plays it (`deck.ts`). `loadVideoById`
  sets `BUFFERING`, then `PLAYING` after 50 ms, starting at `startSeconds`. The app reads state
  only from `onStateChange`, so every change fires it.
- Without user activation an unmuted `loadVideoById` or `playVideo` stays `UNSTARTED`, which is
  how browsers block sound. Muted playback starts without activation, as browsers allow.
- Time advances from `performance.now()` while `PLAYING`, so the clock controls it, and the player
  moves to `ENDED` at the video's duration (from the catalogue, else 300 s).
- `seekTo`, `mute`, `unMute`, `pauseVideo`, `stopVideo`, `getCurrentTime`, `getDuration`,
  `getPlayerState` and `destroy` behave as documented.
- Video ids with an `e150` or `e100` prefix fire `onError` with that code after loading, and
  `getVideoData()` reports the refused id, as the real player does (decision 42). The app shows a
  notice only for the audible deck, so a scenario about the notice puts the refused video where
  it plays; errors on the hidden decks are silent. The hidden decks load the next release's first
  video and `J`'s next track before either plays, so they find a refused catalogue video first,
  unless it is the first video a page plays. TRI-28 therefore refuses the playing video with
  `fail(videoId, 150)`.

**User activation.** The app decides between playing and waiting for Space from
`navigator.userActivation.hasBeenActive` (`triage-player.svelte.ts`). In Chromium every Playwright
call that evaluates in the page, `expect(locator)` and `locator.textContent()` included, runs as a
user gesture and sets that flag. The spike measured more: a fresh page starts inactive, and the flag
is set about 9 ms after `page.goto()` with no test action at all, so under Playwright the real flag
is practically always set and the app would never wait for Space. The init script therefore replaces
`navigator.userActivation` with an object the harness owns. It turns active on the first trusted
`keydown` other than Escape, or the first `pointerdown`, which is what the HTML standard counts as
activation. The app and the fake player read the same flag. The planned other browser hosts
and Electron reuse it; Electron's planned `autoplayPolicy` does not change the flag. If the Electron shell later skips the Space step
because it may autoplay, TRI-02 gets an Electron variant.

`window.__fakeYouTube` lets tests read and drive it: `players()` lists each player's video,
state, time and muted flag; `audible()` returns the video playing with sound; `loads()` lists
every `loadVideoById` and `cueVideoById` call with its `startSeconds`, which shows whether the
next release and the next track were preloaded muted; `end()` ends the audible video;
`fail(videoId, code)` refuses a video at runtime; `blockSound()` keeps unmuted playback
`UNSTARTED` although the page has activation, as a browser that blocks autoplay does.
`app.youtube` wraps these calls.

## Manual rehearsals

`tools/dev/fake-services.ts` also runs standalone (`node
tools/dev/fake-services.ts [<dump>] [--port 4567] [--mbps 40] [--checksum <sha256>]
[--wrong-checksums 0]`), for
rehearsing the setup by hand: it serves the Discogs API and oEmbed from the catalogue, so a
rehearsal can use `e2e-token-dj`, and data.discogs.com with a dump file from disk, which may be
10 GB, read a chunk at a time and sent at the set rate in MiB per second. `--wrong-checksums N`
names another hash in the first N reads of `CHECKSUM.txt`. Without `--checksum` it
hashes the file first. It prints the three addresses to start Digga with (`DIGGA_DUMPS_URL`,
`DIGGA_DISCOGS_API_URL`, `DIGGA_YOUTUBE_OEMBED_URL`), and each request and each problem, such as
a token that does not start with `e2e-`, as it happens. Outside the harness no guard refuses a real host, so a rehearsal
checks that all three addresses point at it before starting Digga, in the environment the process
receives (print it with the same command line first), and loads the harness's guard:
`NODE_OPTIONS=--import=<repo>/tests/e2e/support/guard.ts` with `DIGGA_E2E_ALLOWED_PORT` set to
the fakes' port. The fakes never answer with a redirect.

Always use a throwaway library, dumps directory, config and working directory with no `.env`.
Build the environment from an allowlist as [spawnDigga does](HARNESS.md#launching-processes),
including a fake home. Verify that every path and all three service URLs are applied to the
actual process. Pass each environment assignment as its own argument; do not rely on shell
word splitting of a variable containing assignments. A fake service by itself does not isolate
Digga's paths or its other network requests. The
[earlier rehearsal incident](HISTORY.md#the-setups-steps-1-to-3-p1-slice-web) records why these
checks and the guard are required.
