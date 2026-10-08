# Electron only

Read this when working on electron only coverage. Follow the [E2E rules](../../E2E_TESTING.md#rules-for-agents-writing-e2e-tests)
and [authoring guidance](../AUTHORING.md). [Scenario conventions and other families](README.md).

`tests/e2e/specs/electron.e2e.ts` implements every ELEC scenario but ELEC-03, tagged `@electron`,
through the [Electron host](../ELECTRON.md), on the unpackaged app and on the packaged app's
inspectable variant. ELEC-03 waits for a keychain runner; [PLAN](../PLAN.md#electron) says which.

## ELEC-01

Priority: **P0**.

The app starts its server on a free port bound to `127.0.0.1` and opens the window at `localhost`:
the URL the window asks for is `http://localhost:<port>`, the log says "listening on
http://127.0.0.1:<port>", the port is not the config's 3456, a connection to the port on another of
the machine's addresses is refused, and the app's page then opens on that origin

## ELEC-02

Priority: **P1**.

The library is the one the environment names, and userData, which holds the log, Chromium's files
(`Chromium`, decision 155) and `Crashpad`, the one `--user-data-dir` names; the log names the library.
The token file is the library's `secrets.env` (decision 152), which holds the saved token encrypted
and not its text; the library holds Digga's files only. Nothing is written to the real userData:
none of the files the app's processes hold open for writing lies in the home folder, outside the
test's folder. A file written and closed earlier is not seen; the preload's refusal (GUARD-03) keeps
userData itself in the test's folder

## ELEC-03

Priority: **P1**.

The token saved in Settings is stored with `safeStorage` (the file holds no plain token) and
survives a relaunch; runs only on an `executablePath` build launched without the mock-keychain
switches, on a runner with an unlocked keychain

## ELEC-04

Priority: **P1**.

`O` and `S` in Triage, `Y` and the release's discogs.com link in Twelves call `shell.openExternal`
with the release's page or the YouTube search, in that order, and the app logs "opening … in the
browser" for each; the app still has one window, on Twelves

## ELEC-05

Priority: **P1**.

An export link saves through `will-download`: the file is in the folder the preload set, holds the
export, its download ends `completed`, no dialog opened, and the app's own handler logs "download of
… completed: …"

## ELEC-06

Priority: **P2**.

The Library menu's items open the Settings tab that starts each job (decision 157): Update the
Catalogue… the Library tab, Import from Discogs… the Discogs tab and Back Up… the Backups tab, each
`aria-current`; a wantlist import started on the tab the menu opened ends done with its count, and
Back up now there says "Backup saved."; Settings… in the application menu opens Settings

## ELEC-07

Priority: **P1**.

Quitting during the download asks first (stubbed `dialog.showMessageBox`): "Quit while Digga
downloads the catalogue?", where the download stopped at the fake's checkpoint and that Discogs does
not resume it, with Quit and Cancel. Cancel keeps the download running, and the setup goes on to
start the load. Quitting then, as the host's relaunch does, asks "Quit while Digga downloads and
loads the catalogue?", answered Quit: the server cancels both jobs and stops, the relaunched app
lists them cancelled, and the crate says "The catalogue stopped loading." with "Pick up". With no
job running, quitting asks nothing

## ELEC-08

Priority: **P2**.

The progress reaches `BrowserWindow.setProgressBar`, and `powerSaveBlocker` runs only while a
download or load runs: before the download no blocker has started; with the download held at a
checkpoint the bar shows the part that has arrived and one `prevent-app-suspension` blocker runs;
with the window unfocused (`setFocused(false)`), once the download and the load have finished the
bar is cleared (-1), that blocker has stopped and the log has the notification "The catalogue is
in: N releases kept.", N as the load's job counts them. With the window focused, a download that
fails at the checkpoint fails the load reading it: the bar is cleared, the blocker stopped, and
nothing is announced. The preload answers `Notification.isSupported()` with false, so the app logs
the notification and creates none ([ELECTRON](../ELECTRON.md#the-harness-preload))

## ELEC-09

Priority: **P2**.

"Use a dump file I have" in step 1 loads a dump the user keeps outside the dumps folder: the
bulk dump is written to a folder in the test's folder. With no answer the preload cancels the
open dialog, and step 1 stays as it was, with Fetch enabled. Answered with the file, the setup
moves on to step 2; back on step 1 it names the file and no longer offers the button. Skip, a
style and Fill the crate load it: the open dialogs recorded are "Use a dump file you have" for
one file filtered to `xml.gz`, cancelled and then answered; the settings hold the file in
`setup.dumpFile`; the fake dumps service sent no transfer, and the only job is the finished load.
The crate says Digga read the catalogue from the file and leaves it where it is, with no "Delete
it"; the file is still there, and the dumps folder has no dump

## ELEC-10

Priority: **P2**.

`nativeTheme.themeSource` follows the saved scheme before the first paint: with Light or Dark saved,
it is that scheme while the window's first navigation is held, and once the host's emulated scheme
is cleared the page's `prefers-color-scheme` matches it

## ELEC-11

Priority: **P1**.

The window's user agent does not name Electron (YouTube embeds reject it): it ends in Chrome's
tokens, names neither Electron nor Digga, and is the one the page's requests send

## ELEC-12

Retired: the browser history import and its Full Disk Access dialog were removed (decision 171 in
`docs/DECISIONS.md`).

## ELEC-13

Priority: **P1**.

Before the held navigation is released, the window has not loaded the app (no page, an empty URL)
and the fakes logged no request, while the server answers `/api/health`; the main process and a
worker it starts cannot connect to a loopback port other than the fakes'; after release the page
loads with the routes and fake YouTube in place: the player is the fake, and a page request to the
other port is refused (declared) and never reaches it

## ELEC-14

Priority: **P1**.

A quit during the start shows no startup error, and the app exits (the regression of `61a280c`,
which the health check found): with a wantlist import held at the fake, so the server's stop waits
for it, the app is asked to quit while its window's first navigation is held, and the navigation
then goes to the app's page, which the stopping server refuses. Once the navigation has failed the
import's page is released; the server logs that it cancelled the job and "stopped", the app
exits with 0, and no message box was shown

## ELEC-15

Priority: **P2**.

A disk short of space offers another dumps folder, which the app keeps. Without
`DIGGA_DUMPS_DIR` (`diggaOptions.dumpsDirFromApp`) and with a listing larger than any disk, step 1
names `dumps` in the library's data folder and says "Free some space, or choose a folder on
another disk.", without `DIGGA_DUMPS_DIR`. "Choose a folder…" with no answer cancels the folder
dialog and the folder stays; answered with a folder in the test's folder, the message names it,
Fetch stays disabled, the dialogs recorded are "Choose a folder for the catalogue" for a folder
that may be created, and `dumps-folder.json` in the library holds it. With the listing at the
dump's own size, a relaunch logs the chosen folder as its dumps folder, step 1 names it, and
Fetch downloads the dump into it; the default folder stays without a dump. SETUP-05 checks that
the app offers no folder while `DIGGA_DUMPS_DIR` names one.
