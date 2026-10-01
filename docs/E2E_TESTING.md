# End-to-end testing

Status: proposed on 2026-09-30 and revised the same day after two rounds of review. The web spike
(Rollout, step 0) is built, and so is the whole P0 set, with the first-run setup (SETUP-01) and
the checkpoint scenarios SETUP-18, SETUP-19 and SETUP-21, and the first half of Triage's P1
scenarios (the record, the player and the tracklist); the results are recorded in "Spike
results". The rest is not built yet. This is the design of Digga's end-to-end (E2E) tests: the
tool, the harness, the fake services, the markup the tests rely on, and the scenarios the suite
should cover. The same tests must run against the browser app now and the Electron app later
(`docs/ELECTRON_PLAN.md`).

## Goals

- Catch the regressions unit tests cannot: those that cross the browser, the Hono server, SQLite,
  the jobs and the worker, and the external services, with real rendering, real keyboard events,
  real timers and real process lifecycles.
- One suite for both delivery shapes. A test drives a Playwright `Page` and does not know whether
  the page belongs to a Chromium tab or an Electron `BrowserWindow`. Where the two hosts differ
  (restarting the server alone, native dialogs), the difference is explicit in the fixture API
  and in the scenario's target.
- Hermetic and fail-closed. No request reaches Discogs, data.discogs.com or YouTube, and a request
  the harness did not allow fails the test instead of leaving the machine. No test reads or writes
  the owner's library, token, browser history or config.
- Deterministic. No fixed sleeps. Tests synchronise on completed requests and on state the app
  exposes, not on the first visible sign of an action. A test that fails once in fifty runs is a
  bug in the test or the app, and retries are not allowed to hide it.
- Failures an agent can read. Every failure leaves text artifacts: server log, the requests the
  fake services received, browser console errors and an ARIA snapshot of the page.
- Fast enough to run often: the smoke set in about a minute, the P0 and P1 sets in about six
  minutes on four workers.

Non-goals: re-testing pure logic that vitest already covers, loading a real 10 GB dump, testing
YouTube or Discogs themselves, and pixel comparisons (optional, see "Rollout").

## What E2E owns and what vitest keeps

The vitest suite is broad: queue SQL, filters and scopes (`tests/queue.test.ts`,
`tests/server.test.ts`), the triage session with a fake api (`tests/session.test.ts`), the sandbox
over the real HTTP API (`tests/sandbox.test.ts`), the player's playlist rules
(`tests/triage-player.test.ts`), Twelves sorting, filtering and paging (`tests/twelves.test.ts`),
the Discogs transport's rate limiting (`tests/discogs-client.test.ts`) and reading a growing dump
(`tests/growing-dump.test.ts`). E2E does not repeat those combinations. It checks that the pieces
are wired together, with one representative case per behaviour:

| Concern                                                       | Owner                      |
| ------------------------------------------------------------- | -------------------------- |
| Queue order, filters, scopes, representative pressing         | vitest                     |
| Undo order, push chain, rounds, notes in the session          | vitest                     |
| Sandbox overlay rules, `409` refusals                         | vitest                     |
| Playlist choice, heard skipping, start offsets                | vitest                     |
| Twelves sort, filter and paging combinations                  | vitest                     |
| Discogs rate limit gap, `429` backoff, quota pause            | vitest                     |
| Free space unknown (`statfs` fails)                           | vitest                     |
| Keys reach the right handler on the right page                | E2E                        |
| A verdict travels key -> session -> api -> server -> DB       | E2E                        |
| A want reaches the (fake) Discogs wantlist, and `Z` undoes it | E2E                        |
| Jobs started in the UI run in the server and report back      | E2E                        |
| The setup runs download, imports and load as separate jobs    | E2E                        |
| Reload, relaunch and crash keep what they should              | E2E                        |
| The accessibility tree matches what the keymap promises       | E2E (with axe)             |
| Electron shell: window, menu, dialogs, safeStorage, downloads | E2E, Electron project only |

When a bug crosses layers, its fix gets an E2E regression test. When a bug is inside one module,
its fix gets a vitest test.

## Tool: Playwright Test

Playwright Test is the only mainstream runner that drives both a browser and an Electron app
with the same `Page`, locator and assertion API (`_electron.launch()` returns an
`ElectronApplication` whose windows are ordinary `Page` objects). Electron runs Chromium, so the
web project on Chromium already exercises the engine the packaged app will use. Playwright also
brings what this app needs: web-first assertions that wait, `clock` for the 1.5 s push grace and
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

## Architecture

```
Playwright worker (Node; several run in parallel)
 |- fake services on 127.0.0.1:<port>   Discogs API, data.discogs.com, YouTube oEmbed:
 |                                       request log, fault injection, transfer checkpoints
 |- app host
 |    web:      spawns the guarded CLI server, then opens a prepared Chromium context
 |    electron: launches the main process with the harness preload, which guards it and holds
 |              the window's first navigation until the host has prepared the context
 '- test -> page objects -> app.page

Page (Chromium tab or BrowserWindow)
 |- prepared before the app's first script: fake YouTube API, routes, clock
 '- Digga client -> /api -> Digga server -> SQLite in the temp library -> fake services
```

Each test gets its own library, its own server process and its own fake services. Nothing is
shared between tests except read-only templates built once per run, so tests run fully in
parallel and in any order.

### Launching processes

One helper, `spawnDigga(args, options)`, starts every Node process the harness needs: the
server, the template builds and `app.cli()`. They all get the same isolation.

- `process.execPath` with the absolute path of `src/cli/digga.ts` in the repository, arguments as
  an array, no shell.
- The working directory is the test's temp folder, which holds no `.env`. The CLI loads `.env`
  from its working directory before it resolves paths and secrets (`src/cli/runtime.ts`), so a
  developer's `.env` with a real token or library path never applies.
- The environment is built, never inherited. From the parent it takes only `PATH`; on Windows
  `SYSTEMROOT`, `WINDIR`, `TEMP` and `TMP`; on Linux `DISPLAY`, `XAUTHORITY` and
  `WAYLAND_DISPLAY` when present, which `xvfb-run` sets. Then it sets `DIGGA_DATA_DIR`,
  `DIGGA_DUMPS_DIR` and `DIGGA_CONFIG_FILE`; the fake service URLs (see "Product changes");
  `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `XDG_CONFIG_HOME` and `XDG_CACHE_HOME` inside
  a fake home; `TZ=UTC`, `LANG=en_US.UTF-8`, `DIGGA_LOG_LEVEL=debug`; the network guard and its
  allowed port; and `DISCOGS_TOKEN` only when the test asks for the environment token.
- Before spawning, the helper checks that every `DIGGA_*` path is absolute and inside the run's
  temp root, and refuses otherwise. Path arguments get the same check, and a command whose
  default output lies outside the library must name one: `digga dump census` without `--out`
  writes the shipped `style-census.json` in the repository. That check, made before the process
  exists, is what keeps the real library safe. The `library: <dir>` line the server prints is
  compared afterwards as a second check.
- `digga serve --port 0` runs with an IPC channel for shutdown (below). The helper reads
  `digga serving on <url>` from stdout, matched by prefix since info log lines come first, and
  waits for `GET http://127.0.0.1:<port>/api/health`.
  The browser uses `localhost`, because the app warns on `127.0.0.1` (decision 29).

### Stopping processes

A graceful stop and a crash leave different state, and scenarios need both.

- **Graceful stop.** The harness sends `shutdown` over the IPC channel. `digga serve` calls
  `server.stop()`, which aborts running jobs (the runner records them `cancelled`), waits for
  them and for a backup in progress, closes the database and exits. IPC works on Windows, where
  Node's `kill("SIGTERM")` ends a process at once. A server that has not exited after 15 s is
  killed and the test fails, since a server that does not stop is a bug.
- **Orphans.** `digga serve` also stops when its IPC channel closes, so a server whose Playwright
  worker died does not keep running. Ctrl-C reaches the servers directly and they stop on
  `SIGINT`, so the helper treats an already closed channel as stopped.
- **Crash.** `kill("SIGKILL")`. Running jobs stay `running` in the database, and the next start
  marks them failed as interrupted (`failStaleJobs()`). SETUP-27 and PER-03 use this.

Discogs requests take no abort signal (`discogs/transport.ts`), and importers check theirs
between pages, so a cancel or a graceful stop waits for the request in flight. Fake delays
therefore stay at 5 s or less, well inside the 15 s limit, and a cancelled job's row reads
`running` until that request has returned.

The app fixture depends on the fake-services fixture, so Playwright tears the app down first; the
fakes keep answering until the server has exited. The temp folder is deleted after the exit.

### The app host

Tests receive a `DiggaApp` and never touch `browser` or `context` directly. Two hosts implement
it; the Playwright project chooses which.

```ts
export interface DiggaApp {
  /** The window under test. A relaunch replaces it; page objects read it on each use. */
  readonly page: Page;
  /** http://localhost:<port>, fixed for one launch. */
  readonly origin: string;
  readonly library: { dataDir: string; dumpsDir: string; configFile: string };
  /** Opens a hash route such as "#/twelves"; defaults to "#/triage". */
  open(hash?: string): Promise<void>;
  /** Typed calls to the current launch's /api, for given-state and read-back. */
  readonly api: AppApiClient;
  readonly given: Given;
  /** pause() and runFor(), when the test installed the clock (see "Time"). */
  readonly clock: PageClock;
  /**
   * Stops the whole app and starts it again on the same library, prepared as at the first
   * launch, with a new page that is blank until open(). Given state is not applied again.
   */
  relaunch(options?: { crash?: boolean }): Promise<void>;
  /** Web only: restarts the server on the same port while the page and its session stay. */
  restartServer(options?: { crash?: boolean }): Promise<void>;
  /** Runs `digga <args>` against the same library, with the same isolation. */
  cli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }>;
  /** Installs interception, runs the action, and returns the URL the app opened. */
  expectExternalOpen(action: () => Promise<void>): Promise<string>;
  /** Runs the action and waits until the download completes, saved in the test's output folder. */
  expectDownload(action: () => Promise<void>): Promise<{ name: string; path: string }>;
  /** Dispatches a paste event carrying the text at the focused element. */
  paste(text: string): Promise<void>;
  /** Reads and drives window.__fakeYouTube in the page. */
  readonly youtube: FakeYouTubeHandle;
  /** The page's /api requests so far, over every launch, as "METHOD /api/path". */
  apiRequests(): string[];
  /** Aborts the page's next matching requests (one by default), for the current launch. */
  abortRequests(
    match: { method: string; path: string },
    options?: { times?: number },
  ): Promise<void>;
  /** Declares aborts, /api errors, console errors and page errors the test causes on purpose. */
  expectProblems(problems: ExpectedProblems): void;
}
```

**Web host.** It prepares the library, config and fake home, spawns the server, prepares a
browser context (below) and opens the page. The console, page-error and request collectors are
attached to the context. `relaunch()` closes the context first, so no request of the page meets a
stopped server, then stops the server, and starts both again with the whole preparation and new
collectors; the port may change. The collectors feed one log per test, so a problem from an
earlier launch still fails the test. `restartServer()` keeps the port, so the open page
reconnects without a reload. Another worker's `--port 0` could take the port in between; the
helper then fails with that reason rather than retrying on another port.

