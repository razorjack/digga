# E2E implementation plan

Read this when continuing the E2E implementation project. Start with the [E2E guide](../E2E_TESTING.md)
and its binding rules. Use the [scenario specifications](scenarios/README.md) for acceptance criteria.
Completed investigations belong in [HISTORY](HISTORY.md).

Status recorded on 2026-10-02. The rollout below includes completed work as context.

## Rollout

0. **Spikes (one session each, independent).**
   - Web, done on 2026-09-30 (see [Spike results](HISTORY.md#spike-results)): `@playwright/test`; `spawnDigga()` with the
     isolated environment and the socket guard and its vitest test; the base route with
     `route.fetch()`; the fake YouTube script with its user-activation object; the `small` and
     `small-account` templates from a hand-written dump; GUARD-01, GUARD-02, SHELL-01, TRI-07 and
     TRI-10.
   - Electron, throwaway: a minimal main process that follows the plan's startup, outside the
     product. Check the preload's guard in the main process and in a worker it starts, the held
     first `loadURL()` (no request before release), routes, init scripts and the clock on
     `electronApp.context()`, the host-resolver switch, the safeStorage round trip with the
     keychain switches, `relaunch()`, and whether a packaged build honours `-r`. Record the
     results in [HISTORY](HISTORY.md) before the host interface is fixed.
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
   TRI-28 and TRI-36 (see [The first Triage P1 slice](HISTORY.md#the-first-triage-p1-slice-web)). Triage's P1 set was done on 2026-10-01
   with the other half, the verdicts, the queue, scopes, the market, the seller and the wants:
   TRI-08, TRI-09, TRI-14, TRI-15, TRI-19, TRI-20, TRI-21 (with a gap), TRI-23, TRI-25, TRI-30,
   TRI-32, TRI-33, TRI-34, TRI-39, TRI-40 and TRI-42 (see [The second Triage P1 slice](HISTORY.md#the-second-triage-p1-slice-web)). With them
   came `expectExternalOpen()`, `diggaOptions.config`, `given.verdict()` and `given.sellerShop()`,
   and the fake's inventory. Settings' P1 set was done on 2026-10-01: SET-01, SET-02, SET-03,
   SET-04, SET-07, SET-16 and SET-20, then SET-08, SET-09, SET-10, SET-11, SET-13, SET-14 and
   SET-17 (with a gap; see [The Settings P1 slice](HISTORY.md#the-settings-p1-slice-web)). With them came the Settings page object,
   `expectDownload()` in the web host, `diggaOptions.environmentToken` and `dumpFiles`,
   `given.trackMark()`, the fake's lists, and the small catalogue's July and September dumps.
   Twelves' P1 set was done on 2026-10-01: TWL-01, TWL-02 (with a gap), TWL-04, TWL-05, TWL-06,
   TWL-12, TWL-13 and TWL-14, then TWL-07, TWL-09, TWL-10, TWL-11 and TWL-03 (see [The Twelves P1 slice](HISTORY.md#the-twelves-p1-slice-web)). With them came the Twelves page object's actions, the `bulk` template,
   `app.cli()`, `diggaOptions.decisionsBackup` with `fixtures/decisions.ts`, the fake's
   `GET /lists/{id}`, and the markup of accessibility bug 2. The P1 sets of Shell, Sandbox and
   Persistence were done on 2026-10-01: SHELL-03, SHELL-04, SHELL-05, SHELL-07, SHELL-09, SBX-02,
   SBX-03, SBX-04, SBX-05, SBX-07 and PER-05 (see [The Shell, Sandbox and Persistence P1 slice](HISTORY.md#the-shell-sandbox-and-persistence-p1-slice-web)).
   With them came `restartServer()`, the Keys dialog's page object, Settings' sandbox switch and
   Appearance actions, Triage's queue retry, and lasting aborts. The setup's P1 scenarios for
   steps 1 to 3, before the load starts, were done on 2026-10-01: SETUP-02, SETUP-03, SETUP-04,
   SETUP-05, SETUP-06, SETUP-07, SETUP-11, SETUP-15, SETUP-16, SETUP-17 and SETUP-30, then
   SETUP-08, SETUP-09, SETUP-13 and SETUP-14 (see [The setup's steps 1 to 3 P1 slice](HISTORY.md#the-setups-steps-1-to-3-p1-slice-web)). With them
   came the setup page object's actions for steps 1 to 3, `LiveRegionWatch`, the fake's `503`
   for every request and `dj`'s currency, and the markup of accessibility bugs 3 and 4 for those
   steps. The ten gaps were closed on 2026-10-02 (see [Closing the gaps](HISTORY.md#closing-the-gaps-web)): TRI-21, TWL-02 and
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
   [Running](../E2E_TESTING.md#running)).
4. **Electron** (with session 7). Product change 6, the Electron host and preload, the ELEC
   scenarios, and the shared suite on the unpackaged app and the inspectable release candidate.

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
  see [Disk space](HARNESS.md#disk-space).
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
  only, since the Electron app is the main target (see [Running](../E2E_TESTING.md#running)).
- **Open:** Is a CI provider other than GitHub Actions planned? Are visual snapshots wanted at all? What does the Electron app do when
  `safeStorage` cannot encrypt, as on Linux without a keyring: refuse to save the token, or save
  it with the plain-text key?
