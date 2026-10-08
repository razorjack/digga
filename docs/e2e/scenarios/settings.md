# Settings [`small` or `small-account`]

Read this when working on settings coverage. Follow the [E2E rules](../../E2E_TESTING.md#rules-for-agents-writing-e2e-tests)
and [authoring guidance](../AUTHORING.md). [Scenario conventions and other families](README.md).

## SET-01

Priority: **P1**.

The form shows the saved config, and the save bar no buttons; a change reads "Unsaved changes."
and marks its tab ("Unsaved changes" as the link's description); Revert restores; Save and
`ControlOrMeta+S` save ("Saved. The queue has reloaded."); a change stays unsaved on another tab
and saves from there; a reload keeps it

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

Hidden labels: one per line; a saved label leaves the queue; `X`'s labels appear here, and keep
their Discogs id when the list is edited and saved again

## SET-05

Priority: **P2**.

Given: `universe.styles` Drum n Bass and Neurofunk.

Styles checkboxes appear with several universe styles and narrow the queue: with Drum n Bass
unchecked the preview matches one record, and once saved the queue holds only the second record,
the one Neurofunk record

## SET-06

Priority: **P2**.

Given: `labels: Cold Storage, Echo Chamber`; every small record is from the UK and the first one is
also the oldest, so on all labels neither By country nor By year moves it.

Order: one strategy change changes the first record in Triage; the shuffled order is stable across a
reload (its seed is the server's UTC day). The queue response carries `seed`; when two reads have
different seeds, UTC midnight passed between them, and the test compares the next read instead

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

Given: a saved token.

Currency: `P` then asks in the chosen currency and shows its symbol: with GBP saved, the fake gets
`curr_abbr=GBP` and the market line reads £12.50

## SET-13

Priority: **P1**.

Given: `small` with the username `dj` and a saved token.

Imports: Collection and Wantlist add a row that runs (its page held at the fake) and ends done with its
counts; the Library and Twelves show the imports

## SET-14

Priority: **P1**.

Given: `small` with the username `dj` and a saved token.

Imports: an import cancelled while its page is held at the fake reads running until the page has
returned, then cancelled

## SET-15

Priority: **P2**.

Given: `small-account` with a saved token.

Imports: "Your Discogs" offers Collection, Wantlist and Maybe list, and no history import; Maybe list
is disabled until a list is saved, not merely chosen; Read shop needs a username, reads
`shopkeeper`, and `F`'s search then offers the seller

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

Given: the July and September dumps in the folder.

Load by file name from the datalist, with a limit and a dry run: the datalist offers both dumps,
newest first; the request carries the file, `limit: 2` and `dryRun: true`; the job ends done having
matched 2, and the library's dump and records to dig are as before

## SET-19

Priority: **P2**.

Backups: with given verdicts and a `relaunch()`, whose start writes the day's decisions backup,
`/api/backups` lists it and Settings shows it. The first start cannot: it runs before the given
state exists, and an empty library gets no backup

## SET-20

Priority: **P1**.

Exports, with given verdicts and a track mark: the three links download (completed, via
`expectDownload`) JSON and CSV with the saved verdicts and marks

## SET-21

Priority: **P1**.

Given: the September dump listed.

A snoozed record with a note, whose release has no master in August, is on the Snoozed shelf with
its note after "Update from the newest dump" loads September, where the release is on a master;
`/api/releases/:id` gives the verdict under the master's key

## SET-22

Priority: **P2**.

Given: `small-account` with a saved token.

A library holds one Discogs account's data (decision 138). The Username field's description says
the library holds `dj`'s collection, wantlist and Maybe list; `e2e-token-other` is not saved (`409`,
declared, "Not saved: This library holds the Discogs collection and wantlist of dj; forget them in
Settings before using other."). "Forget them", its confirmation accepted, forgets 3 items ("Forgot
3 Discogs items of dj."); then `/api/discogs/account` names no data account, the collected and
wanted records are back in the queue, `e2e-token-other` saves and reads as another account's,
and Twelves' Discogs wantlist and Owned shelves count 0. `tests/wantlist-http.test.ts` covers the
routes' refusals and `DELETE /api/discogs/data`; this row checks the Settings flow and what the
queue and Twelves read after it

## SET-23

Priority: **P2**.

A failed scheduled backup shows in Settings. With a verdict given after the first start's check, the
library's `backups` folder loses its write permission (POSIX, not as root, given back in cleanup), and `relaunch()`: the start's check finds the day's
database copy and cannot write the decisions backup or the checkpoint, `/api/backups` reports the
failure, and the Backups tab reads "A scheduled backup failed just now: the daily decisions backup
failed: EACCES…; the decisions checkpoint failed: EACCES…. Digga tries again every fifteen
minutes; Back up now tries at once." That a later check that succeeds clears it stays with
`tests/daily-backups.test.ts`: the next scheduled check runs 15 minutes later on the server's
clock, which a test cannot move, and a relaunch starts without the failure in any case

## Completion contracts

- Settings' actions end the same way (`pages/settings.ts`). Save, by button or `ControlOrMeta+S`,
  ends once `PUT /api/settings` and the `GET /api/queue` the hidden Triage page sends after it have
  answered and the bar reads "Saved. The queue has reloaded."; a token save once
  `PUT /api/discogs/token` has answered and the button reads "Save token" again, by when the
  status line reads the outcome; a job once its row's status cell reads the state the test waits
  for; Cancel once the cancel and the `GET /api/jobs` after it have answered; Delete once
  `DELETE /api/dumps/:name` has answered with the folder's new listing and the row has gone.

- An Appearance radio (`chooseColorScheme()`) ends once its `PUT /api/settings` has answered and
  the root element carries the scheme in `data-color-scheme`.

- Settings' Delete asks with `window.confirm()`, and Playwright dismisses a dialog no listener
  handles. `deleteDump()` registers a `once("dialog")` listener before the click, which records
  the dialog's type and message and accepts or dismisses as the test says. "Forget them"
  (`forgetDiscogsData()`) asks the same way; it ends once `DELETE /api/discogs/data` has answered
  and the page says how many items it forgot.
