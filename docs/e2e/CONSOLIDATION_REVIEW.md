# E2E consolidation review

Reviewed on 2026-10-17 against `d9541b1faed4870fc008f9e328b65daa2c4a28e5` on `master`.
This is a proposal, not an implementation. Only this report changes in this review.
References name the reviewed revision; line numbers will move when proposals are applied.

## Recommendation

Merge six tests into four existing tests. Keep every other test and the current priority policy.
The suite has **212 distinct tests in 32 spec files**, not 206. The web project runs 192;
Electron selects 205. There are 185 shared tests, seven web-only tests and 20 Electron-only
tests. A scenario ID can have several tests, so counting IDs or textual `test(` calls gives a
different answer. The inventory at the end lists every expanded test, its exact title,
location, priority, hosts and one recommended action.

| Scope          | Now: P0 / P1 / P2 | Now total | After M1–M6: P0 / P1 / P2 | After total |
| -------------- | ----------------- | --------- | ------------------------- | ----------- |
| Distinct tests | 16 / 137 / 59     | 212       | 16 / 133 / 57             | 206         |
| Web            | 13 / 130 / 49     | 192       | 13 / 126 / 47             | 186         |
| Electron       | 15 / 136 / 54     | 205       | 15 / 132 / 52             | 199         |

The packaged inspectable project uses the same host exclusions as Electron, so its selected
count is also 205, or 199 after the proposals. This follows from its configuration; it was not
packaged or run. All six removed tests are shared. No spec file becomes empty.

Both complete web runs passed without retries or skips. The default five-worker run took
117.48 seconds wall time, with one-minute load 19.82–32.19. The two-worker run took 227.85
seconds, with load 7.63–18.36. These load ranges do not overlap. They are separate observations,
not evidence of worker-count efficiency.

**Estimated CI saving: roughly five seconds per push if per-test costs match this session's
two-worker run.** This is a planning estimate, not a CI measurement. The six removed tests
account for 11.241 worker-seconds in that run, or 5.621 seconds divided between two workers,
before the surviving tests gain assertions. Their individual loads appear in the proposal
table. Added assertions and scheduling reduce that saving; Linux performance could change it
in either direction. There is no evidence here for a minutes-long reduction. Do not multiply
this estimate by a historical CI/Mac ratio.

No behavioral assertion or scenario ID is intentionally lost. Six independent failure results
become steps within four tests. An early failure can prevent later steps from running. That is
the explicit cost of these merges. No test is proposed for outright deletion or replacement
with vitest: the apparent unit overlap still leaves a browser, HTTP or lifecycle contract.
The two ineffective queue-count assertions described below already weaken current coverage;
the merges do not cause that gap.

## Measurement method and limits

Environment: arm64 macOS, Node `v24.18.0`, ten logical CPUs, local `CI` unset. Playwright chose
five workers by default. The CI configuration chooses two. Builds and tests used existing
dependencies. Every app process came from the repository harness and used a throwaway library,
fake tokens and fake services. No request to real services was made. Electron was listed only;
no Electron app or packaged build was started.

Commands, in order, from the repository root:

```sh
python3 /tmp/digga-consolidation-review/measure.py build vp build

PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/digga-consolidation-review/default-permitted.json \
  python3 /tmp/digga-consolidation-review/measure.py default-permitted \
  npx playwright test --config tests/e2e/playwright.config.ts --reporter=json

PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/digga-consolidation-review/electron-list.json \
  npx playwright test --config tests/e2e/playwright.electron.config.ts --list --reporter=json

PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/digga-consolidation-review/two-workers.json \
  python3 /tmp/digga-consolidation-review/measure.py two-workers \
  npx playwright test --config tests/e2e/playwright.config.ts --workers=2 --reporter=json
```

The temporary wrapper starts the command with `subprocess.Popen`, records `time.time()` and
`os.getloadavg()[0]` once per second until exit, and writes its command, start/end, exit status
and samples to JSON. It redirects child output to a separate log. It was not added to the
repository. Wall time includes command launch and up to one sampling interval after exit.
Playwright's duration excludes some wrapper overhead. Per-test durations below come directly
from the successful JSON results, paired with the minimum and maximum sampled one-minute load
during each test's `startTime` through `duration`. A test shorter than a sampling interval uses
the nearest sample if no sample falls inside it. Load is machine-wide, not CPU usage attributed
to Digga. A displayed single value is a range whose endpoints round to the same value.

| Command               | Workers | Result     | Wall seconds | Playwright seconds | Load start / end | Load min / mean / max |
| --------------------- | ------- | ---------- | ------------ | ------------------ | ---------------- | --------------------- |
| Build                 | n/a     | passed     | 8.04         | n/a                | 45.25 / 42.44    | 42.44 / 43.59 / 45.25 |
| Full web, default     | 5       | 192 passed | 117.48       | 116.48             | 32.19 / 21.43    | 19.82 / 24.23 / 32.19 |
| Full web, two workers | 2       | 192 passed | 227.85       | 226.19             | 18.36 / 10.19    | 7.63 / 12.84 / 18.36  |

The successful default run began at 17:27:48 UTC; the two-worker run at 17:30:07 UTC.
An earlier sandboxed invocation failed to bind loopback with `EPERM`; it is excluded from
product results and timing comparisons. The permitted runs used the same harness and client
build. The load was falling, so the second run is useful as a two-worker cost inventory, not
a controlled repetition. No further full run was needed to make that distinction.

Raw JSON, logs and one-second load samples remain under `/tmp/digga-consolidation-review/`.
They are temporary local evidence, not committed artifacts. This report preserves all test
durations and load ranges, so its conclusions do not depend on those files surviving.

### What the slow tests spend time doing

The slowest-test table below uses the two-worker run. The final inventory includes both runs
for every web test. JSON contains total test durations, not a profile of fixture setup versus
test body. The cost explanations are inferences from the executed code, not measured phase
percentages.

- Every test pays for template lookup/copy, an isolated server, a browser context and cleanup
  (`tests/e2e/support/test.ts:169`, `:217`; `support/templates.ts:39`, `:74`). Templates are
  built lazily per run. Concurrent cold builders can duplicate work before one wins the rename.
  This is not a reason to share mutable libraries or processes between tests.
- SETUP-18/19 and most slow setup recovery cases wait for actual committed records to become
  visible. `pages/setup.ts:18` describes the server commit, job polling and count polling;
  `waitForRecordsToDig` at `:488` waits on the UI. M1 removes one duplicate traversal of that
  exact wait. M2/M3 remove short setup traversals that stop before the count is visible.
- A11Y-01 setup, Twelves and Settings perform repeated axe scans of different rendered states,
  with light-scheme checks as well (`specs/accessibility.e2e.ts:95`, `:123`, `:146`). Setup also
  imports and loads data. These are useful scans, not sleep calls. Combining them into a
  larger test would worsen diagnostics without eliminating their scans.
- SETUP-28 at `specs/setup-discogs.e2e.ts:202` deliberately reloads at successive setup states,
  holds an import and waits for loading. Its `openNewPage` helper at `:276` changes a hash and
  reloads. Do not remove the reload as an apparent duplicate navigation: changing only the
  fragment can leave the same document alive and would stop testing resume from server state.
- SETUP-25 and SETUP-26 deliberately perform multiple transfers, loads and UI polling cycles
  (`specs/setup.e2e.ts:264`, `:302`, `:341`, `:376`). One bad checksum and two bad checksums
  exercise automatic retry and exhausted retry respectively. They are not interchangeable data
  rows. SETUP-27 at `:487` adds a crash/relaunch and recovery.
- SETUP-01 and SETUP-10 with a username include serialized Discogs requests and imports before
  the load and verdict. Skipping these jobs would remove the flow they exist to check.
- TRI-15 and TRI-16 advance the browser clock through retry windows, but Discogs I/O and its
  spacing still run in the server (`specs/triage-discogs.e2e.ts:219`, `:265`). Browser clock
  advancement is not equivalent to making all elapsed time virtual. Do not add a rate-limit
  bypass merely to shorten these tests.
- TWL-03 uses the bulk library, seeds 1,200 verdicts and renders 500-row pages
  (`specs/twelves.e2e.ts:177`). It checks selection across page boundaries and accessible range
  names. The unit paging tests do not exercise that DOM or keyboard flow.

No standalone speed fix is supported strongly enough to recommend changing polling intervals,
clock ownership, template caching or request spacing. M1–M6 remove repeated setup and process
cost without such machinery. Instrument fixture phases in a later performance investigation
before assigning a percentage of a test's time to process start or template copy.

## Assertion-preserving merges

All locations in the following sections are under `tests/e2e/` unless a full repository path is
given. All source and survivor titles also appear verbatim in the inventory. Keep every source
scenario tag on its survivor, but use the survivor's single priority tag. Use named `test.step`
blocks identifying the original scenario and check. A failure should name the combined test,
the failed step and the original assertion location. Do not use soft assertions to make an
invalid setup continue.

These proposals comply with E2E rules 1–7: each survivor still starts from one explicit given
state, drives the UI, preserves response/state waits and retains public-API observations.
They do not join independent fixtures or different initial data. Rule 11's regression scenario
IDs remain tagged and specified. Rule 10 still requires the changed specs' ten-run burn-in on
both applicable hosts before their implementation commit. No binding rule change is needed
for M1–M6. The loss of independent failure reporting is a review choice, not permission to
make tests depend on each other.

### First run: M1, M2 and M3

Survivor: **SETUP-18 held at a checkpoint, the crate shows what the load has read**,
`specs/setup.e2e.ts:131`. All four original tests use `empty`, the listed `bulk` dump, no
account and the held `100-to-dig` checkpoint. `fillTheCrate` at `:587` follows the same
Fetch → skip Discogs → pick Drum n Bass → Fill path as the accessibility tests. No additional
fixture or account variation disappears.

**M1: merge SETUP-19 held at a checkpoint, the load counts the records the download has brought
so far**, `specs/setup.e2e.ts:162`, into SETUP-18 after its existing count wait and before it
leaves the crate. Retain SETUP-18's progress, latest-release, catalogue number and header
indicator checks, and its subsequent Settings/Twelves navigation.

Every assertion from SETUP-19 survives as follows:

| Source assertion or completion precondition                                        | Location in the survivor                                             |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Fetch, skip, pick and Fill complete through the page object's response/step checks | Existing setup path, with M2's explicit step checks added            |
| Crate shows `point.recordsToDig`                                                   | Existing `waitForRecordsToDig` before either scenario's observations |
| `/api/stats.remaining === point.recordsToDig`                                      | New `SETUP-19 committed count` step after the visible count          |
| `fakes.dumps.sentBytes === point.offset`                                           | Same step, while the transfer remains held                           |
| Running jobs include both `dump_download` and `dump_load`                          | Same step, same `/api/jobs` query and `arrayContaining` assertion    |
| `/api/dumps.files` is empty because the download is still a part file              | Same step, before any release of the held download                   |

Failure reporting: the combined SETUP-18/19 title identifies the journey; the named SETUP-19
step identifies count, byte, job or part-file failure. A failed SETUP-18 UI check can prevent
these API checks from running. Risk is low because the checkpoint is held and neither test
changes it before these assertions. Preserve the visible count wait; a visible progress bar
does not establish that the count query has caught up with the committed records.

**M2: merge A11Y-04 each setup step sets the document title**,
`specs/accessibility.e2e.ts:345`, into that same SETUP-18 journey. Spell out this test's short
setup path in the survivor; do not add a generic callback framework to `fillTheCrate`.

| Source assertion or completion precondition                                            | Location in the survivor                                               |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Initial catalogue step has its expected heading, address and step state (`expectStep`) | Immediately after `app.open()`                                         |
| Catalogue document title is `stepTitle("catalogue") + " – Digga setup"`                | Before Fetch                                                           |
| Discogs document title uses `stepTitle("discogs")` and the same suffix                 | After Fetch completes                                                  |
| Sound document title uses `stepTitle("sound")` and the same suffix                     | After skipping Discogs                                                 |
| Crate document title uses `stepTitle("crate")` and the same suffix                     | After picking the style and Fill completes, before waiting for records |
| Fetch, skip, pick and Fill response/step preconditions                                 | The same page-object calls, in the same order                          |

Failure reporting: use steps such as `A11Y-04 catalogue title` and `A11Y-04 crate title`.
An early title failure will prevent later setup checks; today the independent title test can
fail while SETUP-18 still reports its outcome. Risk is low, but keep all four titles. Moving
only the final title would lose coverage. `@A11Y-04` must still select this test.

**M3: merge A11Y-05 the crate's Start digging declares T and Enter**,
`specs/accessibility.e2e.ts:386`, into SETUP-18 immediately after Fill completes, before its
count wait. Its only additional assertion is the Start digging button's exact
`aria-keyshortcuts="T Enter"`. The existing identical page-object journey preserves every
action completion check. Do not move this assertion to the later enabled-button state in
SETUP-21: the original checks the early crate state.

Failure reporting: `A11Y-05 crate shortcuts` identifies an attribute failure; a preceding setup
failure masks it. Risk is low. HISTORY at `:841` records the missing shortcut markup found by
this family. This merge keeps that exact regression assertion on the same control and state;
it does not infer coverage from actually pressing the keys. Add `@A11Y-05` to the P1 survivor.
This brings a former P2 assertion into a P1 test without retaining two priority tags.

### Shell: M4

Merge **A11Y-04 each page sets the document title**, `specs/accessibility.e2e.ts:331`, into
**SHELL-02 T, W and , switch pages; the current link, the hash and the title follow**,
`specs/shell.e2e.ts:38`. Both start with `small`, no account, and visit Twelves, Settings,
then Triage by the same keys. `HeaderPage.goTo` at `pages/header.ts:44` presses these keys;
it is not a separate mouse-navigation path.

