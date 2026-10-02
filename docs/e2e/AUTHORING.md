# Writing and debugging E2E tests

Read this when adding or changing tests and page objects, or investigating a failure. Start with the [E2E guide](../E2E_TESTING.md)
and its binding rules. Read the relevant [scenario family](scenarios/README.md). Read [FIXTURES](FIXTURES.md) only
when the task needs different data or fake behavior.

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
the desk during a practice round, a round of snoozed records or a scope has no role, so
`TriagePage.banner` finds it by its opening words; the market line is the only `status` in the record's header (`TriagePage.market`).

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
repository allows only erasable syntax, so do not use parameter properties.

Use [TriagePage](../../tests/e2e/pages/triage.ts) as the implementation reference.
`startListening()` waits for `needs_gesture`, presses Space and waits for `playing`.
`judge()` waits for a visible record, arms the verdict response before the key press, checks
that response and its completed body, and waits for the slip to stop being busy.
`playerStatus()` matches exact copy within the Player region, because "Nothing playing"
also contains "playing".

`judge()` is for live mode. In the sandbox no request is sent, so `judgeInSandbox()` waits for
the record to change and the slip to settle.

## Time

`clock` fakes the page's timers, `Date` and `performance.now()`. It controls the browser's
timers only:

| Browser timer                                                            | Where                                                                                                            |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| 350 ms before a sandbox push completes                                   | `sandbox.ts` (`pushDelayMs`)                                                                                     |
| 5 s, 30 s and 2 min before a failed push is tried again                  | `triage/session.svelte.ts` (`PUSH_RETRY_DELAYS_MS` in `shared/wantlist.ts`)                                      |
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
  navigation is released in the planned Electron host. After `install()` time keeps flowing, so polling runs. A
  test asks for it with `test.use({ diggaOptions: { clock: true } })`; the host installs it on
  every context it opens, a relaunch's too.
- A test whose action must land inside a browser timer's window, such as a sandbox switch before
  a sandbox push's 350 ms have passed, pauses the clock before the key press that starts the
  window and keeps it paused until the action has completed. Pausing only around the assertion is
  too late: the window would close in real time while the test acts.
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

## Synchronisation

Visible state often comes before the work it announces. In Triage the slip turns "pending"
before `POST /api/verdicts` is sent, a want's push starts only after the page has read that
request's answer (`#saveVerdict()`), and "undone" shows before `DELETE /api/verdicts/:key`
completes. The first visible sign is therefore not proof that anything finished. Tests
synchronise on completed requests and on the state the app sets after them:

- Arm `page.waitForResponse()` before the action that causes the request, a key press or a
  `runFor()`, and await it after. Match on the decoded path: the undo's request is
  `/api/verdicts/m%3A501` on the wire, and a push is preceded by `GET /api/releases/:id`.
- A response is not the end of the work. `waitForResponse()` resolves on the headers, and the
  page reads the body before it continues. The helper checks `response.ok()`, awaits
  `response.finished()`, and then waits for the state the page sets afterwards. For verdicts and
  undos that is the slip's `aria-busy` returning to false (see [Markup audit](#markup-audit)): by then the page
  has run the code after the save, which starts a want's push.
- A request that must stay in flight while the test acts is held at the fake (TRI-39), never
  delayed by a fixed time.
