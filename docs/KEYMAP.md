# Keymap

All keys are single presses without modifiers unless stated. Every action shows its key on screen,
and `?` lists the keys of the current page. The definitions live in `src/client/keymap.ts`; the
handlers are in `src/client/pages/Triage.svelte`, `Twelves.svelte` and `App.svelte`. Keys are
ignored while a text field has focus, while the `?` overlay is open, and when held with Cmd, Ctrl
or Alt. Holding a key down never repeats a verdict.

## Pages (everywhere)

| key | action                 |
| --- | ---------------------- |
| `T` | triage                 |
| `W` | twelves                |
| `,` | settings               |
| `?` | show or hide the keys  |
| Esc | close the keys overlay |

## Triage: player

| key       | action                                                               |
| --------- | -------------------------------------------------------------------- |
| `Space`   | play / pause (also starts sound the first time, see below)           |
| `J` / `K` | next / previous track (video) of the current release                 |
| `←` / `→` | seek -/+ `player.seekStepSeconds` (default 10 s); repeats while held |
| `1` … `9` | jump to 10% … 90% of the video                                       |
| `O`       | open the release on discogs.com                                      |
| `S`       | open a YouTube search for artist + title                             |
| `Enter`   | retry when the queue or the release failed to load                   |

## Triage: verdicts (one per release, undoable)

| key | status      | copy       | notes                                                         |
| --- | ----------- | ---------- | ------------------------------------------------------------- |
| `R` | `rejected`  | "skip"     |                                                               |
| `A` | `accepted`  | "want"     | pushes to the Discogs wantlist after 1.5 s unless undone      |
| `M` | `maybe`     | "maybe"    | for your Discogs Maybe list; offered once the list is chosen  |
| `C` | `candidate` | "grail"    | the one you've been hunting: a top want or an ID-hunt match   |
| `L` | `snoozed`   | "snooze"   | off the queue, to hear again later (Snoozed shelf)            |
| `D` | `no_audio`  | "no audio" | leaves the queue without a judgement                          |
| `N` | none        | "next"     | moves on; the release stays in the queue and comes back later |
| `Z` | undo        |            | reverts the last verdict or `N` and returns to that release   |
| Esc | none        |            | during a round of snoozed records: back to the queue          |

`Z` walks back through the whole session, one step per press. A verdict is undone with
`DELETE /api/verdicts/:key` (in a round of snoozed records, by restoring the snooze); an `N` is
undone locally. Undoing a want that already reached the Discogs wantlist takes it off again. The
counter reads "4,312 dug", where dug counts every verdict made in Digga (source `triage` or
`manual`), not seeds.

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

Pressing the same mark again clears it.

## Twelves

| key                  | action                                                                          |
| -------------------- | ------------------------------------------------------------------------------- |
| `1` … `8`            | shelf: everything, want, Discogs wantlist, owned, maybe, grail, snoozed, tracks |
| `J` / `K`, `↓` / `↑` | move the selection                                                              |
| `S`                  | next sort order (newest, label, artist, year, price, want)                      |
| `/`                  | focus the filter; Enter or Esc leaves it                                        |
| `O`                  | open the release on discogs.com                                                 |
| `E`                  | edit the note (of the record, or of the track on Tracks); Enter saves           |
| `A` `M` `C` `R` `L`  | re-judge a triage verdict (`R` takes it off the shelves)                        |
| `A` on a want        | add it to the Discogs wantlist when it is not there (a failed push)             |
| `Enter`              | hear the selected snoozed record, and those after it, in Triage                 |
| `I`                  | read the Discogs Maybe list again                                               |
| `Z`                  | undo the last change, including what it did to the Discogs wantlist             |

The Tracks shelf lists the tracks marked grail or keep in Triage, with their release and the
record's verdict; `J`/`K`, `O`, `E`, `/` and `S` work there too. Marks themselves change in Triage.

Wantlist and owned records come from Discogs and cannot be re-judged here. Re-judging a record as
want adds it to the Discogs wantlist; re-judging a want as anything else takes it off.

## Settings

`Cmd+S` / `Ctrl+S` saves. Fields are reached with Tab. Page keys keep working while a checkbox,
radio button or slider has focus; text fields and menus take the keys for themselves.

## Player behaviours

- Each video starts at `player.startAtFraction` (default 0.5) of `videos.duration_seconds`, or
  of the player's reported duration when the dump has none, and at least 5 s before the end.
- The hidden second player loads the next release's first video muted and pauses at its start
  offset, so a verdict or `N` starts the next release at once.
- A release opens on its first video whose tune was not heard before (on any release). `J` and
  auto-advance at the end of a video skip heard tunes, videos that failed, and second uploads of a
  track already played; `J` falls back to heard tunes when nothing else is left. `K` never skips
  heard tunes.
- `POST /api/listen-log` is sent after 4 s of playback and again, with the remaining seconds,
  when the listener leaves the track. The track then counts as heard everywhere it appears.
- Videos with `embeddable = 0`, and videos YouTube refuses (error 100, 101, 150), are skipped
  with a notice. When nothing on a release plays, the player shows the `no_audio` state: `S`
  searches YouTube, `D` records `no_audio`, and the verdict keys still work.
- Browsers hold back sound until the page has had a key press or click. Until then the player
  shows "Space: start listening".
- The embed never takes focus or clicks (`inert` hosts, `controls: 0`, `disablekb: 1`), so keys
  always reach Digga.
