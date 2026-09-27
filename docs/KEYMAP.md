# Keymap (spec for the UI session)

All keys are single presses without modifiers unless stated. Every action shows its key on screen.

## Player

| key       | action                                               |
| --------- | ---------------------------------------------------- |
| `Space`   | play / pause                                         |
| `J` / `K` | next / previous track (video) of the current release |
| `←` / `→` | seek -/+ `player.seekStepSeconds` (default 10 s)     |
| `1` … `9` | jump to 10% … 90% of the video                       |
| `O`       | open the release on discogs.com                      |
| `?`       | show this help                                       |

## Verdicts (one per release, undoable)

| key | status      | copy                                                                               |
| --- | ----------- | ---------------------------------------------------------------------------------- |
| `R` | `rejected`  | "skip"                                                                             |
| `A` | `accepted`  | "wheel up" (session 3 pushes it to the Discogs wantlist)                           |
| `M` | `maybe`     | "maybe"                                                                            |
| `C` | `candidate` | "bo!" (possible match for the ID hunt)                                             |
| `N` | none        | next release without a verdict (the release stays in the queue)                    |
| `Z` | undo        | reverts the last verdict (`DELETE /api/verdicts/:key`) and returns to that release |

Counter copy reads "4,312 rinsed".

## Track marks (optional, per track)

| key       | mark                        |
| --------- | --------------------------- |
| `Shift+K` | `keep` on the current track |
| `Shift+M` | `meh`                       |
| `Shift+C` | `candidate`                 |

## Player behaviours

- Start each video at `player.startAtFraction` (default 0.5) of `videos.duration_seconds`, falling
  back to the player's reported duration when unknown.
- Preload the next release in a hidden second player so `N` and verdict keys are instant.
- Post to `POST /api/listen-log` when a track has played for a few seconds and on leaving it, so
  `heard_tracks` accumulates and the same tune is greyed out elsewhere.
- Grey out tracks whose `heard` flag is set; skip them by default when auto-advancing with `J`.
- `no_audio` state for releases without embeddable videos: show the facts, offer `S` to open a
  YouTube search (`youtubeSearchUrl(artist + title)`), and let `R`/`A`/`M`/`C`/`N` work as usual.
  A dedicated key records `no_audio` so the release leaves the queue without a judgement.
