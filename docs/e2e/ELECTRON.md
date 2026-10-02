# Electron E2E plan

Read this when implementing or debugging the Electron test host. Start with the [E2E guide](../E2E_TESTING.md)
and its binding rules. The host and its scenarios are not built. Read [HARNESS](HARNESS.md) for the shared
contracts, [Electron scenarios](scenarios/electron.md) for coverage, and the product
[Electron plan](../ELECTRON_PLAN.md) for packaging.

## Electron

The shared suite needs no change for Electron. The work is the Electron host, the harness
preload and the Electron-only scenarios.

- **Launch.** `_electron.launch({ args: ["-r", preload, mainEntry], env })` with the isolated
  environment, `--user-data-dir` in the test's temp folder (the plan keeps the token file and the
  log in userData, which `DIGGA_DATA_DIR` does not move), the host-resolver switch and the
  keychain switches below. Then the sequence from [Startup order](HARNESS.md#startup-order), then `firstWindow()` with its
  content size set to 1600 x 1000.
- **Main-process stubs.** Installed by the preload before the app's first line:
  `shell.openExternal`, `dialog.showMessageBox`, `dialog.showOpenDialog`, and spies on
  `setProgressBar` and `Notification`, recording calls for the test.
- **Native module ABI.** `@electron/rebuild` rebuilds `better-sqlite3` for Electron's ABI. If that
  happens in the repository's `node_modules`, the CLI, vitest and the web E2E host, all on Node's
  ABI, break. Rebuild only inside the packaged app's staging folder (electron-builder does this),
  and give the unpackaged test run its own install. The fakes run in the Playwright worker and
  need no native module.
- **Fuses.** `_electron.launch()` starts Electron with inspector arguments to attach to it, so a
  build with the `EnableNodeCliInspectArguments` fuse off cannot be launched by Playwright at
  all. The suite runs on an inspectable variant of each release candidate that differs only in
  that fuse. The final fused artifact gets a smaller check without Playwright: launched with the
  isolated environment, `--user-data-dir`, an empty library and the fake service URLs, with no
  preload and no hold, it must write its "listening on" line to its log and answer
  `GET /api/health`, and it is then stopped. Nothing guards it but the environment, so the check
  does nothing more.
- **Keychain.** `safeStorage` uses the macOS Keychain, libsecret or kwallet on Linux, and DPAPI on
  Windows. Playwright's loader, used with the `electron` package, always adds
  `--use-mock-keychain` and `--password-store=basic`; with `executablePath` there is no loader
  and no switches. The host therefore passes both switches itself, so no run touches the
  developer's login keychain. On Linux the basic store makes `safeStorage` report encryption as
  unavailable unless `safeStorage.setUsePlainTextEncryption(true)` was called, so the preload
  calls it there. The Electron spike checks a save, relaunch and read round trip with these
  settings on each OS. ELEC-03 alone omits the switches and runs on an `executablePath` build on
  a runner with a real, unlocked keychain.
- **Linux CI** needs a display: `xvfb-run`, whose `DISPLAY` and `XAUTHORITY` the launch helper
  passes through.
- **Downloads and external links** go through the handlers from [Product changes](HISTORY.md#product-changes-the-harness-needs), item 6.
