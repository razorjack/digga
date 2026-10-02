# Accessibility

Read this when working on accessibility coverage. Follow the [E2E rules](../../E2E_TESTING.md#rules-for-agents-writing-e2e-tests)
and [authoring guidance](../AUTHORING.md). [Scenario conventions and other families](README.md).

## A11Y-01

Priority: **P1**.

axe finds no serious or critical violation, and no `landmark-unique` or `page-has-heading-one`
violation, on: Triage (playing, no audio, end of queue), the Keys dialog, the scope picker, each
Twelves shelf, Settings, each setup step, the crate while loading, the finished crate and the
practice card. The region names are asserted directly, since axe reports a dangling
`aria-labelledby` only as incomplete

## A11Y-02

Priority: **P1**.

The player hosts are `inert`, and Tab never reaches the fake player's focusable button; no focusable
element keeps the page keys after a click

## A11Y-03

Priority: **P2**.

Live regions exist before their updates: the slip (which starts with its instructions), the flashes
and the header status are in the DOM before the text changes

## A11Y-04

Priority: **P1**.

Every route and setup step sets the document title
