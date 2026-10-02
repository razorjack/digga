# Sandbox

Read this when working on sandbox coverage. Follow the [E2E rules](../../E2E_TESTING.md#rules-for-agents-writing-e2e-tests)
and [authoring guidance](../AUTHORING.md). [Scenario conventions and other families](README.md).

## SBX-01

Priority: **P0**.

Given: `small-account` with a saved token.

With the sandbox on, verdicts, marks, notes, listens, `A` and `Z` send no request to
`/api/verdicts`, `/api/track-verdicts`, `/api/listen-log` or `/api/discogs/wantlist`, and the fake
Discogs gets no `PUT` or `DELETE`; the slips say "Sandbox: nothing was saved.", and `A` ends with
"Added to your wantlist (sandbox: nothing sent).", after which the logs are read

## SBX-02

Priority: **P1**.

Sandbox verdicts show in Twelves and the counts; a reload drops them

## SBX-03

Priority: **P1**.

Turning the sandbox off: the next verdict is saved; the sandbox's verdicts and undo history are
gone; turning it on again starts an empty sandbox

## SBX-04

Priority: **P1**.

Given: `small-account` with a saved token.

A want given in the sandbox with the clock paused, then the sandbox turned off before the sandbox
push's 350 ms: after `runFor(1000)` the page sends no wantlist request and no `PUT` reaches the fake
(decision 55); the live queue offers the record again, which has no verdict

## SBX-05

Priority: **P1**.

Given: `small` with the username `dj` and a saved token.

Setup work is real in the sandbox: a collection import fills the Owned shelf, which a reload keeps;
`P` reaches the fake

## SBX-06

Priority: **P2**.

The Maybe list import in the sandbox reads the real list and keeps its maybes in the tab

## SBX-07

Priority: **P1**.

Given: `small-account` with a saved token.

A want given live is pushed at once (`POST /api/discogs/wantlist/:id` answered); the sandbox turned
on afterwards leaves the verdict saved (export), the fake has the `PUT`, and Twelves reads
"Everything here is on your Discogs wantlist."

## Completion contracts

- The sandbox sends no verdict request. Its helpers wait for the record to change and the slip to
  settle, and a sandbox want ends when the slip reads "Added to your wantlist (sandbox: nothing
  sent).", after a real `GET /api/releases/:id` and the sandbox's 350 ms delay.

- A negative check after a sandbox push that a mode switch interrupted (SBX-04) runs the clock
  past the push's 350 ms, then waits for the answer to a later request, the `GET /api/queue` that
  `T` sends. Playwright delivers the browser's events in order, so a request that the push's end
  started is in the page's log by then.