| Source assertion or completion precondition                                         | Location in the survivor                                               |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Initial title is `page("triage").label + " – Digga"`                                | Add after the initial visible Triage check, before the loop            |
| Header page navigation is visible before each key                                   | Retain the helper's visibility precondition explicitly before each key |
| Destination has `aria-current="page"` after each key                                | Already checked for each route                                         |
| Twelves, Settings and returned Triage titles match `page(route).label + " – Digga"` | Already checked for the same three routes, in the same order           |

SHELL-01 also checks the initial title, but the added assertion keeps `@A11Y-04` independently
selectable without relying on SHELL-01 running. Keep SHELL-02's visible-page, other-link and
hash assertions. Report failures under the route's named step and a combined SHELL-02/A11Y-04
title. Failure isolation is slightly worse; runtime and route-state coverage remain equivalent.
Risk is low. The P0 survivor gains only the initial title and navigation precondition checks.
Do not add a P1 tag to it.

### Triage: M5

Merge **A11Y-05 the scope picker's dig button declares Enter**,
`specs/accessibility.e2e.ts:368`, into **TRI-21 one Esc closes the picker while its search field
holds text**, `specs/triage-queue.e2e.ts:559`.

Both use `small`, no account, open Triage and open the picker for the first time. Retain
`openScopePicker()` and all its record, picker and focus preconditions. Add the removed test's
only additional assertion, the dig button's exact `aria-keyshortcuts="Enter"`, immediately
after that first open, before searching for `zzq`. Keep all TRI-21 search, close, hidden banner,
reopen, cleared search and on-record group assertions.

Failure reporting: `A11Y-05 scope shortcut` fails before `TRI-21 Escape and reopen`; the latter
will not run if the attribute is wrong. Risk is low. As with M3, HISTORY at `:841` identifies a
real missing-markup bug, and this transfers the exact assertion to the same initial state.
Keep `@A11Y-05`, with the survivor's P1 priority only. The other TRI-21 tests have different
scopes or account data and remain independent.

### Twelves: M6

Merge **TWL-07 a snooze re-judged a want goes on the Discogs wantlist**,
`specs/twelves-discogs.e2e.ts:102`, into **TWL-11 Z undoes the last change, its wantlist request
included**, `specs/twelves-discogs.e2e.ts:239`.

Both use `small-account`, `e2e-token-dj`, and the same dated snooze on `FIRST_RECORD`. Both
open the Snoozed shelf and rejudge it accepted. `TwelvesPage.rejudge` at `pages/twelves.ts:272`
already waits for the saved verdict, shelf response and completed wantlist message. This is
not the in-flight undo race; TRI-39 stays separate.

| Removed assertion or completion precondition                                                                            | Location in TWL-11                                                          |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Snoozed shelf selected key equals `triageKeyOf(FIRST_RECORD)`                                                           | Add before rejudge                                                          |
| Rejudge saves, reloads the shelf and completes the push                                                                 | Keep the same `rejudge("accepted")` helper                                  |
| Exact message is `rejudgedSentence(nameOf(FIRST_RECORD), "accepted") + " Added to your Discogs wantlist. Z undoes it."` | Add immediately after rejudge                                               |
| Exactly one PUT, with `user: DJ.username` and `id: String(FIRST_RECORD.id)`                                             | Add the complete original array assertion before undo                       |
| Accepted shelf has a visible accepted stamp for that key                                                                | Visit Accepted and assert, after TWL-11's original absence check on Snoozed |
| Its row does not contain `not on your Discogs wantlist`                                                                 | Same Accepted visit, after the completed push                               |
| Open/shelf selection checks performed by page objects                                                                   | Keep the same helpers; return to Snoozed before undo                        |

Then retain every original TWL-11 assertion: `Undone.`, the restored snoozed stamp, the DELETE
user and release, DELETE arrival no earlier than PUT completion, absence from the fake
wantlist, and the exported original snooze date. Shelf selection changes presentation and
does not clear `undoStack` (`src/client/twelves/shelf.svelte.ts:63`).

Failure reporting: `TWL-07 saved want and membership` and `TWL-11 undo restores snooze` separate
the stages. A push or membership failure prevents reporting undo independently. Risk is
moderate: the extra shelf visit changes how soon undo runs. The original helper already waits
for the push to complete, so this does not remove its ordering assertion or an in-flight
window. Preserve the separate held-push TRI-39 test. Leave TWL-07's other initial states as
separate tests; do not chain their rejudgements onto this one.

### Savings by proposal

These are removed test durations, not measured savings after implementation. All use the
two-worker run. The additional assertions remain work in the survivor. The right-hand column
is an optimistic division-by-two scheduling proxy, not an additive guarantee about wall time
or a CI measurement. M1 should produce most of the actual saving; M6 adds the most new work.

| Proposal | Removed test             | Worker-seconds (sampled load) | Gross two-worker wall proxy, seconds |
| -------- | ------------------------ | ----------------------------- | ------------------------------------ |
| M1       | SETUP-19                 | 5.618 (13.34–13.34)           | 2.809                                |
| M6       | TWL-07 snooze to want    | 1.658 (8.29–8.29)             | 0.829                                |
| M3       | A11Y-05 crate shortcut   | 1.215 (16.08–16.15)           | 0.608                                |
| M2       | A11Y-04 setup titles     | 1.167 (16.08–16.08)           | 0.584                                |
| M4       | A11Y-04 main-page titles | 0.853 (16.08–16.08)           | 0.427                                |
| M5       | A11Y-05 scope shortcut   | 0.730 (16.08–16.08)           | 0.365                                |

## Tests considered and kept

The inventory gives every test its disposition. These are the cases where duplication or cost
made the decision less obvious. Existing vitest coverage is evidence against expanding E2E
combinations; it is not proof that the current cross-layer observation can disappear.

### Guard, shell and accessibility

Keep GUARD-01/02/03. `tests/e2e-guard.test.ts` checks interception mechanisms, but the E2E
tests prove that the real launched server, browser and Electron preload actually install and
enforce them. They protect the owner's library and external services.

Keep SHELL-03/04/05 focus and dialog behavior. `tests/keymap.test.ts` checks definitions and
matching, not browser focus, event routing or modal lifecycle. HISTORY at `:589` records a
dialog wait that missed the closing element; preserve the current synchronization. Keep the
web-only URL/history cases under their existing host restrictions.

Keep all six A11Y-01 tests and all live-region tests. Static copy helpers and component state
tests cannot establish that a live region existed before its text changed. HISTORY at `:834`
records heading and alert insertion defects. The title/attribute merges above leave those
scans and insertion checks untouched. Do not collapse the scans into one suite-wide assertion
or drop light-scheme checks because the DOM looks similar.

### First run

Keep both SETUP-01 P0 cases. The default-config/account journey and immediate `T` during a
partial load have different preconditions. HISTORY at `:181` records the stale queue exposed
by the latter; `tests/setup-flow.test.ts` and `tests/setup-access.test.ts` do not drive that
browser-to-worker transition. The setup polling race at HISTORY `:193` also argues against
weakening completion waits.

Keep SETUP-21's threshold and shortcut flow, SETUP-24's change-picks cancellation, both
SETUP-25 download failures, both SETUP-26 checksum outcomes, SETUP-27 crash recovery and both
SETUP-28 resume cases. These use different intermediate states, not merely different inputs
to one pure function. `tests/setup-model.test.ts`, `tests/setup-flow.test.ts`,
`tests/setup-http.test.ts`, `tests/dump-download.test.ts`, `tests/dump-load.test.ts` and
`tests/growing-dump.test.ts` cover their rules and server mechanics. They do not show the
correct next page after a real reload or process restart. SETUP-27 exposed raw interrupted-job
copy (HISTORY `:829`); retain the user-facing assertion.

Keep SETUP-06's already-downloaded case. HISTORY at `:652` records it incorrectly skipping
the first step. Token and username setup paths also remain separate: they cause different
identity requests and push permissions. M1–M3 are the only setup reductions recommended.

### Settings

Keep SET-03 validation. `tests/config.test.ts` and `tests/integer.test.ts` already cover the
value rules, but `specs/settings.e2e.ts:117` checks native field state, accessible errors and
Save being disabled. Keep SET-05 at `:188` and SET-26 in `settings-styles.e2e.ts:12`: one style
and no styles are different UI states, and no styles is a regression boundary. Do not merge
them simply because queue SQL already has filter tests.

Keep SET-06 at `specs/settings.e2e.ts:217`. Unit queue ordering exists in `tests/queue.test.ts`,
but the UI case saves the strategy and observes Triage and reload. Keep the preview, tab,
slider and job-summary cases for the same reason. `tests/settings-state.test.ts`,
`tests/settings-store.test.ts`, `tests/settings-tabs.test.ts` and `tests/queue-settings.test.ts`
cover state transformations, not the browser's controls and persistence requests.

SET-08, SET-13 and SET-17 found username, fast-job completion and copy defects (HISTORY
`:393–410`). Keep them. SET-14's cancel-before-releasing-the-held-page assertion is particularly
important now that Discogs requests accept cancellation. Keep SET-20 exports: unit export
tests do not exercise browser download initiation or file content delivered through the UI.
SET-10's untested no-account clause is recorded separately below, not silently removed.

### Triage

Keep TRI-11 at `specs/triage.e2e.ts:249` and TRI-41 at `specs/triage-player.e2e.ts:169`. The
former holds a verdict key on an unactivated desk; the latter compares repeated seeking with
verdict suppression during playback. `tests/keymap.test.ts`, `tests/session.test.ts` and
`tests/triage-player.test.ts` do not replace those real keyboard events.

Keep TRI-13 completed-push undo, TRI-39 held-push undo, TRI-45 one retry succeeding, TRI-15
retry exhaustion and TRI-16 immediate authentication failure. They are different ordering and
failure contracts, not one table with different status codes. `tests/session.test.ts`,
`tests/discogs-client.test.ts`, `tests/discogs-cancellation.test.ts` and
`tests/wantlist-http.test.ts` cover pieces of the chain. They do not prove the browser's status,
fake request order and resulting shelf agree. Do not replace these with unit-only coverage.

Keep both TRI-38 tests at `specs/triage-queue.e2e.ts:374` and `:391`. Their starting coverage
differs: nobody wants the label versus an imported want covering it. The SQL boundary has
unit coverage, but the positive case observes import/coverage/queue wiring. Joining them
would mutate the initial library and lose independent failure reporting for a small saving.

Keep TRI-09 and TRI-30. Queue completion after passes and an already exhausted queue are
different states; HISTORY at `:304` records a wrong completion headline. Keep TRI-29 and
TRI-44: explicit requeue and returning to a hidden mounted session have different lifecycle
ownership. Keep TRI-27 and TWL-14 attachment flows: Triage and Twelves initiate them through
different handlers. Matching and URL combinations already belong in `tests/match-videos.test.ts`,
`tests/videos.test.ts` and `tests/youtube.test.ts`; the E2E paths confirm attachment and playback.

The newer note, pressing and history-control tests remain. Independent note persistence,
fallback notes and blur versus explicit cancellation are not copies of the old verdict-note
flow. Legacy history verdicts remain supported data; their tests are not dead browser-history
import coverage. `tests/library-with-history.test.ts` and `tests/decision-log.test.ts` cover
data rules, while the E2E cases check visible controls and undo.

### Twelves

Keep TWL-02 keyboard selection and TWL-03 pagination despite `tests/twelves.test.ts` covering
selection, filtering, sorting and page calculations. The tests assert focused rows, scrolling,
visible boundaries and accessible ranges. HISTORY at `:467` records the selection/scroll
work. Keep TWL-04's one UI sorting path; add future ordering combinations only to vitest.

Keep TWL-07's other variants and TWL-09 push controls. Imported wantlist membership and a
locally snoozed record are different starting states. M6 removes only the duplicate snooze
path. Keep TWL-22 and TWL-23 (`specs/twelves-replay.e2e.ts:8`, `:44`): replaying a marked upload
and seeking a saved track when that release is already loaded can fail differently. HISTORY
at `:1098` records the need to wait for replay selection, which must survive any future edit.

Keep TWL-26 note freshness (`specs/twelves-notes.e2e.ts:9`) and TWL-30 verdict freshness
(`specs/replay-verdict.e2e.ts:10`). They update different state and the latter checks undo
against a newer decision. Keep both TWL-28 cases (`specs/twelves-pressings.e2e.ts:10`): shelf
and replay actions have different callers even though `tests/wantlist-pressings.test.ts`
already covers pressing selection. Keep the exact release IDs in fake request assertions.

### Persistence and Electron

Keep PER-01 reload/relaunch, PER-02 backup/restore and PER-03 graceful-stop/crash variants.
`tests/decisions-backup.test.ts`, `tests/backup.test.ts`, `tests/daily-backups.test.ts`,
`tests/cli.test.ts` and `tests/library-lock.test.ts` cover storage and commands, but cannot
replace observing a newly launched app with that data. PER-04 failed writes, PER-05 a server
restart without page reload and the two PER-10 tab conflicts exercise different failure
boundaries. Keep resume-session and resume-settings cases: checkpoint rules have unit tests,
but the app must also restore the correct settings and playback context.

