# Twelves [`small` or `small-account`, with given verdicts]

Read this when working on twelves coverage. Follow the [E2E rules](../../E2E_TESTING.md#rules-for-agents-writing-e2e-tests)
and [authoring guidance](../AUTHORING.md). [Scenario conventions and other families](README.md).

## TWL-01

Priority: **P1**.

Given: `small-account`.

Keys `1` to `9` pick the shelves; each option's name has the shelf's count, from the given verdicts,
a keep and a meh mark, and `dj`'s imported collection and wantlist; Everything leaves out no audio;
an empty shelf (Grail) shows its text

## TWL-02

Priority: **P1**.

`J`, `K`, `↓`, `↑` move `aria-current` and scroll the row into the window, below the sticky
column headers and above the shelf's footer: with every small record snoozed, `J` to the last row leaves its middle uncovered
(`document.elementFromPoint()`); on the Tracks shelf in a 480 px window, `J` to the fifth track does
the same

## TWL-03

Priority: **P1**.

Paging [`bulk`, 1,200 verdicts restored with `digga restore` before the server starts]: 500 rows a
page; `→` and `←` turn; `K` on page 2's first row goes back to page 1's last, and `J` crosses into
the next page; "Shelf pages" says "501–1,000 of 1,200 records"; the last page holds 200

## TWL-04

Priority: **P1**.

`S` changes the sort: three records judged in the reverse of their labels' order go from newest
first to label order

## TWL-05

Priority: **P1**.

`/` focuses the filter; typing a label's name filters to its records; Enter leaves it with the text
kept; more text says "Nothing matches “…”."; Esc clears it

## TWL-06

Priority: **P1**.

`E` edits a note; Enter saves ("Note saved."); `E` on a record with a note shows it, Esc cancels; an
empty note removes it ("Note removed."); both survive a reload

## TWL-07

Priority: **P1**.

Given: `small-account` with a saved token.

Re-judging, each from its own given state: a want of a release on `dj`'s wantlist re-judged a grail
stays on it (the fake gets nothing); the same want re-judged a skip: the fake gets `DELETE`, the row
leaves the shelves, and the export says skip; a snooze re-judged a want: the fake gets `PUT`

## TWL-08

Priority: **P2**.

Given: `small-account`.

Wantlist and owned records refuse re-judging with a flash: `R` on `dj`'s want and `A` on the
collected release say "Wantlist and owned records come from Discogs; change them there.", the
stamps stay, and no `POST /api/verdicts` is sent

## TWL-09

Priority: **P1**.

Given: `small-account` with a saved token.

Wants and grails missing from the wantlist carry the marker and the banner count; `A` retries a want
and `C` a grail; with two or more on the shelf, "add all N" pushes each, in order, and the banner
says everything is on the wantlist

## TWL-10

Priority: **P1**.

Given: `small-account`.

Maybe hand-off: without a list, the hint, and `I` only flashes; with list 9001 and a saved token, "N
maybes are not on your Discogs Maybe list yet"; `I` reads the list (the fake holds two of them) and
their markers go

## TWL-11

Priority: **P1**.

Given: `small-account` with a saved token.

`Z` undoes the last change, a snooze re-judged a want: the snooze comes back with its date, and the
fake gets `DELETE` after the `PUT`

## TWL-12

Priority: **P1**.

Enter on a snoozed record starts a round in Triage from it, with the snoozed records after it on the
shelf. Enter on a different record starts an ordinary replay round; Esc returns to the queue.

## TWL-13

Priority: **P1**.

The Tracks shelf lists grail and keep marks, not meh ones, with release and verdict; `E` edits a
track note; verdict keys explain that marks change in Triage and send nothing

## TWL-14

Priority: **P1**.

Given: `labels: Echo Chamber`.

The No audio shelf: `Y` opens a YouTube search; `app.paste()` attaches a link and the record leaves
the shelf for the queue (`/api/queue`)

## TWL-15

Priority: **P2**.

`O` opens the selected release on discogs.com (`expectExternalOpen`)

## TWL-16

Priority: **P2**.

Given: a decisions backup restored before the server starts, with a snooze for `NOT_IN_ANY_DUMP`
(`r:9001`, `dj`'s second want, which no dump has).

A verdict for a release in no dump reads "Not in the loaded dump (r:…)", with the verdict's own
key, and its row has no `data-release-id`; Enter on it says Triage cannot play it

## TWL-17

Priority: **P2**.

Given: `small-account` with a saved token, and a snooze.

`A` then `R` pressed at once end as a skip, off the wantlist (decision 62): the page sends the
want's verdict and push, then the skip's verdict and the wantlist removal, in that order; the fake
gets the `DELETE` after the `PUT` has answered, the export says skip, and the flash says the record
was taken off the wantlist

## TWL-18

Retired: the shelf no longer has a sandbox mode to switch (decision 150 in `docs/DECISIONS.md`).

## Completion contracts

- Twelves' actions end the same way (`pages/twelves.ts`). Its flash shows only after the work it
  reports: a re-judgement saves the verdict, then adds to or takes from the Discogs wantlist, then
  shows the flash and loads the shelf again. So a re-judgement ends once `POST /api/verdicts` and
  the `GET /api/twelves` after it have answered and the flash says where the record went; a
  change to the wantlist has reached the fake by then, since the server answers the page only
  after the fake has answered it. A note ends once its `POST /api/verdicts` has answered and the flash reads
  "Note saved." or "Note removed."; a track note the same way with `POST /api/track-verdicts`; `A`
  or `C` on a want already judged so (a retry) once `POST /api/discogs/wantlist/:id` and the reload
  after it have answered and the flash says it was added; "add all" once the flash counts what
  was added, after the last push and the reload; `I` once its `POST /api/jobs/import/list` has
  answered and the flash says what the list holds, after the job has ended and the shelf has
  loaded; `Z` once the restored verdict and the reload have answered and the flash says "Undone";
  a paste once `POST /api/releases/:id/videos` and the reload have answered and the flash says the
  link is attached; `J`, `K`, the arrows and the page turns once another row has
  `aria-current="true"`; Enter on a snoozed record once Triage shows the record under the round's
  banner. A flash with no request behind it, such as a verdict key on the Tracks shelf, comes from
  the key press itself, so the check that nothing was sent can follow it at once. Changes pressed
  without a wait run one after the other (TWL-17), so the last one's requests and the flash after
  it end them all: for a want re-judged a skip, the wantlist removal and the `GET /api/twelves`
  after it.

## TWL-22

Priority: **P1**.

A keep mark on an accepted record stores an upload and second. Enter from Tracks opens that exact
upload at that second. Esc restores the previous digging queue, with the accepted verdict unchanged.

## TWL-23

Priority: **P1**.

A marked track belongs to the undecided release already on the triage desk. Open Tracks and replay
it: the player switches from the first track to the saved upload and second, without a verdict.

## TWL-24

Priority: **P2**.

Given: `small-account` with a saved token, and a want of the release `dj`'s wantlist holds.

An import that misses an item ends it (decision 137). The release is taken off the fake's wantlist,
as on discogs.com; Settings' Wantlist import ends done, its job counts one item removed
(`/api/jobs/:id`), and its row ends "1 gone from Discogs", as `digga import wantlist` says it. Twelves then shows the record on none of Everything, Want and Discogs wantlist,
so nothing offers to push it again; the export keeps the want, and the record stays out of the
queue. `tests/importers.test.ts` and `tests/twelves.test.ts` cover the marking and the shelf rules;
this row checks them together, from the job Settings starts to the shelves the server's
`removed_at` feeds

## TWL-25

Priority: **P1**.

Given: `small` with two snoozed records. Holding the reject key changes only the first record,
even after the shelf selects the next one. Repeated keydown events send no further verdicts;
the remaining record stays snoozed in the shelf and the API. Navigation keys may still repeat.

## TWL-26

Priority: **P1**.

Given: `small` with a snoozed record. Replay it, save a note in Triage, leave the round and edit
that note in Twelves. Replaying again shows the latest note, including in the note editor.
