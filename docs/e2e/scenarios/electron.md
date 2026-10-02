# Electron only

Read this when working on electron only coverage. Follow the [E2E rules](../../E2E_TESTING.md#rules-for-agents-writing-e2e-tests)
and [authoring guidance](../AUTHORING.md). [Scenario conventions and other families](README.md).

## ELEC-01

Priority: **P0**.

The app starts its server on a free port bound to `127.0.0.1` and opens the window at `localhost`

## ELEC-02

Priority: **P1**.

The library is the one the environment names, and userData, which holds the token file and the log,
the one `--user-data-dir` names; nothing is written to the real userData

## ELEC-03

Priority: **P1**.

The token saved in Settings is stored with `safeStorage` (the file holds no plain token) and
survives a relaunch; runs only on an `executablePath` build launched without the mock-keychain
switches, on a runner with an unlocked keychain

## ELEC-04

Priority: **P1**.

`O`, `S`, `Y` and the discogs.com link call `shell.openExternal` and open no window

## ELEC-05

Priority: **P1**.

Export links save through `will-download` and complete

## ELEC-06

Priority: **P2**.

Menu items start jobs; the renderer shows their progress

## ELEC-07

Priority: **P1**.

Quitting during the download asks first (stubbed `dialog.showMessageBox`); cancel keeps it running;
confirm waits for `server.stop()`, and the job ends cancelled

## ELEC-08

Priority: **P2**.

The load's progress reaches `BrowserWindow.setProgressBar`; a notification when it ends unfocused;
`powerSaveBlocker` runs only during download and load

## ELEC-09

Priority: **P2**.

"Use a dump file I have" with a stubbed `showOpenDialog` loads the fixture dump

## ELEC-10

Priority: **P2**.

`nativeTheme.themeSource` follows the saved scheme before the first paint

## ELEC-11

Priority: **P1**.

The window's user agent does not name Electron (YouTube embeds reject it)

## ELEC-12

Priority: **P2**.

The history import's permission error shows the Full Disk Access dialog (macOS)

## ELEC-13

Priority: **P1**.

Before the held navigation is released, the window has not loaded the app and the fakes logged no
request; the main process and a worker it starts cannot connect to a loopback port other than the
fakes'; after release the page loads with the routes and fake YouTube in place
