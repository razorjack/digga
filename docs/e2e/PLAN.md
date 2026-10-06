# E2E implementation plan

Read this when continuing the E2E implementation project. For an individual test change,
start with the [E2E guide](../E2E_TESTING.md) and the relevant
[scenario family](scenarios/README.md). Historical findings and measurements are in
[HISTORY](HISTORY.md); they are not prerequisites for every session.

Reconciled against the scenario tags and source on 2026-10-02, at `e1fa6aa` before the
documentation split, and again after the setup's remaining scenarios and the Accessibility
family, which completed the Setup and Accessibility families. On 2026-10-03 the remaining P2
scenarios outside Triage completed the Shell, Sandbox, Twelves, Settings and Persistence families
([history](HISTORY.md#the-remaining-p2-scenarios-outside-triage-web)); the Sandbox family was
retired later with sandbox mode (decision 150 in `docs/DECISIONS.md`). The web host and the web
P0 set are implemented. No current spec uses `test.fail` or `test.fixme`; the one `test.skip` is SETUP-12's
unreadable folder on Windows or as root, where permissions do not stop Digga. That does not mean
coverage is complete: the entries below are specified but unimplemented, and the observations
below still need decisions.

## Next work

1. Implement every remaining P2 scenario, then review the full suite for consolidation.
   The owner chose this order on 2026-10-02; do not prune P2 before that review.

A slice is complete when its specified behavior is covered, the affected spec passes
`--repeat-each=10`, all repository checks pass, and the relevant reference and this plan agree
with the implementation. A reproduced product gap gets the normal-current-behavior and
`test.fail` treatment described in the [scenario conventions](scenarios/README.md#coverage-states).
Do not treat an observation as a confirmed gap without checking it.

## Remaining web P2 coverage

The links lead to the requirements. Add fixture records or fake endpoints only when the
scenario needs them; `GET /masters/{id}` is still absent from the fake Discogs API.

| Family                        | Remaining IDs                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------ |
| [Triage](scenarios/triage.md) | TRI-16, TRI-22, TRI-24, TRI-29, TRI-31, TRI-35, TRI-37, TRI-38, TRI-41, TRI-43 |

The original catalogue design included pooled-video pressings, undated wanted-label records,
House releases and additional records in other styles. Check the current
[catalogue](../../tests/e2e/fixtures/catalogue.ts) before adding them. Its implemented records
and accounts, not the original target of about 40 records, define today's given state.

## Observations awaiting a decision

These are observations from earlier runs, not approved implementation tasks or expected-failure
coverage. Reproduce against current code when taking one up. Resolved observations, including
Triage's stale queue and Twelves' re-judging copy, remain in history only.

| Observation                                                                               | Evidence and decision needed                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Videos with `embeddable = 0` are omitted without a notice, while KEYMAP promises a notice | [First Triage slice](HISTORY.md#the-first-triage-p1-slice-web). Decide whether copy or behavior changes.                                                                                                                                                                                                                                                                                        |
| A cued track is marked current and says "playing" while the player waits for Space        | [First Triage slice](HISTORY.md#the-first-triage-p1-slice-web). Decide the track's accessible state before playback.                                                                                                                                                                                                                                                                            |
| Keys used in Settings activate the page, so Triage's cued video can read "paused"         | [Settings slice](HISTORY.md#the-settings-p1-slice-web). Decide whether the existing activation behavior needs any change.                                                                                                                                                                                                                                                                       |
| Read my lists is enabled by the typed username but requests the saved username            | [Settings slice](HISTORY.md#the-settings-p1-slice-web). An unsaved first username produced `400`; decide when the action should be available.                                                                                                                                                                                                                                                   |
| A cancelled import keeps the page that was in flight                                      | [Remaining P2 outside Triage](HISTORY.md#the-remaining-p2-scenarios-outside-triage-web). A collection import cancelled with its page held read cancelled, "page 1 of 1, 1 items", and saved the collected seed. Decide whether a cancel should discard that page.                                                                                                                               |
| Resuming setup with a saved token waits for the account check behind a held import page   | [SETUP-28 finding](HISTORY.md#closing-the-gaps-web). The earlier estimate was up to about 15 s with a 13-page wantlist; decide whether account lookup should delay the setup.                                                                                                                                                                                                                   |
| A want Discogs refuses for its token (`401` or `403`) is tried three more times           | TRI-16: the server answers `502` for every Discogs error (`app.onError` in `src/server/app.ts`), so the session's `mayPassLater()` tries the push again after 5 s, 30 s and 2 min before it says "Discogs answered 403: check the Discogs token in Settings…". Decide whether a refused token should end the push at once.                                                                      |
| Settings' import row does not say how many items an import found gone                     | TWL-24: the wantlist import that ended a want reads "page 1 of 1, 1 items" (`src/shared/job-display.ts`), while its job's progress has `removed: 1` and `digga import wantlist` prints "1 gone from Discogs" (`src/cli/report.ts`). Decide whether the row should say it.                                                                                                                       |
| Back up now leaves a scheduled backup's failure on the Backups tab                        | SET-23, probed: with the folder writable again, Back up now said "Backup saved." and the tab still read "A scheduled backup failed …", since only the next scheduled check, up to 15 minutes later, clears it (`startDailyBackups()` in `src/server/daily-backups.ts`, `backUpNow()` in `src/server/routes/data.ts`). Decide whether a successful Back up now should clear it.                  |
| `P` on the open record plays a video it finds                                             | TRI-23: the first record waits for Space on track A; `P` brings a video for track C, and the player moves to C and plays it. `#refreshRelease()` in `src/client/player/triage-player.svelte.ts` plays any video the open release gains, written for a pasted link, and since 18b1193 `P`'s videos reach it. Decide whether a video `P` finds should play at once or only show in the tracklist. |

## Breadth and release checks

- Implement the separate [manual contract suite](scenarios/contracts.md) and
  `playwright.contract.config.ts`. Add `e2e:contract` only with that configuration; ordinary
  commands must never select it. CON-01 uses the real IFrame API in headed Chromium;
  CON-02 accepts a supplied token but its client must refuse every method except GET;
  CON-03 reads the dump listing without downloading a dump. These checks are manual before
  release, never CI. Until they exist, they cannot detect drift in the fakes.
- [CI](../E2E_TESTING.md#ci) runs the whole suite on every push. The owner decided on
  2026-10-02 against scheduled or nightly runs, and on 2026-10-03 that burn-ins run locally, not
  in CI, so as not to spend GitHub's free compute for open-source projects on repeated runs. A
  P1/P2 split is considered only if the suite outgrows its CI budget.
- Add Firefox and WebKit only after CI stays green on pushes for a few weeks. The owner chose
  limited effort on 2026-10-02 because Electron is the main target: fix quick issues, mark the
  rest as Chromium-only with reasons, and avoid larger product or harness changes for those
  engines. Check the dialogs' `closedby` fallback.
- Visual snapshots remain an open choice. If approved, start with a few main-screen
  `toHaveScreenshot` checks on Linux only, with human review of updates.
- Keep the smoke budget near one minute and P0/P1 near six minutes on CI's four-vCPU runner,
  where the configuration uses two workers. On 2026-10-02 the smoke set took 27 s there and the
  whole suite 3.8 minutes ([CI on GitHub Actions](HISTORY.md#ci-on-github-actions)). Exact
  timings in history describe earlier runs. Per-test processes remain isolated. If measurements
  justify it, consider sharding, a template cache keyed by every input, or a
  `discogsMinIntervalMs` option. That option would stop E2E from exercising production spacing;
  do not add it solely because an earlier measurement was slow.

## Electron

First run the throwaway spike described in [ELECTRON](ELECTRON.md#startup-order), outside the
product: test the guard in the main process and a worker, held first navigation, context routes,
init scripts, clock, resolver rule, safeStorage round trip on each OS, relaunch, and packaged
`-r` behavior. Record results in HISTORY before settling the host design.

Then implement the host, preload and product integration with the
[Electron packaging work](../ELECTRON_PLAN.md), run the shared suite and
[ELEC-01 through ELEC-13](scenarios/electron.md) on the unpackaged app and inspectable release
candidate, and add `e2e:electron`. Run on macOS, Windows and Linux; Linux needs `xvfb-run`.
The fully fused artifact gets only the isolated launch and health check described in ELECTRON.

Decide the behavior when `safeStorage` cannot encrypt: refuse to save the token, or allow the
plain-text store explicitly. The test host's basic store is not the product decision.

## Maintaining the plan

Remove completed IDs from the lists above, update the owning reference, and record meaningful
new evidence in HISTORY with the tested revision, date, environment, command and outcome.
Keep acceptance criteria in the scenario files and current API signatures in source. A
historical run is not evidence that a scenario still passes today. Use Playwright's `--list`
plus the spec assertions to reconcile implemented coverage; a tag alone does not prove it.
