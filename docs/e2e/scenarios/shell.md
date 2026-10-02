# Shell and navigation

Read this when working on shell and navigation coverage. Follow the [E2E rules](../../E2E_TESTING.md#rules-for-agents-writing-e2e-tests)
and [authoring guidance](../AUTHORING.md). [Scenario conventions and other families](README.md).

## SHELL-01

Priority: **P0**.

A loaded library opens on Triage: title "Triage – Digga", header counts dug and to go, the first
record

## SHELL-02

Priority: **P0**.

`T`, `W` and `,` switch pages; `aria-current="page"`, the hash and the title follow

## SHELL-03

Priority: **P1**.

Page keys are ignored in a text field (Settings' username), and with Cmd, Ctrl or Alt; they work
with a clicked checkbox focused (decision 60)

## SHELL-04

Priority: **P1**.

`?` opens the Keys dialog with the current page's groups (Triage's and Twelves'); Esc, the close
button, the backdrop and `?` again close it; page and verdict keys stay quiet while it is open;
after each close the body has focus

## SHELL-05

Priority: **P1**.

With the sandbox on, the header stamp links to `#/settings/sandbox`, which highlights the Sandbox
section and focuses the switch. The highlight is drawn only (a background and an inset bar), so the
test reads the computed `box-shadow`, and `none` on `#/settings`

## SHELL-06

Priority: **P2**.

Opened on `127.0.0.1`, the page shows the warning with the `localhost` link (**web**)

## SHELL-07

Priority: **P1**.

Settings load normally; `route` aborts `/api/queue*` and `/api/stats*` until lifted: the header
reads "Server unreachable" (it does only while stats have never loaded) and Triage "The queue did
not load"; once requests pass, Enter loads the queue, and a page change brings the header's counts

## SHELL-08

Priority: **P2**.

An unknown hash opens Triage

## SHELL-09

Priority: **P1**.

Appearance: System follows the emulated scheme; Light and Dark apply at once (`data-color-scheme`,
computed `color-scheme`), survive a reload, and do not restart the Triage queue

## SHELL-10

Priority: **P2**.

Browser Back and Forward move between pages and setup steps (**web**; Electron if the window keeps
history)

## SHELL-11

Priority: **P2**.

At 840 px wide the Triage columns are stacked (980 px and below) and the header wraps (860 px and
below); every control stays reachable

## SHELL-12

Priority: **P2**.

`/api/settings` fails while the app opens (aborted until lifted): Triage says "The settings did not
load." with the reason and "try again" (`Enter`), and asks for no queue; once the server answers,
Enter reads the settings and the queue starts. Settings says "Settings did not load: …" with "Try
again", which shows the form

## Completion contracts

- The Keys dialog's actions (`pages/dialogs.ts`): `?` ends once the dialog is visible. A close,
  by `?` again, Esc, the close button or a click on the backdrop, ends once the dialog's `close`
  event has reached a listener the page object added before the action, and the dialog is
  hidden. The browser hides the dialog before it fires `close`, and the app learns of the close
  only from that event, so a page key pressed between the two would still find the help open;
  the app's listener was added first, so it has run by then. The listener goes in through
  `evaluateHandle()`, which returns at once: a first version started `locator.evaluate()`
  without awaiting it, the key press won the race, and the hidden dialog no longer matched the
  locator, so the wait hung.

- A key that should do nothing is checked in the page: a page key sets the hash inside its
  keydown handler, and the handler has run when `keyboard.press()` returns, so `location.hash`
  read with `evaluate()` straight after is exact (SHELL-03, SHELL-04). `page.url()` follows a hash
  change through a separate event. Against a build without the guards the hash had changed by
  then in every run.