**Electron host.** `relaunch()` quits the app and launches it again on the same library, with
the same preparation. `restartServer()` is not available: the server lives in the main process,
and restarting it alone would need a main-process API the product does not plan. Scenarios that
need it are tagged web.

`_electron.launch()` has no `viewport`, `reducedMotion` or `serviceWorkers` option, and the test
runner's `use` options, automatic screenshots and `trace` setting do not reach an Electron app.
The Electron host therefore passes `locale`, `timezoneId` and `colorScheme` to `launch()`, calls
`page.emulateMedia({ reducedMotion: "reduce" })`, sets the window's content size, and starts and
stops tracing and takes the failure screenshot itself.

**Helpers with a completion contract.**

- `expectExternalOpen()` installs its interception before the action: in the web host a context
  route that answers the external URL with an empty page and the `page` event that captures the
  popup; in Electron a stub of `shell.openExternal`. It returns once the URL is known.
- `expectDownload()` resolves only when the download has completed: in the web host it awaits
  `download.saveAs()` into the test's output folder; in Electron the `will-download` handler sets
  that path and the helper waits for `done` with state `completed`.
- `paste()` dispatches a synthetic `ClipboardEvent` with a `DataTransfer`, which is what Digga's
  `onpaste` handlers read. It needs no clipboard permission and never touches the OS clipboard,
  so it behaves the same in both hosts and in parallel workers. The suite does not press
  `ControlOrMeta+V`: the browser would read the OS clipboard, which workers and the developer
  share. That the browser turns the key into a paste event is the browser's behaviour.

### Startup order

Everything that must be in place before the app's first request is installed before the app
starts. A reload after the fact cannot undo a request that already left.

- **Web.** The fakes start; the library is prepared; the server starts with the guard active from
  its first instruction (`--import`); the given state goes through the API; the browser context
  is prepared with the routes, the fake YouTube init script, blocked service workers and, if the
  test asks for it, the clock. Only then does the host call `page.goto()`.
- **Electron.** In the plan (`docs/ELECTRON_PLAN.md`), the main process starts the server and
  loads the window as soon as the app is ready. The host launches it with a harness preload,
  `-r tests/e2e/support/electron-preload.cjs` before the main entry, which runs in the main
  process before the app's first line:
  - it installs the socket guard, so all main-process code is guarded, `loadConfig()` included;
  - it stubs `shell.openExternal`, `dialog.showMessageBox` and `dialog.showOpenDialog`, spies on
    `setProgressBar` and `Notification`, and registers the download handler once the session
    exists;
  - it wraps `BrowserWindow.prototype.loadURL`, so the first call records its URL and waits until
    the host calls `globalThis.diggaE2e.release()`.

  The host polls through `electronApp.evaluate()` until the preload reports the held URL. The
  server is running by then and its origin is known. On `electronApp.context()` the host
  installs the routes for that origin, the fake YouTube script and the clock, applies the given
  state through the API, and releases the navigation. The product has no code for this. ELEC-13
  tests the sequence.

  Electron may ignore `-r` in a packaged build. The Electron spike checks it on the inspectable
  release candidate. If the flag is ignored there, the product gets one test hook at the same
  point: with `DIGGA_E2E_HOLD=1` the main process waits after `server.start()` and before
  `loadURL()`, and the host installs the guard and the stubs through `evaluate()` while it waits
  (`require` is not defined there; the guard takes `net` from `process.getBuiltinModule()`).
  Node code that runs before that point is then unguarded, and only the fake service URLs keep
  it from the real services; the resolver rule still covers Chromium's network and
  `electron.net`.

### Libraries

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
| `small`         | `dump load` of the August and then the September small dump                          | Triage, Twelves, Settings          |
| `small-account` | `small`, then `import collection` and `import wantlist` for `dj`; username in config | wantlist, Maybe list, seller tests |
| `bulk`          | `dump load` of the bulk dump                                                         | paging, strategies                 |

There is no cache across runs: the spike built `small` in 0.2 s and `small-account` in 0.4 s. If
a larger catalogue makes the build slow, a cache keyed by a hash of every input (the catalogue,
the fake services, the migrations, the loader, the importers and the CLI) can follow, still
published only after success.

Per-test state goes on top, through documented paths only:

- **Config.** `empty` has no config, so the first start creates it from the schema defaults with
  the sandbox on, as for a real new user. For the loaded templates the host writes
  `digga.config.json` from `DEFAULT_CONFIG` with the test's overrides, `sandbox: false` unless the
  test asks for the sandbox, since the setup turns it off and live mode is the path most digging
  takes. `diggaOptions.labels` digs only the labels it names: the config leaves every other label
  of the small catalogue out (`filters.excludeLabels`), as `X` would, so a test reaches the
  records it is about without digging past others.
- **Credentials.** Templates hold none. The `small-account` build passes `DISCOGS_TOKEN` to its
  import commands only. A test that wants a saved token calls `app.given.savedToken(token)`,
  which goes through `PUT /api/discogs/token` before the page opens, so the token lands wherever
  the host's `Secrets` keeps it: `secrets.env` in the web app, `safeStorage` in Electron. The
  environment token is `DISCOGS_TOKEN` in both hosts; the Electron `Secrets` must give it the
  same precedence as the CLI's.
- **Decisions.** `app.given` writes verdicts, track marks and listens through the app's own
  `/api` before the page opens. The server refuses digging writes while the sandbox is on, so
  `given` writes with the sandbox off and switches it on afterwards when the test asks for it.
- **Bulk decisions** (1,200 verdicts for paging) go through `digga restore` with a generated
  decisions backup, the documented restore path.

Tests never open the SQLite file. Assertions read the UI first and the public API second
(`/api/twelves`, `/api/stats`, `/api/export/decisions.json`), which keeps them independent of the
schema and lets the Electron host run them unchanged.

### The fixture catalogue

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
drops one, so the last load has "added" and "missing" counts and a `load:<id>` scope. Videos
that YouTube has and no release lists, one titled after a track that has none, are there to be
pasted (TRI-26).

Records that only some scenarios reach sit on labels that sort after those of the first records,
so the default queue starts as before, and a scenario digs them with `diggaOptions.labels`. The
catalogue names the records that scenarios refer to (`FIRST_RECORD`, `TRACK_RUN`,
`SAME_TUNE_ELSEWHERE` and so on) and says in a comment which scenarios they serve. Built so far:
14 releases in one dump, and the release in no dump (see "The first Triage P1 slice").

**The bulk catalogue** has 1,500 generated Drum n Bass records from 1998 to 2002 on vinyl,
deterministic from a seed, on 30 labels no other fixture uses, in id order as in a Discogs dump,
so more than 500 records to dig arrive in the first 40% of the file. The generated releases have
no master and match the picks the setup scenarios make (Drum n Bass, the census's middle years,
vinyl), so each is one record to dig. Releases in other styles, which the census and the filter
preview need, join when a scenario needs them; the setup scenarios need none. The dump is 81 KB
and is built in memory once per worker, in about 25 ms (see "The first-run setup path").

**Checkpoints.** The builder (`fixtures/dump.ts`) compresses the dump with a full flush at named
points, `100-to-dig` and `600-to-dig`, and records for each its compressed offset, the number of
records to dig before it and the last release before it. It deflates each part on its own; a
full flush resets the compressor, so these are the bytes a gzip stream flushed with
`Z_FULL_FLUSH` between the parts would write. A gunzip stream given the bytes up to a full flush yields all the
XML before it, so at a held transfer the loader has parsed every release before the point. The
loader then commits them and reports progress within a second (product change 4), and tests
wait for the recorded count in the UI or `/api/stats` before they release the transfer. The fake
data.discogs.com holds and releases transfers (see "The fake services"). The runs confirmed all
of this; see "The first-run setup path".

Video ids follow YouTube's 11-character shape (`[\w-]{11}`, which `deck.ts` checks). A prefix
tells the fake player how to behave: `e150…` refuses with error 150, `e100…` with 100, anything
else plays.

### The fake services

The server talks to three external HTTP services. E2E replaces each with a fake served by one
`node:http` server inside the Playwright worker, started per test on `127.0.0.1:0`. Running it in
the worker, not in the app, means the fakes work unchanged when the app is an Electron process,
need no native module, and let tests read and change their state as typed objects.

The same module also runs standalone (`node tools/dev/fake-services.ts`), which replaces
`tools/dev/fake-data-dumps.ts` for rehearsing the setup by hand. The fakes never answer with a
redirect.

Digga's own `/api` is never faked. Tests reach a state by driving the real server into it. The
only exception is transport failure: a `route()` can abort or delay one request to test the "did
not load" and "not saved" states, since a real server does not fail on demand.
`app.abortRequests({ method, path }, { times })` registers such a route on the context; the test
declares the abort and the console error it causes with `app.expectProblems()`.

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

State: accounts (`dj` with a collection of 5, a wantlist of 6 including one release in no dump,
a private "Maybe" list 9001 and a public list 9002), a seller `shopkeeper` with 20 listings, and
the catalogue's releases.

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
with `diggaOptions.listedDump` so it is listed from the app's first request, and without which
the fake answers `404`; the listed size (`list(dump, { listedBytes })`, `null` for none); holds at
checkpoints; `set({ failAfterBytes })`; and `sentBytes`, what the transfer has sent so far. The
rest comes with the scenarios that need it.

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
request to the server has completed (see "Synchronisation"):

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

### The fake YouTube IFrame API

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

### Secrets and the Discogs token

- Tests only use fake tokens (`e2e-token-dj`, `e2e-token-other`, `e2e-token-refused`).
- No Digga process inherits the developer's environment or reads their `.env` (see "Launching
  processes").
- A token reaches a test library in one of three ways, one per scenario group: typed into the
  setup or Settings form, set through `PUT /api/discogs/token` by `app.given.savedToken()`, or
  passed as `DISCOGS_TOKEN` (the "token from the environment" state, where Settings disables the
  field and the route answers `409`).
- The fake fails any request with a token that does not start with `e2e-`.
- Electron keeps the token with `safeStorage`; see "Electron" for keychains in CI.

### The network and filesystem guard

The guard fails closed at runtime in every process that could reach the network. The layers
overlap on purpose.

