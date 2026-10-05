# Accessibility

Read this when working on accessibility coverage. Follow the [E2E rules](../../E2E_TESTING.md#rules-for-agents-writing-e2e-tests)
and [authoring guidance](../AUTHORING.md). [Scenario conventions and other families](README.md).

## A11Y-01

Priority: **P1**.

axe finds no serious or critical violation, and no `landmark-unique` or `page-has-heading-one`
violation, on: Triage (playing, no audio, end of queue), the Keys dialog, the scope picker, each
Twelves shelf, each Settings tab, each setup step, the crate while loading and the finished crate. The region names are asserted directly, since axe reports a dangling
`aria-labelledby` only as incomplete: Triage's Player region, its "Last action", "Up next" and
"Verdicts" groups and its two named status regions; each shelf's table; Settings' Library, Dump,
Discogs, Imports, Backups and Exports regions, each on its tab; each step's region or form, named by its
heading, and the crate's "Fill the crate", then "The catalogue is in: …".

Each state is scanned with every rule in the dark scheme the host emulates, then with
`color-contrast` alone in the light scheme. The light scan costs about as much as the full one,
so the seven record shelves after Everything, which reuse its table, are scanned in the dark
scheme only. No rule is excluded for any element

## A11Y-02

Priority: **P1**.

The player hosts are `inert`, and Tab never reaches the fake player's focusable button: a round of
Tab presses on Triage, playing the Groundwork record, never makes a player's frame the active
element. No focusable element keeps the page keys after a click: a track's button, a header link
and the verdict bar's N leave nothing focused, and K, T and N then do what they do; the position
slider takes the focus and leaves Space to the page

## A11Y-03

Priority: **P2**.

Live regions exist before their updates: the slip (which starts with its instructions), the flashes
and the header status are in the DOM before the text changes. `LiveRegionWatch` records none of a
snooze on the slip, M's message without a Maybe list in "Triage messages", "Note saved." in
Twelves, and the header's "The catalogue is in: …" after an update started in Settings (the
September dump listed, held at `part-way` until the header shows the load); the header's status is in the page, empty, from the start

## A11Y-04

Priority: **P1**.

Every route and setup step sets the document title: "Triage – Digga", "Twelves – Digga" and
"Settings – Digga" from the routes table, and "<step> – Digga setup" for each of the four steps

## A11Y-05

Priority: **P2**.

A control that a key also starts declares the key in `aria-keyshortcuts`: the scope picker's dig
button `Enter`, and the crate's Start digging `T Enter`, though its key cap shows T only

## A11Y-06

Priority: **P2**.

In a window 1,100 px wide, the header hides the ETA from sight only: it is 1 px wide, and the
banner's ARIA snapshot still has "ETA after a few verdicts"
