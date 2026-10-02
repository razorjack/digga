# E2E harness

Read this when changing process launch, isolation, guards or lifecycle. Start with the [E2E guide](../E2E_TESTING.md)
and its binding rules. For data and fake services, read [FIXTURES](FIXTURES.md). Electron-specific work also needs
[ELECTRON](ELECTRON.md); its host is planned, not implemented.

## Tool: Playwright Test

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
  `DIGGA_DUMPS_DIR` and `DIGGA_CONFIG_FILE`; the fake service URLs (see [Product changes](HISTORY.md#product-changes-the-harness-needs));
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
  /** pause() and runFor(), when the test installed the clock (see [Time](AUTHORING.md#time)). */
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

### Secrets and the Discogs token

- Tests only use fake tokens (`e2e-token-dj`, `e2e-token-other`, `e2e-token-refused`).
- No Digga process inherits the developer's environment or reads their `.env` (see [Launching processes](#launching-processes)).
- A token reaches a test library in one of three ways, one per scenario group: typed into the
  setup or Settings form, set through `PUT /api/discogs/token` by `app.given.savedToken()`, or
  passed as `DISCOGS_TOKEN` (the "token from the environment" state, where Settings disables the
  field and the route answers `409`).
- The fake fails any request with a token that does not start with `e2e-`.
- Electron keeps the token with `safeStorage`; see [Electron](ELECTRON.md#electron) for keychains in CI.

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
   process gets it from the harness preload (see [Startup order](#startup-order)). The dump-load worker makes no
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
   with the reason and attached to the failure artifacts ([The first-run setup path](HISTORY.md#the-first-run-setup-path-web) has both
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
