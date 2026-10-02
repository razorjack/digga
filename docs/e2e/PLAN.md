# E2E implementation plan

Read this when continuing the E2E implementation project. For an individual test change,
start with the [E2E guide](../E2E_TESTING.md) and the relevant
[scenario family](scenarios/README.md). Historical findings and measurements are in
[HISTORY](HISTORY.md); they are not prerequisites for every session.

Reconciled against the scenario tags and source on 2026-10-02, at `e1fa6aa` before the
documentation split. The web host and the web P0 set are implemented. No current spec uses
`test.fail`, `test.skip` or `test.fixme`. That does not mean coverage is complete: the entries
below are specified but unimplemented, and the observations below still need decisions.

## Next work

1. Add the CI workflow after confirming the provider. The working assumption is GitHub Actions:
   Ubuntu, Node 24, Chromium with its system dependencies, `vp run verify`, then the remaining
   E2E tests with `@P0` excluded so smoke does not run twice. Upload the HTML report and failure
   artifacts; shard only if the suite exceeds its budget.
2. Implement every remaining P2 scenario, then review the full suite for consolidation.
   The owner chose this order on 2026-10-02; do not prune P2 before that review.

A slice is complete when its specified behavior is covered, the affected spec passes
`--repeat-each=10`, all repository checks pass, and the relevant reference and this plan agree
with the implementation. A reproduced product gap gets the normal-current-behavior and
`test.fail` treatment described in the [scenario conventions](scenarios/README.md#coverage-states).
Do not treat an observation as a confirmed gap without checking it.

## Remaining web P2 coverage

The links lead to the requirements. Add fixture records or fake endpoints only when the
scenario needs them; `GET /masters/{id}` is still absent from the fake Discogs API.

| Family                                  | Remaining IDs                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| [Shell](scenarios/shell.md)             | SHELL-06, SHELL-08, SHELL-10, SHELL-11                                         |
| [Setup](scenarios/setup.md)             | SETUP-10, SETUP-20                                                             |
| [Triage](scenarios/triage.md)           | TRI-16, TRI-22, TRI-24, TRI-29, TRI-31, TRI-35, TRI-37, TRI-38, TRI-41, TRI-43 |
| [Sandbox](scenarios/sandbox.md)         | SBX-06                                                                         |
| [Twelves](scenarios/twelves.md)         | TWL-08, TWL-15, TWL-16, TWL-17, TWL-18                                         |
| [Settings](scenarios/settings.md)       | SET-05, SET-06, SET-12, SET-15, SET-18, SET-19                                 |
| [Persistence](scenarios/persistence.md) | PER-02, PER-03                                                                 |

The original catalogue design included pooled-video pressings, undated wanted-label records,
House releases and additional records in other styles. Check the current
[catalogue](../../tests/e2e/fixtures/catalogue.ts) before adding them. Its implemented records
and accounts, not the original target of about 40 records, define today's given state.

## Observations awaiting a decision

These are observations from earlier runs, not approved implementation tasks or expected-failure
coverage. Reproduce against current code when taking one up. Resolved observations, including
Triage's stale queue and Twelves' re-judging copy, remain in history only.

| Observation                                                                               | Evidence and decision needed                                                                                                                                                  |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Videos with `embeddable = 0` are omitted without a notice, while KEYMAP promises a notice | [First Triage slice](HISTORY.md#the-first-triage-p1-slice-web). Decide whether copy or behavior changes.                                                                      |
| A cued track is marked current and says "playing" while the player waits for Space        | [First Triage slice](HISTORY.md#the-first-triage-p1-slice-web). Decide the track's accessible state before playback.                                                          |
| Keys used in Settings activate the page, so Triage's cued video can read "paused"         | [Settings slice](HISTORY.md#the-settings-p1-slice-web). Decide whether the existing activation behavior needs any change.                                                     |
| Read my lists is enabled by the typed username but requests the saved username            | [Settings slice](HISTORY.md#the-settings-p1-slice-web). An unsaved first username produced `400`; decide when the action should be available.                                 |
| Resuming setup with a saved token waits for the account check behind a held import page   | [SETUP-28 finding](HISTORY.md#closing-the-gaps-web). The earlier estimate was up to about 15 s with a 13-page wantlist; decide whether account lookup should delay the setup. |

## Breadth and release checks

- Implement the separate [manual contract suite](scenarios/contracts.md) and
  `playwright.contract.config.ts`. Add `e2e:contract` only with that configuration; ordinary
  commands must never select it. CON-01 uses the real IFrame API in headed Chromium;
  CON-02 accepts a supplied token but its client must refuse every method except GET;
  CON-03 reads the dump listing without downloading a dump. These checks are manual before
  release, never CI. Until they exist, they cannot detect drift in the fakes.
- Add `e2e:nightly` with the planned P2 schedule and `--repeat-each=5` burn-in. Add Firefox and
  WebKit only after Chromium has been stable for a few weeks. The owner chose limited effort
  on 2026-10-02 because Electron is the main target: fix quick issues, mark the rest as
  Chromium-only with reasons, and avoid larger product or harness changes for those engines.
  Check the dialogs' `closedby` fallback.
- Visual snapshots remain an open choice. If approved, start with a few main-screen
  `toHaveScreenshot` checks on Linux only, with human review of updates.
- Keep the smoke budget near one minute and P0/P1 near six minutes on four workers. Exact
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
