# Triage [`small`]

Read this when working on triage coverage. Follow the [E2E rules](../../E2E_TESTING.md#rules-for-agents-writing-e2e-tests)
and [authoring guidance](../AUTHORING.md). [Scenario conventions and other families](README.md).

`small` has no Discogs account, so an `A` or `C` there pushes at once and the server
answers `400` ("Set your Discogs username in Settings first"). Tests on `small` judge without
them; scenarios with pushes use `small-account` with a saved token.

## TRI-01

Priority: **P1**.

The first record in label-sweep order shows its facts (catalogue number, label, artist heading,
title, year and country, format, styles), a tracklist with each track's video state, and "Up next".
While the player waits for Space, the first track is current (`aria-current`) and its hidden text
says "cued", without the ▶ glyph; once Space plays it, it reads "▶" and "playing"

## TRI-02

Priority: **P0**.

Before a key press the player shows the Space key cap and "start listening" (status "waiting for
Space"); Space plays with sound at `startAtFraction` of the video (the cued `startSeconds`); the
now-playing line and "playing" follow

## TRI-03

Priority: **P1**.

Space pauses and resumes; `←` and `→` seek by the saved seek step; `1` to `9` jump; the position
slider follows

## TRI-04

Priority: **P1**.

`J` and `K` change track; `J` skips heard tunes and refused videos and falls back to heard ones; `K`
skips refused videos but not heard ones; a video's end advances; `J` on the last track says "That
was the last track. Judge it."; after the last video ends, "end of the tracks"

## TRI-05

Priority: **P1**.

The next release's first video and the track `J` moves to are loaded muted on the hidden decks;
after a verdict the next release plays without a new load (fake `loads()`); "Up next" reads
"buffered, starts at once"

## TRI-06

Priority: **P1**.

After `runFor(4500)` of playback a listen is posted (awaited); once `J` moves on, the track reads
"played"; 2 s of the next track are posted as not heard when a verdict leaves it, and that tune
stays unheard; the same tune on another release reads "heard". The posted listen preserves the
playing tune, playback ID and sampled video offsets.

## TRI-07

Priority: **P0**.

Given: `small-account` with a saved token.

`R`, `A`, `C`, `L` and `D`, each judged and settled: the slip's stamp (`STATUS_COPY`), the record
leaves, dug and "this session" count up; the pushes for `A` and `C` end "Added to your Discogs
wantlist."; after a reload `/api/export/decisions.json` holds all five; `A`, `C`, `L` and `D` are on
their shelves; `R` is on none

## TRI-08

Priority: **P1**.

`M` without a Maybe list shows the flash that points to Settings and writes nothing; with a list,
`M` saves `maybe`, and the verdict bar offers it

## TRI-09

Priority: **P1**.

`N` passes: slip "later"; the record returns after the queue; the end screen offers "go round the N
you passed", and its headline says every release has a verdict "apart from the N you passed"

## TRI-10

Priority: **P0**.

`Z` walks back a verdict, `N` and `X` one step per press and returns to each record; slip "undone";
after the `DELETE` answers, the export no longer holds the verdict

## TRI-11

Priority: **P1**.

A held verdict key (`keyboard.down` twice, then `up`) judges one record

## TRI-12

Priority: **P0**.

Given: `small-account` with a saved token.

`E` gives the record a note, then `A` with the push held at the fake: the slip reads "Adding to your
Discogs wantlist…", then, released, "Added to your Discogs wantlist."; the fake got `PUT
/users/dj/wants/{id}` with the note. A plain `A` sends no body

## TRI-13

Priority: **P0**.

Given: `small-account` with a saved token.

With the clock paused, `A` ends with "Added to your Discogs wantlist.", since no timer stands
between the saved verdict and the push; `Z` then sends `DELETE /api/discogs/wantlist/:id`. The fake
got one `PUT` and one `DELETE`

## TRI-14

Priority: **P1**.

Given: `small-account` with a saved token.

`C` pushes like `A`; the note sent lists the grail and keep tracks and the record's note (decision 70)

## TRI-15

Priority: **P1**.

Given: `small-account` with a saved token, the clock paused.

The fake fails four `PUT`s (`500`, the page's `502` declared): the slip reads "trying again in 5
s.", "in 30 s." and "in 2 min." as each wait runs out, then "Saved, but not on the Discogs
wantlist.", and the message names the record; Twelves marks it

## TRI-16

Priority: **P2**.

Given: `small` with the username `dj`, which holds no Discogs data, and the clock paused before
the verdict.

Saving `e2e-token-other` says "Token saved.", keeps the username `dj`, and Settings' token status
shows the mismatch as a problem ("The token belongs to other, not dj."); a push then fails at once:
the fake answers the one `PUT` `403`, the page gets Discogs' `403` (declared), and the message says
Discogs answered `403` and to check the token. With the clock run past every retry delay, the page
sent no second push and the fake received no second `PUT`. On `small-account`, which holds `dj`'s
Discogs data, the server refuses another account's token instead (decision 138, SET-22)

## TRI-17

Priority: **P1**.

`E`: the note field takes focus with the saved text; Enter keeps it; Esc cancels; the note survives
`N` and `Z`; the verdict saves it (Twelves shows it)

## TRI-18

Priority: **P1**.

`Shift+K`, `Shift+M`, `Shift+C` mark the playing track (its mark stamp, then the `POST
/api/track-verdicts` awaited, since the stamp shows first), with the playing video and its second;
the same key again clears it; with nothing playing a flash explains; keep and grail marks reach the
Tracks shelf, meh does not

## TRI-19

Priority: **P1**.

`X` hides the record's first label: after the settings save and the queue's reload have answered,
its records are out of the queue, Settings lists the label, the slip says so; `Z` brings the label
back

## TRI-20

Priority: **P1**.

`F`: the dialog lists the record's labels and artists, track artists included, and "Added by the
last dump load"; Enter digs the first label; the banner counts what is left; only that label's
records come; Esc returns to the whole queue

## TRI-21

Priority: **P1**.

`F` search: two letters list matches with record counts; `↓` moves to the options; a seller read in
Settings comes first; no match says so; one Esc closes the picker while the search field holds text,
and it opens again empty

## TRI-22

Priority: **P2**.

Given: `labels: Rollers Archive, Tempest Audio`.

A scope dug to the end with one of its records passed: "Nothing is left to dig from the label …"
and "go round the 1 you passed", which brings the record back under the scope's banner; Esc returns
to the whole queue, which starts from that record again, since a pass belongs to the queue it was
made in

## TRI-23

Priority: **P1**.

`P`: "asking Discogs…" with `aria-busy`, then price, for sale, want and have, the rating,
"checked just now"; the fake got `GET /releases/{id}?curr_abbr=EUR`. Its answer also lists the
video Discogs has for the first record's track C since the dump (`laterVideos`), and the open
record takes it: the player, on track A and waiting for Space, moves to C and plays that video, as
it plays a pasted one, with `P` as the gesture. `tests/session.test.ts` covers which parts of the
loaded record the answer replaces; this row checks that its videos reach the tracklist and the
player

## TRI-24

Priority: **P2**.

`P` for a release Discogs no longer has (fake `404`): the page gets `502` (declared) and the flash
says "The price did not load: Discogs did not return the release"; the line keeps no market data,
and the tracklist and the release's videos stay as the dump had them, where a `P` that succeeds
adds the video Discogs has since the dump (TRI-23)

## TRI-25

Priority: **P1**.

`O` opens `discogs.com/release/{id}` and `S` a YouTube search for artist and title
(`expectExternalOpen`)

## TRI-26

Priority: **P1**.

`app.paste()` of a YouTube link: the server stores it, oEmbed's title matches a track, which plays;
an unmatched link plays under "Other videos" (`data-video-id`); other text and a paste inside the
note field attach nothing

## TRI-27

Priority: **P1**.

A release without videos: "No videos on this release." with `S`, `⌘V` and `D`; verdict keys still
work

## TRI-28

Priority: **P1**.

Refused videos: the playing video, refused with `app.youtube.fail(id, 150)`, is skipped with the
notice "… won't play here: the uploader blocks embedding. Skipped." (the hidden decks find a refused
catalogue video first, silently; see [The fake YouTube IFrame
API](../FIXTURES.md#the-fake-youtube-iframe-api)); a release whose only video is refused shows "Its
only video won't play here.", and one whose several videos all are "None of its N videos will play
here."; `embed="false"` videos show "no embed" and are never loaded

## TRI-29

Priority: **P2**.

Given: `labels: Echo Chamber`.

`D`, then a link pasted on Twelves' No audio shelf deletes the verdict (export), the record
leaves the shelf, and Triage, shown again with `T`, offers it without a reload (the header still
counts the session's verdict), after the record on screen when it sorts earlier (TRI-44)

## TRI-30

Priority: **P1**.

The end of the queue: "all dug"; "hear the N snoozed again" starts a round with its banner; a
verdict replaces a snooze, `N` leaves it, Esc returns

## TRI-31

Priority: **P2**.

No releases loaded: a fresh library (`newLibrary("empty")`), where `digga dump load` of a dump
without releases finishes having kept nothing, then `relaunch({ library })`: "No releases loaded
yet." and the settings button (`,`), which opens Settings on the Library tab

## TRI-32

Priority: **P1**.

Filters that match nothing: "Your filters match no records." with the loaded count

## TRI-33

Priority: **P1**.

The release detail request fails once (`route` abort): "The tracklist did not load"; Enter retries

## TRI-34

Priority: **P1**.

`queue.limit: 5`: digging past the batch loads the next one without a gap

## TRI-35

Priority: **P2**.

Given: `labels: Rollers Archive, Tempest Audio`.

In the label's `F` scope, a settings save (the seek step, on the Digging tab, through the save bar)
restarts the queue: its `GET /api/queue` carries the scope, and Triage shows the scope's record
under its banner. An Appearance radio on the General tab, which saves at once without the save bar,
restarts nothing: the record on screen stays, and the only queue read after it is `T`'s

## TRI-36

Priority: **P1**.

Leaving Triage pauses the sound (fake `audible()` is null); a listen past 4 s with at least 1 s more
is posted on leaving, a shorter remainder is not; returning keeps the record and the undo history

## TRI-37

Priority: **P2**.

Given: `labels: Transit Audio`, releases without videos skipped.

Pooled videos (decision 72): the main release, which has no video, passes the filter on its
repress's video and plays that video on its own track, A, where the repress has it at A1; a keep
mark goes on the main release's track with that video

## TRI-38

Priority: **P2**.

Given: `labels: White Label`, the label of dj's want that no dump has.

Undated records on a wanted label reach the queue under the default filters (decision 91): on
`small-account` Triage shows the undated record ("year unknown"), and its verdict ends the queue;
on `small`, which wants nothing, the label has nothing to dig ("Your filters match no records.").
The catalogue puts the record in a default style, since `small` is loaded before the account's
wants are imported

## TRI-39

Priority: **P1**.

Given: `small-account` with a saved token.

A push held at the fake, and `Z` while it is in flight: once the fake has received the `PUT`, `Z`;
after the undo has settled, the push is released; the fake then gets the `DELETE`, and the release
ends off the wantlist

## TRI-40

Priority: **P1**.

A seller's shop [`small-account` with a saved token, `shopkeeper` read]: `F` digs the seller; the
record shows the seller's copy, priced and graded, with its comment; `A` on the record puts the
seller's pressing on the wantlist (the fake's `PUT` names that release id, not the main release's)

## TRI-41

Priority: **P2**.

Given: the clock paused.

Held `→` (`keyboard.down` three times) seeks three steps, once per repeat, while a held verdict key
still judges once

## TRI-42

Priority: **P1**.

Given: `small-account` with a saved token.

Digging ten records sends no request to the fake Discogs; the first comes with `P`

## TRI-43

Priority: **P2**.

Given: the clock paused before `K`.

A video the app loads to play while the page has activation stays unstarted
(`app.youtube.blockSound()` after Space and `J`, then `K`): the player reads "cueing up" after
`runFor(3000)` and "waiting for Space" after 750 ms more

## TRI-44

Priority: **P1**.

Given: `labels: Echo Chamber`.

A record judged `D` in Triage, then given a link on Twelves' No audio shelf; `T`: the record on
screen stays, "Up next" names the record, and the next verdict shows it, with the pasted video on
its track. Again with the `D` given before the app opened on Twelves, after Triage has read its
queue: `T` reads it again (decision 112)

## TRI-45

Priority: **P1**.

Given: `small-account` with a saved token, the clock paused.

The fake fails one `PUT`: the slip reads "Not on your Discogs wantlist yet; trying again in 5 s.";
after `runFor(5000)` the second `PUT` lands, the slip reads "Added to your Discogs wantlist." and no
message shows

## Completion contracts

- A want, with time flowing: after the verdict, wait for "Added to your Discogs wantlist.", which
  shows only after `POST /api/discogs/wantlist/:id` has answered, then read the fake's log. The
  app's request answers only after the server's call to the fake has completed, however long the
  server's 1.1 s throttle held it.

- `Z` while a push is on its way (TRI-39): hold `PUT /users/:user/wants/:id` at the fake before
  `A`, await the hold's `received`, press `Z` and wait until the undo has settled, then release
  the hold and wait for the answer to `DELETE /api/discogs/wantlist/:id`, which the session sends
  once the push has answered. A pending slip is read the same way (TRI-12).

- A failed push is tried again on a browser timer (TRI-15, TRI-45). With the clock paused before
  the verdict, the slip reads "trying again in 5 s." once the session has armed the wait, so the
  test waits for that text and then runs the clock by the wait, one try at a time. Running the
  clock in fixed steps instead overshoots the last try and fires the timer that clears the
  message the test reads.

- A track mark's stamp shows before its `POST /api/track-verdicts`, and a listen is a
  `POST /api/listen-log` with nothing on screen until the track is left ("played"). The page
  object's `markTrack()`, `listenFor()` and `listenLoggedBy()` wait for those requests and return
  the body the page sent.

- Triage's other actions end the same way. A push with time flowing ends once
  `POST /api/discogs/wantlist/:id` has answered, which happens after the server's call to the
  fake, and the slip shows how it ended. `P` ends once `POST /api/releases/:id/enrich` has
  answered and the market line is no longer `aria-busy`. `X` and `Z` on a label end once
  `PUT /api/settings` and the `GET /api/queue` after it have answered. `F`'s search ends once the
  `GET /api/scopes` for the typed text has answered and the status no longer reads "Searching…";
  Enter in the picker ends once the `GET /api/queue` with that `scope` has answered, and Esc on a
  scope once the one without it has. A tracklist's retry ends with its `GET /api/releases/:id`.
  `T` from another page ends once the `GET /api/queue` that Triage sends when it is shown has
  answered (`showAgain()`).

## TRI-46

Priority: **P1**.

`E`, a note and Enter save it without a verdict. After the saved status and a reload, the note
is visible on the same record and the release API still has no verdict.

### TRI-47: Playback and history controls (P1)

A library without `seen` verdicts has no "records opened before" control in Settings' Skip group,
once the header's counter shows that the stats have loaded; "tunes heard before" is there. The
browser history import that wrote `seen` verdicts is gone (decision 171), so only a library from
before it shows the control.

Seed a history verdict and a heard tune. Disable both skip controls in Settings and save. Triage
includes the record and starts on the heard first track. Judge and undo it; the saved verdict is
`seen` again.
