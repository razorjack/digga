# Shopping [`small-account`, fake Discogs token]

Follow the [E2E rules](../../E2E_TESTING.md) and [authoring guidance](../AUTHORING.md).
The product behavior is described in [Shopping](../../SHOPPING.md).

## SHOP-01

Priority: **P0**. Target: web and Electron.

Start with the imported account's wants and add the shopkeeper's pressing through the public API.
Discover **Shop my wants** in Twelves, read the seller through the visible form, and verify two
matching copies. Shortlist both, then use the second pass to keep one, remove the other and undo.
Verify the currency subtotal, accessible controls, listing handoff, and persistence after relaunch.
An axe scan covers the selected shortlist view.

## SHOP-02

Priority: **P1**. Target: web and Electron.

With the seller already read, open Shop with its toolbar key and choose the seller. Play a matched
copy with Space. Abort one shopping write: the error is visible, the copy stays selected, and the
shortlist stays unchanged. Retry successfully and verify that no Triage verdict was posted.

## SHOP-03

Priority: **P1**. Target: web and Electron.

Open the seller's wanted pressing with a track that has no cached video. Refresh audio with `P`.
The track becomes playable using the video now listed by fake Discogs; selecting it starts that
video. The selected listing and shortlist stay unchanged. The public release API retains the link.

## Completion contracts

A shopping action completes when its PUT response body finishes and Shopping review returns to
`aria-busy="false"`. A failed save leaves the current listing selected and announces the error in
the pre-existing alert. A shop read completes when the import job ends and its queue appears.
Relaunch assertions read the saved shortlist through both the UI and the public shopping API.
Audio refresh completes when its POST response finishes and the Refresh audio button returns to
`aria-busy="false"`; track playback is checked through `aria-current` and the fake player's audio.
