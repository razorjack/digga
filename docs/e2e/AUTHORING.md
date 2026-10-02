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
  navigation is released in Electron. After `install()` time keeps flowing, so polling runs. A
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
- A want, with time flowing: after the verdict, wait for "Added to your Discogs wantlist.", which
  shows only after `POST /api/discogs/wantlist/:id` has answered, then read the fake's log. The
  app's request answers only after the server's call to the fake has completed, however long the
  server's 1.1 s throttle held it.
- `Z` while a push is on its way (TRI-39): hold `PUT /users/:user/wants/:id` at the fake before
  `A`, await the hold's `received`, press `Z` and wait until the undo has settled, then release
  the hold and wait for the answer to `DELETE /api/discogs/wantlist/:id`, which the session sends
  once the push has answered. A pending slip is read the same way (TRI-12).
- Nothing pushed (PER-04): the verdict's request fails, so the session never starts a push.
  Check that the page sent no request to `/api/discogs/` (`app.apiRequests()`), then that the fake
  received nothing after the mark the test took before the key. The saved token's given state has
  already asked the fake for `/oauth/identity` before the page opened, so its log is not empty
  from the start. The server calls Discogs only when the page asks, so the page's log decides,
  and the fake's log confirms.
- The sandbox sends no verdict request. Its helpers wait for the record to change and the slip to
  settle, and a sandbox want ends when the slip reads "Added to your wantlist (sandbox: nothing
  sent).", after a real `GET /api/releases/:id` and the sandbox's 350 ms delay.
- A request that must stay in flight while the test acts is held at the fake (TRI-39), never
  delayed by a fixed time.
- A failed push is tried again on a browser timer (TRI-15, TRI-45). With the clock paused before
  the verdict, the slip reads "trying again in 5 s." once the session has armed the wait, so the
  test waits for that text and then runs the clock by the wait, one try at a time. Running the
  clock in fixed steps instead overshoots the last try and fires the timer that clears the
  message the test reads.
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
- A negative check after a sandbox push that a mode switch interrupted (SBX-04) runs the clock
  past the push's 350 ms, then waits for the answer to a later request, the `GET /api/queue` that
  `T` sends. Playwright delivers the browser's events in order, so a request that the push's end
  started is in the page's log by then.
- A response that must follow another is matched in order: the first wait notes its match inside
  its own predicate (`waitForResponses()` in `pages/triage.ts`). Playwright runs predicates in the
  order the responses arrive, but a callback chained to the first wait can run after both
  responses have been dispatched, when they arrive together, and the second wait then never
  matches. The Settings burn-in hung once in 60 runs on exactly that (see [The Settings P1 slice](HISTORY.md#the-settings-p1-slice-web)).
- Settings' Delete asks with `window.confirm()`, and Playwright dismisses a dialog no listener
  handles. `deleteDump()` registers a `once("dialog")` listener before the click, which records
  the dialog's type and message and accepts or dismisses as the test says.
- Some writes leave in a fixed order: the session saves verdicts one at a time, the player posts
  listens in order, and each paste sends its request at once. A request that should not exist
  would then be in the page's log before the answer to a later one, so a negative check waits for
  that answer and counts: one `POST /api/verdicts` per press of a held key (TRI-11), no attachment
  from a paste of other text or into the note field (TRI-26), no listen for a remainder under 1 s
  (TRI-36).

## Determinism

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
   (`LiveRegionWatch`, see [Synchronisation](#synchronisation)); against the old markup all three failed. The
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
  work (see [Synchronisation](#synchronisation)). On a failed save the slip clears and the busy state goes with it.
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
