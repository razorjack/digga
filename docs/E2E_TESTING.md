# End-to-end testing

Status: proposed on 2026-09-30 and revised the same day after two rounds of review. The web spike
(Rollout, step 0) is built, and so is the whole P0 set, with the first-run setup (SETUP-01) and
the checkpoint scenarios SETUP-18, SETUP-19 and SETUP-21, Triage's P1 set: the record, the
player and the tracklist first, then the verdicts, the queue, scopes, the market, the seller and
the wants, Settings' P1 set, Twelves' P1 set with the `bulk` template, and the P1 sets of Shell,
Sandbox and Persistence with `restartServer()`, and the setup's P1 scenarios for steps 1 to 3,
before the load starts; the fake services have moved to `tools/dev/fake-services.ts`. On
2026-10-02 the ten product gaps the suite recorded were closed, with SHELL-12, SETUP-24, SETUP-25,
SETUP-26, SETUP-28, SETUP-29 and SETUP-32 built for them; no scenario is a gap now. The results
are recorded in "Spike results". The rest is not built yet. This is the design of Digga's
end-to-end (E2E) tests: the tool, the harness, the fake services, the markup the tests rely on,
and the scenarios the suite should cover. The same tests must run against the browser app now and the Electron app later
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
  cli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }>;
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
  /**
   * Aborts the page's next matching requests (one by default), for the current launch; with
   * `times: Infinity`, every one until the test calls lift().
   */
  abortRequests(
    match: { method: string; path: string },
    options?: { times?: number },
  ): Promise<{ lift(): Promise<void> }>;
  /** Declares aborts, /api errors, console errors and page errors the test causes on purpose. */
  expectProblems(problems: ExpectedProblems): void;
}
```

**Web host.** It prepares the library, config and fake home, spawns the server, prepares a
browser context (below) and opens the page. Everything above is built in the web host; `cli()` runs the command through `spawnDigga()` with the test's environment
and resolves when it exits, with a `null` code when a signal ended it. The console, page-error and request collectors are
attached to the context. `relaunch()` closes the context first, so no request of the page meets a
stopped server, then stops the server, and starts both again with the whole preparation and new
collectors; the port may change. The collectors feed one log per test, so a problem from an
earlier launch still fails the test. `restartServer()` keeps the port, so the open page
reconnects without a reload. It first waits until none of the page's `/api` requests is in
flight (the browser log counts them from Playwright's `request`, `requestfinished` and
`requestfailed` events), then stops the server over IPC, or kills it with `crash`, and starts
`digga serve --port <the same port>`. A request the page sends while no server runs fails: the
base route records the failed fetch and Chromium logs "Failed to load resource:
net::ERR_FAILED", which fails the test unless declared. Waiting for timers is the test's part:
PER-05 waits for the stats refresh its verdict schedules. Another worker's `--port 0` could take
the port in between; the restart then fails with "another process took port N while the server
restarted" rather than moving to another port, where the page could not follow.

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
  popup; in Electron a stub of `shell.openExternal`. It returns once the URL is known. The web
  host's route matches every URL outside the app's origin, answers the window's page and nothing
  else the window asks for (`404`), and is removed once the window is closed, so the URL neither
  reaches the network nor counts as refused, while an external URL the app opens outside the
  helper still reaches the base route and fails the test ("the browser requested …"). The app
  opens with `window.open(url, "_blank", "noopener,noreferrer")`; the context's `page` event
  still sees that window.
- `expectDownload()` resolves only when the download has completed: in the web host it arms the
  page's `download` event before the action and awaits `download.saveAs()` into `downloads/` in
  the test's output folder, which resolves once the download has completed and rejects for one
  that failed; in Electron the `will-download` handler sets that path and the helper waits for
  `done` with state `completed`. Built in the web host (SET-20).
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
drops one, so a load of it has small exact "added" and "missing" counts. Videos
that YouTube has and no release lists, one titled after a track that has none, are there to be
pasted (TRI-26), and one titled after the release without videos (TWL-14).

Records that only some scenarios reach sit on labels that sort after those of the first records,
so the default queue starts as before, and a scenario digs them with `diggaOptions.labels`. The
catalogue names the records that scenarios refer to (`FIRST_RECORD`, `TRACK_RUN`,
`SAME_TUNE_ELSEWHERE` and so on) and says in a comment which scenarios they serve. Built so far:
20 releases in the August dump, of which Twelves' scenarios name `THIRD_RECORD`, `IN_COLLECTION`,
`ON_WANTLIST` (on `dj`'s wantlist, so a want of it given in Digga is on the wantlist) and
`EVENT_HORIZON`, the release in no dump (see "The first Triage P1 slice" and "The
second Triage P1 slice"), and the September dump (`SMALL_SEPTEMBER`): the August releases but
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
the default library once (see "The setup's steps 1 to 3 P1 slice"). The fakes never answer with a
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
- Triage's other actions end the same way. A push with time flowing ends once
  `POST /api/discogs/wantlist/:id` has answered, which happens after the server's call to the
  fake, and the slip shows how it ended. `P` ends once `POST /api/releases/:id/enrich` has
  answered and the market line is no longer `aria-busy`. `X` and `Z` on a label end once
  `PUT /api/settings` and the `GET /api/queue` after it have answered. `F`'s search ends once the
  `GET /api/scopes` for the typed text has answered and the status no longer reads "Searching…";
  Enter in the picker ends once the `GET /api/queue` with that `scope` has answered, and Esc on a
  scope once the one without it has. A tracklist's retry ends with its `GET /api/releases/:id`.
  `T` from another page ends once the `GET /api/queue` that Triage sends when it is shown has
  answered (`showAgain()`).
- Settings' actions end the same way (`pages/settings.ts`). Save, by button or `ControlOrMeta+S`,
  ends once `PUT /api/settings` and the `GET /api/queue` the hidden Triage page sends after it have
  answered and the bar reads "Saved. The queue has reloaded."; a token save once
  `PUT /api/discogs/token` has answered and the button reads "Save token" again, by when the
  status line reads the outcome; a job once its row's status cell reads the state the test waits
  for; Cancel once the cancel and the `GET /api/jobs` after it have answered; Delete once
  `DELETE /api/dumps/:name` has answered with the folder's new listing and the row has gone.
- Twelves' actions end the same way (`pages/twelves.ts`). Its flash shows only after the work it
  reports: a re-judgement saves the verdict, then adds to or takes from the Discogs wantlist, then
  shows the flash and loads the shelf again. So a re-judgement ends once `POST /api/verdicts` and
  the `GET /api/twelves` after it have answered and the flash says where the record went; a
  change to the wantlist has reached the fake by then, since the server answers the page only
  after the fake has answered it. A note ends once its `POST /api/verdicts` has answered and the flash reads
  "Note saved." or "Note removed."; a track note the same way with `POST /api/track-verdicts`; `A`
  or `C` on a want already judged so (a retry) once `POST /api/discogs/wantlist/:id` and the reload
  after it have answered and the flash says it was added; "add all" once the flash counts what
  was added, after the last push and the reload; `I` once its `POST /api/jobs/import/list` has
  answered and the flash says what the list holds, after the job has ended and the shelf has
  loaded; `Z` once the restored verdict and the reload have answered and the flash says "Undone";
  a paste once `POST /api/releases/:id/videos` and the reload have answered and the flash says the
  link is attached; `J`, `K`, the arrows and the page turns once another row has
  `aria-current="true"`; Enter on a snoozed record once Triage shows the record under the round's
  banner. A flash with no request behind it, such as a verdict key on the Tracks shelf, comes from
  the key press itself, so the check that nothing was sent can follow it at once.
- The Keys dialog's actions (`pages/dialogs.ts`): `?` ends once the dialog is visible. A close,
  by `?` again, Esc, the close button or a click on the backdrop, ends once the dialog's `close`
  event has reached a listener the page object added before the action, and the dialog is
  hidden. The browser hides the dialog before it fires `close`, and the app learns of the close
  only from that event, so a page key pressed between the two would still find the help open;
  the app's listener was added first, so it has run by then. The listener goes in through
  `evaluateHandle()`, which returns at once: a first version started `locator.evaluate()`
  without awaiting it, the key press won the race, and the hidden dialog no longer matched the
  locator, so the wait hung.
- Settings' sandbox switch (`switchSandbox()`) ends once `PUT /api/settings` and the
  `GET /api/queue` that the hidden Triage page sends in the new mode have answered, the page says
  it switched, and the header's sandbox stamp shows or has gone. An Appearance radio
  (`chooseColorScheme()`) ends once its `PUT /api/settings` has answered and the root element
  carries the scheme in `data-color-scheme`.
- The setup's actions end the same way (`pages/setup.ts`). A step change ends once the address,
  the step list's `aria-current="step"` and the step's heading show the new step. Fetch ends once
  `POST /api/jobs/dump-download` has answered and step 2 shows; Continue on step 2 once a
  `POST /api/jobs/import/<kind>` has answered for each import it starts and step 3 shows; Connect
  once `PUT /api/discogs/token` and the `GET /api/discogs/profile` after it have answered and
  Continue is enabled again, which happens only when the step's work, the settings read included,
  is done; a refused token once the `PUT` has answered `400` and Connect is enabled again; Try
  again and Check again once `GET /api/setup` has answered; "Fill the crate" once `PUT