1. **Node processes** (the CLI server and commands, and Electron's main process). A module
   patches `net.Socket.prototype.connect` to allow loopback addresses at the fake services' exact
   port and nothing else; listening is unaffected. The TCP clients Node ships connect through it
   (fetch and undici, `http`, `https`, `tls`, `net`), so a redirect to another host or an IP
   literal is refused too. A native addon or a transport that does not use `net.Socket` would
   not be. The patch reads both call forms: `http` and `https` pass `path: null`, so a pipe is
   recognised by a truthy `path`, and `net.connect()` passes its normalised arguments as an
   array. CLI processes load it with `NODE_OPTIONS=--import=<guard>`, and their worker threads
   inherit it. Playwright removes `NODE_OPTIONS` from every Electron launch, so Electron's main
   process gets it from the harness preload (see "Startup order"). The dump-load worker makes no
   requests; the Electron spike checks whether a worker started from the main process inherits
   the preload, and if not, the preload wraps `worker_threads.Worker` so each worker loads the
   guard first.
2. **Context routes.** The base route lets through the app's exact origin and aborts everything
   else, recording the URL; the fixture fails a test that has aborts it did not declare. In
   Chromium, Playwright does not route the requests that follow a redirect, so the base route
   fetches an allowed request itself with `route.fetch({ maxRedirects: 0 })`, fulfills the page with
   the answer, and aborts and fails the test on a redirect. Digga's server and the fakes send none.
   The spike showed both the need and the cost: with `route.continue()`, a fetch that is redirected
   and a navigation that is redirected both reached the forbidden port; with `route.fetch()` neither
   did, and a Triage page load took about 5 ms longer (86 ms against 81 ms, the medians of 16
   reloads). The base route fetches each request from `127.0.0.1`, the address the server binds,
   because a fetch of `localhost` tries `[::1]` first, and on its own connection
   (`Connection: close`), because `route.fetch()`, unlike Chromium, does not send a request again
   when a kept-alive connection turns out to be closing. A request it cannot fetch is recorded
   with the reason and attached to the failure artifacts ("The first-run setup path" has both
   failures). `context.routeWebSocket()` closes every WebSocket (Digga opens none). Fault routes and
   the external-open helper are registered after the base route and call `route.fallback()` for
   requests they do not handle, so they compose with it (Playwright tries the newest matching route
   first). The web context uses `serviceWorkers: "block"`; Electron has no such option, and Digga
   registers no service worker.
3. **Chromium resolution.** The browser, and Electron through its command line, starts with
   `--host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1"`, so no
   other host name or IP literal resolves. This covers what Playwright does not route, such as
   preconnects, and `electron.net` in the main process. `127.0.0.1` stays resolvable for SHELL-06;
   the routes still allow only the app's port. Firefox and WebKit have no such switch and rely
   on the routes.
4. **The harness's own requests.** `app.api` and the health probe accept only the test's origin
   and use `redirect: "error"`.
5. **A vitest source check** lists the external base URLs in `src/server` (`api.discogs.com`,
   `data.discogs.com`, `www.youtube.com/oembed`) and fails when a new one appears without a
   matching `CreateServerOptions` setting. It is supplementary: it catches the omission early,
   the runtime layers enforce.

Exact ports also keep tests away from a Digga the owner has running on port 3456.

The guard is tested itself. A vitest test runs the Node guard against fetch, `http`, `https`,
`tls` and `net` in each call form, a redirect and a worker thread. GUARD-01 and GUARD-02 check
the running layers against a second loopback listener the test owns, never port 3456.

**Filesystem.** `HOME`, `USERPROFILE` and the other folder variables point into a fake home in
the temp folder. `readSetup()` looks for browser history there (`discoverHistoryFiles()` defaults
to `os.homedir()`), so the setup never sees the developer's Brave or Firefox, and history tests
place fixture `History` databases there.

### Disk space

The setup's free-space line and the download's check read the real disk (`statfs`). Faking free
space would need a product setting that exists only for tests, so the suite does not fake it. It
makes the real disk irrelevant instead:

- **Precondition.** `globalSetup` fails the run with a clear message unless the temp root has
  2 GiB free, since a test download needs its size plus the 1 GiB the downloader keeps spare.
- **Too little space before the download.** The fake listing says 900 TB, more than any disk has
  (SETUP-05).
- **Too little space at the download.** The listing says 2 MB and the fake's `Content-Length`
  says 900 TB, so the download job refuses in `ensureRoom()` (SETUP-32).
- **Free space unknown.** `statfs` failing is a vitest case (`tests/setup-http.test.ts`):
  `readSetup()` takes its free-space function as a dependency, as `downloadDump()` takes
  `freeBytes`, and says nothing of the free space when it throws.

### Time

`clock` fakes the page's timers, `Date` and `performance.now()`. It controls the browser's
timers only:

| Browser timer                                                            | Where                                                                                                            |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| 1.5 s grace before a wantlist push                                       | `triage/session.svelte.ts` (`pushGraceMs`)                                                                       |
| 350 ms before a sandbox push completes                                   | `sandbox.ts` (`pushDelayMs`)                                                                                     |
| 4 s of playback before a listen, 250 ms ticks                            | `player/triage-player.svelte.ts`                                                                                 |
| 10 s look-again at the end of the queue                                  | `pages/Triage.svelte`                                                                                            |
| 1 s polling of the setup, load status and jobs                           | `setup/flow.svelte.ts`, `load-status.svelte.ts`, `settings/jobs.svelte.ts`                                       |
| 3 s between the setup's stats reads, 250 ms waits for a cancel           | `setup/flow.svelte.ts`                                                                                           |
| 500 ms job wait                                                          | `jobs.ts`                                                                                                        |
| 500 ms stats refresh, 300 ms preview, 200 ms search                      | `stores.svelte.ts`, `settings/preview.svelte.ts`, `triage/scope-search.svelte.ts`                                |
| 5 s player notices; 6 s Triage and Settings flashes; 5 s Twelves flashes | `player/triage-player.svelte.ts`, `triage/session.svelte.ts`, `pages/Settings.svelte`, `twelves/shelf.svelte.ts` |

The 3.5 s after which a blocked play asks for Space is not a timer of its own: the player's
250 ms tick checks how long a "play" load has stayed unstarted (TRI-43).

The clock does not reach the server (the Discogs client's 1.1 s gap, the hourly backup check),
the fake services' delays, or the dump-load worker. Tests wait for those through the UI or a
completed response. After `runFor()` the page's clock is ahead of the server's, so text computed
from server timestamps moves on: "checked just now" reads "1 minute ago" once a test has run the
clock 60 s, and the load's ETA changes. Tests that read such text match a pattern.

Rules:

- Install the clock before the app starts: before `page.goto()` in the web host, before the held
  navigation is released in Electron. After `install()` time keeps flowing, so polling runs. A
  test asks for it with `test.use({ diggaOptions: { clock: true } })`; the host installs it on
  every context it opens, a relaunch's too.
- A test whose action must land inside a browser timer's window, such as `Z` or a sandbox switch
  within the push grace, pauses the clock before the key press that starts the window and keeps
  it paused until the action has completed. Pausing only around the assertion is too late: the
  grace would run out in real time while the test acts.
- `app.clock.pause()` reads the page's `Date.now()` and calls `pauseAt()` 1 s ahead of it.
  `pauseAt()` refuses a time the page's clock has already passed, and that clock runs on while
  the calls travel. The clock then jumps by what is left of the second, firing each timer due in
  it at most once; pausing before the key press puts that jump before the window opens.
- The clock also holds `requestAnimationFrame`: while paused, a frame callback waits for
  `runFor()`. The client uses none and no Svelte transition; one added later would stop there.
- Use `runFor(ms)` to let time pass: it fires every due timer in order. The player adds at most
  1 s per 250 ms tick, so `runFor(4500)` produces a logged listen, while `fastForward(4500)`,
  which fires each due timer at most once, would not. Use `fastForward()` only when skipping
  repeated ticks is the point.
- With the clock paused before playback starts, each tick adds exactly 250 ms, so a listen's
  seconds are exact: `runFor(4500)` logs a listen of 4 s and leaves 0.5 s, `runFor(5500)` leaves
  1.5 s to post when the listener leaves the track (TRI-36). The position slider shows the whole
  seconds of the time the last tick read, up to 250 ms behind the player. TRI-03 runs the clock
  2,500 ms, so the last tick falls 2.25 to 2.5 s in, inside one whole second whatever the ticks'
  phase.

### Synchronisation

Visible state often comes before the work it announces. In Triage the slip turns "pending"
before `POST /api/verdicts` is sent, the grace timer starts only after the page has read that
request's answer (`#saveVerdict()`), and "undone" shows before `DELETE /api/verdicts/:key`
completes. The first visible sign is therefore not proof that anything finished. Tests
synchronise on completed requests and on the state the app sets after them:

- Arm `page.waitForResponse()` before the action that causes the request, a key press or a
  `runFor()`, and await it after. Match on the decoded path: the undo's request is
  `/api/verdicts/m%3A501` on the wire, and a push is preceded by `GET /api/releases/:id`.
- A response is not the end of the work. `waitForResponse()` resolves on the headers, and the
  page reads the body before it continues. The helper checks `response.ok()`, awaits
  `response.finished()`, and then waits for the state the page sets afterwards. For verdicts and
  undos that is the slip's `aria-busy` returning to false (see "Markup audit"): by then the page
  has run the code after the save, which arms the push grace.
- A want, with time flowing: after the verdict, wait for "Added to your Discogs wantlist.", which
  shows only after `POST /api/discogs/wantlist/:id` has answered, then read the fake's log. The
  app's request answers only after the server's call to the fake has completed, however long the
  server's 1.1 s throttle held it.
- Nothing pushed (TRI-13), with the clock paused before `A`: after the verdict has settled, press
  `Z`, wait until the undo has settled, `runFor(2000)` past the grace, check that the page sent
  no request to `/api/discogs/wantlist` (`app.apiRequests()`), then that the fake received
  nothing after the mark the test took before `A`. The saved token's given state has already
  asked the fake for `/oauth/identity` before the page opened, so its log is not empty from the
  start. The grace timer was armed before `Z`, so `runFor()` fires it and the check is not
  empty by accident. The server calls Discogs only when the page asks, so the page's log
  decides, and the fake's log confirms.
- The sandbox sends no verdict request. Its helpers wait for the record to change and the slip to
  settle, and a sandbox want ends when the slip reads "Added to your wantlist (sandbox: nothing
  sent).", after the grace, a real `GET /api/releases/:id` and the sandbox's 350 ms delay.
- A request that must stay in flight while the test acts is held at the fake (TRI-39), never
  delayed by a fixed time.
- A track mark's stamp shows before its `POST /api/track-verdicts`, and a listen is a
  `POST /api/listen-log` with nothing on screen until the track is left ("played"). The page
  object's `markTrack()`, `listenFor()` and `listenLoggedBy()` wait for those requests and return
  the body the page sent.
- Some writes leave in a fixed order: the session saves verdicts one at a time, the player posts
  listens in order, and each paste sends its request at once. A request that should not exist
  would then be in the page's log before the answer to a later one, so a negative check waits for
  that answer and counts: one `POST /api/verdicts` per press of a held key (TRI-11), no attachment
  from a paste of other text or into the note field (TRI-26), no listen for a remainder under 1 s
  (TRI-36).

### Determinism

- Viewport 1600 x 1000, and the same Electron content size. The header hides the sandbox
  explanation while a dump job runs at 1440 px and below, and hides it and the ETA at 1180 px and
  below (`App.svelte`), which changes accessible names; responsive checks set their own viewport.
- `locale: "en-US"`, `timezoneId: "UTC"` in the browser; `TZ=UTC` in the server, so backup file
  names (`localDay()`) and the Twelves day column agree. The `random` strategy's seed is the
  server's UTC day.
- `reducedMotion: "reduce"`, which shortens the stamp's slam animation to 0.01 ms.
- `colorScheme: "dark"` unless the test is about the scheme.
- Fonts ship in `dist/` and the stamps are seeded, so screenshots attached to failures are
  comparable; the background grain is not seeded.
- Assertions that involve dates match a pattern or a relative phrase, never today's date. The
  `random` strategy is checked for stability across reloads, not for a fixed order.

### Failure artifacts

On failure the fixture attaches, as text where possible:

- the server's stdout and stderr (debug level);
- the fake services' request log as JSON, and the page's request log;
- the requests the base route could not fetch for the page, with the reason;
- browser console messages and page errors;
- `page.locator("body").ariaSnapshot()`, a YAML view of the accessibility tree that an agent can
  read without opening a trace viewer;
- a screenshot, and a trace (`trace: "retain-on-failure"`). In the web host these options reach
  the contexts the host creates with `browser.newContext()`, and Playwright also writes an
  `error-context.md` with the error and the test's source for an agent to read.

Any `pageerror` or unexpected `console.error` fails the test, unless the test declares it. So
does any `/api` response with a status of 400 or above that the test did not declare, which
catches a failed push that a test never looked at, and any request a fault route aborted.
Chromium logs a failed response to the console as "Failed to load resource: the server responded
with a status of …"; the host leaves those messages to the status check, so the declared response
covers them. Aborted requests and a stopped server produce other console errors, such as "Failed
to load resource: net::ERR_FAILED", so the scenarios that cause them declare them:

```ts
app.expectProblems({
  aborted: [/^POST \/api\/verdicts$/],
  consoleErrors: [/^Failed to load resource: net::ERR_FAILED/],
});
await app.abortRequests({ method: "POST", path: "/api/verdicts" });
```

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
5. **The markup changes** in the next section.
6. **For Electron:** the main process honours `DIGGA_DATA_DIR`, `DIGGA_DUMPS_DIR`,
   `DIGGA_CONFIG_FILE` and the service URLs, as the CLI does; its `Secrets` lets `DISCOGS_TOKEN`
   win over the `safeStorage` token, as the CLI's does; it handles `window.open` with
   `setWindowOpenHandler` and `shell.openExternal`, and downloads in `will-download`; and quitting
   waits for `server.stop()`, which the plan's `before-quit` handler does not, so jobs end
   `cancelled` and the database closes. The app needs all of these anyway.

No product code exists only for tests, unless the Electron spike shows that packaged builds
ignore `-r` (see "Startup order").

The web spike built changes 1 and 2, and the markup its scenarios use: the slips' group names,
the last slip's `aria-busy`, and `data-release-id` and `data-triage-key` on the record's facts.
`createVideoTitleLookup()` now takes an options object with the oEmbed address.

The rest of the P0 set added more of item 5, and moved keys and copy the tests read into plain
modules, since Node imports neither a component nor a `.svelte.ts` module: the flash's `label`,
which names "Triage messages" and "Player notices"; `data-position` on the tracklist's track
rows; `PLAYER_STATUS_COPY` in `src/client/player/status.ts`; the header's pages and their keys
(`ROUTES`) in `src/client/routes.ts`; and the track-mark keys (`TRACK_MARK_KEYS`) in `keymap.ts`.

The first Triage P1 slice added `data-video-id` on the tracklist's "Other videos" rows.

The setup path built items 3 and 4. `readSetup(deps, { freeBytes })` takes the dependencies it
reads (`db`, `paths`, `dataDumps`) and the free-space function, whose default is the download's
`freeBytesIn()`. In the loader, a timer reports whenever a second passes without a report, and
every scanning report commits the pending batch first, so what the progress says is in the
database; the batch size, the final flush, the dry run and the limit are as they were, and the
per-1,000 clock check is gone, since the timer covers it. A timed commit that fails ends the load
with its error, through the input stream. Its vitest cases are in `tests/dump-load.test.ts` and
`tests/growing-dump.test.ts`. The burn-in also found a race in the setup's job polling, fixed in
`src/client/setup/flow.svelte.ts` with `tests/setup-flow.test.ts` (see "The first-run setup
path"). The setup needed no markup change.

## Markup audit

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
   stays a `span`.
2. **`src/client/twelves/Pager.svelte`:** `<nav aria-label="Pages">` repeats the header's
   `<nav aria-label="Pages">`, so Twelves has two navigation landmarks with the same name. Name
   the pager "Shelf pages".
3. **Field errors not tied to their fields.** AGENTS.md asks for `aria-invalid` on invalid fields
   and the message attached with `aria-describedby`.
   - The setup's token and username fields (`DiscogsStep.svelte`): a refused token or unknown
     user shows in the step's `role="alert"` paragraph, but the field gets no `aria-invalid` and
     does not reference the message. Set `aria-invalid` with the custom validity, clear both on
     input, and add the alert's id to `aria-describedby` after the hint.
   - The style search (`StylePicker.svelte`): "Pick at least one style" exists only in the native
     validation bubble, which disappears, and the field gets no `aria-invalid`. Render the message
     in an element the field references, after `style-search-hint`.
   - Settings' `reportProblem()` sets the custom validity and `aria-invalid`, but the message
     appears only in the save bar's status, not attached to the field. Give each problem an
     element the field references, keeping its hint id.
   - Settings' token field references its status line, but a refused token only adds the
     `problem` class; the field gets no `aria-invalid`.
4. **Live regions inserted together with their text.** The setup's error paragraphs
   (`{#if flow.error}<p role="alert">` in each step), the space alert in `CatalogueStep.svelte`,
   the "Connected as" status in `DiscogsStep.svelte` and the "stopped loading" notice in
   `CrateStep.svelte` appear with their text, so screen readers may not announce them. Each
   region stays in the DOM, empty until it has something to say, and an error's field
   association is cleared with it.

Related, smaller:

- The header hides "verdicts are not saved" and the ETA with `display: none`, which also removes
  them from the accessibility tree. The visually hidden class would keep them for screen readers
  while the layout stays the same.
- The scope picker's Enter button and "Start digging", which Enter also starts, do not declare
  Enter in `aria-keyshortcuts`.

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
  unnamed.
- **The slips** (`Slip.svelte`): the last slip shows verdicts, passes, hidden labels and undos,
  so its name is "Last action". It becomes `role="group"` with that `aria-label`, keeping its
  `aria-live`. The next slip becomes a group labelled by its visible "Up next". A group gives the
  handle without adding landmarks, which a named `<section>` would.
- **The last slip is busy while its write is in flight.** It carries `aria-busy="true"` from the
  key press until the verdict's or the undo's request has been answered and the page has acted
  on the answer. Screen readers can wait for a confirmed action, and tests get the end of the
  work (see "Synchronisation"). On a failed save the slip clears and the busy state goes with it.
- **`Flash.svelte`** takes an optional `label` for `aria-label`. The Triage screen has up to five
  `role="status"` regions: the header's announcement, the market line, the session flash, the
  player notice and, while it is open, the scope picker's status. Naming the flash ("Triage
  messages") and the player notice ("Player notices") lets a test assert on one of them.
- **The queue** (`.record` in `Triage.svelte`) gets `aria-busy` while the queue loads.

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

## Locators and page objects

Priority for finding an element, highest first:

1. Role and accessible name: `getByRole("dialog", { name: "Keys" })`,
   `getByRole("button", { name: "Save settings" })`.
2. Label: `getByLabel("Token")`, `getByLabel("From year")`.
3. `aria-keyshortcuts` for key-bound controls, with the key from `keymap.ts`.
4. Domain `data-*` attributes for identity: `[data-triage-key="m:501"]`.
5. Visible text, scoped to a named container, for content the user reads (artist, title, a
   message, a state's copy).

Never: CSS classes, element structure, `nth-child`, generated ids, or `waitForTimeout`.

`getByRole()` has no option for `aria-current`, so the tracklist's current row is the list item
that holds an element with `aria-current="true"` (`TriagePage.currentTrack`).

Copy assertions import the app's own copy (`STATUS_COPY`, `VERDICT_KEYS` and `TRACK_MARK_KEYS`
from `src/client/keymap.ts`, `SHELVES` and `MARK_COPY` from `src/client/twelves/model.ts`,
`ROUTES` from `src/client/routes.ts`, `PLAYER_STATUS_COPY` from `src/client/player/status.ts`),
so a copy change updates the tests, while a handful of copy tests pin the
phrases the docs promise. Text in the DOM is as written, not as styled: the stamps read "all
dug" and "ready to dig" in lower case.

Tests act as the user does: keys for everything the keymap offers, with one mouse test per
control group to cover the buttons. Key presses use the keymap:

```ts
const key = (status: TriageStatus) =>
  VERDICT_KEYS.find((verdict) => verdict.status === status)!.key;
await page.keyboard.press(key("accepted").toLowerCase());
```

Page objects are thin: locators and domain actions. An action may wait for the state it promises
(Space waits until the player plays); checks of outcomes stay in the test. Page objects hold the
`DiggaApp` and read `app.page` on each use, so they keep working after `relaunch()`. The
repository allows only erasable syntax, so no parameter properties:

```ts
export class TriagePage {
  readonly app: DiggaApp;

  constructor(app: DiggaApp) {
    this.app = app;
  }

  get root(): Locator {
    return this.app.page.getByRole("main");
  }
  get record(): Locator {
    return this.root.locator("[data-triage-key]");
  }
  get player(): Locator {
    return this.root.getByRole("region", { name: "Player" });
  }
  get lastAction(): Locator {
    return this.root.getByRole("group", { name: "Last action" });
  }

  track(position: string): Locator {
    return this.root
      .getByRole("list", { name: "Tracklist" })
      .locator(`[data-position="${position}"]`);
  }

  /** Exact text: the region's "Nothing playing" also contains "playing". */
  playerStatus(status: PlayerStatus): Locator {
    return this.player.getByText(PLAYER_STATUS_COPY[status], { exact: true });
  }

  async startListening(): Promise<void> {
    await expect(this.playerStatus("needs_gesture")).toBeVisible();
    await this.app.page.keyboard.press("Space");
    await expect(this.playerStatus("playing")).toBeVisible();
  }

  /** Presses the verdict's key; returns once the server has saved it and the page has acted. */
  async judge(status: TriageStatus): Promise<void> {
    // A key pressed before a record is on screen does nothing.
    await expect(this.record).toBeVisible();
    const saved = this.app.page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/verdicts" &&
        response.request().method() === "POST",
    );
    await this.app.page.keyboard.press(key(status).toLowerCase());
    const response = await saved;
    expect(response.ok()).toBe(true);
    await response.finished();
    await expect(this.lastAction).not.toHaveAttribute("aria-busy", "true");
  }
}
```

`judge()` is for live mode. In the sandbox no request is sent, so `judgeInSandbox()` waits for
the record to change and the slip to settle.

## Scenarios

IDs are stable, so commits, reviews and failures can refer to them; new scenarios get new
numbers. Priority: **P0** is the smoke set, **P1** runs on every CI run, **P2** runs nightly.
Target: **both** unless marked **web** or **electron**. Templates are named in brackets where it
matters.

**Gap** marks a scenario where the product does not yet do what `docs/FIRST_RUN.md` or this
document says. The scenario lists what the product does today, and a normal test asserts that.
The designed behaviour is a separate `test.fail` with the gap in its title: it runs, and the run
reports it as soon as the product catches up, which is when the gap is closed here and the test
becomes a normal one.

The P0 set covers the guard, startup and navigation, the first run from real defaults, playback,
a live verdict surviving reload and relaunch, undo and the push grace, sandbox isolation, and one
failed write: GUARD-01, GUARD-02, SHELL-01, SHELL-02, SETUP-01, TRI-02, TRI-07, TRI-10, TRI-12,
TRI-13, SBX-01, PER-01 and PER-04.

### Guard

| ID       | Scenario                                                                                                                                                                                                                                       | P   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| GUARD-01 | `DIGGA_YOUTUBE_OEMBED_URL` points at a loopback listener the test owns, on a port other than the fakes': `app.paste()` of a YouTube link; the listener saw no connection, and the guard reported the refused connection on the server's stderr | P0  |
| GUARD-02 | A context prepared for a small server the test owns: a request to another loopback port, a redirect from the allowed origin to it, and a WebSocket to it all fail, and that port's listener saw nothing                                        | P0  |

### Shell and navigation

| ID       | Scenario                                                                                                                                                                                                                                                   | P   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| SHELL-01 | A loaded library opens on Triage: title "Triage – Digga", header counts dug and to go, the first record                                                                                                                                                    | P0  |
| SHELL-02 | `T`, `W` and `,` switch pages; `aria-current="page"`, the hash and the title follow                                                                                                                                                                        | P0  |
| SHELL-03 | Page keys are ignored in a text field, and with Cmd, Ctrl or Alt; they work with a checkbox focused (decision 60)                                                                                                                                          | P1  |
| SHELL-04 | `?` opens the Keys dialog with the current page's groups; Esc, the close button and the backdrop close it; page keys stay quiet while it is open; focus does not stay inside                                                                               | P1  |
| SHELL-05 | With the sandbox on, the header stamp links to `#/settings/sandbox`, which highlights and focuses the switch                                                                                                                                               | P1  |
| SHELL-06 | Opened on `127.0.0.1`, the page shows the warning with the `localhost` link (**web**)                                                                                                                                                                      | P2  |
| SHELL-07 | Settings load normally; `route` aborts `/api/queue*` and `/api/stats*`: the header reads "Server unreachable" (it does only while stats have never loaded) and Triage "The queue did not load"; once requests pass, Enter loads the queue                  | P1  |
| SHELL-08 | An unknown hash opens Triage                                                                                                                                                                                                                               | P2  |
| SHELL-09 | Appearance: System follows the emulated scheme; Light and Dark apply at once (`data-color-scheme`, computed `color-scheme`), survive a reload, and do not restart the Triage queue                                                                         | P1  |
| SHELL-10 | Browser Back and Forward move between pages and setup steps (**web**; Electron if the window keeps history)                                                                                                                                                | P2  |
| SHELL-11 | At 840 px wide the Triage columns are stacked (980 px and below) and the header wraps (860 px and below); every control stays reachable                                                                                                                    | P2  |
| SHELL-12 | **Gap.** `/api/settings` fails when the app opens: today Triage never starts its queue and Enter does nothing, since both wait for settings; the Settings page says "Settings did not load: …" without a retry. Proposed: Triage says so too, with a retry | P2  |

### First run (`#/setup`) [`empty`, fake data.discogs.com serving the bulk dump]

| ID       | Scenario                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | P   |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| SETUP-01 | The first run from the default config: the sandbox is on at first (`/api/settings`); fetch, connect with `e2e-token-dj`, keep the suggested styles, fill the crate; the config then has the sandbox off; with the transfer held at `600-to-dig` and its count shown, "Start digging"; the first verdict is in `/api/export/decisions.json`. **Gap:** Triage digs the queue it read when the picks were saved, before the first records came, until it looks again (every 10 s during a load), so "Start digging" can open on "You have dug everything loaded so far." with 600 to go; the test runs the clock 10 s before the verdict. Designed: Triage opens on a record; its `test.fail` pauses the clock before the picks are saved, so Triage cannot look again, and opens Triage with `T` at `100-to-dig` | P0  |
| SETUP-02 | An empty library opens `#/setup/catalogue`; the header holds only the wordmark; `T`, `W` and `,` do nothing; the step list marks step 1; the title is "Fetch the catalogue – Digga setup"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | P1  |
| SETUP-03 | Step 1 shows the dump's date, listed size, folder and free space; the fake logged no download before the button                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | P1  |
| SETUP-04 | data.discogs.com answers `503`: the reason and "Try again"; once the fake recovers, Try again shows the dump                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | P1  |
| SETUP-05 | The listing says 900 TB: an alert with the space needed, the folder and `DIGGA_DUMPS_DIR`; Fetch is disabled; "Check again"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | P1  |
| SETUP-06 | The dump is already in the dumps folder: "Digga has the 1 September 2026 catalogue already" and Continue                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | P1  |
| SETUP-07 | Enter starts the download; the download strip shows on steps 2 and 3 with a `<progress>`; the step is in the address; a reload stays on it; Back goes a step back                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | P1  |
| SETUP-08 | A token Discogs accepts: "Connected as dj: 5 in your collection, 6 wants"; the username is adopted; currency comes from the profile                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | P1  |
| SETUP-09 | `e2e-token-refused`: the step's alert shows Discogs' refusal, nothing is saved, the username stays empty. After markup item 3: the field has `aria-invalid` and references the alert                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | P1  |
| SETUP-10 | "No token? Use your username": the public profile is read; a later want stays in Digga, its push fails with the declared `400` ("Set your Discogs token in Settings first"), and Twelves marks it as not on the wantlist                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | P2  |
| SETUP-11 | Skip moves to step 3 with nothing connected and no suggestions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | P1  |
| SETUP-12 | Browser history: the checkbox and browser list appear only for browsers with a history file in the fake home; a browser folder the harness makes unreadable (`chmod 000` on the root it lists, POSIX, not as root, restored in cleanup) is listed too, with the Full Disk Access hint; the import marks the fixture's visited releases as seen                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | P2  |
| SETUP-13 | Continue starts the collection and wantlist imports as jobs (the fake logs their pages) and moves on at once                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | P1  |
| SETUP-14 | Step 3 with imports: the account's styles are picked ("mostly Drum n Bass"); years default to the middle 80%; the estimate is a `status` line                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | P1  |
| SETUP-15 | Style picker: "jung" then Enter picks Jungle; "Often tagged with" adds a style; "Remove Jungle" removes it; genres open as `<details>`; Vinyl only; the load-years disclosure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | P1  |
| SETUP-16 | Validation: no style blocks submit; "from" is capped by "to". After markup item 3: the search field gets `aria-invalid` and references the message                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | P1  |
| SETUP-17 | "Fill the crate" saves styles, years, formats and load years (read back through `/api/settings`) and starts the load                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | P1  |
| SETUP-18 | Held at `100-to-dig`, once its count shows: the Download and Read `<progress>` rows have values, releases kept and records to dig are counted, "Just pulled" names a release; the header shows "loading N%" and the page keys work again                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | P1  |
| SETUP-19 | Held at `100-to-dig`: the records to dig reach the checkpoint's count while the download is held, so the load read the growing file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | P1  |
| SETUP-20 | Imports slower than the load's start (the wantlist pages held at the fake): "Reading your collection and wantlist first, so the load also keeps other records on your labels." and "Start without it"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | P2  |
| SETUP-21 | Held at `100-to-dig`: "Start digging" is disabled and "ready at 500 records" shows; released to `600-to-dig`: enabled once its count shows; Enter and the button open Triage with the sandbox off (the page; its first record follows SETUP-01's gap). `T` is also the page key, which works during the load whatever the count (`docs/FIRST_RUN.md`)                                                                                                                                                                                                                                                                                                                                                                                                                                                          | P1  |
| SETUP-22 | Practice round: the banner counts "1 of 5"; after five verdicts "That's digging."; Enter turns the sandbox off and the five records come round again; `/api/export/decisions.json` holds none of them; Esc ends it early                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | P1  |
| SETUP-23 | The load finishes: the "ready to dig" stamp and the `h1` "The catalogue is in: …"; the header status says "The catalogue is in: …" once, the indicator goes; "Delete it" deletes the dump (`/api/dumps` is empty)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | P1  |
| SETUP-24 | "Change your picks" during the load cancels it and returns to step 3; releases the load added without a verdict are gone, releases with a verdict and the verdicts stay; a reload then opens the load's screen with "Cancelled". **Gap:** the picks start again from the suggestions, not from the previous picks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | P1  |
| SETUP-25 | With the load reading the growing file, the download fails part way (fake `failAfterBytes`): "The catalogue stopped loading: The download stopped: …", with Pick up and Change your picks; Pick up downloads again. **Gap:** the designed copy ("The download stopped at 4.1 of 10.5 GB: … it starts again." with "Start again"); and a download that fails before a load reads it (steps 2 and 3) shows nothing today: the strip goes, and "Fill the crate" then fails with "Dump file not found"                                                                                                                                                                                                                                                                                                             | P1  |
| SETUP-26 | Wrong checksum, with the load reading: "The catalogue stopped loading: The download stopped: … does not match its published checksum", with Pick up and Change your picks. **Gap:** designed is "The download does not match Discogs' checksum" and one more download by itself before asking                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | P2  |
| SETUP-27 | A crash during the load (`relaunch({ crash: true })`): the jobs are marked failed as interrupted; the setup offers Pick up, which reads the dump from the start                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | P1  |
| SETUP-28 | Resume as built: a new page opens the load's screen once a load exists, step 1 before the download starts, and step 2 while the catalogue comes, or step 3 when the address asks for it. **Gap:** earlier answers come back only where the server holds them (the connected account); the picks do not                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | P1  |
| SETUP-29 | **Gap.** Picks that match nothing: today the load ends with no records to dig and "Start digging" enabled. Designed: "Nothing in the catalogue matches these picks" and Change your picks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | P2  |
| SETUP-30 | A library with a finished load never shows the setup; `#/setup` goes to Triage [`small`]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | P1  |
| SETUP-31 | Digging during the load, held at `100-to-dig`: at the end of the queue "You have dug everything loaded so far."; after release, once `/api/stats` counts more records to dig, `runFor(10_000)` and the next record shows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | P1  |
| SETUP-32 | The listing says 2 MB and the transfer's `Content-Length` 900 TB: the download job fails for lack of space before it writes a byte (`/api/jobs`). **Gap:** the setup shows nothing of it (see SETUP-25); designed: the reason on the step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | P2  |
| SETUP-33 | A load that finishes with fewer than 500 records to dig enables "Start digging"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | P1  |

### Triage [`small`, sandbox off unless stated]

`small` has no Discogs account, so a live `A` or `C` there pushes after the grace and the server
answers `400` ("Set your Discogs username in Settings first"). Tests on `small` judge without
them; scenarios with pushes use `small-account` with a saved token.

| ID     | Scenario                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | P   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| TRI-01 | The first record in label-sweep order shows its facts (catalogue number, label, artist heading, title, year and country, format, styles), a tracklist with each track's video state, and "Up next"                                                                                                                                                                                                                                                                                                 | P1  |
| TRI-02 | Before a key press the player shows the Space key cap and "start listening" (status "waiting for Space"); Space plays with sound at `startAtFraction` of the video (the cued `startSeconds`); the now-playing line and "playing" follow                                                                                                                                                                                                                                                            | P0  |
| TRI-03 | Space pauses and resumes; `←` and `→` seek by the saved seek step; `1` to `9` jump; the position slider follows                                                                                                                                                                                                                                                                                                                                                                                    | P1  |
| TRI-04 | `J` and `K` change track; `J` skips heard tunes and refused videos and falls back to heard ones; `K` skips refused videos but not heard ones; a video's end advances; `J` on the last track says "That was the last track. Judge it."; after the last video ends, "end of the tracks"                                                                                                                                                                                                              | P1  |
| TRI-05 | The next release's first video and the track `J` moves to are loaded muted on the hidden decks; after a verdict the next release plays without a new load (fake `loads()`); "Up next" reads "buffered, starts at once"                                                                                                                                                                                                                                                                             | P1  |
| TRI-06 | After `runFor(4500)` of playback a listen is posted (awaited); once `J` moves on, the track reads "played"; the same tune on another release reads "heard"                                                                                                                                                                                                                                                                                                                                         | P1  |
| TRI-07 | [`small-account` with a saved token] `R`, `A`, `C`, `L` and `D`, each judged and settled: the slip's stamp (`STATUS_COPY`), the record leaves, dug and "this session" count up; the pushes for `A` and `C` end "Added to your Discogs wantlist."; after a reload `/api/export/decisions.json` holds all five; `A`, `C`, `L` and `D` are on their shelves; `R` is on none                                                                                                                           | P0  |
| TRI-08 | `M` without a Maybe list shows the flash that points to Settings and writes nothing; with a list, `M` saves `maybe`, and the verdict bar offers it                                                                                                                                                                                                                                                                                                                                                 | P1  |
| TRI-09 | `N` passes: slip "later"; the record returns after the queue, and the end screen offers "go round the N you passed"                                                                                                                                                                                                                                                                                                                                                                                | P1  |
| TRI-10 | `Z` walks back a verdict, `N` and `X` one step per press and returns to each record; slip "undone"; after the `DELETE` answers, the export no longer holds the verdict                                                                                                                                                                                                                                                                                                                             | P0  |
| TRI-11 | A held verdict key (`keyboard.down` twice, then `up`) judges one record                                                                                                                                                                                                                                                                                                                                                                                                                            | P1  |
| TRI-12 | [`small-account` with a saved token] `E` gives the record a note, then `A`: the slip reads "Adding to your Discogs wantlist…", then "Added to your Discogs wantlist."; the fake got `PUT /users/dj/wants/{id}` with the note. A plain `A` sends no body                                                                                                                                                                                                                                            | P0  |
| TRI-13 | [`small-account` with a saved token] With the clock paused, `A`, then `Z` after the verdict has settled and before the grace ends: after the undo has settled and `runFor(2000)`, the page sent no wantlist request and the fake got nothing after `A`. `Z` after the push: the fake gets `DELETE`                                                                                                                                                                                                 | P0  |
| TRI-14 | [`small-account` with a saved token] `C` pushes like `A`; the note sent lists the grail and keep tracks and the record's note (decision 70)                                                                                                                                                                                                                                                                                                                                                        | P1  |
| TRI-15 | [`small-account` with a saved token] The push fails (fake `500`, the page's `502` declared): "Saved, but not on the Discogs wantlist."; Twelves marks the record                                                                                                                                                                                                                                                                                                                                   | P1  |
| TRI-16 | [`small-account`] Saving `e2e-token-other` keeps the username `dj`, and Settings' sandbox section warns before going live; a push then fails: the fake answers `403`, the page gets `502` (declared)                                                                                                                                                                                                                                                                                               | P2  |
| TRI-17 | `E`: the note field takes focus with the saved text; Enter keeps it; Esc cancels; the note survives `N` and `Z`; the verdict saves it (Twelves shows it)                                                                                                                                                                                                                                                                                                                                           | P1  |
| TRI-18 | `Shift+K`, `Shift+M`, `Shift+C` mark the playing track (its mark stamp, then the `POST /api/track-verdicts` awaited, since the stamp shows first); the same key again clears it; with nothing playing a flash explains; keep and grail marks reach the Tracks shelf, meh does not                                                                                                                                                                                                                  | P1  |
| TRI-19 | `X` hides the record's first label: after the settings save and the queue's reload have answered, its records are out of the queue, Settings lists the label, the slip says so; `Z` brings the label back                                                                                                                                                                                                                                                                                          | P1  |
| TRI-20 | `F`: the dialog lists the record's labels and artists, track artists included, and "Added by the last dump load"; Enter digs the first label; the banner counts what is left; only that label's records come; Esc returns to the whole queue                                                                                                                                                                                                                                                       | P1  |
| TRI-21 | `F` search: two letters list matches with record counts; `↓` moves to the options; a seller read in Settings comes first; no match says so                                                                                                                                                                                                                                                                                                                                                         | P1  |
| TRI-22 | A scope dug to the end: "Nothing is left to dig from the label …", "go round", and Esc back                                                                                                                                                                                                                                                                                                                                                                                                        | P2  |
| TRI-23 | `P`: "asking Discogs…" with `aria-busy`, then price, for sale, want and have, "checked just now"; the fake got `GET /releases/{id}?curr_abbr=EUR`; works in the sandbox                                                                                                                                                                                                                                                                                                                            | P1  |
| TRI-24 | `P` for a release Discogs no longer has (fake `404`): the flash says Discogs did not return the release; the line keeps no market data                                                                                                                                                                                                                                                                                                                                                             | P2  |
| TRI-25 | `O` opens `discogs.com/release/{id}` and `S` a YouTube search for artist and title (`expectExternalOpen`)                                                                                                                                                                                                                                                                                                                                                                                          | P1  |
| TRI-26 | `app.paste()` of a YouTube link: the server stores it, oEmbed's title matches a track, which plays; an unmatched link plays under "Other videos" (`data-video-id`); other text and a paste inside the note field attach nothing                                                                                                                                                                                                                                                                    | P1  |
| TRI-27 | A release without videos: "No videos on this release." with `S`, `⌘V` and `D`; verdict keys still work                                                                                                                                                                                                                                                                                                                                                                                             | P1  |
| TRI-28 | Refused videos: the playing video, refused with `app.youtube.fail(id, 150)`, is skipped with the notice "… won't play here: the uploader blocks embedding. Skipped." (the hidden decks find a refused catalogue video first, silently; see "The fake YouTube IFrame API"); a release whose only video is refused shows "Its only video won't play here.", and one whose several videos all are "None of its N videos will play here."; `embed="false"` videos show "no embed" and are never loaded | P1  |
| TRI-29 | Live: `D`, then a link pasted on Twelves' No audio shelf deletes the verdict (export), the record leaves the shelf, and Triage offers it again after a reload. Sandbox: with a saved `D` (given live), a pasted link leaves the saved verdict in the export (decision 74)                                                                                                                                                                                                                          | P2  |
| TRI-30 | The end of the queue: "all dug"; "hear the N snoozed again" starts a round with its banner; a verdict replaces a snooze, `N` leaves it, Esc returns                                                                                                                                                                                                                                                                                                                                                | P1  |
| TRI-31 | No releases loaded (a finished load that kept nothing): "No releases loaded yet." and the settings button                                                                                                                                                                                                                                                                                                                                                                                          | P2  |
| TRI-32 | Filters that match nothing: "Your filters match no records." with the loaded count                                                                                                                                                                                                                                                                                                                                                                                                                 | P1  |
| TRI-33 | The release detail request fails once (`route` abort): "The tracklist did not load"; Enter retries                                                                                                                                                                                                                                                                                                                                                                                                 | P1  |
| TRI-34 | `queue.limit: 5`: digging past the batch loads the next one without a gap, in live and sandbox mode                                                                                                                                                                                                                                                                                                                                                                                                | P1  |
| TRI-35 | A settings save restarts the queue and keeps the `F` scope; a color scheme change keeps the record on screen                                                                                                                                                                                                                                                                                                                                                                                       | P2  |
| TRI-36 | Leaving Triage pauses the sound (fake `audible()` is null); a listen past 4 s with at least 1 s more is posted on leaving, a shorter remainder is not; returning keeps the record and the undo history                                                                                                                                                                                                                                                                                             | P1  |
| TRI-37 | Pooled videos: the main release without video plays the repress's video at its own position (decision 72)                                                                                                                                                                                                                                                                                                                                                                                          | P2  |
| TRI-38 | Undated records on a wanted label reach the queue under the default filters (decision 91) [`small-account`]. The catalogue puts them in a default style, since `small` is loaded before the account's wants are imported                                                                                                                                                                                                                                                                           | P2  |
| TRI-39 | [`small-account` with a saved token] A push held at the fake, and `Z` while it is in flight: once the fake has received the `PUT`, `Z`; after the undo has settled, the push is released; the fake then gets the `DELETE`, and the release ends off the wantlist                                                                                                                                                                                                                                   | P1  |
| TRI-40 | A seller's shop [`small-account`, `shopkeeper` read]: `F` digs the seller; `A` on the record puts the seller's pressing on the wantlist (the fake's `PUT` names that release id, not the main release's)                                                                                                                                                                                                                                                                                           | P1  |
| TRI-41 | Held `→` (`keyboard.down` repeated) seeks once per repeat, while a held verdict key still judges once                                                                                                                                                                                                                                                                                                                                                                                              | P2  |
| TRI-42 | Digging ten records sends no request to the fake Discogs; the first comes with `P`                                                                                                                                                                                                                                                                                                                                                                                                                 | P1  |
| TRI-43 | A video the app loads to play while the page has activation stays unstarted (`app.youtube.blockSound()`); after `runFor(3750)` the player reads "waiting for Space"                                                                                                                                                                                                                                                                                                                                | P2  |

### Sandbox

| ID     | Scenario                                                                                                                                                                                                                                                                                                                                                                                                        | P   |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| SBX-01 | [`small-account` with a saved token] With the sandbox on, verdicts, marks, notes, listens, `A` and `Z` send no request to `/api/verdicts`, `/api/track-verdicts`, `/api/listen-log` or `/api/discogs/wantlist`, and the fake Discogs gets no `PUT` or `DELETE`; the slips say "Sandbox: nothing was saved.", and `A` ends with "Added to your wantlist (sandbox: nothing sent).", after which the logs are read | P0  |
| SBX-02 | Sandbox verdicts show in Twelves and the counts; a reload drops them                                                                                                                                                                                                                                                                                                                                            | P1  |
| SBX-03 | Turning the sandbox off: the next verdict is saved; the sandbox's verdicts and undo history are gone; turning it on again starts an empty sandbox                                                                                                                                                                                                                                                               | P1  |
| SBX-04 | A want given in the sandbox with the clock paused, then the sandbox turned off within the grace: after `runFor(2000)` no `PUT` ever reaches the fake (decision 55)                                                                                                                                                                                                                                              | P1  |
| SBX-05 | Setup work is real in the sandbox: a collection import fills the Owned shelf; `P` reaches the fake                                                                                                                                                                                                                                                                                                              | P1  |
| SBX-06 | The Maybe list import in the sandbox reads the real list and keeps its maybes in the tab                                                                                                                                                                                                                                                                                                                        | P2  |
| SBX-07 | [`small-account` with a saved token] A want given live with the clock paused, then the sandbox turned on within the grace: the verdict stays saved (export); after `runFor(2000)` the pending push has been dropped with the live history (no `PUT`), and Twelves marks the want as not on the wantlist                                                                                                         | P1  |

### Twelves [`small-account` with given verdicts]

| ID     | Scenario                                                                                                                                                                                                            | P   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| TWL-01 | Keys `1` to `9` pick the shelves with their counts; Everything leaves out no audio; an empty shelf shows its text                                                                                                   | P1  |
| TWL-02 | `J`, `K`, `↓`, `↑` move `aria-current` and keep it in view                                                                                                                                                          | P1  |
| TWL-03 | Paging [`bulk`, 1,200 restored verdicts]: 500 rows a page; `→` and `←` turn; `J` crosses into the next page; "Shelf pages" says "501–1,000 of 1,200 records"                                                        | P1  |
| TWL-04 | `S` changes the sort, and one order change is visible in the rows                                                                                                                                                   | P1  |
| TWL-05 | `/` focuses the filter; typing filters by one field; Enter leaves it; Esc clears it; "Nothing matches …"                                                                                                            | P1  |
| TWL-06 | `E` edits a note; Enter saves ("Note saved."); an empty note removes it; both survive a reload                                                                                                                      | P1  |
| TWL-07 | Re-judging, each from its own given state: want to grail keeps it on the wantlist; want to skip: the fake gets `DELETE`, and the row leaves the shelves (the export says skip); snooze to want: the fake gets `PUT` | P1  |
| TWL-08 | Wantlist and owned records refuse re-judging with a flash                                                                                                                                                           | P2  |
| TWL-09 | Wants missing from the wantlist carry the marker and the banner count; `A` retries a want and `C` a grail; with two or more, "add all N" pushes each and the banner says everything is on the wantlist              | P1  |
| TWL-10 | Maybe hand-off: without a list, the hint; with one, "N maybes are not on your Discogs Maybe list yet"; `I` reads the list (the fake holds two of them) and their markers go                                         | P1  |
| TWL-11 | `Z` undoes the last change, including its wantlist request                                                                                                                                                          | P1  |
| TWL-12 | Enter on a snoozed record starts a round in Triage from it; on another record a flash explains                                                                                                                      | P1  |
| TWL-13 | The Tracks shelf lists grail and keep marks with release and verdict; `E` edits a track note; verdict keys explain that marks change in Triage                                                                      | P1  |
| TWL-14 | The No audio shelf: `Y` opens a YouTube search; `app.paste()` attaches a link and the record leaves the shelf for the queue                                                                                         | P1  |
| TWL-15 | `O` opens the release on discogs.com                                                                                                                                                                                | P2  |
| TWL-16 | A verdict for a release in no dump reads "Not in the loaded dump (r:…)"                                                                                                                                             | P2  |
| TWL-17 | `A` then `R` pressed at once end as a skip, off the wantlist (decision 62)                                                                                                                                          | P2  |
| TWL-18 | Switching the sandbox remounts the shelf in the new mode                                                                                                                                                            | P2  |

### Settings [`small` or `small-account`]

| ID     | Scenario                                                                                                                                                                                                                                                       | P   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| SET-01 | The form shows the saved config and "All saved."; a change reads "Unsaved changes."; Revert restores; Save and `ControlOrMeta+S` save ("Saved. The queue has reloaded."); a reload keeps it                                                                    | P1  |
| SET-02 | The filter preview updates after a change without saving ("These filters match N records, M still to dig")                                                                                                                                                     | P1  |
| SET-03 | An invalid batch or seek step marks the field (`aria-invalid`, `:invalid`), shows the problem and disables Save. After markup item 3: the message is attached to the field                                                                                     | P1  |
| SET-04 | Hidden labels: one per line; a saved label leaves the queue; `X`'s labels appear here                                                                                                                                                                          | P1  |
| SET-05 | Styles checkboxes appear with several universe styles and narrow the queue                                                                                                                                                                                     | P2  |
| SET-06 | Order: one strategy change changes the first record in Triage; the shuffled order is stable across a reload (its seed is the server's UTC day)                                                                                                                 | P2  |
| SET-07 | Player: the start-at slider (`aria-valuetext`) and the seek step reach the player (fake `startSeconds`, seek distance)                                                                                                                                         | P1  |
| SET-08 | Token: saving `e2e-token-dj` says "Token saved." and whose; `e2e-token-refused` says "Not saved: …" and keeps the old one; Remove removes it                                                                                                                   | P1  |
| SET-09 | A token from the environment: the field is disabled with the hint; `PUT /api/discogs/token` answers `409`                                                                                                                                                      | P1  |
| SET-10 | [`small-account` with a saved token] Opening Settings costs about two Discogs requests (identity and lists; fake log), matching "Every request Digga makes"; on `small` it costs none                                                                          | P1  |
| SET-11 | Maybe list: "Read my lists" fills the select with public and private lists; choosing one and saving enables `M` in Triage; later the lists load when Settings opens and the button reads "Reload lists"; a failing read shows the hint                         | P1  |
| SET-12 | Currency: `P` then asks in the chosen currency and shows its symbol                                                                                                                                                                                            | P2  |
| SET-13 | Jobs: Collection and Wantlist add a row that runs and ends done with its counts; Twelves shows the imports                                                                                                                                                     | P1  |
| SET-14 | Jobs: a slow import (a page delayed 2 s at the fake) can be cancelled; the row ends cancelled once the page in flight has returned                                                                                                                             | P1  |
| SET-15 | Jobs: History reads the fake home's history file; Maybe list is disabled until a list is saved; Read shop needs a username, reads `shopkeeper`, and `F`'s search then offers the seller                                                                        | P2  |
| SET-16 | Dumps: the folder lists each dump with its size and use; Delete asks first (dismiss keeps it, accept deletes it); buttons are disabled while a dump job runs                                                                                                   | P1  |
| SET-17 | "Update from the newest dump": one job, download then load; the Library section then counts what the load added and did not find. **Gap:** the header indicator appears only after a reload, since only the app's start and the setup check for a running load | P1  |
| SET-18 | Load by file name from the datalist, with a limit and a dry run                                                                                                                                                                                                | P2  |
| SET-19 | Backups: with given verdicts and a `relaunch()`, whose start writes the day's decisions backup, `/api/backups` lists it and Settings shows it. The first start cannot: it runs before the given state exists, and an empty library gets no backup              | P2  |
| SET-20 | Exports: the three links download (completed, via `expectDownload`) JSON and CSV with the saved verdicts and marks, and without sandbox verdicts                                                                                                               | P1  |

### Persistence and lifecycle

| ID     | Scenario                                                                                                                                                                                                                                                                         | P   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| PER-01 | A live snooze (`L`) with a note (`E`), and a keep mark on a track (`Shift+K`, its `POST /api/track-verdicts` awaited), survive a reload and a `relaunch()`                                                                                                                       | P0  |
| PER-02 | After further changes, `digga backup` writes today's decisions; `digga restore` of that file into a fresh `small` library brings the verdicts back into Twelves                                                                                                                  | P2  |
| PER-03 | `relaunch({ crash: true })` during an import marks the job failed as interrupted; a graceful `relaunch()` during one records it cancelled once its page in flight has returned; Settings shows each                                                                              | P2  |
| PER-04 | [`small-account` with a saved token] The server does not take a want (`route` aborts `POST /api/verdicts` once): "The verdict was not saved: …", the record comes back, and after `runFor(2000)` nothing has reached the fake Discogs; the same key again saves it and pushes it | P0  |
| PER-05 | `restartServer()` in the middle of a session: the open page keeps working without a reload, and the next verdict is saved (**web**)                                                                                                                                              | P1  |

### Accessibility

| ID      | Scenario                                                                                                                                                                                                                                                                                                                                                                                                               | P   |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| A11Y-01 | axe finds no serious or critical violation, and no `landmark-unique` or `page-has-heading-one` violation, on: Triage (playing, no audio, end of queue), the Keys dialog, the scope picker, each Twelves shelf, Settings, each setup step, the crate while loading, the finished crate and the practice card. The region names are asserted directly, since axe reports a dangling `aria-labelledby` only as incomplete | P1  |
| A11Y-02 | The player hosts are `inert`, and Tab never reaches the fake player's focusable button; no focusable element keeps the page keys after a click                                                                                                                                                                                                                                                                         | P1  |
| A11Y-03 | Live regions exist before their updates: the slip (which starts with its instructions), the flashes and the header status are in the DOM before the text changes                                                                                                                                                                                                                                                       | P2  |
| A11Y-04 | Every route and setup step sets the document title                                                                                                                                                                                                                                                                                                                                                                     | P1  |

### Electron only

| ID      | Scenario                                                                                                                                                                                                                                                                           | P   |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| ELEC-01 | The app starts its server on a free port bound to `127.0.0.1` and opens the window at `localhost`                                                                                                                                                                                  | P0  |
| ELEC-02 | The library is the one the environment names, and userData, which holds the token file and the log, the one `--user-data-dir` names; nothing is written to the real userData                                                                                                       | P1  |
| ELEC-03 | The token saved in Settings is stored with `safeStorage` (the file holds no plain token) and survives a relaunch; runs only on an `executablePath` build launched without the mock-keychain switches, on a runner with an unlocked keychain                                        | P1  |
| ELEC-04 | `O`, `S`, `Y` and the discogs.com link call `shell.openExternal` and open no window                                                                                                                                                                                                | P1  |
| ELEC-05 | Export links save through `will-download` and complete                                                                                                                                                                                                                             | P1  |
| ELEC-06 | Menu items start jobs; the renderer shows their progress                                                                                                                                                                                                                           | P2  |
| ELEC-07 | Quitting during the download asks first (stubbed `dialog.showMessageBox`); cancel keeps it running; confirm waits for `server.stop()`, and the job ends cancelled                                                                                                                  | P1  |
| ELEC-08 | The load's progress reaches `BrowserWindow.setProgressBar`; a notification when it ends unfocused; `powerSaveBlocker` runs only during download and load                                                                                                                           | P2  |
| ELEC-09 | "Use a dump file I have" with a stubbed `showOpenDialog` loads the fixture dump                                                                                                                                                                                                    | P2  |
| ELEC-10 | `nativeTheme.themeSource` follows the saved scheme before the first paint                                                                                                                                                                                                          | P2  |
| ELEC-11 | The window's user agent does not name Electron (YouTube embeds reject it)                                                                                                                                                                                                          | P1  |
| ELEC-12 | The history import's permission error shows the Full Disk Access dialog (macOS)                                                                                                                                                                                                    | P2  |
| ELEC-13 | Before the held navigation is released, the window has not loaded the app and the fakes logged no request; the main process and a worker it starts cannot connect to a loopback port other than the fakes'; after release the page loads with the routes and fake YouTube in place | P1  |

### Real-service contract checks (manual, never in CI)

The fakes encode assumptions about Discogs and YouTube. A separate configuration,
`tests/e2e/playwright.contract.config.ts`, which the ordinary commands cannot select, checks them
against the real services when run by hand before a release:

| ID     | Check                                                                                                                                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CON-01 | The real IFrame API loads on `localhost`, plays a known embeddable video in headed Chromium, and emits the states the fake emits, with `getVideoData()`                                                                  |
| CON-02 | With a token the developer supplies for the run, and a client that refuses anything but `GET` (Discogs tokens cannot be limited to reading): identity, one release and one wantlist page have the fields the fake serves |
| CON-03 | data.discogs.com's listing still parses to the newest dump and its size, without downloading it                                                                                                                          |

## Electron

The shared suite needs no change for Electron. The work is the Electron host, the harness
preload and the Electron-only scenarios.

- **Launch.** `_electron.launch({ args: ["-r", preload, mainEntry], env })` with the isolated
  environment, `--user-data-dir` in the test's temp folder (the plan keeps the token file and the
  log in userData, which `DIGGA_DATA_DIR` does not move), the host-resolver switch and the
  keychain switches below. Then the sequence from "Startup order", then `firstWindow()` with its
  content size set to 1600 x 1000.
- **Main-process stubs.** Installed by the preload before the app's first line:
  `shell.openExternal`, `dialog.showMessageBox`, `dialog.showOpenDialog`, and spies on
  `setProgressBar` and `Notification`, recording calls for the test.
- **Native module ABI.** `@electron/rebuild` rebuilds `better-sqlite3` for Electron's ABI. If that
  happens in the repository's `node_modules`, the CLI, vitest and the web E2E host, all on Node's
  ABI, break. Rebuild only inside the packaged app's staging folder (electron-builder does this),
  and give the unpackaged test run its own install. The fakes run in the Playwright worker and
  need no native module.
- **Fuses.** `_electron.launch()` starts Electron with inspector arguments to attach to it, so a
  build with the `EnableNodeCliInspectArguments` fuse off cannot be launched by Playwright at
  all. The suite runs on an inspectable variant of each release candidate that differs only in
  that fuse. The final fused artifact gets a smaller check without Playwright: launched with the
  isolated environment, `--user-data-dir`, an empty library and the fake service URLs, with no
  preload and no hold, it must write its "listening on" line to its log and answer
  `GET /api/health`, and it is then stopped. Nothing guards it but the environment, so the check
  does nothing more.
- **Keychain.** `safeStorage` uses the macOS Keychain, libsecret or kwallet on Linux, and DPAPI on
  Windows. Playwright's loader, used with the `electron` package, always adds
  `--use-mock-keychain` and `--password-store=basic`; with `executablePath` there is no loader
  and no switches. The host therefore passes both switches itself, so no run touches the
  developer's login keychain. On Linux the basic store makes `safeStorage` report encryption as
  unavailable unless `safeStorage.setUsePlainTextEncryption(true)` was called, so the preload
  calls it there. The Electron spike checks a save, relaunch and read round trip with these
  settings on each OS. ELEC-03 alone omits the switches and runs on an `executablePath` build on
  a runner with a real, unlocked keychain.
- **Linux CI** needs a display: `xvfb-run`, whose `DISPLAY` and `XAUTHORITY` the launch helper
  passes through.
- **Downloads and external links** go through the handlers from "Product changes", item 6.

## Running

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
                page's requests and problems, and the declarations), fault-routes.ts
  pages/        triage.ts, twelves.ts, settings.ts, setup.ts, header.ts, dialogs.ts
  specs/        guard, shell, setup, triage, triage-player, sandbox, twelves, settings,
                persistence, a11y, electron
  contract/     the real-service checks
tools/dev/fake-services.ts   the fakes, used by the harness and for rehearsals by hand
```

**Projects.** `web-chromium` runs every test not tagged `@electron`. `web-firefox` and
`web-webkit` join the nightly run once the Chromium suite has been stable for a few weeks; the
browser version must work in current Firefox and Safari, and the `closedby` fallback on dialogs
is one reason to check. `electron` runs every test not tagged `@web`.

**CI** (there is none yet; GitHub Actions is assumed): on each pull request, `vp run verify` and
`vp run e2e` on Ubuntu with Node 24, with the HTML report and failure artifacts uploaded; sharding
once the run exceeds its budget. Once `verify` includes `e2e:smoke`, the CI's `e2e` step leaves
out `@P0` so the smoke set does not run twice. Nightly: P2, and once stable, the other browsers
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

## Rules for agents writing E2E tests

1. Start every test from a named template and explicit given-state. No test depends on another.
2. Act through keys and visible controls; assert through the UI, then the public API. Never open
   the database.
3. Locate by role and name, label, `aria-keyshortcuts` or domain `data-*`, in that order. Never
   by class, structure or generated id.
4. Never `waitForTimeout`. Wait for a completed request, a state the app exposes, or an entry in
   the fake's log. The first visible sign of an action is not proof that it finished. Before an
   action, wait for its precondition: a key pressed before Triage shows a record does nothing.
5. Install the clock before the app starts, advance it with `runFor()`, and remember that it moves
   only the browser. Pause it before an action that must land inside a timer's window.
6. A negative assertion first waits for the request that closes the window and the state the page
   sets after it, then advances the clock, then checks the page's requests and the fake's log.
7. Import keys and copy from `keymap.ts`, `routes.ts`, `player/status.ts` and `twelves/model.ts`
   instead of repeating them.
8. Only fake tokens. Never set a real token, never read the developer's environment, and start
   every Digga process through `spawnDigga()`.
9. A test that needs a new product hook asks for an accessible name or ARIA state first, then a
   domain identity attribute, then a state attribute; never a `data-testid` without a comment.
10. Run a new or changed spec with `--repeat-each=10`. A flaky test is fixed or removed, not
    retried.
11. When a bug crosses layers, its fix adds an E2E scenario with a new ID in this document.
12. A scenario the product does not meet yet is marked as a gap here. Today's behaviour gets a
    normal test and the design a `test.fail`; never assert today's behaviour as if it were the
    design.

## Rollout

0. **Spikes (one session each, independent).**
   - Web, done on 2026-09-30 (see "Spike results"): `@playwright/test`; `spawnDigga()` with the
     isolated environment and the socket guard and its vitest test; the base route with
     `route.fetch()`; the fake YouTube script with its user-activation object; the `small` and
     `small-account` templates from a hand-written dump; GUARD-01, GUARD-02, SHELL-01, TRI-07 and
     TRI-10.
   - Electron, throwaway: a minimal main process that follows the plan's startup, outside the
     product. Check the preload's guard in the main process and in a worker it starts, the held
     first `loadURL()` (no request before release), routes, init scripts and the clock on
     `electronApp.context()`, the host-resolver switch, the safeStorage round trip with the
     keychain switches, `relaunch()`, and whether a packaged build honours `-r`. Record the
     results in this document before the host interface is fixed.
1. **Harness.** The rest of product changes 1 to 5; the fake services with data.discogs.com,
   checkpoints and the rest of the Discogs API, moved to `tools/dev/fake-services.ts`; the `empty`
   and `bulk` templates; the rest of the host interface; page objects; the rest of the P0 set; the
   commands and the `tests/e2e/` layout in AGENTS.md. `e2e:smoke` joins `vp run verify` after it has
   passed a burn-in of `--repeat-each=20`, since `verify` must be green before every commit.
   Done on 2026-10-01: product changes 3 and 4; data.discogs.com in the fakes module with the
   listing, the checksum, holds at checkpoints and `failAfterBytes`; the checkpoint builder and the
   bulk catalogue; the `empty` template; the setup page object; the whole P0 set, which passed
   its burn-in; the layout in AGENTS.md. Still to do: the rest of the fake services' settings and
   of the Discogs API, the move to `tools/dev/fake-services.ts`, the `bulk` template, the rest of
   the host interface and page objects, and the decision on `e2e:smoke` in `verify`.
2. **Coverage.** The P1 scenarios, axe scans, failure artifacts and the CI workflow. Started on
   2026-10-01 with the first half of Triage's P1 scenarios, the record, the player and the
   tracklist: TRI-01, TRI-03, TRI-04, TRI-05, TRI-06, TRI-11, TRI-17, TRI-18, TRI-26, TRI-27,
   TRI-28 and TRI-36 (see "The first Triage P1 slice"). Next: the other half of Triage (verdicts,
   queue, scope, market, seller and wants), then the other families.
3. **Breadth.** P2 scenarios, the contract configuration, and once the Chromium suite is stable,
   the Firefox and WebKit projects and the nightly burn-in. Optional: a few `toHaveScreenshot`
   checks of the main screens, on Linux only, where snapshot updates need a human review.
4. **Electron** (with session 7). Product change 6, the Electron host and preload, the ELEC
   scenarios, and the shared suite on the unpackaged app and the inspectable release candidate.

## Spike results

The web spike was built on 2026-09-30 on macOS with Node 24.18, Playwright 1.63.0 and its
Chromium 153. GUARD-01, GUARD-02, SHELL-01, TRI-07 and TRI-10 pass. The spike showed:

- **The Node guard works in every call form.** Loaded through `NODE_OPTIONS=--import`, it refused
  fetch to `127.0.0.1`, to `localhost` and to an external host, a redirected fetch, `http.get`,
  `https.get`, `tls.connect`, `net.connect` in both call forms, `socket.connect`, and fetch in a
  worker thread, and let the fakes' port through (`tests/e2e-guard.test.ts`). Without the guard,
  GUARD-01 fails: the server's oEmbed lookup reaches the test's listener.
- **Redirects need the harness's fetch**, and user activation needs the harness's flag; the
  measurements are in "The network and filesystem guard" and "The fake YouTube IFrame API".
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
  `Date.now()` (see "Time"). Reading the time and pausing took 29 ms at the median, 155 ms at the
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
  modules (see "Product changes the harness needs").
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
videos" rows. The work showed:

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
  passed record has none (TRI-09 and TRI-30 cover that screen).
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

## Risks and open questions

- **Per-test server processes** keep tests isolated but cost a Node start each, about 200 ms in
  the spike.
- **Real timers on the server.** The Discogs client's 1.1 s gap makes tests that touch Discogs
  several times slower. If the suite exceeds its budget, a `discogsMinIntervalMs` server option
  set by the harness would help, at the cost of not running production spacing in E2E.
- **Real disk space** stays a precondition of the run rather than something the tests control;
  see "Disk space".
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
- **Open:** `e2e:smoke` has passed its burn-in (see "The first-run setup path"). Should it be part
  of `vp run verify`, which would then take about 13 s longer and need Playwright's Chromium on
  every machine that commits? Which browsers must the web version support? Is a CI provider other
  than GitHub Actions planned? Are visual snapshots wanted at all? What does the Electron app do
  when `safeStorage` cannot encrypt, as on Linux without a keyring: refuse to save the token, or
  save it with the plain-text key?
