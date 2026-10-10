# Keymap

All keys are single presses without modifiers unless stated. Every action shows its key on screen,
and `?` lists the keys of the current page. The definitions live in `src/client/keymap.ts`; the
handlers are in `src/client/pages/Triage.svelte`, `Twelves.svelte` and `App.svelte`. Keys are
ignored while a text field has focus, while the `?` overlay is open, and when held with Cmd, Ctrl
or Alt. A letter held with Shift runs no letter shortcut; only the track marks below use Shift. Keys
that are not letters (`/`, `,`, the digits, Enter, the arrows) work with or without Shift, since some
layouts need Shift to type them. Holding a key down never repeats a verdict.

## Pages (everywhere)

| key | action                 |
| --- | ---------------------- |
| `T` | triage                 |
| `W` | twelves                |
| `,` | settings               |
| `?` | show or hide the keys  |
| Esc | close the keys overlay |

In the desktop app the View menu also has Triage (`Cmd+1`), Twelves (`Cmd+2`) and Keys (`Cmd+/`),
and the application menu Settings… (`Cmd+,`); elsewhere `Ctrl` takes the place of `Cmd`. The menu
leaves the single keys to the page, since an accelerator without a modifier would take the key
from text fields.

## Triage: player

| key       | action                                                               |
| --------- | -------------------------------------------------------------------- |
| `Space`   | play / pause (also starts sound the first time, see below)           |
| `J` / `K` | next / previous track (video) of the current release                 |
| `←` / `→` | seek -/+ `player.seekStepSeconds` (default 10 s); repeats while held |
| `1` … `9` | jump to 10% … 90% of the video; a paused video stays paused          |
| `O`       | open the release on discogs.com                                      |
| `P`       | ask Discogs for the price, copies for sale, have/want and videos     |
| `S`       | open a YouTube search for artist + title                             |
| `E`       | write a note on the record; Enter saves it without a verdict         |
| `⌘V`      | attach a copied YouTube link to the release and play it              |
| `Enter`   | retry when the settings, the queue or the release failed to load     |

