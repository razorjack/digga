# E2E harness

Read this when changing process launch, isolation, guards or lifecycle. Start with the [E2E guide](../E2E_TESTING.md)
and its binding rules. For data and fake services, read [FIXTURES](FIXTURES.md). Electron-specific work also needs
[ELECTRON](ELECTRON.md), which describes the Electron host.

## Runner and configuration

The suite uses Playwright Test. [package.json](../../package.json) pins the version, and
[playwright.config.ts](../../tests/e2e/playwright.config.ts) defines the web project, retries,
timeout and artifacts. [playwright.electron.config.ts](../../tests/e2e/playwright.electron.config.ts)
takes the same settings with the Electron project instead, and
[playwright.packaged.config.ts](../../tests/e2e/playwright.packaged.config.ts) with the packaged
app's, so only `vp run e2e:electron`, `vp run e2e:packaged` and commands naming those files start
Electron ([ELECTRON](ELECTRON.md#running)). Each project sets the
fixture option `host`, and leaves out the tests tagged for the other host. The
[runner comparison](HISTORY.md#runner-choice-on-2026-09-30) records the original selection.

Tests end in `.e2e.ts`, with `testDir: "specs"` and `testMatch: "**/*.e2e.ts"`; Vitest only
loads `tests/**/*.test.ts`. `tsconfig.e2e.json` includes the DOM library for the fake YouTube
script and page objects; the root project references it and `tsconfig.node.json` excludes
`tests/e2e/`. `vp check` checks the suite. The lint override exempts `.e2e.ts` functions from
length and complexity limits, as for unit tests.

The 30 s test timeout includes fixture setup; setup journeys use `test.slow()`. The host
separately limits server shutdown to 15 s. Locally there are no retries. Under `CI`, one retry
is allowed for diagnosis, but `failOnFlakyTests` makes a pass on retry fail the run.

**CI.** [ci.yml](../../.github/workflows/ci.yml) runs on GitHub Actions; the
[E2E guide](../E2E_TESTING.md#ci) says what each run does and why burn-ins run locally. The
choices behind it:

- `ubuntu-24.04`, not `ubuntu-latest`, so a new image arrives with a commit. Node is pinned to
  24.18.0 because `devEngines.packageManager` in package.json requires npm 11.16.0, which that
  release bundles; under another npm, every npm command, setup-node's included, stops with
  `EBADDEVENGINES` (`onFail: "download"` does not download).
- Under `CI` the configuration uses two workers. Every test runs its own server, fake services
  and browser, so the runner's four vCPUs are saturated at two: on three and four workers the
  whole suite finished only 8% and 11% sooner while each test ran 1.4 and 1.7 times slower, and on
  four A11Y-01's Twelves scans reached the 30 s timeout ([measurements](HISTORY.md#ci-on-github-actions)).
  Locally Playwright's default, half the cores, still applies.
- `~/.cache/ms-playwright` is cached under a key of the runner's OS and architecture and the
  locked `@playwright/test` version, so a Playwright update downloads its Chromium once. On a
  hit, `playwright install-deps chromium` still installs the system libraries, which the cache
  does not hold.
- The rest of the suite runs with `--grep-invert @P0` against the `dist/` that verify built, so
  the smoke set runs once and the client is built once.
- The `github` reporter joins `list` and `html` on GitHub Actions and annotates each failure at
  its line. A failed run uploads `playwright-report/` and `test-results/e2e/` for 14 days.
- No secrets and `permissions: contents: read`. The guard stays as it is: the runner has
  internet access, and the guard keeps Digga and the browser away from it.

## Architecture

```
Playwright worker (Node; several run in parallel)
 |- fake services on 127.0.0.1:<port>   Discogs API, data.discogs.com, YouTube oEmbed:
 |                                       request log, fault injection, transfer checkpoints
 |- app host
 |    web:      spawns the guarded CLI server, then opens a prepared Chromium context
 |    electron: launches the app with the harness preload, prepares its context, then its window
 '- test -> page objects -> app.page

Page (Chromium tab; the app's BrowserWindow with the Electron host)
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
  `DIGGA_DUMPS_DIR` (unless `diggaOptions.dumpsDirFromApp`, ELEC-15) and `DIGGA_CONFIG_FILE`; the fake service URLs (see [Service configuration](#service-configuration));
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
`running` until that request has returned. A graceful stop with a page held at the fake waits for
the page, so the test releases it while `relaunch()` is pending, and only once the server has
aborted the job: the runner then logs "stopping: cancelled N running job(s), waiting for them",
which PER-03 reads from the stopping server's output (`app.servers.at(-1)`). A page released
earlier returns before the abort and the job ends done.

The app fixture depends on the fake-services fixture, so Playwright tears the app down first; the
fakes keep answering until the server has exited. The temp folder is deleted after the exit.

### The app host

Tests receive a `DiggaApp` and never touch `browser` or `context` directly. The web host and the
[Electron host](ELECTRON.md#shared-host-contract) implement it; the Electron host has no
`restartServer()` and no `openPage()`. The fixture sees each host as a `DiggaHost`, which adds
the problem log, the server processes' output (`app.servers`, the current one `app.server`) and
closing. A test that needs to know the host destructures the `host` fixture (`"web"` or
`"electron"`), as PER-11 does for the name the library lock gives the server.

The authoritative interface, API client, given-state helpers, YouTube handle and page clock
are in [support/app.ts](../../tests/e2e/support/app.ts). Read the signatures there when using
or changing a helper. `app.page` is replaced on relaunch, so page objects read it on every use.
`app.origin` is fixed for one launch. `open()` defaults to `#/triage`.

`app.api` accepts only paths under `/api/` on the current launch and refuses redirects.
`app.given` sets up state before the page opens; [FIXTURES](FIXTURES.md#libraries) defines
the supported setup paths. `apiRequests()` includes all launches in the test.
`abortRequests()` applies to the current launch, defaults to one abort, and returns `lift()`;
`times: Infinity` lasts until lifted. Declare deliberate failures with `expectProblems()`
([failure artifacts](AUTHORING.md#failure-artifacts)).

**A second library.** A test has one app, and one library unless it asks for another: the
`newLibrary(template)` fixture copies a template into the test's folder with the default test
config and returns its `DiggaLibrary`. `app.cli(args, { library })` runs a command
on it, and `app.relaunch({ library })` stops the app and starts it on that library, which
`app.library` then names; the fake home, the working directory and the fakes stay. A library is
prepared before the relaunch, as the README says a restore is done with the server stopped. PER-02
restores the decisions backup `digga backup` wrote into a fresh `small` library this way. The
test's folder, with every library in it, is deleted after the app has stopped.

**Another page.** `app.openPage()` opens a second page of the app on the same server, blank until
its `open()`: in the web host a new page in the same browser context, as a second tab. The
Electron app opens one window, so the Electron host has no `openPage()`, and PER-10 is `@web`. It returns a `DiggaApp` for that page, so page objects
built on it act there, with its own fake player and clock handles, while the server, library, API,
given state and problem log are the app's. The context's guard, routes, init scripts and
collectors cover it. `relaunch()` closes it, and it cannot relaunch the app or restart the server
itself (PER-10).

**Web host.** It prepares the library, config and fake home, spawns the server, prepares a
browser context (below) and opens the page. `cli()` runs through `spawnDigga()` with the test's
environment and resolves on exit, with a `null` code when a signal ended it. Console, page-error
and request collectors attach to the context. `relaunch()` closes the context first, so no request of the page meets a
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

**Helpers with a completion contract.**

- `expectExternalOpen()` installs its interception before the action: in the web host a context
  route that answers the external URL with an empty page and the `page` event that captures the
  popup. The Electron host reads what the preload's stub of `shell.openExternal` recorded. It returns once the URL is known. The web
  host's route matches every URL outside the app's origin, answers the window's page and nothing
  else the window asks for (`404`), and is removed once the window is closed, so the URL neither
  reaches the network nor counts as refused, while an external URL the app opens outside the
  helper still reaches the base route and fails the test ("the browser requested …"). The app
  opens with `window.open(url, "_blank", "noopener,noreferrer")`; the context's `page` event
  still sees that window.
- `expectDownload()` resolves only when the download has completed: in the web host it arms the
  page's `download` event before the action and awaits `download.saveAs()` into `downloads/` in
  the test's output folder, which resolves once the download has completed and rejects for one
  that failed. In the Electron host the preload's `will-download` handler saves the file in
  `downloads/` in the test's folder, and the host waits for `done` with state `completed`. SET-20
  covers both, ELEC-05 the Electron handler.
- `paste()` dispatches a synthetic `ClipboardEvent` with a `DataTransfer`, which is what Digga's
  `onpaste` handlers read. It needs no clipboard permission and never touches the OS clipboard,
  so parallel workers do not interfere and the Electron host uses the same helper. The suite does not press
  `ControlOrMeta+V`: the browser would read the OS clipboard, which workers and the developer
  share. That the browser turns the key into a paste event is the browser's behaviour.

### Startup order

Everything that must be in place before the app's first request is installed before the app
starts. A reload after the fact cannot undo a request that already left.

- **Web.** The fakes start; the library is prepared; the server starts with the guard active from
  its first instruction (`--import`); the given state goes through the API; the browser context
  is prepared with the routes, the fake YouTube init script, blocked service workers and, if the
  test asks for it, the clock. Only then does the host call `page.goto()`.

- **Electron.** The fakes start; the library is prepared; the app starts with the harness preload,
  which installs the guard and holds the app's start; the context is prepared as for the web; the
  app starts its server and its window, whose first navigation the preload holds; the given state
  goes through the API; the navigation is released to a blank page; the host calls `page.goto()`
  in `open()`. [Electron startup](ELECTRON.md#startup-order) gives the reasons for each step.

### Service configuration

`CreateServerOptions` takes `discogsApiUrl`, `youtubeOembedUrl` and `dataDumpsUrl`.
The CLI reads `DIGGA_DISCOGS_API_URL`, `DIGGA_YOUTUBE_OEMBED_URL` and `DIGGA_DUMPS_URL`;
`discogsFor()` uses the first for import commands too. `.env.example` lists them under
Development. `createVideoTitleLookup()` takes its oEmbed URL through an options object.
The harness supplies all three URLs from its fake services before starting any process.

### Secrets and the Discogs token

- Tests only use fake tokens (`e2e-token-dj`, `e2e-token-other`, `e2e-token-refused`).
- No Digga process inherits the developer's environment or reads their `.env` (see [Launching processes](#launching-processes)).
- A token reaches a test library in one of three ways, one per scenario group: typed into the
  setup or Settings form, set through `PUT /api/discogs/token` by `app.given.savedToken()`, or
  passed as `DISCOGS_TOKEN` (the "token from the environment" state, where Settings disables the
  field and the route answers `409`).
- The fake fails any request with a token that does not start with `e2e-`.
- The Electron app encrypts a saved token with `safeStorage`, under the mock keychain in the
  tests; see [Electron](ELECTRON.md#launch).

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
   inherit it. The dump-load worker makes no requests. Playwright removes `NODE_OPTIONS` from an
   Electron launch, so the [harness preload](ELECTRON.md#the-harness-preload) loads the guard and
   makes each worker import it first, since workers do not inherit a module a `-r` preload loaded.
2. **Context routes.** The base route lets nothing through until the host allows the app's origin
   (`guardContext()` returns the guard, and `allowOrigin()` opens it), since the Electron host
   installs it before its server has a port. It then lets through the app's exact origin, and the same port on
   `127.0.0.1`, where SHELL-06 opens the app to see its warning, and aborts everything else,
   recording the URL; the fixture fails a test that has aborts it did not declare. In
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
3. **Chromium resolution.** The web browser starts with
   `--host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1"`, so no
   other host name or IP literal resolves. This covers what Playwright does not route, such as
   preconnects. `127.0.0.1` stays resolvable for SHELL-06; routes still allow only the app's port there.
   The Electron host passes the same switch (`HOST_RESOLVER_RULES` in `browser-guard.ts`), which
   also covers `electron.net`. Future Firefox and
   WebKit projects have no such switch and must rely on routes.
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
the temp folder, so nothing the app or Chromium writes under the home lands in the developer's.
SET-23 makes the library's `backups` folder read-only (mode `555`) inside the test and gives the
permission back in `finally`; it skips on Windows and as root, where the mode stops nothing.

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