- A live region that must be in the page before its text ([live-region audit](HISTORY.md#markup-audit-recorded-through-2026-10-02)) is checked with
  `LiveRegionWatch` (`support/live-regions.ts`). Installed before the page opens, its init script
  runs a `MutationObserver` from the page's first script and records each live region
  (`role="alert"`, `role="status"` or `aria-live`) inserted with text already in it. The test reads
  the record after the message shows and checks that the message is not in it. A region present
  when the step mounts and filled later passes; a region inserted with its text fails, as the old
  markup did in SETUP-05, SETUP-08 and SETUP-09. Regions inserted with their text when a page
  first renders are recorded too, which is harmless and why the tests look for their own message.
- A response that must follow another is matched in order: the first wait notes its match inside
  its own predicate (`waitForResponses()` in `pages/triage.ts`). Playwright runs predicates in the
  order the responses arrive, but a callback chained to the first wait can run after both
  responses have been dispatched, when they arrive together, and the second wait then never
  matches. The Settings burn-in hung once in 60 runs on exactly that (see [The Settings P1 slice](HISTORY.md#the-settings-p1-slice-web)).
- Some writes leave in a fixed order: the session saves verdicts one at a time, the player posts
  listens in order, and each paste sends its request at once. A request that should not exist
  would then be in the page's log before the answer to a later one, so a negative check waits for
  that answer and counts: one `POST /api/verdicts` per press of a held key (TRI-11), no attachment
  from a paste of other text or into the note field (TRI-26), no listen for a remainder under 1 s
  (TRI-36).

The completion contracts for each page are kept with its scenarios: [triage](scenarios/triage.md#completion-contracts), [persistence](scenarios/persistence.md#completion-contracts), [sandbox](scenarios/sandbox.md#completion-contracts), [settings](scenarios/settings.md#completion-contracts), [twelves](scenarios/twelves.md#completion-contracts), [shell](scenarios/shell.md#completion-contracts), [setup](scenarios/setup.md#completion-contracts).

## Determinism

- Viewport 1600 x 1000; the Electron plan uses the same content size. The header hides the sandbox
  explanation from sight while a dump job runs at 1440 px and below, and it and the ETA at 1180 px
  and below (`App.svelte`), as `.visually-hidden` does, so accessible names stay the same;
  responsive checks set their own viewport.
- `locale: "en-US"`, `timezoneId: "UTC"` in the browser; `TZ=UTC` in the server, so backup file
  names (`localDay()`) and the Twelves day column agree. The `random` strategy's seed is the
  server's UTC day.
- `reducedMotion: "reduce"`, which shortens the stamp's slam animation to 0.01 ms.
- `colorScheme: "dark"` unless the test is about the scheme.
- Fonts ship in `dist/` and the stamps are seeded, so screenshots attached to failures are
  comparable; the background grain is not seeded.
- Assertions that involve dates match a pattern or a relative phrase, never today's date. The
  `random` strategy is checked for stability across reloads, not for a fixed order.

## Failure artifacts

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

## Accessibility scans

`expectAccessible(page, state)` in [support/axe.ts](../../tests/e2e/support/axe.ts) scans the page
with `@axe-core/playwright` and fails on serious and critical violations, and on
`landmark-unique` and `page-has-heading-one` whatever their impact. It attaches each scan's full
result to the test as `axe <state>.json`, passed or failed; moderate and minor findings and axe's
incomplete checks are read there.

- Scan a settled state. axe reads the DOM once, so reach the state through the page objects and
  wait for what it shows (the playing status, a shelf's rows, Settings' filter preview, the
  crate's count) before the scan.
- axe reports an `aria-labelledby` that names nothing only as incomplete, so assert the region
  names a scenario relies on directly.
- Every rule runs in the dark scheme the host emulates; `color-contrast` runs again in the light
  scheme (`lightScheme: false` skips that for a state drawn with components already scanned).
  Chromium applies an emulated scheme at its next frame, and a computed style read before then
  mixes the two schemes: the first light scans reported contrasts of 1.03 to 2.09 between one
  scheme's text colour and the other's background. The helper waits until the body's background
  has changed before it scans, and again after it puts the dark scheme back.
- Never disable a rule globally. A rule excluded for one element needs a comment in the spec and
  a sentence in the scenario saying why it does not apply; none is excluded today.
- A contrast failure that needs a new colour is the owner's decision: record it as a product gap
  with the measured ratio and both colours.

## Markup audit

The current locator contract uses native roles, accessible names, ARIA state and domain
identity. For the original findings and their fixes, read the
[dated audit](HISTORY.md#markup-audit-recorded-through-2026-10-02); its findings are all fixed,
and new ones go to [PLAN](PLAN.md). Do not treat the historical audit as a task list.

### Handles for identity and state

Use domain identity when no semantic equivalent exists. State comes from ARIA or visible text;
`data-*` never replaces the information a screen reader needs.

| Element                     | Identity attributes                  |
| --------------------------- | ------------------------------------ |
| Triage release facts header | `data-release-id`, `data-triage-key` |
| Tracklist track row         | `data-position`                      |
| Tracklist Other videos row  | `data-video-id`                      |
| Twelves record row          | `data-triage-key`, `data-release-id` |
| Tracks shelf row            | `data-release-id`, `data-position`   |
| Settings job row            | `data-job-id`                        |

A Twelves verdict whose release is absent from the dump has no `data-release-id`.
There is one visible `main`: other pages unmount, and hidden Triage drops out of role queries.
No page identity handle is needed.

Track buttons expose "playing", "has a video", "video would not play" or "no video" as text,
and the current track has `aria-current`. Job status is cell text. Delete buttons include
the dump name; header counts are text; queue loading is `aria-busy`. Read slip states from
`STATUS_COPY` and push messages, player states from `PLAYER_STATUS_COPY`, with exact matching.
Within a Twelves row, exact "want" distinguishes its stamp from "1,210 want" in the market cell.

Use `data-testid` only when neither accessible semantics nor domain identity can identify the
element, and explain that exception in a comment.

### Names and state contracts

- Settings names the Sandbox, Library, Backups and exports, Discogs, and Jobs regions with
  `aria-labelledby`. Discogs is inside the settings form; other form sections stay unnamed.
  Opened at `#/settings/sandbox`, the Sandbox region has `aria-current="location"`, which also
  draws its highlight.
- The slips are groups named "Last action" and "Up next", retaining the last action's
  `aria-live`. Groups identify the slips without adding landmarks. The last action is busy
  from a verdict or undo key until the request has answered and the page has acted on it;
  a failed save clears the slip and busy state.
- `Flash.svelte` takes an optional `label`. "Triage messages" and "Player notices" distinguish
  these regions from the header, market and scope-picker status regions.
- The queue's `.record` carries `aria-busy` while it loads. This is an ARIA-state contract,
  not permission to locate it by class.
- Twelves uses `aria-current="true"` for the selected row and calls its pager "Shelf pages".
  The table uses J/K navigation; adding `aria-selected` alone would not implement a grid.
- The load-year fields are named "load from" and "load to"; the second label's hidden "load"
  distinguishes it from the listening-year field named "to".
- `aria-keyshortcuts` identifies key-bound controls. Verdict buttons get values from
  `keymap.ts`; other controls declare theirs in the component.
- Setup IDs (`token`, `style-search`, `practice-done-title`) are currently unique. If a component
  mounts twice, use `$props.id()`; tests do not locate controls by generated or structural IDs.

Invalid fields expose `aria-invalid` and reference their error after their hint through
`aria-describedby`; clearing the error clears its association and custom validity. Keep live
regions in the DOM before adding their messages. `LiveRegionWatch` checks this insertion order
([synchronisation](#synchronisation)); it does not prove what a screen reader announces.
