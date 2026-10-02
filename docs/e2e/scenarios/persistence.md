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

`relaunch({ crash: true })` during an import marks the job failed as interrupted; a graceful
`relaunch()` during one records it cancelled once its page in flight has returned; Settings shows
each

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