/api/settings` and `POST /api/jobs/dump-load` have answered and the crate shows. "Fill the
  crate" with no style picked sends nothing and ends once the search field has `aria-invalid`. A
  year ends once Tab has left its field, which commits it (`change`), and the field shows it.
- A live region that must be in the page before its text (accessibility bug 4) is checked with
  `LiveRegionWatch` (`support/live-regions.ts`). Installed before the page opens, its init script
  runs a `MutationObserver` from the page's first script and records each live region
  (`role="alert"`, `role="status"` or `aria-live`) inserted with text already in it. The test reads
  the record after the message shows and checks that the message is not in it. A region present
  when the step mounts and filled later passes; a region inserted with its text fails, as the old
  markup did in SETUP-05, SETUP-08 and SETUP-09. Regions inserted with their text when a page
  first renders are recorded too, which is harmless and why the tests look for their own message.
- A key that should do nothing is checked in the page: a page key sets the hash inside its
  keydown handler, and the handler has run when `keyboard.press()` returns, so `location.hash`
  read with `evaluate()` straight after is exact (SHELL-03, SHELL-04). `page.url()` follows a hash
  change through a separate event. Against a build without the guards the hash had changed by
  then in every run.
- A negative check after a push grace that a mode switch interrupted (SBX-04, SBX-07) runs the
  clock past the grace, then waits for the answer to a later request, the `GET /api/queue` that
  `T` sends. Playwright delivers the browser's events in order, so a request that the grace's end
  started is in the page's log by then.
- A response that must follow another is matched in order: the first wait notes its match inside
  its own predicate (`waitForResponses()` in `pages/triage.ts`). Playwright runs predicates in the
  order the responses arrive, but a callback chained to the first wait can run after both
  responses have been dispatched, when they arrive together, and the second wait then never
  matches. The Settings burn-in hung once in 60 runs on exactly that (see "The Settings P1 slice").
- Settings' Delete asks with `window.confirm()`, and Playwright dismisses a dialog no listener
  handles. `deleteDump()` registers a `once("dialog")` listener before the click, which records
  the dialog's type and message and accepts or dismisses as the test says.
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

The first Triage P1 slice added `data-video-id` on the tracklist's "Other videos" rows. The second
needed no markup: its scenarios locate everything by role, name, `aria-keyshortcuts`, the
existing handles and visible text.

The Settings P1 slice added the rest of the Settings markup: `data-job-id` on the job rows, the
names of the five sections, and the two Settings bullets of accessibility bug 3 (see "Markup
audit").

The Twelves P1 slice added `data-triage-key` and `data-release-id` on Twelves' rows,
`data-release-id` and `data-position` on the Tracks shelf's rows, and the pager's name of
accessibility bug 2 (see "Markup audit").

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

The setup's steps 1 to 3 slice added the setup's part of accessibility bugs 3 and 4 for those
steps, the name "load to" (see "Markup audit"), and moved the steps and their titles
(`SETUP_STEPS`) from the rune module `flow.svelte.ts` into the plain module
`src/client/setup/steps.ts`, which the page object imports.

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
   (`LiveRegionWatch`, see "Synchronisation"); against the old markup all three failed. The
   crate's "stopped loading" notice and error paragraph are still inserted with their text; they
   come with the crate's scenarios.

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
  work (see "Synchronisation"). On a failed save the slip clears and the busy state goes with it.
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
that holds an element with `aria-current="true"` (`TriagePage.currentTrack`), and Twelves'
selected row is the row with `aria-current="true"` (`TwelvesPage.selected`); Twelves' rows are
found by `data-triage-key`, and the Tracks shelf's by `data-release-id` and `data-position`. The banner above
the desk during a round or a scope has no role, so `TriagePage.banner` finds it by its opening
words; the market line is the only `status` in the record's header (`TriagePage.market`).

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

| ID       | Scenario                                                                                                                                                                                                                                                                                                                             | P   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- |
| SHELL-01 | A loaded library opens on Triage: title "Triage – Digga", header counts dug and to go, the first record                                                                                                                                                                                                                              | P0  |
| SHELL-02 | `T`, `W` and `,` switch pages; `aria-current="page"`, the hash and the title follow                                                                                                                                                                                                                                                  | P0  |
| SHELL-03 | Page keys are ignored in a text field (Settings' username), and with Cmd, Ctrl or Alt; they work with a clicked checkbox focused (decision 60)                                                                                                                                                                                       | P1  |
| SHELL-04 | `?` opens the Keys dialog with the current page's groups (Triage's and Twelves'); Esc, the close button, the backdrop and `?` again close it; page and verdict keys stay quiet while it is open; after each close the body has focus                                                                                                 | P1  |
| SHELL-05 | With the sandbox on, the header stamp links to `#/settings/sandbox`, which highlights the Sandbox section and focuses the switch. The highlight is drawn only (a background and an inset bar), so the test reads the computed `box-shadow`, and `none` on `#/settings`                                                               | P1  |
| SHELL-06 | Opened on `127.0.0.1`, the page shows the warning with the `localhost` link (**web**)                                                                                                                                                                                                                                                | P2  |
| SHELL-07 | Settings load normally; `route` aborts `/api/queue*` and `/api/stats*` until lifted: the header reads "Server unreachable" (it does only while stats have never loaded) and Triage "The queue did not load"; once requests pass, Enter loads the queue, and a page change brings the header's counts                                 | P1  |
| SHELL-08 | An unknown hash opens Triage                                                                                                                                                                                                                                                                                                         | P2  |
| SHELL-09 | Appearance: System follows the emulated scheme; Light and Dark apply at once (`data-color-scheme`, computed `color-scheme`), survive a reload, and do not restart the Triage queue                                                                                                                                                   | P1  |
| SHELL-10 | Browser Back and Forward move between pages and setup steps (**web**; Electron if the window keeps history)                                                                                                                                                                                                                          | P2  |
| SHELL-11 | At 840 px wide the Triage columns are stacked (980 px and below) and the header wraps (860 px and below); every control stays reachable                                                                                                                                                                                              | P2  |
| SHELL-12 | `/api/settings` fails while the app opens (aborted until lifted): Triage says "The settings did not load." with the reason and "try again" (`Enter`), and asks for no queue; once the server answers, Enter reads the settings and the queue starts. Settings says "Settings did not load: …" with "Try again", which shows the form | P2  |