Keep all 20 Electron-only tests, including the two GUARD-03 expansions. No runtime saving
is claimed for them because Electron was not run. The unit tests in `tests/electron-window.test.ts`,
`tests/electron-user-agent.test.ts`, `tests/secrets.test.ts` and `tests/desktop.test.ts` do not
prove native window, menu, preload or download wiring. ELEC-14 guards a startup-quit error
found by the health check (HISTORY `:1427`). Its stale blocking assumption needs investigation,
not removal; see the observation below.

## P0, priority, Electron and CI options

These options are outside the recommended count of 206. Do not silently combine them with
the merges. Each changes when or where a failure is detected and needs the owner's decision.

**P0 recommendation: keep the current set.** Web has 13 P0 tests, not 15. Electron has 15;
the union has 16. Web P0 covers two isolation guards, loaded startup, navigation, playback
activation, every verdict, note-to-wantlist payload, completed-push undo, mixed undo,
reload/relaunch persistence, recovery from a failed verdict write and two first-run paths.
Electron substitutes its own guard coverage and adds native startup. The inventory marks each
P0 explicitly. M4 makes a main-page title regression part of SHELL-02 without adding a test.

An optional demotion of **TRI-12 a want pushes the record's note to the Discogs wantlist; a
plain want sends no body** (`specs/triage.e2e.ts:114`) from P0 to P1 would leave 12 web smoke
tests. TRI-07 and TRI-13 still exercise pushes, and `tests/wantlist-note.test.ts` and
`tests/wantlist-http.test.ts` cover payload rules. The trade-off is losing the pre-commit
browser-to-Discogs note/body assertion. Full push CI would still run it, so CI saves no test
time. Its measured duration and load are in the inventory; do not treat that whole duration
as smoke wall time saved. Recommendation: retain P0 unless the owner explicitly accepts that
later detection. No other priority change is recommended from this session's evidence.

**Electron recommendation: retain the shared suite.** `ELECTRON.md:225` deliberately makes
every shared test run there unless it cannot apply. The least host-specific assertions are
SET-03 value validation, SET-05 styles, SET-06 strategy and TWL-04 sorting. Their data rules
are identical on both hosts and already have unit coverage. Their rendered keyboard/control
paths still run in Electron's embedded browser, so the entire test is not proven redundant.
In particular, axe uses a different mode there (`support/axe.ts`; `ELECTRON.md:221`).

Option: use a documented, smaller local Electron selection during ordinary product work,
then require the complete shared Electron and inspectable-package suites before a release.
Keep the default full configuration and do not label applicable tests `@web` just to save
time. If the owner instead wants permanent exclusions, change the shared-suite policy in
`E2E_TESTING.md` and `ELECTRON.md` separately and list each excluded ID. The trade-off is later
discovery of embedded-browser event, focus, layout or packaging differences. No duration or
CI saving can be estimated from the unrun Electron project; current CI never starts it.

**CI recommendation: keep two workers, all priorities and no burn-ins.** The workflow at
`.github/workflows/ci.yml:70` runs verify/P0 then `--grep-invert @P0`; it does not run P0 twice.
The full-suite measurement here is one invocation, whereas CI has two. Cold template startup
can therefore differ. Keep the existing fail-on-flaky policy and diagnostic retry.

Option: run the non-E2E checks, build once, then run the entire web suite in one Playwright
invocation in CI. Local `vp run verify` must still run smoke before a commit. This might avoid
some repeated cold template construction, but this session did not isolate that cost and
assigns it no numeric saving. The trade-off is losing the separate early smoke result and
changing the workflow documented in `E2E_TESTING.md`. Decide that separately from the merges.
Do not increase workers based on this Mac: HISTORY `:907–978` records the reason CI settled
on two, including axe timeouts at higher concurrency. Historical measurements were searched
for context, not compared numerically with this session. The brief's October 11 CI duration
was not independently measured here and is not an input to the savings estimate.

## Unused support code and retained fixtures

These are follow-up cleanup proposals, with no claimed runtime saving and no test-count
change. Repository-wide references were checked, including standalone fake-service use and
the vitest suite. Documentation examples are not runtime consumers.

| Candidate                                                                   | Evidence and proposed change                                                                                                                                                                                                                                                                        | Risk                                                                                           |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `FakeServices.delay`, `tools/dev/fake-services.ts:171`                      | No caller. Remove the method, `Fault.delayMs` at `:69` and its application at `:264`; remove the example and explanation in `docs/e2e/FIXTURES.md:276`. Keep holds, dump throttling and the independent oEmbed timeout mechanism.                                                                   | Low; check for new consumers before implementation.                                            |
| `restartServer({ crash })`, `support/app.ts:63`, `support/hosts/web.ts:136` | The only caller, PER-05 at `specs/persistence.e2e.ts:269`, passes no argument. Remove this unused option and branch, keeping graceful restart.                                                                                                                                                      | Low. Do not remove `relaunch({ crash: true })` or `server.crash()`, which other tests require. |
| Unused export qualifiers in catalogue                                       | `FixtureVideo` `:18`, `FixtureListing` `:55`, `FixtureList` `:63`, `HARDLINE_AUDIO` `:107`, `UPFRONT_AUDIO` `:115`, `DROPPED_IN_SEPTEMBER` `:518`, `ALL_RELEASES` `:689`, all in `fixtures/catalogue.ts`, have no outside consumer. Remove only `export` if narrowing the module API is worthwhile. | Low; the declarations themselves are used internally and must remain.                          |
| Two further unused export qualifiers                                        | `DatedVerdict`, `fixtures/decisions.ts:22`, and `DumpOptions`, `fixtures/dump.ts:40`, are internal types with no outside consumer. Remove only `export`.                                                                                                                                            | Low; optional cleanup, not dead fixture removal.                                               |

No unused public page-object operation was found in the six page objects. No catalogue record,
whole fake endpoint or named template is recommended for deletion. `empty`, `small`,
`small-account` and `bulk`, and the July/August/September dump variations all have consumers.
Bulk's 1,500 records supply both held download checkpoints and TWL-03's 1,200-verdict library;
shrinking it without preserving those boundaries changes coverage.

No current sandbox/practice-round/browser-history-import fixture or option was found that can
be deleted safely. Retired SBX scenario documentation is an intentional historical marker.
The `seen` verdict and `seed:history` compatibility paths still have current consumers and
tests. Do not delete those because the import command was removed.

## Scenario and documentation corrections for a later session

Only this report is edited now. These corrections should accompany approved implementation
or be made as a separate documentation change.

