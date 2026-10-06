# Persistence and lifecycle

Read this when working on persistence and lifecycle coverage. Follow the [E2E rules](../../E2E_TESTING.md#rules-for-agents-writing-e2e-tests)
and [authoring guidance](../AUTHORING.md). [Scenario conventions and other families](README.md).

## PER-01

Priority: **P0**.

A live snooze (`L`) with a note (`E`), and a keep mark on a track (`Shift+K`, its `POST
/api/track-verdicts` awaited), survive a reload and a `relaunch()`

## PER-02

Priority: **P2**.

After further changes, `digga backup` writes today's decisions; `digga restore` of that file into a
fresh `small` library brings the verdicts back into Twelves. Given two verdicts and a keep mark,
the changes are a note and a re-judgement in Twelves; `/api/backups` then lists the day's decisions
backup, and after `relaunch({ library })` on the fresh library its Snoozed shelf holds both records,
the note included, and its Tracks shelf the mark. The test waits for the database copy the server's
start writes before `digga backup`, which writes the day's copy to the same path

## PER-03

Priority: **P2**.

Given: `small` with the username `dj` and a saved token.

`relaunch({ crash: true })` during an import marks the job failed as interrupted; a graceful
`relaunch()` during one records it cancelled once its page in flight has returned; Settings shows
each. The collection import's page is held at the fake. The graceful stop aborts the job and then
waits for that page, so the test releases it once the stopping server has logged the abort, while
`relaunch()` is still pending; the job's row then reads cancelled, after one page request

## PER-04

Priority: **P0**.

Given: `small-account` with a saved token.

The server does not take a want (`route` aborts `POST /api/verdicts` once): "The verdict was not
saved: …", the record comes back, and nothing has reached the fake Discogs; the same key again saves
it and pushes it

## PER-05

Priority: **P1**.

`restartServer()` in the middle of a session, once the verdict's stats refresh has answered: the
open page keeps its record, slip and session count without a reload, and the next verdict is saved
(**web**)

## Completion contracts

- Nothing pushed (PER-04): the verdict's request fails, so the session never starts a push.
  Check that the page sent no request to `/api/discogs/` (`app.apiRequests()`), then that the fake
  received nothing after the mark the test took before the key. The saved token's given state has
  already asked the fake for `/oauth/identity` before the page opened, so its log is not empty
  from the start. The server calls Discogs only when the page asks, so the page's log decides,
  and the fake's log confirms.

## PER-09

Priority: **P1**.

Pass a record, pause on the next, seek, and let the five-second checkpoint save. Reload and choose
Resume session. The same upload is cued at the saved second with playback paused. Pass it and go
round the saved passes; the first record is still there.

## PER-10

Priority: **P2**.

Two pages of the app on one server (`app.openPage()`, decision 139). In the first, Triage snoozes
the record on screen; in the second, Twelves re-judges it a skip. `Z` in the first then sends
`DELETE /api/verdicts/:key` with the snooze it expects; the server answers `409` (declared), the
messages read "Undo failed: The record's verdict changed since this page read it, in another tab or
by a load; reload to see it", the slip is no longer busy, the record stays off the screen, and the
export keeps the skip. Again from a given snooze on Twelves' Snoozed shelf in both pages: the second
re-judges it a skip, and `D` in the first, which still shows the snooze, is refused the same way
("Not saved: …"); the shelf loads again without the record. Vitest covers the server's comparison
and each page's handling of a `409` with a fake api (`server.test.ts`, `session.test.ts`,
`twelves.test.ts`); this row checks that the verdict each page expects survives the query string
or the JSON body to the server's comparison, and what each page then shows

## PER-11

Priority: **P2**.

One process owns a library (decision 129). While the server runs, `digga stats` and `digga backup`
run beside it and exit 0, and `digga restore` of the decisions backup just written exits 1 with
"digga: The library is in use by the Digga server (process N, since …). Stop it first."; after
`relaunch({ crash: true })`, which leaves the lock file behind, the next server starts, and the
same refusal names its process instead. The test waits for the database copy the server's start
writes before `digga backup` (PER-02). `tests/library-lock.test.ts` covers the lock itself: a
second holder refused, a lock of an ended process or an empty one taken over, and a second server
kept off before it fails the first one's running jobs. This row checks which commands take the
lock, how the CLI reports a refusal, and a lock that a killed server process really left
