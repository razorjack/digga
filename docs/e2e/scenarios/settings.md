# Settings [`small` or `small-account`]

Read this when working on settings coverage. Follow the [E2E rules](../../E2E_TESTING.md#rules-for-agents-writing-e2e-tests)
and [authoring guidance](../AUTHORING.md). [Scenario conventions and other families](README.md).

## SET-01

Priority: **P1**.

The form shows the saved config and "All saved."; a change reads "Unsaved changes."; Revert
restores; Save and `ControlOrMeta+S` save ("Saved. The queue has reloaded."); a reload keeps it

## SET-02

Priority: **P1**.

The filter preview updates after a change without saving ("These filters match N records, M still to
dig")

## SET-03

Priority: **P1**.

An invalid batch or seek step marks the field (`aria-invalid`, `:invalid`), shows the problem in the
save bar and under the field, whose description has it after the hint, and disables Save; a valid
value clears all of it

## SET-04

Priority: **P1**.

Hidden labels: one per line; a saved label leaves the queue; `X`'s labels appear here

## SET-05

Priority: **P2**.

Styles checkboxes appear with several universe styles and narrow the queue

## SET-06

Priority: **P2**.

Order: one strategy change changes the first record in Triage; the shuffled order is stable across a
reload (its seed is the server's UTC day)

## SET-07

Priority: **P1**.

Player: the start-at slider (`aria-valuetext`) and the seek step reach the player (fake
`startSeconds`, seek distance)

## SET-08

Priority: **P1**.

Given: `small`.

Token: saving `e2e-token-dj` says "Token saved." and whose, and the form takes the username the
server adopted; `e2e-token-refused` says "Not saved: …", marks the field `aria-invalid` and keeps
the old one; Remove removes it

## SET-09

Priority: **P1**.

Given: `small-account`, `DISCOGS_TOKEN=e2e-token-dj`.

A token from the environment: the field is disabled with the hint; `PUT /api/discogs/token` answers
`409`

## SET-10

Priority: **P1**.

Given: `small-account` with a saved token.

Opening Settings costs two Discogs requests, identity and lists (fake log), as "Every request Digga
makes" says; on `small` it costs none

## SET-11

Priority: **P1**.

Given: `small-account` with a saved token.

Maybe list: the lists load when Settings opens; a failing read shows the hint and "Read my lists",
which reads them again and fills the select with the private and the public list; choosing one and
saving enables `M` in Triage; back in Settings the lists load again, the button reads "Reload lists"
and the select shows the saved list

## SET-12

Priority: **P2**.

Currency: `P` then asks in the chosen currency and shows its symbol

## SET-13

Priority: **P1**.

Given: `small` with the username `dj` and a saved token.

Jobs: Collection and Wantlist add a row that runs (its page held at the fake) and ends done with its
counts; the Library and Twelves show the imports

## SET-14

Priority: **P1**.

Given: `small` with the username `dj` and a saved token.

Jobs: an import cancelled while its page is held at the fake reads running until the page has
returned, then cancelled

## SET-15

Priority: **P2**.

Jobs: History reads the fake home's history file; Maybe list is disabled until a list is saved; Read
shop needs a username, reads `shopkeeper`, and `F`'s search then offers the seller

## SET-16

Priority: **P1**.

Given: the July, August and September dumps in the folder.

Dumps: the folder lists each dump, newest first, with its size and use; Delete asks first (dismiss
keeps it, accept deletes it); while a download held at the fake runs, the dump buttons and each
Delete are disabled

## SET-17

Priority: **P1**.

Given: the September dump listed, its transfer held part-way.

"Update from the newest dump": one job, download then load; the header shows "loading" without a
reload; the Library section then counts what the load added (3) and did not find (1), and the
indicator goes

## SET-18

Priority: **P2**.

Load by file name from the datalist, with a limit and a dry run

## SET-19

Priority: **P2**.

Backups: with given verdicts and a `relaunch()`, whose start writes the day's decisions backup,
`/api/backups` lists it and Settings shows it. The first start cannot: it runs before the given
state exists, and an empty library gets no backup

## SET-20

Priority: **P1**.

Exports, with given verdicts and a track mark and a verdict in the sandbox: the three links download
(completed, via `expectDownload`) JSON and CSV with the saved verdicts and marks, and without the
sandbox verdict

## SET-21

Priority: **P1**.

Given: the September dump listed.

A snoozed record with a note, whose release has no master in August, is on the Snoozed shelf with
its note after "Update from the newest dump" loads September, where the release is on a master;
`/api/releases/:id` gives the verdict under the master's key

## Completion contracts

- Settings' actions end the same way (`pages/settings.ts`). Save, by button or `ControlOrMeta+S`,
  ends once `PUT /api/settings` and the `GET /api/queue` the hidden Triage page sends after it have
  answered and the bar reads "Saved. The queue has reloaded."; a token save once
  `PUT /api/discogs/token` has answered and the button reads "Save token" again, by when the
  status line reads the outcome; a job once its row's status cell reads the state the test waits
  for; Cancel once the cancel and the `GET /api/jobs` after it have answered; Delete once
  `DELETE /api/dumps/:name` has answered with the folder's new listing and the row has gone.

- Settings' sandbox switch (`switchSandbox()`) ends once `PUT /api/settings` and the
  `GET /api/queue` that the hidden Triage page sends in the new mode have answered, the page says
  it switched, and the header's sandbox stamp shows or has gone. An Appearance radio
  (`chooseColorScheme()`) ends once its `PUT /api/settings` has answered and the root element
  carries the scheme in `data-color-scheme`.

- Settings' Delete asks with `window.confirm()`, and Playwright dismisses a dialog no listener
  handles. `deleteDump()` registers a `once("dialog")` listener before the click, which records
  the dialog's type and message and accepts or dismisses as the test says.
