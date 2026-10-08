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
retired later with sandbox mode (decision 150 in `docs/DECISIONS.md`). On 2026-10-06 Triage's
remaining P2 scenarios completed the last family, and the cross-layer changes of 2026-10-03 got
their rows ([history](HISTORY.md#the-triage-p2-scenarios-and-the-2026-10-03-changes-web)). The web
host, the web P0 set and every specified web scenario are implemented. On 2026-10-07 the Electron
host ran the shared suite on the unpackaged app, with the Electron scenarios it can meet, and on
2026-10-08 on the packaged app's inspectable variant ([Electron](#electron)). No current spec uses
`test.fail` or `test.fixme`; the one `test.skip` call, in SET-23, skips on Windows or as root,
where file permissions do not stop Digga. One observation below awaits a decision.

## Next work

1. The owner's ×10 burn-in of the Electron configuration on a quiet machine ([Electron](#electron)).
2. Review the full suite for consolidation. The owner chose on 2026-10-02 to implement every P2
   scenario first and to review after that; do not prune before that review.

A slice is complete when its specified behavior is covered, the affected spec passes
`--repeat-each=10`, all repository checks pass, and the relevant reference and this plan agree
with the implementation. A reproduced product gap gets the normal-current-behavior and
`test.fail` treatment described in the [scenario conventions](scenarios/README.md#coverage-states).
Do not treat an observation as a confirmed gap without checking it.

## Remaining web coverage

None: every web scenario in the [families](scenarios/README.md) has a tagged test. Add fixture
records or fake endpoints only when a new scenario needs them; `GET /masters/{id}` is still absent
from the fake Discogs API. Of the original catalogue design, the pooled-video pressings and the
undated wanted-label record are in the [catalogue](../../tests/e2e/fixtures/catalogue.ts); House
releases and records in other styles are not. Its implemented records and accounts, not the
original target of about 40 records, define today's given state.

## Observations awaiting a decision

These are observations from earlier runs, not approved implementation tasks or expected-failure
coverage. Reproduce against current code when taking one up. Resolved observations, including
Triage's stale queue and Twelves' re-judging copy, remain in history only.

The owner decided every earlier observation on 2026-10-08 ([decision 172](../DECISIONS.md));
their evidence stays in history. One was made after that:

| Observation                                            | Evidence and decision needed                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The packaged app outlived its server at loads below 80 | The final `vp run e2e:packaged` at `84ffcca` ([history](HISTORY.md#the-owners-decisions-of-2026-10-08-web-electron-unpackaged-and-packaged)): the host killed five apps still running 10 s after their server stopped, in the first `accessibility.e2e.ts` tests, which started as packaging ended, at loads of 39.7 to 48.6; no test failed. Decision 172 kept the exit handling on evidence of slow exits only at 80 and above. Decide whether this changes that. |

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

The [Electron host](ELECTRON.md) runs the shared suite and the Electron-only scenarios on the
unpackaged app on macOS (`vp run e2e:electron`), built on 2026-10-07 after the
[spike](HISTORY.md#the-electron-spike-electron-unpackaged). 168 of the 175 shared tests run on
Electron; the seven `@web` tests and their reasons are in [ELECTRON](ELECTRON.md#the-shared-suite-on-electron).
Every ELEC scenario but ELEC-03 is implemented, and GUARD-03 tests the preload's refusal ([history](HISTORY.md#the-electron-host-and-its-scenarios-electron-unpackaged)).
The same tests run on the packaged app's inspectable variant (`vp run e2e:packaged`), which
ignores `-r`, so the host prepares it through the `DIGGA_E2E_HOLD` hook
([ELECTRON](ELECTRON.md#the-packaged-app)).

Waiting, with what each waits for:

| Work                                  | Waits for                                                                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ELEC-03, the token in a real keychain | the inspectable variant (`release/inspectable/`) launched without the mock-keychain switches, on a runner with an unlocked keychain that is not the owner's |
| The suite on Windows and Linux        | their packages; Linux needs `xvfb-run` and a check of `safeStorage` under the basic store                                                                   |

No `test.fail` stands for these: they are features not built yet, not gaps in built ones.
Running Electron in CI is not planned.

**A ×10 burn-in for the owner.** The whole Electron configuration passed once and at
`--repeat-each=3` on a loaded machine. Run the ×10 burn-in on a quiet machine:

```sh
vp build
npx playwright test --config tests/e2e/playwright.electron.config.ts --repeat-each=10 --workers 4
```

That is 1,860 tests, about 23 minutes on four workers at the measured rate. Record the outcome in
HISTORY with the revision, load and duration.

Where `safeStorage` cannot encrypt, the product saves the token as text and Settings says so
(decision 152); the scenarios for that state follow from it.

## Maintaining the plan

Remove completed IDs from the lists above, update the owning reference, and record meaningful
new evidence in HISTORY with the tested revision, date, environment, command and outcome.
Keep acceptance criteria in the scenario files and current API signatures in source. A
historical run is not evidence that a scenario still passes today. Use Playwright's `--list`
plus the spec assertions to reconcile implemented coverage; a tag alone does not prove it.