| Location                                                                      | Mismatch                                                                                                                                                                                    | Correction                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scenarios/twelves.md:51`, `:167`                                             | The note completion contract still names `POST /api/verdicts` and short saved/removed messages. `pages/twelves.ts:255` uses `PUT /api/releases/:id/note` and messages ending `Z undoes it.` | Update the route and full messages; keep the separate track-note route.                                                                                                                                                          |
| `scenarios/settings.md:86`                                                    | SET-10 also promises zero Discogs requests for `small`. Its sole tagged test at `specs/settings-discogs.e2e.ts:107` only uses `small-account`.                                              | Mark the no-account observation as an assertion gap. Add an explicit completed-load/fake-log assertion to a suitable existing no-account Settings test later; do not claim the account case covers it or delete the requirement. |
| `specs/digging-controls.e2e.ts:22` versus TRI-47 in `scenarios/triage.md:449` | The title says the two controls can be disabled independently, but the test unchecks both before saving.                                                                                    | Narrow the title to what it proves. Separate pure combinations belong in unit tests; add a UI independence case only if the specification is expanded to require it.                                                             |
| `specs/triage.e2e.ts:272` and `scenarios/triage.md:153`, TRI-17               | The title and scenario say the verdict saves the note. The note now saves independently, and this test later checks its exported association with a verdict.                                | Change that final clause in both places to say the note remains with the saved record; preserve the assertions. TRI-46 and newer note tests cover independent persistence.                                                       |
| `scenarios/README.md:9`                                                       | The family map omits `note-verdict.e2e.ts` from Triage, `replay-verdict.e2e.ts` from Twelves and `resume-settings.e2e.ts` from Persistence.                                                 | Include those files. If M1–M5 are approved, also list the new A11Y-04/05 locations in setup, shell and triage-queue.                                                                                                             |
| `PLAN.md:86`                                                                  | The present-tense shared test count is stale.                                                                                                                                               | Use 185 shared, seven web-only and 20 Electron-only before implementation, or the approved post-merge counts. Preserve dated historical observations elsewhere.                                                                  |
| `HARNESS.md:116`                                                              | Says Discogs requests take no abort signal and cancellation waits for a held page.                                                                                                          | Update for `discogs.withSignal`, transport cancellation and current PER-03/SET-14 behavior. Do not weaken their before-release assertions.                                                                                       |
| `FIXTURES.md:276`                                                             | Demonstrates the unused fake delay API.                                                                                                                                                     | Remove alongside the cleanup, retaining the hold/release guidance.                                                                                                                                                               |

After merges, scenario IDs stay stable. Update family completion contracts and the location
map, not historical results. CON real-service contracts remain planned/manual and ELEC-03's
real keychain remains explicitly deferred; neither is silently counted as an implemented test.

## Confirmed test defect: queue request counts ignore the client's method

`specs/shell.e2e.ts:391` defines `queueReadCount` by counting only `GET /api/queue` in the
browser log. The client now calls `POST /queue` (`src/client/api.ts:174`). The browser log
records the actual method (`support/browser-log.ts:71`).

This affects **SHELL-12 Triage says the settings did not load, starts no queue, and Enter reads
them again** (`specs/shell.e2e.ts:173`) and **SHELL-09 System follows the emulated scheme,
Light and Dark apply at once and survive a reload, and none restarts Triage's queue**
(`specs/shell.e2e.ts:224`). Their queue-count assertions can remain zero even if the browser
unexpectedly starts another queue. Both tests passed in both runs, so passing them does not
prove this negative assertion. SHELL-09's unchanged-record check and the other UI checks
still provide useful coverage.

Keep these tests. In a later fix, count the actual POST contract, assert a positive baseline
after a normal queue has loaded, and preserve rule 6's completed-response/state window before
negative assertions. For the settings-unreachable case the expected pre-retry count remains
zero; prove the counter sees the subsequent successful queue after retry. Do not change the
client to accommodate the stale test. This review makes no test or product fix.

## Observation: ELEC-14 relies on an outdated cancellation assumption

`specs/electron.e2e.ts:292` says the held import keeps shutdown waiting so that initial
navigation fails while the app is stopping. `support/hosts/electron.ts:229` similarly describes
that dependency; `quitDuringStart` waits for the navigation-failed log before releasing the
fake request. The wantlist importer now uses `withSignal` (`src/server/importers/wantlist.ts:19`),
and the transport aborts the in-flight request (`src/server/discogs/transport.ts:120`).

The comment's blocking assumption is obsolete. The app might still log the failure in time,
but this review did not run Electron and does not claim a reproduced failure. Run ELEC-14
through the approved Electron configuration and examine exit/navigation ordering before
changing this helper. Keep the regression and its assertions about no startup dialog, clean
stop and exit. Do not replace it with a unit test or dismiss the health-check bug it guards.
No product bug was demonstrated by the two web runs.

## Applying approved proposals

Approve M1–M6 individually; M2/M3 can share the SETUP-18 edit with M1 but do not require M1.
M6 deserves a separate decision because it changes when undo happens after a completed push.
No approval of this report implies approval of a priority, Electron or CI policy change.

The implementation session should transfer assertions first, retain source tags and step
names, remove only the six redundant test declarations, update scenario locations, and run
the changed specs' required ten-run burn-ins on web and Electron. Recount expanded tests and
measure again under comparable load before claiming realized savings. Keep the defects and
optional dead-code cleanup as separate reviewable changes. Do not share a mutable library,
remove fake guards or weaken synchronization to meet a timing target.

## Verification of this report

`python3 /tmp/digga-consolidation-review/measure.py verify vp run verify` passed:
format/lint/type checks, 625 vitest tests in 79 files, portability, Svelte checks, client build
and all 13 web P0 tests on five workers. Total wall time was 23.17 seconds, with one-minute
load 9.55–10.79 (start 9.55, end 10.49, mean 10.35). This timing is for verification as a whole,
not a third full-suite run.

Lint reported one existing, non-failing `typescript(no-base-to-string)` warning at
`tests/e2e/specs/electron.e2e.ts:724` for `String(error.cause ?? error)`. It was left unchanged.
The report's final verification-result edit was formatted and checked separately. No test,
product, harness or other document was edited. The owner's untracked
`docs/PRE_RELEASE_ARCHITECTURE_REVIEW.md` remains outside this commit.

## Slowest tests and complete disposition inventory

The following tables are generated from Playwright's expanded test lists and successful JSON
results, checked against the source. Durations are seconds followed by sampled one-minute
load in parentheses. `W+E` means shared, `W` web only and `E` Electron only. `not run` means
no runtime measurement was made.

`Keep` means keep as is for consolidation. `Absorb M…` means keep with the speed fix described
in that proposal. `Merge M…` means merge into its named survivor and remove this declaration.
The separate queue-counter repair does not authorize removing either affected test.
There are 202 Keep actions, four survivors with speed fixes and six merges.

### Slowest twenty, two workers

| Exact test title and source                                                                                                                                                | Seconds (load)       | Principal work inferred from code                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------- |
| A11Y-01 each setup step, the crate while it loads and once it is in · `tests/e2e/specs/accessibility.e2e.ts:146`                                                           | 14.831 (15.66–16.69) | Repeated axe scans and rendered states; imports/load and polling |
| SETUP-28 a new page resumes at the first step not done, with the account and the picks filled in · `tests/e2e/specs/setup-discogs.e2e.ts:202`                              | 11.273 (15.84–17.46) | Repeated document reloads, held import, load polling             |
| SETUP-01 the first run from the default config ends with a saved verdict · `tests/e2e/specs/setup.e2e.ts:33`                                                               | 10.086 (13.72–14.47) | Full setup, serialized imports, load/count polling, verdict      |
| SETUP-10 with a username and no token, a want stays in Digga: its push fails once, and Twelves says it is not on the wantlist · `tests/e2e/specs/setup-discogs.e2e.ts:285` | 9.286 (15.21–15.84)  | Username imports, load/count polling, failed push and shelf      |
| SETUP-26 a download that does not match Discogs' checksum twice asks before a third · `tests/e2e/specs/setup.e2e.ts:376`                                                   | 8.929 (9.80–10.57)   | Multiple checksum transfers/loads and UI polling                 |
| SETUP-25 a download that stops on steps 2 and 3 says where it stopped, and starts again · `tests/e2e/specs/setup.e2e.ts:302`                                               | 8.902 (10.57–12.13)  | Dropped transfer, retry, load and status polling                 |
| SETUP-25 a download that stops under the load says where it stopped, keeps what loaded, and starts again · `tests/e2e/specs/setup.e2e.ts:264`                              | 7.825 (11.32–12.13)  | Dropped transfer, retry, load and status polling                 |
| SETUP-27 Digga closing during the load leaves Pick up, which reads the dump from the start · `tests/e2e/specs/setup.e2e.ts:487`                                            | 7.679 (9.13–9.58)    | Load/count polling, crash/relaunch, recovery                     |
| SETUP-26 a download that does not match Discogs' checksum comes once more by itself, and the load reads it again · `tests/e2e/specs/setup.e2e.ts:341`                      | 7.615 (9.80–10.57)   | Multiple checksum transfers/loads and UI polling                 |
| SETUP-21 Start digging waits for 500 records to dig, while T opens Triage at any count · `tests/e2e/specs/setup.e2e.ts:184`                                                | 7.305 (12.13–12.75)  | Two held checkpoints, threshold/count polling, navigation        |
| SETUP-31 at the end of what has loaded, Triage waits, and the next record shows once it arrives · `tests/e2e/specs/setup.e2e.ts:87`                                        | 6.756 (13.72–14.47)  | Load/count polling and round behavior during growth              |
| SETUP-24 Change your picks stops the load, keeps what was dug, and step 3 starts from the picks · `tests/e2e/specs/setup.e2e.ts:217`                                       | 6.672 (12.13–12.75)  | Load/count polling, cancel, restart and reload                   |
| TRI-15 a push Discogs keeps failing is tried three more times, then stays saved in Digga, and Twelves marks it · `tests/e2e/specs/triage-discogs.e2e.ts:265`               | 6.537 (8.48–8.70)    | Clock retry windows plus real serialized Discogs requests        |
| TRI-16 another account's token keeps the username and reads as a problem; a want then fails at once at Discogs · `tests/e2e/specs/triage-discogs.e2e.ts:219`               | 6.452 (8.48–8.70)    | Clock retry windows plus real serialized Discogs requests        |
| A11Y-01 each Twelves shelf · `tests/e2e/specs/accessibility.e2e.ts:95`                                                                                                     | 6.280 (16.69–17.45)  | Repeated axe scans and rendered states                           |
| A11Y-01 Settings · `tests/e2e/specs/accessibility.e2e.ts:123`                                                                                                              | 5.954 (16.69–17.45)  | Repeated axe scans and rendered states                           |
| SET-15 Maybe list waits for a saved list, Read shop reads a seller for F · `tests/e2e/specs/settings-discogs.e2e.ts:231`                                                   | 5.827 (16.12–16.91)  | Job execution and progress/completion polling                    |
| SETUP-18 held at a checkpoint, the crate shows what the load has read · `tests/e2e/specs/setup.e2e.ts:131`                                                                 | 5.754 (13.34–13.34)  | Held growing dump and visible count polling                      |
| SETUP-28 with a saved token, a new page resumes at once and checks the account behind a held import · `tests/e2e/specs/setup-discogs.e2e.ts:247`                           | 5.674 (15.84–16.78)  | Document reload and account check behind a held import           |
| SETUP-19 held at a checkpoint, the load counts the records the download has brought so far · `tests/e2e/specs/setup.e2e.ts:162`                                            | 5.618 (13.34–13.34)  | Held growing dump and visible count polling                      |

### Every test

#### accessibility.e2e.ts

| Exact test title                                                                                         | Source                                     | Priority / host | Action   | Five workers: seconds (load) | Two workers: seconds (load) |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------- | -------- | ---------------------------- | --------------------------- |
| A11Y-01 Triage playing, the Keys dialog and the scope picker                                             | `tests/e2e/specs/accessibility.e2e.ts:34`  | P1 / W+E        | Keep     | 6.558 (31.46–32.19)          | 4.315 (17.45–18.36)         |
| A11Y-01 Triage with no audio                                                                             | `tests/e2e/specs/accessibility.e2e.ts:64`  | P1 / W+E        | Keep     | 3.405 (31.46–32.19)          | 2.189 (18.36–18.36)         |
| A11Y-01 Triage at the end of the queue                                                                   | `tests/e2e/specs/accessibility.e2e.ts:77`  | P1 / W+E        | Keep     | 3.302 (31.46–32.19)          | 1.738 (17.45–17.45)         |
| A11Y-01 each Twelves shelf                                                                               | `tests/e2e/specs/accessibility.e2e.ts:95`  | P1 / W+E        | Keep     | 9.986 (30.06–32.19)          | 6.280 (16.69–17.45)         |
| A11Y-01 Settings                                                                                         | `tests/e2e/specs/accessibility.e2e.ts:123` | P1 / W+E        | Keep     | 9.289 (30.06–32.19)          | 5.954 (16.69–17.45)         |
| A11Y-01 each setup step, the crate while it loads and once it is in                                      | `tests/e2e/specs/accessibility.e2e.ts:146` | P1 / W+E        | Keep     | 17.550 (28.12–31.46)         | 14.831 (15.66–16.69)        |
| A11Y-02 the players are inert, Tab never reaches one, and a clicked control leaves the page keys working | `tests/e2e/specs/accessibility.e2e.ts:204` | P1 / W+E        | Keep     | 2.665 (31.46–31.46)          | 1.260 (16.69–16.69)         |
| A11Y-03 the slip, the flashes and the header's status are in the page before their text                  | `tests/e2e/specs/accessibility.e2e.ts:286` | P2 / W+E        | Keep     | 2.911 (30.06–30.06)          | 2.333 (16.08–16.69)         |
| A11Y-04 each page sets the document title                                                                | `tests/e2e/specs/accessibility.e2e.ts:331` | P1 / W+E        | Merge M4 | 1.451 (30.06–30.06)          | 0.853 (16.08–16.08)         |
| A11Y-04 each setup step sets the document title                                                          | `tests/e2e/specs/accessibility.e2e.ts:345` | P1 / W+E        | Merge M2 | 1.748 (30.06–30.06)          | 1.167 (16.08–16.08)         |
| A11Y-05 the scope picker's dig button declares Enter                                                     | `tests/e2e/specs/accessibility.e2e.ts:368` | P2 / W+E        | Merge M5 | 1.050 (30.06–30.06)          | 0.730 (16.08–16.08)         |
| A11Y-05 the crate's Start digging declares T and Enter                                                   | `tests/e2e/specs/accessibility.e2e.ts:386` | P2 / W+E        | Merge M3 | 1.749 (30.06–30.06)          | 1.215 (16.08–16.15)         |
| A11Y-06 a narrow window hides the header's ETA from sight only                                           | `tests/e2e/specs/accessibility.e2e.ts:404` | P2 / W+E        | Keep     | 1.135 (30.06–30.06)          | 0.670 (16.15–16.15)         |

#### digging-controls.e2e.ts

| Exact test title                                                                 | Source                                       | Priority / host | Action | Five workers: seconds (load) | Two workers: seconds (load) |
| -------------------------------------------------------------------------------- | -------------------------------------------- | --------------- | ------ | ---------------------------- | --------------------------- |
| TRI-47 Settings offers the history exclusion only to a library with records seen | `tests/e2e/specs/digging-controls.e2e.ts:8`  | P1 / W+E        | Keep   | 1.127 (30.06–30.06)          | 0.712 (16.15–16.15)         |
| TRI-47 history exclusion and heard-tune skipping can be disabled independently   | `tests/e2e/specs/digging-controls.e2e.ts:22` | P1 / W+E        | Keep   | 1.748 (30.06–30.13)          | 0.923 (16.15–16.15)         |

#### electron.e2e.ts

| Exact test title                                                                                                                                            | Source                                | Priority / host | Action | Five workers: seconds (load) | Two workers: seconds (load) |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | --------------- | ------ | ---------------------------- | --------------------------- |
| ELEC-01 the app serves on a free port bound to 127.0.0.1 and opens its window at localhost                                                                  | `tests/e2e/specs/electron.e2e.ts:36`  | P0 / E          | Keep   | not run                      | not run                     |
| ELEC-17 on macOS the toolbar is the title bar, and a quit saves where the window was                                                                        | `tests/e2e/specs/electron.e2e.ts:56`  | P2 / E          | Keep   | not run                      | not run                     |
| ELEC-18 the View menu shows the pages and the keys, and only a development run can reload                                                                   | `tests/e2e/specs/electron.e2e.ts:99`  | P2 / E          | Keep   | not run                      | not run                     |
| ELEC-02 the library is the one the environment names, userData the one --user-data-dir names, and nothing is written in the home folder                     | `tests/e2e/specs/electron.e2e.ts:130` | P1 / E          | Keep   | not run                      | not run                     |
| ELEC-04 O, S, Y and the discogs.com link go to shell.openExternal and open no window                                                                        | `tests/e2e/specs/electron.e2e.ts:177` | P1 / E          | Keep   | not run                      | not run                     |
| ELEC-05 an export saves through will-download into the folder set for it and completes                                                                      | `tests/e2e/specs/electron.e2e.ts:220` | P1 / E          | Keep   | not run                      | not run                     |
| ELEC-06 the Library menu opens the Settings tab that starts each job, where the job runs and reports                                                        | `tests/e2e/specs/electron.e2e.ts:254` | P2 / E          | Keep   | not run                      | not run                     |
| ELEC-14 a quit while the app starts shows no startup error, and the app exits                                                                               | `tests/e2e/specs/electron.e2e.ts:291` | P1 / E          | Keep   | not run                      | not run                     |
| ELEC-07 quitting during the download and the load asks first; Cancel keeps them, Quit stops them                                                            | `tests/e2e/specs/electron.e2e.ts:322` | P1 / E          | Keep   | not run                      | not run                     |
| ELEC-16 after a quit stopped the download before any load, step 1 says so and fetching starts it over; a Cancel says nothing                                | `tests/e2e/specs/electron.e2e.ts:373` | P2 / E          | Keep   | not run                      | not run                     |
| ELEC-08 the Dock shows the download and the load, the Mac stays awake while they run, and a load that ends unseen is announced                              | `tests/e2e/specs/electron.e2e.ts:419` | P2 / E          | Keep   | not run                      | not run                     |
| ELEC-08 a load that fails while the window is focused clears the Dock, lets the Mac sleep and announces nothing                                             | `tests/e2e/specs/electron.e2e.ts:460` | P2 / E          | Keep   | not run                      | not run                     |
| ELEC-09 a dump file the user has loads from where it is, without a download, and is never offered for deletion                                              | `tests/e2e/specs/electron.e2e.ts:491` | P2 / E          | Keep   | not run                      | not run                     |
| ELEC-15 a disk short of space offers another folder, which the app keeps and downloads into                                                                 | `tests/e2e/specs/electron.e2e.ts:558` | P2 / E          | Keep   | not run                      | not run                     |
| ELEC-10 nativeTheme follows the saved dark scheme before the window loads the app                                                                           | `tests/e2e/specs/electron.e2e.ts:639` | P2 / E          | Keep   | not run                      | not run                     |
| ELEC-10 nativeTheme follows the saved light scheme before the window loads the app                                                                          | `tests/e2e/specs/electron.e2e.ts:639` | P2 / E          | Keep   | not run                      | not run                     |
| ELEC-11 the window's user agent is Chrome's and names neither Electron nor Digga                                                                            | `tests/e2e/specs/electron.e2e.ts:661` | P1 / E          | Keep   | not run                      | not run                     |
| ELEC-13 the held window loads nothing and the main process and its workers reach only the fakes; once released, the page has the routes and the fake player | `tests/e2e/specs/electron.e2e.ts:742` | P1 / E          | Keep   | not run                      | not run                     |

#### guard.e2e.ts

| Exact test title                                                                             | Source                             | Priority / host | Action | Five workers: seconds (load) | Two workers: seconds (load) |
| -------------------------------------------------------------------------------------------- | ---------------------------------- | --------------- | ------ | ---------------------------- | --------------------------- |
| GUARD-01 the server cannot reach a loopback port other than the fakes'                       | `tests/e2e/specs/guard.e2e.ts:35`  | P0 / W+E        | Keep   | 1.244 (30.13–30.13)          | 0.709 (16.15–16.15)         |
| GUARD-02 the browser reaches only the allowed origin: no other port, redirect or WebSocket   | `tests/e2e/specs/guard.e2e.ts:60`  | P0 / W          | Keep   | 0.306 (30.06–30.06)          | 0.157 (16.15–16.15)         |
| GUARD-03 the Electron preload refuses to start with DIGGA_DATA_DIR outside the test's folder | `tests/e2e/specs/guard.e2e.ts:108` | P0 / E          | Keep   | not run                      | not run                     |
| GUARD-03 the Electron preload refuses to start with userData outside the test's folder       | `tests/e2e/specs/guard.e2e.ts:108` | P0 / E          | Keep   | not run                      | not run                     |

#### note-verdict.e2e.ts

| Exact test title                                                     | Source                                  | Priority / host | Action | Five workers: seconds (load) | Two workers: seconds (load) |
| -------------------------------------------------------------------- | --------------------------------------- | --------------- | ------ | ---------------------------- | --------------------------- |
| TRI-50 clicking a verdict saves the open note on its original record | `tests/e2e/specs/note-verdict.e2e.ts:7` | P1 / W+E        | Keep   | 2.144 (30.13–30.13)          | 0.997 (16.15–16.15)         |

#### persistence.e2e.ts

| Exact test title                                                                                                                                                 | Source                                   | Priority / host | Action | Five workers: seconds (load) | Two workers: seconds (load) |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------- | ------ | ---------------------------- | --------------------------- |
| PER-01 a live snooze with a note and a keep mark survive a reload and a relaunch                                                                                 | `tests/e2e/specs/persistence.e2e.ts:32`  | P0 / W+E        | Keep   | 3.204 (30.13–30.13)          | 1.919 (15.66–15.66)         |
| PER-02 digga backup writes today's decisions, which digga restore brings into a fresh library                                                                    | `tests/e2e/specs/persistence.e2e.ts:65`  | P2 / W+E        | Keep   | 3.571 (30.13–30.13)          | 2.154 (15.66–15.66)         |
| PER-12 digga restore of the database copy digga backup wrote brings the library into a fresh one                                                                 | `tests/e2e/specs/persistence.e2e.ts:115` | P2 / W+E        | Keep   | 2.811 (30.13–30.13)          | 1.684 (15.66–15.66)         |
| PER-11 while the server runs, a command that changes the library is refused, stats and backup run beside it, and a crash's lock does not keep the next start out | `tests/e2e/specs/persistence.e2e.ts:164` | P2 / W+E        | Keep   | 2.428 (30.13–30.13)          | 1.673 (14.88–15.66)         |
| PER-03 a crash during an import leaves the job failed as interrupted                                                                                             | `tests/e2e/specs/persistence.e2e.ts:208` | P2 / W+E        | Keep   | 5.177 (28.12–30.13)          | 4.470 (14.88–14.88)         |
| PER-03 a graceful relaunch cancels an import without waiting for its held page                                                                                   | `tests/e2e/specs/persistence.e2e.ts:228` | P2 / W+E        | Keep   | 5.430 (28.12–30.13)          | 4.562 (14.88–14.88)         |
| PER-05 after restartServer() the open page keeps its session without a reload, and the next verdict is saved                                                     | `tests/e2e/specs/persistence.e2e.ts:251` | P1 / W          | Keep   | 1.719 (28.12–30.13)          | 1.774 (14.49–14.88)         |
| PER-04 a verdict the server never got comes back, pushes nothing, and saves on the next try                                                                      | `tests/e2e/specs/persistence.e2e.ts:289` | P0 / W+E        | Keep   | 2.224 (28.12–30.13)          | 1.678 (14.49–14.49)         |
| PER-10 an undo in one page is refused once another page has re-judged the record                                                                                 | `tests/e2e/specs/persistence.e2e.ts:330` | P2 / W          | Keep   | 1.331 (28.12–28.12)          | 1.269 (14.49–14.49)         |
| PER-10 a Twelves change in one page is refused once another page has re-judged the record                                                                        | `tests/e2e/specs/persistence.e2e.ts:359` | P2 / W          | Keep   | 1.311 (28.12–28.12)          | 1.435 (14.49–14.49)         |

#### replay-verdict.e2e.ts

| Exact test title                                    | Source                                     | Priority / host | Action | Five workers: seconds (load) | Two workers: seconds (load) |
| --------------------------------------------------- | ------------------------------------------ | --------------- | ------ | ---------------------------- | --------------------------- |
| TWL-30 replay undo retains a newer Twelves decision | `tests/e2e/specs/replay-verdict.e2e.ts:10` | P1 / W+E        | Keep   | 1.635 (28.12–28.12)          | 1.384 (14.49–14.49)         |

#### resume-session.e2e.ts

| Exact test title                                                                        | Source                                     | Priority / host | Action | Five workers: seconds (load) | Two workers: seconds (load) |
| --------------------------------------------------------------------------------------- | ------------------------------------------ | --------------- | ------ | ---------------------------- | --------------------------- |
| PER-09 resume restores the passed records, current upload, and paused playback position | `tests/e2e/specs/resume-session.e2e.ts:10` | P1 / W+E        | Keep   | 2.163 (28.12–28.12)          | 1.790 (14.49–14.49)         |

#### resume-settings.e2e.ts

| Exact test title                                               | Source                                     | Priority / host | Action | Five workers: seconds (load) | Two workers: seconds (load) |
| -------------------------------------------------------------- | ------------------------------------------ | --------------- | ------ | ---------------------------- | --------------------------- |
| PER-13 resume retains labels hidden after the first checkpoint | `tests/e2e/specs/resume-settings.e2e.ts:8` | P1 / W+E        | Keep   | 1.939 (28.12–28.75)          | 1.753 (14.49–14.49)         |

#### settings-discogs.e2e.ts

| Exact test title                                                                                                       | Source                                        | Priority / host | Action | Five workers: seconds (load) | Two workers: seconds (load) |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | --------------- | ------ | ---------------------------- | --------------------------- |
| SET-08 a token Discogs takes is saved with its account, a refused one is not, Remove removes it                        | `tests/e2e/specs/settings-discogs.e2e.ts:36`  | P1 / W+E        | Keep   | 1.782 (28.12–28.75)          | 1.240 (16.30–16.30)         |
| SET-09 a token from the environment disables the field with the hint, and the server refuses another                   | `tests/e2e/specs/settings-discogs.e2e.ts:80`  | P1 / W+E        | Keep   | 3.369 (28.12–28.75)          | 3.035 (16.30–16.30)         |
| SET-10 opening Settings costs two Discogs requests, the account and its lists, as the page says                        | `tests/e2e/specs/settings-discogs.e2e.ts:107` | P1 / W+E        | Keep   | 3.473 (28.75–28.75)          | 2.972 (16.30–16.30)         |
| SET-11 Read my lists offers the private and public lists; the chosen one enables M and loads with the page             | `tests/e2e/specs/settings-discogs.e2e.ts:133` | P1 / W+E        | Keep   | 5.155 (28.75–28.75)          | 5.033 (16.30–16.91)         |
| SET-22 Settings forgets the Discogs account's data, after which the library holds none of it and takes another account | `tests/e2e/specs/settings-discogs.e2e.ts:182` | P2 / W+E        | Keep   | 3.551 (28.75–28.75)          | 3.480 (16.30–16.91)         |
| SET-15 Maybe list waits for a saved list, Read shop reads a seller for F                                               | `tests/e2e/specs/settings-discogs.e2e.ts:231` | P2 / W+E        | Keep   | 6.070 (26.93–28.75)          | 5.827 (16.12–16.91)         |
| SET-13 the collection and wantlist imports run as jobs, end done with their counts, and fill Twelves                   | `tests/e2e/specs/settings-discogs.e2e.ts:272` | P1 / W+E        | Keep   | 5.705 (26.93–28.75)          | 5.599 (16.12–16.91)         |
| SET-14 cancelling an import interrupts its held page                                                                   | `tests/e2e/specs/settings-discogs.e2e.ts:323` | P1 / W+E        | Keep   | 3.976 (26.93–28.75)          | 3.927 (15.07–16.12)         |
| SET-12 P asks Discogs in the chosen currency and shows its symbol                                                      | `tests/e2e/specs/settings-discogs.e2e.ts:348` | P2 / W+E        | Keep   | 3.918 (26.93–28.75)          | 3.823 (15.07–16.12)         |

#### settings-jobs-unsaved.e2e.ts

| Exact test title                                        | Source                                           | Priority / host | Action | Five workers: seconds (load) | Two workers: seconds (load) |
| ------------------------------------------------------- | ------------------------------------------------ | --------------- | ------ | ---------------------------- | --------------------------- |
| SET-28 jobs require saving or discarding draft settings | `tests/e2e/specs/settings-jobs-unsaved.e2e.ts:7` | P1 / W+E        | Keep   | 1.124 (26.93–26.93)          | 1.087 (15.07–15.07)         |

#### settings-styles.e2e.ts

| Exact test title                                 | Source                                      | Priority / host | Action | Five workers: seconds (load) | Two workers: seconds (load) |
| ------------------------------------------------ | ------------------------------------------- | --------------- | ------ | ---------------------------- | --------------------------- |
| SET-26 unchecking every style matches no records | `tests/e2e/specs/settings-styles.e2e.ts:12` | P1 / W+E        | Keep   | 1.757 (26.93–26.93)          | 1.583 (15.07–15.07)         |

#### settings-years.e2e.ts

| Exact test title                                   | Source                                    | Priority / host | Action | Five workers: seconds (load) | Two workers: seconds (load) |
| -------------------------------------------------- | ----------------------------------------- | --------------- | ------ | ---------------------------- | --------------------------- |
| SET-25 load years can be cleared and entered again | `tests/e2e/specs/settings-years.e2e.ts:7` | P1 / W+E        | Keep   | 1.371 (26.93–26.93)          | 1.070 (15.07–15.07)         |

#### settings.e2e.ts

| Exact test title                                                                                                     | Source                                | Priority / host | Action | Five workers: seconds (load) | Two workers: seconds (load) |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | --------------- | ------ | ---------------------------- | --------------------------- |
| SET-01 the form shows the saved config; a change is unsaved until Save or Cmd+S, Revert restores, a reload keeps it  | `tests/e2e/specs/settings.e2e.ts:41`  | P1 / W+E        | Keep   | 1.924 (26.93–26.93)          | 1.337 (15.07–15.14)         |
| SET-02 the filter preview counts what a change would match before it is saved                                        | `tests/e2e/specs/settings.e2e.ts:88`  | P1 / W+E        | Keep   | 2.431 (26.93–26.93)          | 1.991 (15.14–15.14)         |
| SET-03 an invalid batch or seek step marks the field, attaches the problem to it and disables Save                   | `tests/e2e/specs/settings.e2e.ts:117` | P1 / W+E        | Keep   | 1.447 (26.93–26.93)          | 0.788 (15.14–15.14)         |
| SET-04 hidden labels: one per line, a saved label leaves the queue, and X's labels show here with their ids          | `tests/e2e/specs/settings.e2e.ts:146` | P1 / W+E        | Keep   | 1.639 (26.93–26.93)          | 1.058 (15.14–15.14)         |
| SET-05 the universe's styles are checkboxes, and one left checked narrows the queue to it                            | `tests/e2e/specs/settings.e2e.ts:188` | P2 / W+E        | Keep   | 2.227 (26.93–26.93)          | 2.073 (15.14–15.14)         |
| SET-06 a strategy changes Triage's first record, and the shuffled order stays over a reload                          | `tests/e2e/specs/settings.e2e.ts:217` | P2 / W+E        | Keep   | 2.306 (26.93–27.66)          | 1.163 (15.14–15.14)         |
| SET-07 the start-at slider and the seek step reach the player                                                        | `tests/e2e/specs/settings.e2e.ts:258` | P1 / W+E        | Keep   | 1.820 (27.66–27.66)          | 0.924 (15.14–15.14)         |
| SET-16 the dumps folder lists each dump's size and use; Delete asks first; dump jobs disable the buttons             | `tests/e2e/specs/settings.e2e.ts:297` | P1 / W+E        | Keep   | 3.534 (27.66–27.66)          | 2.392 (15.14–16.41)         |
| SET-17 Update from the newest dump downloads and loads in one job; the Library counts what it added and did not find | `tests/e2e/specs/settings.e2e.ts:354` | P1 / W+E        | Keep   | 3.088 (27.66–27.66)          | 2.302 (15.14–16.41)         |
| SET-21 the update keeps a verdict on its record when the newer dump puts the release on a master                     | `tests/e2e/specs/settings.e2e.ts:389` | P1 / W+E        | Keep   | 3.027 (27.66–27.66)          | 2.695 (16.41–16.41)         |
| SET-18 Load takes a file name from the datalist, with a limit and a dry run that records nothing                     | `tests/e2e/specs/settings.e2e.ts:422` | P2 / W+E        | Keep   | 3.129 (27.66–27.66)          | 2.303 (16.41–16.41)         |
| SET-19 a relaunch with verdicts writes the day's decisions backup, which Settings shows                              | `tests/e2e/specs/settings.e2e.ts:464` | P2 / W+E        | Keep   | 3.009 (27.66–27.66)          | 2.620 (16.41–18.30)         |
| SET-23 a scheduled backup that fails shows in Settings until Back up now succeeds                                    | `tests/e2e/specs/settings.e2e.ts:496` | P2 / W+E        | Keep   | 3.547 (26.96–27.66)          | 2.783 (16.41–18.30)         |
| SET-20 the three exports download the saved verdicts and marks                                                       | `tests/e2e/specs/settings.e2e.ts:550` | P1 / W+E        | Keep   | 1.268 (27.66–27.66)          | 1.100 (18.30–18.30)         |
| SET-24 Esc in Settings goes back to the page it was opened from, except in a text field                              | `tests/e2e/specs/settings.e2e.ts:688` | P2 / W+E        | Keep   | 1.671 (27.66–27.66)          | 1.248 (18.30–18.30)         |
| SET-27 leaving Settings with unsaved changes asks; Keep editing stays, Discard drops them, Save keeps them           | `tests/e2e/specs/settings.e2e.ts:710` | P1 / W+E        | Keep   | 1.869 (26.96–27.66)          | 1.514 (18.30–18.30)         |

#### setup-discogs.e2e.ts

| Exact test title                                                                                                              | Source                                     | Priority / host | Action | Five workers: seconds (load) | Two workers: seconds (load) |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------- | ------ | ---------------------------- | --------------------------- |
| SETUP-08 a token Discogs accepts names the account, its sizes and its currency                                                | `tests/e2e/specs/setup-discogs.e2e.ts:34`  | P1 / W+E        | Keep   | 2.852 (26.96–27.66)          | 2.433 (18.20–18.30)         |
| SETUP-34 a username Discogs does not know is not saved, and the field says so                                                 | `tests/e2e/specs/setup-discogs.e2e.ts:61`  | P1 / W+E        | Keep   | 1.665 (26.96–26.96)          | 1.058 (18.30–18.30)         |
| SETUP-09 a token Discogs refuses is not kept, and the field says why until it is edited                                       | `tests/e2e/specs/setup-discogs.e2e.ts:78`  | P1 / W+E        | Keep   | 1.626 (26.96–26.96)          | 1.038 (18.20–18.20)         |
| SETUP-13 Continue starts the collection and wantlist imports and moves on while they run                                      | `tests/e2e/specs/setup-discogs.e2e.ts:107` | P1 / W+E        | Keep   | 4.453 (25.28–26.96)          | 4.279 (18.20–18.20)         |
| SETUP-20 the load waits for imports slower than its start, and Start without it starts it at once                             | `tests/e2e/specs/setup-discogs.e2e.ts:135` | P2 / W+E        | Keep   | 6.038 (25.28–26.96)          | 5.570 (17.46–18.20)         |
| SETUP-14 after the imports, step 3 picks the account's styles, with the years and estimate for them                           | `tests/e2e/specs/setup-discogs.e2e.ts:167` | P1 / W+E        | Keep   | 6.276 (25.28–26.96)          | 5.537 (17.46–17.46)         |
| SETUP-28 a new page resumes at the first step not done, with the account and the picks filled in                              | `tests/e2e/specs/setup-discogs.e2e.ts:202` | P1 / W+E        | Keep   | 12.214 (24.14–26.96)         | 11.273 (15.84–17.46)        |
| SETUP-28 with a saved token, a new page resumes at once and checks the account behind a held import                           | `tests/e2e/specs/setup-discogs.e2e.ts:247` | P1 / W+E        | Keep   | 6.120 (25.28–26.96)          | 5.674 (15.84–16.78)         |
| SETUP-10 with a username and no token, a want stays in Digga: its push fails once, and Twelves says it is not on the wantlist | `tests/e2e/specs/setup-discogs.e2e.ts:285` | P2 / W+E        | Keep   | 9.591 (24.14–25.28)          | 9.286 (15.21–15.84)         |

#### setup-steps.e2e.ts

| Exact test title                                                                                     | Source                                   | Priority / host | Action | Five workers: seconds (load) | Two workers: seconds (load) |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------- | ------ | ---------------------------- | --------------------------- |
| SETUP-02 an empty library opens the first step, with the header to itself                            | `tests/e2e/specs/setup-steps.e2e.ts:20`  | P1 / W+E        | Keep   | 0.969 (25.28–25.28)          | 0.772 (15.84–15.84)         |
| SETUP-03 step 1 states the catalogue's date, size, folder and free space before anything downloads   | `tests/e2e/specs/setup-steps.e2e.ts:41`  | P1 / W+E        | Keep   | 1.053 (25.28–25.28)          | 0.912 (15.84–15.84)         |
| SETUP-04 with data.discogs.com down, step 1 gives the reason, and Try again finds the catalogue      | `tests/e2e/specs/setup-steps.e2e.ts:64`  | P1 / W+E        | Keep   | 1.109 (25.28–25.28)          | 0.873 (15.21–15.21)         |
| SETUP-05 a catalogue larger than the free space disables Fetch and says how to make room             | `tests/e2e/specs/setup-steps.e2e.ts:88`  | P1 / W+E        | Keep   | 1.136 (25.28–25.28)          | 0.975 (15.21–15.21)         |
| SETUP-32 a download that finds too little space stops before it writes a byte, and the step says why | `tests/e2e/specs/setup-steps.e2e.ts:118` | P2 / W+E        | Keep   | 2.234 (24.14–25.28)          | 2.110 (15.21–15.21)         |
| SETUP-06 a catalogue already downloaded is kept, and Continue moves on without a download            | `tests/e2e/specs/setup-steps.e2e.ts:151` | P1 / W+E        | Keep   | 1.101 (24.14–24.14)          | 0.799 (15.21–15.21)         |
| SETUP-07 the download runs behind steps 2 and 3, which keep their step over a reload and go back     | `tests/e2e/specs/setup-steps.e2e.ts:170` | P1 / W+E        | Keep   | 3.392 (24.14–24.14)          | 2.802 (14.95–15.21)         |
| SETUP-11 Skip moves to step 3 with nothing connected and nothing suggested                           | `tests/e2e/specs/setup-steps.e2e.ts:200` | P1 / W+E        | Keep   | 1.010 (24.14–24.14)          | 0.969 (14.95–14.95)         |
| SETUP-15 the style picker finds, suggests, removes and lists styles; the years have their options    | `tests/e2e/specs/setup-steps.e2e.ts:223` | P1 / W+E        | Keep   | 1.996 (24.14–24.14)          | 1.843 (14.95–14.95)         |
| SETUP-16 Fill the crate needs a style and a span that runs forwards                                  | `tests/e2e/specs/setup-steps.e2e.ts:263` | P1 / W+E        | Keep   | 1.948 (24.14–24.14)          | 1.535 (14.95–14.95)         |
| SETUP-17 Fill the crate saves the styles, years, formats and load years and starts the load          | `tests/e2e/specs/setup-steps.e2e.ts:299` | P1 / W+E        | Keep   | 2.234 (24.14–24.14)          | 1.617 (14.95–14.95)         |
| SETUP-30 a library with a finished load never shows the setup, and #/setup goes to Triage            | `tests/e2e/specs/setup-steps.e2e.ts:335` | P1 / W+E        | Keep   | 1.479 (24.14–24.14)          | 0.791 (14.95–14.95)         |

#### setup.e2e.ts

| Exact test title                                                                                                 | Source                             | Priority / host | Action            | Five workers: seconds (load) | Two workers: seconds (load) |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------- | --------------- | ----------------- | ---------------------------- | --------------------------- |
| SETUP-01 the first run from the default config ends with a saved verdict                                         | `tests/e2e/specs/setup.e2e.ts:33`  | P0 / W+E        | Keep              | 10.541 (22.17–24.14)         | 10.086 (13.72–14.47)        |
| SETUP-01 Triage opened with T during the load digs the records counted, without looking again                    | `tests/e2e/specs/setup.e2e.ts:62`  | P0 / W+E        | Keep              | 3.675 (23.41–24.14)          | 3.092 (14.47–14.47)         |
| SETUP-31 at the end of what has loaded, Triage waits, and the next record shows once it arrives                  | `tests/e2e/specs/setup.e2e.ts:87`  | P1 / W+E        | Keep              | 7.507 (22.17–23.41)          | 6.756 (13.72–14.47)         |
| SETUP-18 held at a checkpoint, the crate shows what the load has read                                            | `tests/e2e/specs/setup.e2e.ts:131` | P1 / W+E        | Absorb M1, M2, M3 | 6.195 (22.17–23.41)          | 5.754 (13.34–13.34)         |
| SETUP-19 held at a checkpoint, the load counts the records the download has brought so far                       | `tests/e2e/specs/setup.e2e.ts:162` | P1 / W+E        | Merge M1          | 6.127 (22.17–23.41)          | 5.618 (13.34–13.34)         |
| SETUP-21 Start digging waits for 500 records to dig, while T opens Triage at any count                           | `tests/e2e/specs/setup.e2e.ts:184` | P1 / W+E        | Keep              | 7.188 (22.17–23.41)          | 7.305 (12.13–12.75)         |
| SETUP-24 Change your picks stops the load, keeps what was dug, and step 3 starts from the picks                  | `tests/e2e/specs/setup.e2e.ts:217` | P1 / W+E        | Keep              | 6.825 (21.36–22.17)          | 6.672 (12.13–12.75)         |
| SETUP-25 a download that stops under the load says where it stopped, keeps what loaded, and starts again         | `tests/e2e/specs/setup.e2e.ts:264` | P1 / W+E        | Keep              | 7.955 (21.36–22.17)          | 7.825 (11.32–12.13)         |
| SETUP-25 a download that stops on steps 2 and 3 says where it stopped, and starts again                          | `tests/e2e/specs/setup.e2e.ts:302` | P1 / W+E        | Keep              | 8.952 (20.13–22.17)          | 8.902 (10.57–12.13)         |
| SETUP-26 a download that does not match Discogs' checksum comes once more by itself, and the load reads it again | `tests/e2e/specs/setup.e2e.ts:341` | P2 / W+E        | Keep              | 7.681 (20.13–22.17)          | 7.615 (9.80–10.57)          |
| SETUP-26 a download that does not match Discogs' checksum twice asks before a third                              | `tests/e2e/specs/setup.e2e.ts:376` | P2 / W+E        | Keep              | 9.068 (20.13–21.36)          | 8.929 (9.80–10.57)          |
| SETUP-29 picks that match nothing offer Change your picks instead of digging                                     | `tests/e2e/specs/setup.e2e.ts:406` | P2 / W+E        | Keep              | 4.345 (20.13–21.36)          | 4.125 (9.58–9.80)           |
| SETUP-23 the finished load: READY TO DIG, the heading that names the crate, one announcement, and Delete it      | `tests/e2e/specs/setup.e2e.ts:443` | P1 / W+E        | Keep              | 2.700 (20.13–21.36)          | 2.616 (9.58–9.58)           |
| SETUP-27 Digga closing during the load leaves Pick up, which reads the dump from the start                       | `tests/e2e/specs/setup.e2e.ts:487` | P1 / W+E        | Keep              | 9.025 (20.13–20.52)          | 7.679 (9.13–9.58)           |
| SETUP-33 a load that ends with fewer than 500 records to dig enables Start digging                               | `tests/e2e/specs/setup.e2e.ts:520` | P1 / W+E        | Keep              | 3.309 (20.13–20.13)          | 2.574 (9.13–9.58)           |

#### shell.e2e.ts

| Exact test title                                                                                                                                | Source                             | Priority / host | Action    | Five workers: seconds (load) | Two workers: seconds (load) |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | --------------- | --------- | ---------------------------- | --------------------------- |
| SHELL-01 a loaded library opens on Triage with its counts and first record                                                                      | `tests/e2e/specs/shell.e2e.ts:18`  | P0 / W+E        | Keep      | 1.159 (20.13–20.13)          | 0.701 (9.13–9.13)           |
| SHELL-02 T, W and , switch pages; the current link, the hash and the title follow                                                               | `tests/e2e/specs/shell.e2e.ts:38`  | P0 / W+E        | Absorb M4 | 1.200 (20.13–20.13)          | 0.835 (9.13–9.13)           |
| SHELL-03 page keys are ignored in a text field and with Cmd, Ctrl or Alt, and work from a checkbox                                              | `tests/e2e/specs/shell.e2e.ts:59`  | P1 / W+E        | Keep      | 1.223 (20.13–20.13)          | 1.082 (9.13–9.13)           |
| SHELL-04 ? opens the Keys dialog with the page's groups; Esc, the close button and the backdrop close it; page keys stay quiet while it is open | `tests/e2e/specs/shell.e2e.ts:94`  | P1 / W+E        | Keep      | 1.767 (20.13–20.13)          | 1.142 (9.13–9.13)           |
| SHELL-07 with the queue and the stats unreachable, the header and Triage say so, and Enter loads the queue once they answer                     | `tests/e2e/specs/shell.e2e.ts:131` | P1 / W+E        | Keep      | 1.421 (20.13–20.13)          | 0.855 (9.13–9.13)           |
| SHELL-12 Triage says the settings did not load, starts no queue, and Enter reads them again                                                     | `tests/e2e/specs/shell.e2e.ts:173` | P2 / W+E        | Keep      | 1.185 (20.13–20.52)          | 0.764 (9.13–9.13)           |
| SHELL-12 Settings says it did not load, and Try again shows the form                                                                            | `tests/e2e/specs/shell.e2e.ts:199` | P2 / W+E        | Keep      | 1.321 (20.52–20.52)          | 0.863 (9.28–9.28)           |
| SHELL-09 System follows the emulated scheme, Light and Dark apply at once and survive a reload, and none restarts Triage's queue                | `tests/e2e/specs/shell.e2e.ts:224` | P1 / W+E        | Keep      | 2.188 (20.52–20.52)          | 1.590 (9.28–9.28)           |
| SHELL-06 opened on 127.0.0.1, the page warns and links to the same page on localhost                                                            | `tests/e2e/specs/shell.e2e.ts:261` | P2 / W          | Keep      | 1.318 (20.52–20.52)          | 0.916 (9.28–9.28)           |
| SHELL-08 an unknown hash opens Triage                                                                                                           | `tests/e2e/specs/shell.e2e.ts:285` | P2 / W+E        | Keep      | 1.186 (20.52–20.52)          | 0.787 (9.28–9.28)           |
| SHELL-10 the browser's Back and Forward move between the pages                                                                                  | `tests/e2e/specs/shell.e2e.ts:296` | P2 / W          | Keep      | 1.559 (20.52–20.52)          | 1.023 (9.28–9.28)           |
| SHELL-10 the browser's Back and Forward move between the setup's steps                                                                          | `tests/e2e/specs/shell.e2e.ts:325` | P2 / W          | Keep      | 2.273 (20.52–20.52)          | 1.117 (9.28–9.28)           |
| SHELL-11 Triage's columns stack, the header wraps, and every control stays reachable                                                            | `tests/e2e/specs/shell.e2e.ts:348` | P2 / W+E        | Keep      | 2.447 (20.52–20.52)          | 0.977 (9.28–9.28)           |

#### triage-discogs.e2e.ts

| Exact test title                                                                                                                             | Source                                      | Priority / host | Action | Five workers: seconds (load) | Two workers: seconds (load) |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------- | ------ | ---------------------------- | --------------------------- |
| TRI-14 C pushes a grail like A, with a note of the grail and keep tracks and the record's note                                               | `tests/e2e/specs/triage-discogs.e2e.ts:23`  | P1 / W+E        | Keep   | 2.291 (20.52–20.52)          | 1.598 (9.28–9.28)           |
| TRI-39 Z while the push is in flight takes the want off Discogs once the push has landed                                                     | `tests/e2e/specs/triage-discogs.e2e.ts:53`  | P1 / W+E        | Keep   | 3.207 (20.16–20.52)          | 2.746 (8.70–9.28)           |
| TRI-42 digging ten records asks Discogs nothing; P asks it first                                                                             | `tests/e2e/specs/triage-discogs.e2e.ts:85`  | P1 / W+E        | Keep   | 2.051 (20.16–20.52)          | 1.625 (8.70–8.70)           |
| TRI-23 P asks Discogs for the market, busy until the answer, then shows it as checked just now, and lists a video Discogs has since the dump | `tests/e2e/specs/triage-discogs.e2e.ts:108` | P1 / W+E        | Keep   | 1.069 (20.52–20.52)          | 0.867 (8.70–8.70)           |
| TRI-23 P on a record with nothing playable plays the video Discogs has since the dump                                                        | `tests/e2e/specs/triage-discogs.e2e.ts:157` | P1 / W+E        | Keep   | 1.228 (20.16–20.16)          | 0.977 (8.70–8.70)           |
| TRI-24 P for a release Discogs no longer has says so, and the line and the tracklist stay as they were                                       | `tests/e2e/specs/triage-discogs.e2e.ts:179` | P2 / W+E        | Keep   | 1.073 (20.16–20.16)          | 0.781 (8.70–8.70)           |
| TRI-16 another account's token keeps the username and reads as a problem; a want then fails at once at Discogs                               | `tests/e2e/specs/triage-discogs.e2e.ts:219` | P2 / W+E        | Keep   | 6.937 (19.82–20.16)          | 6.452 (8.48–8.70)           |
| TRI-15 a push Discogs keeps failing is tried three more times, then stays saved in Digga, and Twelves marks it                               | `tests/e2e/specs/triage-discogs.e2e.ts:265` | P1 / W+E        | Keep   | 7.166 (19.82–20.16)          | 6.537 (8.48–8.70)           |
| TRI-45 a push Discogs fails once is tried again 5 s later and reaches the wantlist                                                           | `tests/e2e/specs/triage-discogs.e2e.ts:305` | P1 / W+E        | Keep   | 3.330 (20.16–20.16)          | 2.900 (8.44–8.48)           |
| TRI-25 O opens the release on discogs.com and S a YouTube search for its artist and title                                                    | `tests/e2e/specs/triage-discogs.e2e.ts:331` | P1 / W+E        | Keep   | 1.149 (20.16–20.16)          | 0.766 (8.48–8.48)           |

#### triage-notes.e2e.ts

| Exact test title                                | Source                                  | Priority / host | Action | Five workers: seconds (load) | Two workers: seconds (load) |
| ----------------------------------------------- | --------------------------------------- | --------------- | ------ | ---------------------------- | --------------------------- |
| TRI-46 a note survives reload without a verdict | `tests/e2e/specs/triage-notes.e2e.ts:5` | P1 / W+E        | Keep   | 1.259 (20.16–20.16)          | 0.856 (8.44–8.44)           |

#### triage-player.e2e.ts

| Exact test title                                                                                                                                | Source                                     | Priority / host | Action | Five workers: seconds (load) | Two workers: seconds (load) |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------- | ------ | ---------------------------- | --------------------------- |
| TRI-05 the next release's first video and J's track wait muted on hidden decks, and play without a new load                                     | `tests/e2e/specs/triage-player.e2e.ts:33`  | P1 / W+E        | Keep   | 0.966 (20.16–20.16)          | 0.842 (8.44–8.44)           |
| TRI-26 a pasted YouTube link is attached and plays, on its track or under Other videos                                                          | `tests/e2e/specs/triage-player.e2e.ts:66`  | P1 / W+E        | Keep   | 1.318 (20.16–20.16)          | 1.094 (8.44–8.44)           |
| TRI-03 Space pauses and resumes, the arrows seek by the seek step, 1 to 9 jump and keep a pause, the slider follows                             | `tests/e2e/specs/triage-player.e2e.ts:120` | P1 / W+E        | Keep   | 1.599 (20.16–20.16)          | 1.160 (8.44–8.44)           |
| TRI-41 a held arrow seeks once per repeat, while a held verdict key judges once                                                                 | `tests/e2e/specs/triage-player.e2e.ts:169` | P2 / W+E        | Keep   | 1.333 (20.16–20.16)          | 0.869 (8.44–8.44)           |
| TRI-43 a video loaded to play that the browser keeps silent asks for Space after 3.5 s                                                          | `tests/e2e/specs/triage-player.e2e.ts:199` | P2 / W+E        | Keep   | 1.315 (19.82–20.16)          | 0.862 (8.44–8.44)           |
| TRI-28 a video YouTube refuses while it plays is skipped with a notice                                                                          | `tests/e2e/specs/triage-player.e2e.ts:232` | P1 / W+E        | Keep   | 1.279 (19.82–19.82)          | 0.794 (8.44–8.44)           |
| TRI-36 leaving Triage pauses the sound and logs a listen's remainder of 1 s or more; returning keeps the record and undo                        | `tests/e2e/specs/triage-player.e2e.ts:258` | P1 / W+E        | Keep   | 1.954 (19.82–19.82)          | 1.314 (8.44–8.44)           |
| TRI-27 a release without videos says so and offers S, Cmd+V and D; verdict keys still work                                                      | `tests/e2e/specs/triage-player.e2e.ts:307` | P1 / W+E        | Keep   | 1.517 (19.82–19.82)          | 0.824 (9.69–9.69)           |
| TRI-28 records whose videos are all refused say so; embed=false videos read no embed and never load                                             | `tests/e2e/specs/triage-player.e2e.ts:337` | P1 / W+E        | Keep   | 1.535 (19.82–19.82)          | 0.827 (9.69–9.69)           |
| TRI-04 J and K change track, skipping refused videos and, for J, heard tunes; a video's end moves on                                            | `tests/e2e/specs/triage-player.e2e.ts:380` | P1 / W+E        | Keep   | 1.877 (19.82–19.82)          | 1.093 (9.69–9.69)           |
| TRI-18 Shift+K, Shift+M and Shift+C mark the playing track, the same key clears it, and Tracks lists keep and grail                             | `tests/e2e/specs/triage-player.e2e.ts:422` | P1 / W+E        | Keep   | 1.868 (19.82–19.82)          | 1.047 (9.69–9.69)           |
| TRI-06 4 s of playback log a listen; the track then reads played, and the tune reads heard on another release; a shorter play is logged unheard | `tests/e2e/specs/triage-player.e2e.ts:485` | P1 / W+E        | Keep   | 1.517 (19.82–19.82)          | 0.916 (9.69–9.69)           |
| TRI-37 a main release without a video plays its repress's video on its own track, which takes the mark                                          | `tests/e2e/specs/triage-player.e2e.ts:547` | P2 / W+E        | Keep   | 1.533 (19.82–19.82)          | 0.753 (9.69–9.69)           |

#### triage-pressing-notes.e2e.ts

| Exact test title                                                     | Source                                           | Priority / host | Action | Five workers: seconds (load) | Two workers: seconds (load) |
| -------------------------------------------------------------------- | ------------------------------------------------ | --------------- | ------ | ---------------------------- | --------------------------- |
| TRI-48 shows another pressing's note until this pressing has its own | `tests/e2e/specs/triage-pressing-notes.e2e.ts:8` | P1 / W+E        | Keep   | 1.406 (19.82–19.82)          | 0.790 (9.69–9.69)           |

#### triage-queue.e2e.ts

| Exact test title                                                                                                               | Source                                    | Priority / host | Action    | Five workers: seconds (load) | Two workers: seconds (load) |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | --------------- | --------- | ---------------------------- | --------------------------- |
| TRI-09 N passes a record, which comes round again from the end of the queue                                                    | `tests/e2e/specs/triage-queue.e2e.ts:41`  | P1 / W+E        | Keep      | 1.624 (19.82–19.82)          | 0.814 (9.69–9.69)           |
| TRI-30 the end of the queue starts a round of the snoozed records: a verdict replaces a snooze, N leaves it, Esc returns       | `tests/e2e/specs/triage-queue.e2e.ts:64`  | P1 / W+E        | Keep      | 1.720 (19.82–20.24)          | 0.987 (9.69–9.69)           |
| TRI-19 X hides the record's first label from the queue and Settings lists it; Z lets it back                                   | `tests/e2e/specs/triage-queue.e2e.ts:126` | P1 / W+E        | Keep      | 1.642 (19.82–20.24)          | 0.882 (9.69–9.69)           |
| TRI-49 X in a round of snoozed records leaves the label's records out and the round goes on; Z brings the record back          | `tests/e2e/specs/triage-queue.e2e.ts:155` | P1 / W+E        | Keep      | 1.707 (19.82–20.24)          | 0.889 (9.69–9.69)           |
| TRI-20 F offers the record's labels, its track artists and the last load's records; Enter digs the first label until Esc       | `tests/e2e/specs/triage-queue.e2e.ts:200` | P1 / W+E        | Keep      | 2.036 (20.24–20.24)          | 0.933 (9.31–9.31)           |
| TRI-22 a scope dug to the end says so, goes round the records passed in it, and Esc returns to the whole queue                 | `tests/e2e/specs/triage-queue.e2e.ts:243` | P2 / W+E        | Keep      | 1.863 (20.24–20.24)          | 0.907 (9.31–9.31)           |
| TRI-35 a save that changes the queue restarts it in the F scope; a seek step or color scheme change keeps the record on screen | `tests/e2e/specs/triage-queue.e2e.ts:274` | P2 / W+E        | Keep      | 2.369 (20.24–20.24)          | 1.417 (9.31–9.31)           |
| TRI-32 filters that match no record say so, with the number of records loaded                                                  | `tests/e2e/specs/triage-queue.e2e.ts:327` | P1 / W+E        | Keep      | 1.228 (20.24–20.24)          | 0.710 (9.31–9.31)           |
| TRI-31 a library whose finished load kept nothing says no releases are loaded and offers settings                              | `tests/e2e/specs/triage-queue.e2e.ts:347` | P2 / W+E        | Keep      | 2.897 (20.24–20.24)          | 1.555 (9.31–9.31)           |
| TRI-38 an undated record on a label nobody wants stays out of the queue under the default filters                              | `tests/e2e/specs/triage-queue.e2e.ts:374` | P2 / W+E        | Keep      | 1.177 (20.24–20.24)          | 0.684 (9.31–9.31)           |
| TRI-38 an undated record on a wanted label reaches the queue under the default filters                                         | `tests/e2e/specs/triage-queue.e2e.ts:391` | P2 / W+E        | Keep      | 1.226 (20.24–20.24)          | 0.736 (9.31–9.31)           |
| TRI-33 a tracklist that did not load says so, and Enter loads it                                                               | `tests/e2e/specs/triage-queue.e2e.ts:416` | P1 / W+E        | Keep      | 1.259 (20.24–20.24)          | 0.800 (9.31–9.31)           |
| TRI-34 digging past the first batch finds the next record waiting                                                              | `tests/e2e/specs/triage-queue.e2e.ts:439` | P1 / W+E        | Keep      | 2.042 (20.24–20.24)          | 0.997 (9.31–9.31)           |
| TRI-44 a record judged D in Triage and given a link in Twelves comes next when Triage is shown again                           | `tests/e2e/specs/triage-queue.e2e.ts:464` | P1 / W+E        | Keep      | 1.829 (20.24–20.24)          | 1.031 (9.31–9.31)           |
| TRI-44 a record judged D before Triage opened and given a link in Twelves comes next when Triage is shown                      | `tests/e2e/specs/triage-queue.e2e.ts:483` | P1 / W+E        | Keep      | 1.709 (20.24–20.24)          | 0.981 (9.13–9.13)           |
| TRI-29 a link pasted on the No audio shelf deletes the D verdict, and Triage offers the record again without a reload          | `tests/e2e/specs/triage-queue.e2e.ts:503` | P2 / W+E        | Keep      | 1.817 (20.24–20.24)          | 0.923 (9.13–9.13)           |
| TRI-21 one Esc closes the picker while its search field holds text                                                             | `tests/e2e/specs/triage-queue.e2e.ts:559` | P1 / W+E        | Absorb M5 | 1.676 (20.24–20.70)          | 1.000 (9.13–9.13)           |
| TRI-21 F's search lists sellers first, then labels and artists with their records; no match says so                            | `tests/e2e/specs/triage-queue.e2e.ts:584` | P1 / W+E        | Keep      | 4.496 (20.70–20.70)          | 4.101 (9.13–9.13)           |
| TRI-40 digging a seller's shop shows the pressing they have, and A wants that pressing                                         | `tests/e2e/specs/triage-queue.e2e.ts:615` | P1 / W+E        | Keep      | 4.390 (20.70–20.70)          | 3.916 (8.72–9.13)           |

#### triage.e2e.ts

| Exact test title                                                                                         | Source                              | Priority / host | Action | Five workers: seconds (load) | Two workers: seconds (load) |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------- | --------------- | ------ | ---------------------------- | --------------------------- |
| TRI-02 the player waits for Space, then plays the cued video with sound from its start                   | `tests/e2e/specs/triage.e2e.ts:24`  | P0 / W+E        | Keep   | 0.990 (20.70–20.70)          | 0.769 (8.72–8.72)           |
| TRI-07 each verdict key saves its verdict, and wants reach the Discogs wantlist                          | `tests/e2e/specs/triage.e2e.ts:67`  | P0 / W+E        | Keep   | 3.588 (20.70–20.70)          | 3.176 (8.72–8.72)           |
| TRI-12 a want pushes the record's note to the Discogs wantlist; a plain want sends no body               | `tests/e2e/specs/triage.e2e.ts:114` | P0 / W+E        | Keep   | 3.110 (20.70–20.70)          | 2.937 (8.72–8.72)           |
| TRI-13 a want reaches the Discogs wantlist without waiting on a timer; Z then takes it off               | `tests/e2e/specs/triage.e2e.ts:143` | P0 / W+E        | Keep   | 2.939 (20.70–20.70)          | 2.693 (8.66–8.72)           |
| TRI-01 the first record in label-sweep order shows its facts, its tracks' videos and what comes next     | `tests/e2e/specs/triage.e2e.ts:172` | P1 / W+E        | Keep   | 1.356 (20.70–20.70)          | 0.753 (8.72–8.72)           |
| TRI-10 Z walks back a verdict, a pass and a hidden label, one per press                                  | `tests/e2e/specs/triage.e2e.ts:219` | P0 / W+E        | Keep   | 1.661 (20.70–21.20)          | 0.840 (8.66–8.66)           |
| TRI-11 a verdict key held down judges one record                                                         | `tests/e2e/specs/triage.e2e.ts:249` | P1 / W+E        | Keep   | 1.517 (20.70–21.20)          | 0.721 (8.66–8.66)           |
| TRI-17 E edits the record's note: Enter keeps it, Esc cancels, it survives N and Z, the verdict saves it | `tests/e2e/specs/triage.e2e.ts:272` | P1 / W+E        | Keep   | 2.410 (20.70–21.20)          | 1.073 (8.66–8.66)           |
| TRI-08 without a Discogs Maybe list, M points to Settings and saves nothing                              | `tests/e2e/specs/triage.e2e.ts:310` | P1 / W+E        | Keep   | 1.511 (20.70–21.20)          | 0.821 (8.66–8.66)           |
| TRI-08 with a Discogs Maybe list, the verdict bar offers M, which saves a maybe                          | `tests/e2e/specs/triage.e2e.ts:339` | P1 / W+E        | Keep   | 1.430 (21.20–21.20)          | 0.746 (8.66–8.66)           |

#### twelves-controls.e2e.ts

| Exact test title                                    | Source                                      | Priority / host | Action | Five workers: seconds (load) | Two workers: seconds (load) |
| --------------------------------------------------- | ------------------------------------------- | --------------- | ------ | ---------------------------- | --------------------------- |
| TWL-29 arrow keys operate the focused sort controls | `tests/e2e/specs/twelves-controls.e2e.ts:6` | P1 / W+E        | Keep   | 1.368 (21.20–21.20)          | 0.769 (8.66–8.66)           |

#### twelves-discogs.e2e.ts

| Exact test title                                                                                                              | Source                                       | Priority / host | Action    | Five workers: seconds (load) | Two workers: seconds (load) |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------- | --------- | ---------------------------- | --------------------------- |
| TWL-07 a want on the Discogs wantlist re-judged a grail stays on it                                                           | `tests/e2e/specs/twelves-discogs.e2e.ts:44`  | P1 / W+E        | Keep      | 1.635 (21.20–21.20)          | 0.836 (8.66–8.66)           |
| TWL-07 a want on the Discogs wantlist re-judged a skip comes off it and off the shelves                                       | `tests/e2e/specs/twelves-discogs.e2e.ts:71`  | P1 / W+E        | Keep      | 2.089 (21.20–21.20)          | 1.692 (8.29–8.66)           |
| TWL-07 a snooze re-judged a want goes on the Discogs wantlist                                                                 | `tests/e2e/specs/twelves-discogs.e2e.ts:102` | P1 / W+E        | Merge M6  | 1.993 (21.20–21.20)          | 1.658 (8.29–8.29)           |
| TWL-09 wants missing from the wantlist are marked and counted; A, C and add all push them; A again says so and writes nothing | `tests/e2e/specs/twelves-discogs.e2e.ts:127` | P1 / W+E        | Keep      | 5.703 (20.71–21.20)          | 5.092 (7.86–8.29)           |
| TWL-17 A then R pressed at once end as a skip, off the Discogs wantlist, one change after the other                           | `tests/e2e/specs/twelves-discogs.e2e.ts:188` | P2 / W+E        | Keep      | 3.044 (21.20–21.20)          | 2.737 (8.29–8.29)           |
| TWL-11 Z undoes the last change, its wantlist request included                                                                | `tests/e2e/specs/twelves-discogs.e2e.ts:239` | P1 / W+E        | Absorb M6 | 3.153 (21.20–21.20)          | 2.738 (7.86–8.29)           |
| TWL-24 a want the Discogs wantlist no longer lists leaves Twelves' shelves after the next wantlist import                     | `tests/e2e/specs/twelves-discogs.e2e.ts:270` | P2 / W+E        | Keep      | 4.837 (20.71–21.20)          | 4.336 (7.86–7.86)           |
| TWL-08 wantlist and owned records refuse re-judging with a flash                                                              | `tests/e2e/specs/twelves-discogs.e2e.ts:312` | P2 / W+E        | Keep      | 0.923 (21.20–21.20)          | 0.842 (7.86–7.86)           |
| TWL-10 without a Maybe list, the Maybe shelf points to Settings and I reads nothing                                           | `tests/e2e/specs/twelves-discogs.e2e.ts:340` | P1 / W+E        | Keep      | 0.786 (21.20–21.20)          | 0.729 (7.86–7.86)           |
| TWL-10 maybes not on the Discogs Maybe list are counted, and I reads the list                                                 | `tests/e2e/specs/twelves-discogs.e2e.ts:372` | P1 / W+E        | Keep      | 2.358 (20.71–20.71)          | 2.071 (7.63–7.86)           |

#### twelves-filtered-wantlist.e2e.ts

| Exact test title                         | Source                                                | Priority / host | Action | Five workers: seconds (load) | Two workers: seconds (load) |
| ---------------------------------------- | ----------------------------------------------------- | --------------- | ------ | ---------------------------- | --------------------------- |
| TWL-27 add all respects the shelf search | `tests/e2e/specs/twelves-filtered-wantlist.e2e.ts:14` | P1 / W+E        | Keep   | 3.444 (20.71–20.71)          | 3.081 (7.63–7.63)           |

#### twelves-keyboard.e2e.ts

| Exact test title                                     | Source                                      | Priority / host | Action | Five workers: seconds (load) | Two workers: seconds (load) |
| ---------------------------------------------------- | ------------------------------------------- | --------------- | ------ | ---------------------------- | --------------------------- |
| TWL-25 holding a verdict key changes only one record | `tests/e2e/specs/twelves-keyboard.e2e.ts:8` | P1 / W+E        | Keep   | 0.926 (20.71–20.71)          | 0.799 (7.63–7.63)           |

#### twelves-notes.e2e.ts

| Exact test title                                | Source                                   | Priority / host | Action | Five workers: seconds (load) | Two workers: seconds (load) |
| ----------------------------------------------- | ---------------------------------------- | --------------- | ------ | ---------------------------- | --------------------------- |
| TWL-26 replay refreshes notes edited in Twelves | `tests/e2e/specs/twelves-notes.e2e.ts:9` | P1 / W+E        | Keep   | 1.867 (20.71–20.71)          | 0.901 (7.63–7.63)           |

#### twelves-pressings.e2e.ts

| Exact test title                                              | Source                                        | Priority / host | Action | Five workers: seconds (load) | Two workers: seconds (load) |
| ------------------------------------------------------------- | --------------------------------------------- | --------------- | ------ | ---------------------------- | --------------------------- |
| TWL-28 replay removes and restores the actual wanted pressing | `tests/e2e/specs/twelves-pressings.e2e.ts:10` | P1 / W+E        | Keep   | 4.538 (20.71–21.21)          | 3.842 (7.63–8.30)           |
| TWL-28 shelf removes and restores the actual wanted pressing  | `tests/e2e/specs/twelves-pressings.e2e.ts:10` | P1 / W+E        | Keep   | 4.505 (20.71–21.21)          | 3.888 (7.63–8.30)           |

#### twelves-replay.e2e.ts

| Exact test title                                                                         | Source                                     | Priority / host | Action | Five workers: seconds (load) | Two workers: seconds (load) |
| ---------------------------------------------------------------------------------------- | ------------------------------------------ | --------------- | ------ | ---------------------------- | --------------------------- |
| TWL-22 replay opens a marked upload at its saved second and leaves the verdict unchanged | `tests/e2e/specs/twelves-replay.e2e.ts:8`  | P1 / W+E        | Keep   | 2.151 (20.71–20.71)          | 1.000 (8.30–8.30)           |
| TWL-23 replay seeks the saved track even when its release is already on the triage desk  | `tests/e2e/specs/twelves-replay.e2e.ts:44` | P1 / W+E        | Keep   | 2.066 (20.71–20.71)          | 1.121 (8.30–8.30)           |

#### twelves.e2e.ts

| Exact test title                                                                                                                          | Source                               | Priority / host | Action | Five workers: seconds (load) | Two workers: seconds (load) |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------- | ------ | ---------------------------- | --------------------------- |
| TWL-01 keys 1 to 9 pick the shelves with their counts; Everything leaves out no audio                                                     | `tests/e2e/specs/twelves.e2e.ts:41`  | P1 / W+E        | Keep   | 2.419 (20.71–21.21)          | 1.567 (8.30–8.30)           |
| TWL-02 J, K, the down and up arrows move the selection and scroll it into the window                                                      | `tests/e2e/specs/twelves.e2e.ts:112` | P1 / W+E        | Keep   | 2.547 (21.21–21.21)          | 2.029 (8.30–8.30)           |
| TWL-02 a track J selects at the bottom of a short window stays above the shelf's footer                                                   | `tests/e2e/specs/twelves.e2e.ts:136` | P1 / W+E        | Keep   | 1.680 (21.21–21.21)          | 1.247 (8.30–8.30)           |
| TWL-03 a shelf shows 500 rows a page; the arrows turn pages and J crosses into the next                                                   | `tests/e2e/specs/twelves.e2e.ts:177` | P1 / W+E        | Keep   | 7.845 (21.21–21.43)          | 4.725 (9.16–9.16)           |
| TWL-04 S changes the order of the rows                                                                                                    | `tests/e2e/specs/twelves.e2e.ts:208` | P1 / W+E        | Keep   | 1.830 (21.21–21.21)          | 0.975 (9.16–9.16)           |
| TWL-05 / focuses the filter, which filters by label; Enter leaves it, Esc clears it                                                       | `tests/e2e/specs/twelves.e2e.ts:226` | P1 / W+E        | Keep   | 2.723 (21.21–21.21)          | 1.231 (9.16–9.16)           |
| TWL-06 E edits a note, Enter saves it, an empty note removes it, and both survive a reload                                                | `tests/e2e/specs/twelves.e2e.ts:259` | P1 / W+E        | Keep   | 3.212 (21.21–21.21)          | 1.504 (9.16–9.16)           |
| TWL-12 Enter replays the selected record, Shift+Enter the shelf from it; on a snoozed record Enter hears the snoozed records after it too | `tests/e2e/specs/twelves.e2e.ts:303` | P1 / W+E        | Keep   | 3.184 (21.21–21.43)          | 1.735 (9.16–10.19)          |
| TWL-13 the Tracks shelf lists grail and keep marks with their release and verdict                                                         | `tests/e2e/specs/twelves.e2e.ts:340` | P1 / W+E        | Keep   | 2.613 (21.21–21.43)          | 1.400 (10.19–10.19)         |
| TWL-14 on the No audio shelf, Y searches YouTube and a pasted link sends the record back to the queue                                     | `tests/e2e/specs/twelves.e2e.ts:386` | P1 / W+E        | Keep   | 2.266 (21.43–21.43)          | 1.115 (10.19–10.19)         |
| TWL-15 O opens the release on discogs.com                                                                                                 | `tests/e2e/specs/twelves.e2e.ts:414` | P2 / W+E        | Keep   | 1.777 (21.43–21.43)          | 1.030 (10.19–10.19)         |
| TWL-16 a verdict for a release in no dump reads Not in the loaded dump, with its key                                                      | `tests/e2e/specs/twelves.e2e.ts:446` | P2 / W+E        | Keep   | 2.360 (21.43–21.43)          | 1.220 (10.19–10.19)         |