### First run (`#/setup`) [`empty`, fake data.discogs.com serving the bulk dump]

| ID       | Scenario                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | P   |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| SETUP-01 | The first run from the default config: the sandbox is on at first (`/api/settings`); fetch, connect with `e2e-token-dj`, keep the suggested styles, fill the crate; the config then has the sandbox off; with the transfer held at `600-to-dig` and its count shown, "Start digging" opens Triage on a record; the first verdict is in `/api/export/decisions.json`. Triage reads its queue again when it is shown (decision 112). A second test pauses the clock before the picks are saved, which keeps Triage from looking again at the end of its queue, and opens Triage with `T` at `100-to-dig`: it shows a record        | P0  |
| SETUP-02 | An empty library opens `#/setup/catalogue`; the header holds only the wordmark; `T`, `W` and `,` do nothing; the step list marks step 1; the title is "Fetch the catalogue – Digga setup"                                                                                                                                                                                                                                                                                                                                                                                                                                        | P1  |
| SETUP-03 | Step 1 shows the dump's date, listed size, folder and free space; the fake logged no download before the button                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | P1  |
| SETUP-04 | data.discogs.com answers `503` for every request (fake `set({ unavailableStatus: 503 })`): step 1 reads "Digga can't reach data.discogs.com: … answered 503." with Try again and no Fetch; once the fake recovers, Try again shows the dump and enables Fetch                                                                                                                                                                                                                                                                                                                                                                    | P1  |
| SETUP-05 | The listing says 900 TB, set before the page opens: an alert, in the page before its text, with the space needed (the size and 1 GB to spare), the folder and `DIGGA_DUMPS_DIR`; Fetch is disabled; "Check again" reads the setup again and still finds too little                                                                                                                                                                                                                                                                                                                                                               | P1  |
| SETUP-06 | The dump is already in the dumps folder (the listed September dump in `diggaOptions.dumpFiles`): step 1 says "Digga has the 1 September 2026 catalogue already", and Continue moves on without a download. Until the setup's steps 1 to 3 slice the setup opened step 2 instead (see its results)                                                                                                                                                                                                                                                                                                                                | P1  |
| SETUP-07 | Enter starts the download; the download strip shows on steps 2 and 3 with a `<progress>`; the step is in the address; a reload stays on it; the step's Back goes a step back, to step 1 with "The catalogue is downloading."; the fake sent one transfer over the reloads. The browser's Back is SHELL-10                                                                                                                                                                                                                                                                                                                        | P1  |
| SETUP-08 | A token Discogs accepts: "Connected as dj: 1 in your collection, 2 wants." in a status region that was in the page before; the username is adopted (`/api/settings`); the currency comes from the profile (GBP, not the default EUR), and Continue without the imports saves it                                                                                                                                                                                                                                                                                                                                                  | P1  |
| SETUP-09 | `e2e-token-refused`: the step's alert, in the page before its text, shows Discogs' refusal; nothing is saved, the username stays empty; the field has `aria-invalid` and references the alert after its hint until it is edited (markup item 3)                                                                                                                                                                                                                                                                                                                                                                                  | P1  |
| SETUP-10 | "No token? Use your username": the public profile is read; a later want stays in Digga, its push fails with the declared `400` ("Set your Discogs token in Settings first"), and Twelves marks it as not on the wantlist                                                                                                                                                                                                                                                                                                                                                                                                         | P2  |
| SETUP-11 | Skip moves to step 3 with nothing connected: no suggestions and no picks, no Discogs request and no import job                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | P1  |
| SETUP-12 | Browser history: the checkbox and browser list appear only for browsers with a history file in the fake home; a browser folder the harness makes unreadable (`chmod 000` on the root it lists, POSIX, not as root, restored in cleanup) is listed too, with the Full Disk Access hint; the import marks the fixture's visited releases as seen                                                                                                                                                                                                                                                                                   | P2  |
| SETUP-13 | Continue starts the collection and wantlist imports as jobs and moves on at once: with the wantlist page held at the fake, step 3 shows while that import runs; released, both end `done`, and the fake logged one page of each for `dj`                                                                                                                                                                                                                                                                                                                                                                                         | P1  |
| SETUP-14 | Step 3 with imports: the account's styles that the census knows are picked ("mostly Drum n Bass"; the fixture's Techstep is not a Discogs style); with 3 imported releases the years default to the middle 80% of the census's releases for the picks; the estimate is a `status` line with the census's count                                                                                                                                                                                                                                                                                                                   | P1  |
| SETUP-15 | Style picker: "jung" then Enter picks Jungle; "Often tagged with" adds Drum n Bass; "Remove Jungle" removes it; a genre opens as `<details>` with its styles as checkboxes (Electronic: Drum n Bass checked, Breakbeat picked); Vinyl only changes the estimate; the load-years disclosure shows the span widened by 3 years each side, and a change shows in its summary                                                                                                                                                                                                                                                        | P1  |
| SETUP-16 | Validation: with no style, Fill the crate sends nothing, and the search field gets `aria-invalid` and references "Pick at least one style" after its hint until a style is picked (markup item 3); "from" is capped by "to" (`max`), and a "from" past it blocks the submit                                                                                                                                                                                                                                                                                                                                                      | P1  |
| SETUP-17 | "Fill the crate" saves styles, years, formats and load years, with the sandbox off (read back through `/api/settings`), and starts the load                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | P1  |
| SETUP-18 | Held at `100-to-dig`, once its count shows: the Download and Read `<progress>` rows have values, releases kept and records to dig are counted, "Just pulled" names a release; the header shows "loading N%" and the page keys work again                                                                                                                                                                                                                                                                                                                                                                                         | P1  |
| SETUP-19 | Held at `100-to-dig`: the records to dig reach the checkpoint's count while the download is held, so the load read the growing file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | P1  |
| SETUP-20 | Imports slower than the load's start (the wantlist pages held at the fake): "Reading your collection and wantlist first, so the load also keeps other records on your labels." and "Start without it"                                                                                                                                                                                                                                                                                                                                                                                                                            | P2  |
| SETUP-21 | Held at `100-to-dig`: "Start digging" is disabled and "ready at 500 records" shows; released to `600-to-dig`: enabled once its count shows; Enter and the button open Triage with the sandbox off (the page; SETUP-01 checks its first record). `T` is also the page key, which works during the load whatever the count (`docs/FIRST_RUN.md`)                                                                                                                                                                                                                                                                                   | P1  |
| SETUP-22 | Practice round: the banner counts "1 of 5"; after five verdicts "That's digging."; Enter turns the sandbox off and the five records come round again; `/api/export/decisions.json` holds none of them; Esc ends it early                                                                                                                                                                                                                                                                                                                                                                                                         | P1  |
| SETUP-23 | The load finishes: the "ready to dig" stamp and the `h1` "The catalogue is in: …"; the header status says "The catalogue is in: …" once, the indicator goes; "Delete it" deletes the dump (`/api/dumps` is empty)                                                                                                                                                                                                                                                                                                                                                                                                                | P1  |
| SETUP-24 | Picks made by hand (Drum n Bass and Jungle, 1997–2003, Vinyl only off), the crate held at `100-to-dig`, one record judged in Triage: "Change your picks" cancels the load and returns to step 3 with those picks and no suggestion; releases the load added without a verdict are gone, the judged release and its verdict stay; a reload then opens the load's screen with "The catalogue stopped loading", whose "Change your picks" brings back the same picks                                                                                                                                                                | P1  |
| SETUP-25 | The download drops its connection where the transfer is held at `100-to-dig`, once every byte sent is on disk. Under the load: the crate's alert, in the page before its text, reads "The download stopped at 6 KB of 79 KB: reason. Discogs does not allow resuming, so it starts again." with "Start again" and "Change your picks"; the 100 records loaded stay, and Triage digs them; "Start again" downloads and loads to READY TO DIG. On steps 2 and 3: the same sentence at the foot instead of the strip; "Start again" brings the strip back, and "Fill the crate" after a stop downloads again before the load starts | P1  |
| SETUP-26 | Wrong checksum (fake `set({ wrongChecksums })`), the first transfer held at `100-to-dig` while the load reads it, then the second (`holdAt(name, { transfer: 2 })`). Once: the crate's alert, in the page before its text, reads "The download does not match Discogs' checksum, so Digga downloads it once more."; the load that read the rejected file fails with that reason, a second load reads the new download, and the catalogue is in after two transfers. Twice: "The download does not match Discogs' checksum. Digga downloaded it twice." with "Start again", which downloads a third time                          | P2  |
| SETUP-27 | A crash during the load (`relaunch({ crash: true })`): the jobs are marked failed as interrupted; the setup offers Pick up, which reads the dump from the start                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | P1  |
| SETUP-28 | A new page resumes at the first step not done: step 1 before anything is fetched, whatever the address asks; step 2 while the catalogue comes, or step 3 when the address asks; the account a username connected comes back on step 2; with the picks confirmed and the load waiting for the imports (the wantlist page held at the fake), step 3 with those picks; the load's screen once a load exists. A catalogue that was in the dumps folder before any download is SETUP-06                                                                                                                                               | P1  |
| SETUP-29 | Picks that match nothing (Jungle, which the all-Drum n Bass bulk catalogue lacks), the transfer held at `100-to-dig` until the crate shows: once the load ends having kept nothing, the crate's heading is "Nothing in the catalogue matches these picks" with "Change your picks", and neither "Start digging" nor "ready at 500 records"; "Change your picks" returns to step 3 with Jungle picked; Drum n Bass then loads to READY TO DIG                                                                                                                                                                                     | P2  |
| SETUP-30 | A library with a finished load never shows the setup; `#/setup` goes to Triage [`small`]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | P1  |
| SETUP-31 | Digging during the load, held at `100-to-dig`: at the end of the queue "You have dug everything loaded so far."; after release, once `/api/stats` counts more records to dig, `runFor(10_000)` and the next record shows                                                                                                                                                                                                                                                                                                                                                                                                         | P1  |
| SETUP-32 | The listing says 2 MB and the transfer's `Content-Length` 900 TB (`set({ contentLength })`): the download job fails for lack of space before it writes a byte, and step 2 says "The download stopped: The dump needs … free in …, counting 1 GB to spare; it has …." in an alert that was in the page before; the dumps folder stays empty                                                                                                                                                                                                                                                                                       | P2  |
| SETUP-33 | A load that finishes with fewer than 500 records to dig enables "Start digging"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | P1  |

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
| TRI-09 | `N` passes: slip "later"; the record returns after the queue; the end screen offers "go round the N you passed", and its headline says every release has a verdict "apart from the N you passed"                                                                                                                                                                                                                                                                                                   | P1  |
| TRI-10 | `Z` walks back a verdict, `N` and `X` one step per press and returns to each record; slip "undone"; after the `DELETE` answers, the export no longer holds the verdict                                                                                                                                                                                                                                                                                                                             | P0  |
| TRI-11 | A held verdict key (`keyboard.down` twice, then `up`) judges one record                                                                                                                                                                                                                                                                                                                                                                                                                            | P1  |
| TRI-12 | [`small-account` with a saved token] `E` gives the record a note, then `A`: the slip reads "Adding to your Discogs wantlist…", then "Added to your Discogs wantlist."; the fake got `PUT /users/dj/wants/{id}` with the note. A plain `A` sends no body                                                                                                                                                                                                                                            | P0  |
| TRI-13 | [`small-account` with a saved token] With the clock paused, `A`, then `Z` after the verdict has settled and before the grace ends: after the undo has settled and `runFor(2000)`, the page sent no wantlist request and the fake got nothing after `A`. `Z` after the push: the fake gets `DELETE`                                                                                                                                                                                                 | P0  |
| TRI-14 | [`small-account` with a saved token] `C` pushes like `A`; the note sent lists the grail and keep tracks and the record's note (decision 70)                                                                                                                                                                                                                                                                                                                                                        | P1  |
| TRI-15 | [`small-account` with a saved token] The push fails (fake `500`, the page's `502` declared): "Saved, but not on the Discogs wantlist."; Twelves marks the record                                                                                                                                                                                                                                                                                                                                   | P1  |
| TRI-16 | [`small-account`] Saving `e2e-token-other` keeps the username `dj`, and Settings' sandbox section warns before going live; a push then fails: the fake answers `403`, the page gets `502` (declared)                                                                                                                                                                                                                                                                                               | P2  |
| TRI-17 | `E`: the note field takes focus with the saved text; Enter keeps it; Esc cancels; the note survives `N` and `Z`; the verdict saves it (Twelves shows it)                                                                                                                                                                                                                                                                                                                                           | P1  |
| TRI-18 | `Shift+K`, `Shift+M`, `Shift+C` mark the playing track (its mark stamp, then the `POST /api/track-verdicts` awaited, since the stamp shows first), with the playing video and its second; the same key again clears it; with nothing playing a flash explains; keep and grail marks reach the Tracks shelf, meh does not                                                                                                                                                                           | P1  |
| TRI-19 | `X` hides the record's first label: after the settings save and the queue's reload have answered, its records are out of the queue, Settings lists the label, the slip says so; `Z` brings the label back                                                                                                                                                                                                                                                                                          | P1  |
| TRI-20 | `F`: the dialog lists the record's labels and artists, track artists included, and "Added by the last dump load"; Enter digs the first label; the banner counts what is left; only that label's records come; Esc returns to the whole queue                                                                                                                                                                                                                                                       | P1  |
| TRI-21 | `F` search: two letters list matches with record counts; `↓` moves to the options; a seller read in Settings comes first; no match says so; one Esc closes the picker while the search field holds text, and it opens again empty                                                                                                                                                                                                                                                                  | P1  |
| TRI-22 | A scope dug to the end: "Nothing is left to dig from the label …", "go round", and Esc back                                                                                                                                                                                                                                                                                                                                                                                                        | P2  |
| TRI-23 | `P`: "asking Discogs…" with `aria-busy`, then price, for sale, want and have, "checked just now"; the fake got `GET /releases/{id}?curr_abbr=EUR`; works in the sandbox                                                                                                                                                                                                                                                                                                                            | P1  |
| TRI-24 | `P` for a release Discogs no longer has (fake `404`): the flash says Discogs did not return the release; the line keeps no market data                                                                                                                                                                                                                                                                                                                                                             | P2  |
| TRI-25 | `O` opens `discogs.com/release/{id}` and `S` a YouTube search for artist and title (`expectExternalOpen`)                                                                                                                                                                                                                                                                                                                                                                                          | P1  |
| TRI-26 | `app.paste()` of a YouTube link: the server stores it, oEmbed's title matches a track, which plays; an unmatched link plays under "Other videos" (`data-video-id`); other text and a paste inside the note field attach nothing                                                                                                                                                                                                                                                                    | P1  |
| TRI-27 | A release without videos: "No videos on this release." with `S`, `⌘V` and `D`; verdict keys still work                                                                                                                                                                                                                                                                                                                                                                                             | P1  |
| TRI-28 | Refused videos: the playing video, refused with `app.youtube.fail(id, 150)`, is skipped with the notice "… won't play here: the uploader blocks embedding. Skipped." (the hidden decks find a refused catalogue video first, silently; see "The fake YouTube IFrame API"); a release whose only video is refused shows "Its only video won't play here.", and one whose several videos all are "None of its N videos will play here."; `embed="false"` videos show "no embed" and are never loaded | P1  |
| TRI-29 | Live: `D`, then a link pasted on Twelves' No audio shelf deletes the verdict (export), the record leaves the shelf, and Triage, shown again with `T`, offers it without a reload, after the record on screen when it sorts earlier (TRI-44). Sandbox: with a saved `D` (given live), a pasted link leaves the saved verdict in the export (decision 74)                                                                                                                                            | P2  |
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
| TRI-40 | A seller's shop [`small-account` with a saved token, `shopkeeper` read]: `F` digs the seller; `A` on the record puts the seller's pressing on the wantlist (the fake's `PUT` names that release id, not the main release's)                                                                                                                                                                                                                                                                        | P1  |
| TRI-41 | Held `→` (`keyboard.down` repeated) seeks once per repeat, while a held verdict key still judges once                                                                                                                                                                                                                                                                                                                                                                                              | P2  |
| TRI-42 | [`small-account` with a saved token] Digging ten records sends no request to the fake Discogs; the first comes with `P`                                                                                                                                                                                                                                                                                                                                                                            | P1  |
| TRI-43 | A video the app loads to play while the page has activation stays unstarted (`app.youtube.blockSound()`); after `runFor(3750)` the player reads "waiting for Space"                                                                                                                                                                                                                                                                                                                                | P2  |
| TRI-44 | [`labels: Echo Chamber`] A record judged `D` in Triage, then given a link on Twelves' No audio shelf; `T`: the record on screen stays, "Up next" names the record, and the next verdict shows it, with the pasted video on its track. Again with the `D` given before the app opened on Twelves, after Triage has read its queue: `T` reads it again (decision 112)                                                                                                                                | P1  |

### Sandbox

| ID     | Scenario                                                                                                                                                                                                                                                                                                                                                                                                        | P   |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| SBX-01 | [`small-account` with a saved token] With the sandbox on, verdicts, marks, notes, listens, `A` and `Z` send no request to `/api/verdicts`, `/api/track-verdicts`, `/api/listen-log` or `/api/discogs/wantlist`, and the fake Discogs gets no `PUT` or `DELETE`; the slips say "Sandbox: nothing was saved.", and `A` ends with "Added to your wantlist (sandbox: nothing sent).", after which the logs are read | P0  |
| SBX-02 | Sandbox verdicts show in Twelves and the counts; a reload drops them                                                                                                                                                                                                                                                                                                                                            | P1  |
| SBX-03 | Turning the sandbox off: the next verdict is saved; the sandbox's verdicts and undo history are gone; turning it on again starts an empty sandbox                                                                                                                                                                                                                                                               | P1  |
| SBX-04 | [`small-account` with a saved token] A want given in the sandbox with the clock paused, then the sandbox turned off within the grace: after `runFor(2000)` the page sends no wantlist request and no `PUT` reaches the fake (decision 55); the live queue offers the record again, which has no verdict                                                                                                         | P1  |
| SBX-05 | [`small` with the username `dj` and a saved token] Setup work is real in the sandbox: a collection import fills the Owned shelf, which a reload keeps; `P` reaches the fake                                                                                                                                                                                                                                     | P1  |
| SBX-06 | The Maybe list import in the sandbox reads the real list and keeps its maybes in the tab                                                                                                                                                                                                                                                                                                                        | P2  |
| SBX-07 | [`small-account` with a saved token] A want given live with the clock paused, then the sandbox turned on within the grace: the verdict stays saved (export); after `runFor(2000)` the pending push has been dropped with the live history (no `PUT`), and Twelves marks the want as not on the wantlist                                                                                                         | P1  |

### Twelves [`small` or `small-account`, with given verdicts]

| ID     | Scenario                                                                                                                                                                                                                                                                                                                                   | P   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- |
| TWL-01 | [`small-account`] Keys `1` to `9` pick the shelves; each option's name has the shelf's count, from the given verdicts, a keep and a meh mark, and `dj`'s imported collection and wantlist; Everything leaves out no audio; an empty shelf (Grail) shows its text                                                                           | P1  |
| TWL-02 | `J`, `K`, `↓`, `↑` move `aria-current` and scroll the row into the window, above the shelf's sticky footer: with every small record snoozed, `J` to the last row leaves its middle uncovered (`document.elementFromPoint()`); on the Tracks shelf in a 480 px window, `J` to the fifth track does the same                                 | P1  |
| TWL-03 | Paging [`bulk`, 1,200 verdicts restored with `digga restore` before the server starts]: 500 rows a page; `→` and `←` turn; `K` on page 2's first row goes back to page 1's last, and `J` crosses into the next page; "Shelf pages" says "501–1,000 of 1,200 records"; the last page holds 200                                              | P1  |
| TWL-04 | `S` changes the sort: three records judged in the reverse of their labels' order go from newest first to label order                                                                                                                                                                                                                       | P1  |
| TWL-05 | `/` focuses the filter; typing a label's name filters to its records; Enter leaves it with the text kept; more text says "Nothing matches “…”."; Esc clears it                                                                                                                                                                             | P1  |
| TWL-06 | `E` edits a note; Enter saves ("Note saved."); `E` on a record with a note shows it, Esc cancels; an empty note removes it ("Note removed."); both survive a reload                                                                                                                                                                        | P1  |
| TWL-07 | [`small-account` with a saved token] Re-judging, each from its own given state: a want of a release on `dj`'s wantlist re-judged a grail stays on it (the fake gets nothing); the same want re-judged a skip: the fake gets `DELETE`, the row leaves the shelves, and the export says skip; a snooze re-judged a want: the fake gets `PUT` | P1  |
| TWL-08 | Wantlist and owned records refuse re-judging with a flash                                                                                                                                                                                                                                                                                  | P2  |
| TWL-09 | [`small-account` with a saved token] Wants and grails missing from the wantlist carry the marker and the banner count; `A` retries a want and `C` a grail; with two or more on the shelf, "add all N" pushes each, in order, and the banner says everything is on the wantlist                                                             | P1  |
| TWL-10 | [`small-account`] Maybe hand-off: without a list, the hint, and `I` only flashes; with list 9001 and a saved token, "N maybes are not on your Discogs Maybe list yet"; `I` reads the list (the fake holds two of them) and their markers go                                                                                                | P1  |
| TWL-11 | [`small-account` with a saved token] `Z` undoes the last change, a snooze re-judged a want: the snooze comes back with its date, and the fake gets `DELETE` after the `PUT`                                                                                                                                                                | P1  |
| TWL-12 | Enter on a snoozed record starts a round in Triage from it, with the snoozed records after it on the shelf; on another record a flash explains                                                                                                                                                                                             | P1  |
| TWL-13 | The Tracks shelf lists grail and keep marks, not meh ones, with release and verdict; `E` edits a track note; verdict keys explain that marks change in Triage and send nothing                                                                                                                                                             | P1  |
| TWL-14 | [`labels: Echo Chamber`] The No audio shelf: `Y` opens a YouTube search; `app.paste()` attaches a link and the record leaves the shelf for the queue (`/api/queue`)                                                                                                                                                                        | P1  |
| TWL-15 | `O` opens the release on discogs.com                                                                                                                                                                                                                                                                                                       | P2  |
| TWL-16 | A verdict for a release in no dump reads "Not in the loaded dump (r:…)"                                                                                                                                                                                                                                                                    | P2  |
| TWL-17 | `A` then `R` pressed at once end as a skip, off the wantlist (decision 62)                                                                                                                                                                                                                                                                 | P2  |
| TWL-18 | Switching the sandbox remounts the shelf in the new mode                                                                                                                                                                                                                                                                                   | P2  |

### Settings [`small` or `small-account`]

| ID     | Scenario                                                                                                                                                                                                                                                                                                                                                                            | P   |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| SET-01 | The form shows the saved config and "All saved."; a change reads "Unsaved changes."; Revert restores; Save and `ControlOrMeta+S` save ("Saved. The queue has reloaded."); a reload keeps it                                                                                                                                                                                         | P1  |
| SET-02 | The filter preview updates after a change without saving ("These filters match N records, M still to dig")                                                                                                                                                                                                                                                                          | P1  |
| SET-03 | An invalid batch or seek step marks the field (`aria-invalid`, `:invalid`), shows the problem in the save bar and under the field, whose description has it after the hint, and disables Save; a valid value clears all of it                                                                                                                                                       | P1  |
| SET-04 | Hidden labels: one per line; a saved label leaves the queue; `X`'s labels appear here                                                                                                                                                                                                                                                                                               | P1  |
| SET-05 | Styles checkboxes appear with several universe styles and narrow the queue                                                                                                                                                                                                                                                                                                          | P2  |
| SET-06 | Order: one strategy change changes the first record in Triage; the shuffled order is stable across a reload (its seed is the server's UTC day)                                                                                                                                                                                                                                      | P2  |
| SET-07 | Player: the start-at slider (`aria-valuetext`) and the seek step reach the player (fake `startSeconds`, seek distance)                                                                                                                                                                                                                                                              | P1  |
| SET-08 | [`small`] Token: saving `e2e-token-dj` says "Token saved." and whose, and the form takes the username the server adopted; `e2e-token-refused` says "Not saved: …", marks the field `aria-invalid` and keeps the old one; Remove removes it                                                                                                                                          | P1  |
| SET-09 | [`small-account`, `DISCOGS_TOKEN=e2e-token-dj`] A token from the environment: the field is disabled with the hint; `PUT /api/discogs/token` answers `409`                                                                                                                                                                                                                           | P1  |
| SET-10 | [`small-account` with a saved token] Opening Settings costs two Discogs requests, identity and lists (fake log), as "Every request Digga makes" says; on `small` it costs none                                                                                                                                                                                                      | P1  |
| SET-11 | [`small-account` with a saved token] Maybe list: the lists load when Settings opens; a failing read shows the hint and "Read my lists", which reads them again and fills the select with the private and the public list; choosing one and saving enables `M` in Triage; back in Settings the lists load again, the button reads "Reload lists" and the select shows the saved list | P1  |
| SET-12 | Currency: `P` then asks in the chosen currency and shows its symbol                                                                                                                                                                                                                                                                                                                 | P2  |
| SET-13 | [`small` with the username `dj` and a saved token] Jobs: Collection and Wantlist add a row that runs (its page held at the fake) and ends done with its counts; the Library and Twelves show the imports                                                                                                                                                                            | P1  |
| SET-14 | [`small` with the username `dj` and a saved token] Jobs: an import cancelled while its page is held at the fake reads running until the page has returned, then cancelled                                                                                                                                                                                                           | P1  |
| SET-15 | Jobs: History reads the fake home's history file; Maybe list is disabled until a list is saved; Read shop needs a username, reads `shopkeeper`, and `F`'s search then offers the seller                                                                                                                                                                                             | P2  |
| SET-16 | [the July, August and September dumps in the folder] Dumps: the folder lists each dump, newest first, with its size and use; Delete asks first (dismiss keeps it, accept deletes it); while a download held at the fake runs, the dump buttons and each Delete are disabled                                                                                                         | P1  |
| SET-17 | [the September dump listed, its transfer held part-way] "Update from the newest dump": one job, download then load; the header shows "loading" without a reload; the Library section then counts what the load added (3) and did not find (1), and the indicator goes                                                                                                               | P1  |
| SET-18 | Load by file name from the datalist, with a limit and a dry run                                                                                                                                                                                                                                                                                                                     | P2  |
| SET-19 | Backups: with given verdicts and a `relaunch()`, whose start writes the day's decisions backup, `/api/backups` lists it and Settings shows it. The first start cannot: it runs before the given state exists, and an empty library gets no backup                                                                                                                                   | P2  |
| SET-20 | Exports, with given verdicts and a track mark and a verdict in the sandbox: the three links download (completed, via `expectDownload`) JSON and CSV with the saved verdicts and marks, and without the sandbox verdict                                                                                                                                                              | P1  |

### Persistence and lifecycle

| ID     | Scenario                                                                                                                                                                                                                                                                         | P   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| PER-01 | A live snooze (`L`) with a note (`E`), and a keep mark on a track (`Shift+K`, its `POST /api/track-verdicts` awaited), survive a reload and a `relaunch()`                                                                                                                       | P0  |
| PER-02 | After further changes, `digga backup` writes today's decisions; `digga restore` of that file into a fresh `small` library brings the verdicts back into Twelves                                                                                                                  | P2  |
| PER-03 | `relaunch({ crash: true })` during an import marks the job failed as interrupted; a graceful `relaunch()` during one records it cancelled once its page in flight has returned; Settings shows each                                                                              | P2  |
| PER-04 | [`small-account` with a saved token] The server does not take a want (`route` aborts `POST /api/verdicts` once): "The verdict was not saved: …", the record comes back, and after `runFor(2000)` nothing has reached the fake Discogs; the same key again saves it and pushes it | P0  |
| PER-05 | `restartServer()` in the middle of a session, once the verdict's stats refresh has answered: the open page keeps its record, slip and session count without a reload, and the next verdict is saved (**web**)                                                                    | P1  |

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
   TRI-28 and TRI-36 (see "The first Triage P1 slice"). Triage's P1 set was done on 2026-10-01
   with the other half, the verdicts, the queue, scopes, the market, the seller and the wants:
   TRI-08, TRI-09, TRI-14, TRI-15, TRI-19, TRI-20, TRI-21 (with a gap), TRI-23, TRI-25, TRI-30,
   TRI-32, TRI-33, TRI-34, TRI-39, TRI-40 and TRI-42 (see "The second Triage P1 slice"). With them
   came `expectExternalOpen()`, `diggaOptions.config`, `given.verdict()` and `given.sellerShop()`,
   and the fake's inventory. Settings' P1 set was done on 2026-10-01: SET-01, SET-02, SET-03,
   SET-04, SET-07, SET-16 and SET-20, then SET-08, SET-09, SET-10, SET-11, SET-13, SET-14 and
   SET-17 (with a gap; see "The Settings P1 slice"). With them came the Settings page object,
   `expectDownload()` in the web host, `diggaOptions.environmentToken` and `dumpFiles`,
   `given.trackMark()`, the fake's lists, and the small catalogue's July and September dumps.
   Twelves' P1 set was done on 2026-10-01: TWL-01, TWL-02 (with a gap), TWL-04, TWL-05, TWL-06,
   TWL-12, TWL-13 and TWL-14, then TWL-07, TWL-09, TWL-10, TWL-11 and TWL-03 (see "The Twelves
   P1 slice"). With them came the Twelves page object's actions, the `bulk` template,
   `app.cli()`, `diggaOptions.decisionsBackup` with `fixtures/decisions.ts`, the fake's
   `GET /lists/{id}`, and the markup of accessibility bug 2. The P1 sets of Shell, Sandbox and
   Persistence were done on 2026-10-01: SHELL-03, SHELL-04, SHELL-05, SHELL-07, SHELL-09, SBX-02,
   SBX-03, SBX-04, SBX-05, SBX-07 and PER-05 (see "The Shell, Sandbox and Persistence P1 slice").
   With them came `restartServer()`, the Keys dialog's page object, Settings' sandbox switch and
   Appearance actions, Triage's queue retry, and lasting aborts. The setup's P1 scenarios for
   steps 1 to 3, before the load starts, were done on 2026-10-01: SETUP-02, SETUP-03, SETUP-04,
   SETUP-05, SETUP-06, SETUP-07, SETUP-11, SETUP-15, SETUP-16, SETUP-17 and SETUP-30, then
   SETUP-08, SETUP-09, SETUP-13 and SETUP-14 (see "The setup's steps 1 to 3 P1 slice"). With them
   came the setup page object's actions for steps 1 to 3, `LiveRegionWatch`, the fake's `503`
   for every request and `dj`'s currency, and the markup of accessibility bugs 3 and 4 for those
   steps. The ten gaps were closed on 2026-10-02 (see "Closing the gaps"): TRI-21, TWL-02 and
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
   "Running").
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
  projects will show it. Closed on 2026-10-02 by decision 113 (see "Closing the gaps").
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
and the Settings markup (see "Markup audit"). The work showed:

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
  it (see "Synchronisation").
- **One gap, confirmed: SET-17's header indicator.** Settings' "Update from the newest dump"
  does not ask the load status again, so with the transfer held part-way the header shows no
  indicator until a reload, after which it reads "loading N%". The normal test asserts that; the
  `test.fail` waits 5 s for the indicator without a reload and failed as expected in every run.
  Closed on 2026-10-02 by decision 115 (see "Closing the gaps").
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
the catalogue and a video to paste for the release without videos, and the markup (see "Markup
audit"). The work showed:

- **No product bug fixed; one gap.** With every small record snoozed, `J` to the last row scrolls
  it to the window's bottom edge, where the shelf's sticky footer covers all of it but its top
  pixels (`scrollIntoView({ block: "nearest" })` in `Twelves.svelte` and `TrackTable.svelte`
  does not allow for the footer). A trial `scroll-margin-bottom: 64px` on the rows made the gap
  test pass, so that is the cause; the fix is CSS, which no vitest test can cover, so TWL-02
  records it as a gap, as TRI-21 did. The normal test checks that the row is in the window; its
  `test.fail` checks with `document.elementFromPoint()` that the row's middle is the row and not
  the footer, and failed as expected in every run. Moving back up is not affected: the first row
  is uncovered after `K`. Closed on 2026-10-02 by decision 114 (see
  "Closing the gaps").
- **The restore runs before the server starts.** See "Libraries" for why. The bulk template builds
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
  complete by then (see "Synchronisation"). "Add all" pushes one release at a time, each after the
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
  `evaluateHandle()` before the press (see "Synchronisation").
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
steps 1 to 3 (see "Markup audit"), and the step titles in `src/client/setup/steps.ts`. SETUP-01
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
- **Rows corrected.** SETUP-08's counts follow the account, 1 and 2 (see "The fake services" for
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
  connection; "The fake services" now asks rehearsals to load it.
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
- **Rehearsals.** After each change to the fake's data.discogs.com part, as "The fake services"
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

## Risks and open questions

- **Per-test server processes** keep tests isolated but cost a Node start each, about 200 ms in
  the spike.
- **Real timers on the server.** The Discogs client's 1.1 s gap makes tests that touch Discogs
  several times slower. If the suite exceeds its budget, a `discogsMinIntervalMs` server option
  set by the harness would help, at the cost of not running production spacing in E2E. Measured
  in the second Triage slice: the gap binds only where requests follow each other at once, and
  costs about 6.6 s of that slice's 40 s of test time, 2.2 s each in the scenarios that read a
  seller's shop; a push after the 1.5 s grace does not wait for it.
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
- **`verify` runs the smoke set.** The owner decided on 2026-10-01 that `e2e:smoke` joins
  `vp run verify`. `verify` now takes about 20 s instead of 9 s, and every machine that commits
  needs Playwright's Chromium (`npx playwright install chromium`).
- **Other browsers.** The owner decided on 2026-10-02 that Firefox and Safari get a cheap effort
  only, since the Electron app is the main target (see "Running").
- **Open:** Is a CI provider other than GitHub Actions planned? Are visual snapshots wanted at all? What does the Electron app do when
  `safeStorage` cannot encrypt, as on Linux without a keyring: refuse to save the token, or save
  it with the plain-text key?
