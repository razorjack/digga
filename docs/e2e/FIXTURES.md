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

There is no cache across runs: the spike built `small` in 0.2 s and `small-account` in 0.4 s,
and `bulk` builds in 0.42 s. The bulk dump has the September small dump's name, so the `bulk`
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
  the host's `Secrets` keeps it: `secrets.env` in the web app, `safeStorage` in Electron. The
  environment token is `DISCOGS_TOKEN` in both hosts; the Electron `Secrets` must give it the
  same precedence as the CLI's. A test asks for it with `diggaOptions.environmentToken`, which the
  fixture passes to the server only when it starts with `e2e-` (SET-09).
- **Decisions.** `app.given` writes verdicts, track marks and listens through the app's own
  `/api` before the page opens. The server refuses digging writes while the sandbox is on, so
  `given` writes with the sandbox off and switches it on afterwards when the test asks for it.
  Built so far: `given.listen()`, `given.verdict()`, which takes the verdict's `decidedAt` so a
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

Tests never open the SQLite file. Assertions read the UI first and the public API second
(`/api/twelves`, `/api/stats`, `/api/export/decisions.json`), which keeps them independent of the
schema and lets the Electron host run them unchanged.

## The fixture catalogue

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
data.discogs.com holds and releases transfers (see [The fake services](#the-fake-services)). The runs confirmed all
of this; see [The first-run setup path](HISTORY.md#the-first-run-setup-path-web).

Video ids follow YouTube's 11-character shape (`[\w-]{11}`, which `deck.ts` checks). A prefix
tells the fake player how to behave: `e150…` refuses with error 150, `e100…` with 100, anything
else plays.

## The fake services

The server talks to three external HTTP services. E2E replaces each with a fake served by one
`node:http` server inside the Playwright worker, started per test on `127.0.0.1:0`. Running it in
the worker, not in the app, means the fakes work unchanged when the app is an Electron process,
need no native module, and let tests read and change their state as typed objects.

The module is `tools/dev/fake-services.ts`. The same module also runs standalone (`node
tools/dev/fake-services.ts [<dump>] [--port 4567] [--mbps 40] [--checksum <sha256>]
[--wrong-checksums 0]`), for
rehearsing the setup by hand: it serves the Discogs API and oEmbed from the catalogue, so a
rehearsal can use `e2e-token-dj`, and data.discogs.com with a dump file from disk, which may be
10 GB, read a chunk at a time and sent at the set rate in MiB per second. `--wrong-checksums N`
names another hash in the first N reads of `CHECKSUM.txt`. Without `--checksum` it
hashes the file first. It prints the three addresses to start Digga with (`DIGGA_DUMPS_URL`,
`DIGGA_DISCOGS_API_URL`, `DIGGA_YOUTUBE_OEMBED_URL`), and each request and each problem, such as
a token that does not start with `e2e-`, as it happens. It replaced an earlier tool that served
the dump alone. Outside the harness no guard refuses a real host, so a rehearsal
checks that all three addresses point at it before starting Digga, in the environment the process
receives (print it with the same command line first), and loads the harness's guard:
`NODE_OPTIONS=--import=<repo>/tests/e2e/support/guard.ts` with `DIGGA_E2E_ALLOWED_PORT` set to
the fakes' port. A rehearsal whose environment did not apply reached the real data.discogs.com and
the default library once (see [The setup's steps 1 to 3 P1 slice](HISTORY.md#the-setups-steps-1-to-3-p1-slice-web)). The fakes never answer with a
redirect.

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

**Discogs API** (`https://api.discogs.com`), every endpoint `src/server/discogs/client.ts` calls:

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
| `GET /masters/{id}`                            | The master's main release                                                                    |

State: accounts (`dj` with a collection of 1, a wantlist of 2 including one release in no dump,
a private "Maybe" list 9001, a public list 9002 and GBP as its currency), a seller `shopkeeper`
whose shop has a repress of a loaded master and a release in no dump, and the catalogue's
releases. Built so far: every request in the table but `GET /masters/{id}`, which waits for a
scenario that reaches it; `dj`'s lists are the private list "Maybe" (9001), which holds the first
two records of the small catalogue, and the public list "Played out" (9002), which is empty. The
design gave `dj` a collection of 5 and a wantlist of 6; the scenarios built since use 1 and 2
(`small-account`, Twelves' shelves, the imports' counts), and nothing needs more, so the design
follows the account (SETUP-08's row too). With 3 imported releases the setup's years come from
the census rather than the imports (SETUP-14); the imported span stays a vitest case
(`tests/setup-model.test.ts`). The profile's currency is GBP, not the config's default EUR, so
SETUP-08 sees it come from the profile; only the setup reads the profile. `GET /users/{u}/lists` answers on one page, and `GET /lists/{id}`
with the list's releases; both show a private list only to `dj`'s own token, and
`GET /lists/{id}` answers `404` for it to any other;
and `shopkeeper`'s two listings, on one page. A Discogs request the fake has no route for fails
the test as unplanned.

Tokens: `e2e-token-<username>` identifies as that user; `e2e-token-refused` gets `401`. Any token
not starting with `e2e-` makes the fake fail the test with "a non-test token reached the fake",
so a real token that leaks into a test run is caught instead of logged. The fake also checks the
`User-Agent` header the transport sends. Every response carries
`X-Discogs-Ratelimit-Remaining: 59`; the 60 s pause at `<= 1` stays a vitest concern.

**data.discogs.com**, as `src/server/discogs/data-dumps.ts` reads it: the `?prefix=data/` and
`?prefix=data/2026/` listing pages with each file's size, the `CHECKSUM.txt` download and the dump
download with `Content-Length`. Per test: which dumps are listed, the listed size, the
`Content-Length` sent, the transfer speed, failing after N bytes, a wrong checksum, `503` for
every page, and checkpoints. Built so far (`fakes.dumps`): the listed dump, which the test names
with `diggaOptions.listedDump` (the bulk dump or the small September dump) so it is listed from
the app's first request, and without which the fake answers `404`; the listed size
(`list(dump, { listedBytes })`, `null` for none), which a test may change before the page opens,
since the server first reads the listing for `GET /api/setup` and keeps a listing it read for an
hour (a failed read is not kept, so SETUP-04's Try again reads it again); holds at checkpoints; `set({ failAfterBytes })`; `503` for every request,
`set({ unavailableStatus: 503 })` until `set({ unavailableStatus: null })` (SETUP-04); the
transfer speed, `set({ bytesPerSecond })`, which the standalone mode uses and no test does; the
`Content-Length` the transfer announces, `set({ contentLength })`, `null` for the dump's size
(SETUP-32); a wrong checksum for the next N reads of `CHECKSUM.txt`, `set({ wrongChecksums: N })`
(SETUP-26, and `--wrong-checksums` in the standalone mode); a hold for one transfer only,
`holdAt(name, { transfer: 2 })`, such as the second download after a mismatch; `transfers`, how
many transfers have started; and `sentBytes`, what the transfer has sent so far. A
listed dump is a `DumpSource`: `memoryDump()` wraps one the builder made, `fileDump()` reads a
file on disk. The rest comes with the scenarios that need it.

A transfer can be held at a checkpoint and released, to the end or to the next checkpoint:

```ts
const point = fakes.dumps.checkpoint("100-to-dig");
fakes.dumps.holdAt(point.name);
// ... the setup starts the download; the load reads what has arrived ...
await setup.waitForRecordsToDig(point.recordsToDig);
fakes.dumps.release("600-to-dig"); // or release() for the rest of the dump
```

A byte rate, when one is added, is for realism, never for synchronisation: it does not say when
the loader's worker has committed what it read, and a browser clock cannot hurry the worker.
Tests wait for the committed state through the UI or `/api/stats`, then release.

**YouTube oEmbed** (`https://www.youtube.com/oembed`): the title the catalogue gives a video id,
else `404`, with an optional delay past the server's 4 s lookup timeout.

**Fault injection** is the same for every route:

```ts
fakes.discogs.fail("PUT /users/:user/wants/:id", { status: 500, times: 1 });
fakes.discogs.delay("PUT /users/:user/wants/:id", { ms: 2000 });
fakes.dumps.set({ failAfterBytes: 400_000 });
```

A delay is for realism. A test that needs a request to stay in flight while it acts holds the
request instead:

```ts
const push = fakes.discogs.hold("PUT /users/:user/wants/:id");
// ... the app pushes ...
await push.received; // the request has reached the fake and waits
// ... the test acts while the push is in flight ...
push.release();
```

**The request log** records method, path, query, whether the request was authenticated, the JSON
body, when the request arrived and when the fake answered. Tests read it after the app's own
request to the server has completed (see [Synchronisation](AUTHORING.md#synchronisation)):

```ts
await expect
  .poll(() => fakes.discogs.requests("PUT /users/dj/wants/:id"))
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
activation. The app and the fake player read the same flag, in every engine and in Electron, whose
planned `autoplayPolicy` does not change the flag. If the Electron shell later skips the Space step
because it may autoplay, TRI-02 gets an Electron variant.

`window.__fakeYouTube` lets tests read and drive it: `players()` lists each player's video,
state, time and muted flag; `audible()` returns the video playing with sound; `loads()` lists
every `loadVideoById` and `cueVideoById` call with its `startSeconds`, which shows whether the
next release and the next track were preloaded muted; `end()` ends the audible video;
`fail(videoId, code)` refuses a video at runtime; `blockSound()` keeps unmuted playback
`UNSTARTED` although the page has activation, as a browser that blocks autoplay does.
`app.youtube` wraps these calls.
