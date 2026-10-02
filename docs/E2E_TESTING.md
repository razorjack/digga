# End-to-end testing

Digga's E2E suite drives the built app in Chromium against fake Discogs and YouTube services.
Each test has its own server, temporary library and fake services. The shared suite is designed
for an Electron host later; only the web host exists today.

Read this guide when running, writing or debugging E2E tests. Then read only the documents
needed for the task. Routine product work does not require loading the full E2E reference.

## Read for the task

| Task                                                  | Read                                                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Run the suite                                         | [Running](#running) below                                                                               |
| Add or change a test or page object                   | [AUTHORING](e2e/AUTHORING.md) and the relevant [scenario family](e2e/scenarios/README.md)               |
| Debug a failure                                       | [Failure artifacts](e2e/AUTHORING.md#failure-artifacts), then the relevant authoring or harness section |
| Change process launch, isolation, guards or lifecycle | [HARNESS](e2e/HARNESS.md)                                                                               |
| Change fixture data or fake services                  | [FIXTURES](e2e/FIXTURES.md)                                                                             |
| Rehearse the setup manually                           | [Manual rehearsals](e2e/FIXTURES.md#manual-rehearsals) and the harness's isolation rules                |
| Continue the E2E implementation project               | [PLAN](e2e/PLAN.md)                                                                                     |
| Work on Electron testing                              | [ELECTRON](e2e/ELECTRON.md) and its linked shared contracts                                             |
| Investigate an earlier finding or measurement         | Search [HISTORY](e2e/HISTORY.md) by scenario ID or error                                                |

The scenario specifications include unimplemented coverage. The plan tracks remaining work;
history records what earlier runs found. Neither is a prerequisite for an unrelated test change.

## Running

Install Chromium once with `npx playwright install chromium` (`--with-deps` on Linux).
Run from the repository root:

```sh
vp run e2e:smoke                 # build, then all implemented @P0 tests on web-chromium
vp run e2e                       # build, then every implemented web scenario, including P2
vp run verify                   # format, lint, types, unit tests, portability, Svelte, smoke

# After vp build: one scenario or a changed spec's required burn-in
npx playwright test --config tests/e2e/playwright.config.ts --grep '@TRI-12\b'
npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/specs/triage.e2e.ts --repeat-each=10
```

The direct Playwright commands do not build the client. Include the ID boundary (`\b`) in a
filter: without it, `@TRI-1` also selects TRI-10 to TRI-19. Without a global `vp`, use `npx vp`.

The scripts in [package.json](../package.json) and the
[Playwright configuration](../tests/e2e/playwright.config.ts) define the runnable suite.
`e2e:nightly`, `e2e:electron` and `e2e:contract` are planned and do not exist yet. The CI workflow
is also planned; the configuration already fails CI runs that pass only on retry.

A new or changed spec must pass `--repeat-each=10` before its commit. All repository checks
must also pass as required by [AGENTS.md](../AGENTS.md#commands). Failure diagnostics are in
[AUTHORING](e2e/AUTHORING.md#failure-artifacts).

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
YouTube or Discogs themselves, and pixel comparisons (optional, see [the implementation plan](e2e/PLAN.md#breadth-and-release-checks)).

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
| The accessibility tree matches what the keymap promises       | E2E (axe scans planned)    |
| Electron shell: window, menu, dialogs, safeStorage, downloads | E2E, Electron project only |

When a bug crosses layers, its fix gets an E2E regression test. When a bug is inside one module,
its fix gets a vitest test.

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
11. When a bug crosses layers, its fix adds an E2E scenario with a new ID in the relevant
    [scenario family](e2e/scenarios/README.md).
12. A scenario the product does not meet yet is marked as a gap in its scenario specification.
    Today's behaviour gets a normal test and the design a `test.fail`; never assert today's
    behaviour as if it were the design.

## Maintaining these documents

Update the document that owns the information: rules and task routes here, test-writing guidance
in AUTHORING, process contracts in HARNESS, test data and fakes in FIXTURES, acceptance criteria
in the scenario family, and remaining work in PLAN. Keep dated investigation evidence in HISTORY.
Update references when moving a section. Do not append session reports to this entry point.