`P` asks Discogs once for the record on screen and shows the answer with its age ("checked 3
days ago"); pressing it again refreshes it. Digga asks for nothing ahead, so the records you skip
cost Discogs no requests. Videos Discogs has since the dump join the tracklist, and the player
goes on as it was, playing or waiting for Space; only on a record with nothing playable does the
first of them play at once, as a pasted link does.

## Triage: verdicts (one per release, undoable)

| key | status      | copy         | notes                                                             |
| --- | ----------- | ------------ | ----------------------------------------------------------------- |
| `R` | `rejected`  | "skip"       |                                                                   |
| `A` | `accepted`  | "want"       | pushes to the Discogs wantlist at once; `Z` takes it off again    |
| `M` | `maybe`     | "maybe"      | for your Discogs Maybe list; offered once the list is chosen      |
| `C` | `candidate` | "grail"      | the one you've been hunting; onto the wantlist like `A`           |
| `L` | `snoozed`   | "snooze"     | off the queue, to hear again later (Snoozed shelf)                |
| `D` | `no_audio`  | "no audio"   | leaves the queue without a judgement                              |
| `N` | none        | "next"       | moves on; the release stays in the queue and comes back later     |
| `X` | none        | "hide label" | leaves every record on the release's first label out of the queue |
| `F` | none        | "dig"        | narrows the queue to one label, artist or seller                  |
| `Z` | undo        |              | reverts the last verdict, `N` or `X` and returns to that release  |
| Esc | none        |              | ends a round of snoozed records, then the label, artist or seller |

`X` adds the release's first label, by its Discogs id, to `filters.excludeLabels` and saves the
settings, so the queue restarts without that label's records; `Z` takes the label out of the list
again. Hidden `Not On Label` also covers the self-releases, such as
`Not On Label (Artist Self-released)`, which have ids of their own (decision 134).

`F` opens a picker with the labels and artists of the record on screen, the artists of its tracks
included, then the records the last dump load added that are still to dig, and a search field for
any label or artist that has loaded records, and for any seller whose shop was read (Settings, Discogs,
"Seller shop", or `digga import seller <username>`). `↓` moves from the field to the options, the
arrows choose, Enter digs and Esc cancels, also while the field holds text. The queue then holds
only the records on that label (on any of their labels), by that artist (on the release or on one of
its tracks) or in that seller's shop, still under the filters and in the chosen order, and a banner
counts what is left. Among matching pressings, Digga prefers vinyl without the White Label or Test Pressing format
descriptions, then the Discogs main release, then the pressing with most videos. Promos remain
eligible. This preference never excludes a record by itself. In a shop the record shown is the pressing the seller has, so `A` puts that
pressing on the wantlist, and Discogs' "Shop my wants" finds it there. Esc goes back to the whole
queue. Records passed with `N` return to whichever queue comes next.

A want or grail that does not reach Discogs, because the network or Discogs failed, is tried
again after 5 s, 30 s and 2 min, and the slip says when; after the last try it stays a want in
Digga, and Twelves marks it for `A` or "add all". A push Discogs refuses for its token (`401` or
`403`) is not tried again: the message says to check the token at once.

`Z` walks back through the whole session, one step per press. A verdict is undone with
`DELETE /api/verdicts/:key` (in a round of snoozed records, by restoring the snooze); an `N` is
undone locally. The undo names the verdict it saved, and the server refuses it when the record was
decided again since, in another tab or by a load; the slip says so and the step is gone. Undoing a want or grail that already reached the Discogs wantlist takes it off again. The
counter reads "4,312 dug", where dug counts every record judged in Digga (source `triage` or
`manual`), whatever the Discogs account holds of it, and never a record only an import brought.

A round of snoozed records starts from Twelves (`Enter` on a snoozed record) or from the end of
the queue. The records come before the queue: a verdict replaces the snooze, `N` leaves it, and
the queue resumes where it was after the last one.

The Discogs API cannot add to lists, so `M` only records the verdict. Twelves marks maybes that are
not on the Discogs list yet; after adding them there by hand, `I` in Twelves (or the Maybe list
import) reads the list again and clears the marks.

## Triage: track marks (optional, on the playing track)

| key       | mark        |
| --------- | ----------- |
| `Shift+K` | `keep`      |
| `Shift+M` | `meh`       |
| `Shift+C` | `candidate` |

Pressing the same mark again clears it. A mark keeps the tune and the second of the video it was
set at, so the moment it is about can be found again. A video that is not matched to a track, such
as one under Other videos, cannot be marked, and the page says so.

## Twelves

| key                         | action                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `1` … `9`                   | shelf: everything, want, Discogs wantlist, owned, maybe, grail, snoozed, tracks, no audio |
| `J` / `K`, `↓` / `↑`        | move the selection, across pages                                                          |
| `←` / `→`                   | previous / next page; a page holds 500 records                                            |
| `S`                         | next sort order (newest, label, artist, year, price, want)                                |
| `/`                         | focus the filter; Enter or Esc leaves it                                                  |
| `O`                         | open the release on discogs.com                                                           |
| `E`                         | edit the note (of the record, or of the track on Tracks); Enter saves                     |
| `A` `M` `C` `R` `L` `D`     | re-judge a triage verdict (`R` takes it off the shelves, `D` means no audio)              |
| `Y`                         | search YouTube for the record                                                             |
| `⌘V`                        | attach a copied YouTube link to the record; no audio goes back to the queue               |
| `A` / `C` on a want / grail | add it to the Discogs wantlist when it is not there                                       |
| `Enter`                     | hear the selected snoozed record, and those after it, in Triage                           |
| `I`                         | read the Discogs Maybe list again                                                         |
| `Z`                         | undo the last change, including what it did to the Discogs wantlist                       |

The Tracks shelf lists the tracks marked grail or keep in Triage, with their release and the
record's verdict; `J`/`K`, `O`, `E`, `/` and `S` work there too. Marks themselves change in Triage.

Records only the Discogs account holds (on the wantlist, owned, on the Maybe list) were not
decided in Digga and cannot be re-judged here; Triage can judge them when it plays them. A record
can be on several shelves: a pushed want is on Want and on Discogs wantlist, and owning one takes
it off Want and Grail. Re-judging a record as
want or grail adds it to the Discogs wantlist; re-judging a want or grail as anything else takes it
off, and switching between want and grail leaves it there.

## Setup

`Enter` takes each step's main action when no field has focus: fetch the catalogue, continue, fill
the crate. In "Find a style", `Enter` picks the first match. On the load's screen, `T` or `Enter`
starts digging once 500 records wait. The page keys stay quiet until the load starts, or until a
load that stopped has left records to dig.

## Settings

Esc goes back to the page Settings was opened from, Triage or Twelves, unless a text field has
focus. Leaving Settings with unsaved changes, by Esc, `T`, `W`, a toolbar link or Back, first asks
whether to save them: Save, Discard or Keep editing, which Esc also chooses. `Cmd+S` / `Ctrl+S` saves. Fields are reached with Tab. Page keys keep working while a checkbox,
radio button or slider has focus; text fields and menus take the keys for themselves.

## Player behaviours

- Each video starts at `player.startAtFraction` (default 0.5) of `videos.duration_seconds`, or
  of the player's reported duration when the dump has none, and at least 5 s before the end.
- A hidden second player loads the next release's first video muted and pauses at its start
  offset, so a verdict or `N` starts the next release at once. A third one does the same for the
  track `J` moves to, so `J` and auto-advance start the next track at once.
- A release opens on its first video whose tune was not heard before (on any release). `J` and
  auto-advance at the end of a video skip heard tunes, videos that failed, and second uploads of a
  track already played; `J` falls back to heard tunes when nothing else is left. `K` never skips
  heard tunes.
- `POST /api/listen-log` is sent after 4 s of playback and again, with the remaining seconds,
  when the listener leaves the track. The track then counts as heard everywhere it appears. A
  shorter play is sent when the listener leaves it, as not heard: the log keeps it, and the tune
  stays unheard.
- Videos with `embeddable = 0` are left out of the playlist, and the tracklist marks their track
  "no embed". Videos YouTube refuses (error 100, 101, 150) are skipped with a notice. When
  nothing on a release plays, the player shows the `no_audio` state: `S`
  searches YouTube, `⌘V` with a copied video link attaches it and plays it, `D` records
  `no_audio`, and the verdict keys still work. A pasted link works on any release, not only in
  that state. YouTube Music links work too; a pasted link to another site says "That is not a
  YouTube link." and attaches nothing, and one to a video the release has says "Already attached
  to this release."
- Browsers hold back sound until the page has had a key press or click. Until then the player
  shows "Space: start listening".
- The embed never takes focus or clicks (`inert` hosts, `controls: 0`, `disablekb: 1`), so keys
  always reach Digga.

Settings has independent controls for skipping records imported from browser history and skipping
previously heard tunes during playback. Both are on by default. Digga no longer reads browser
history (decision 171), so the history control shows only for a library that kept `seen` records
from an earlier version. Turning it off returns them to the queue; undo restores that original
history verdict. The heard label
remains visible when automatic skipping is off.

Enter on any Twelves record shelf replays the visible records from the selection. Enter on Tracks
reopens the selected mark's saved upload and second, including uploads no longer in the catalogue.
N and Esc preserve saved verdicts and return to the original queue. Explicit verdict keys rejudge
local decisions; imported owned/wantlist records retain their existing protection.

On reopening Digga, Resume session restores the saved digging filters, player settings, scope,
passes, and position. Playback waits for Space. Start fresh keeps the current queue instead.
Records decided or filtered out since the checkpoint stay out of the resumed normal queue. Replay
rounds can still include decided records. Account settings are not restored by Resume.
