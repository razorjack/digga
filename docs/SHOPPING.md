# Shopping from one seller

Open **Shop** (`H`) from the toolbar, **Shop my wants** from Twelves, or the shopping link in a
seller's Triage scope. Choose a previously imported seller or enter a Discogs username and read
their shop. **Refresh my wantlist** imports the connected account's current wants.

The first pass contains unreviewed copies of the exact releases on that wantlist. It includes
records already judged and records outside the digging filters. Two copies of one release are
separate choices because their price, grading and comments can differ. The selected copy's asking
price and currency, media and sleeve grades, comment and listing link appear beside the player.

`A` shortlists the copy and advances; `R` skips it for shopping. Neither changes the Discogs
wantlist or the record's Triage verdict. Every decision saves before advancing. `Z` undoes a
decision during the current visit. **Skipped** keeps passed copies available for reconsideration.

In **Shortlist**, `A` keeps the selected copy and advances, while `R` removes it. Keeping every
copy completes the listening pass without emptying the shortlist. Select a copy to hear it again,
or use **Review shortlist** to start another pass. Selections survive leaving the page and
restarting Digga; the current listening position and the undo history do not.

The subtotal counts available copies with known prices, separately for each currency. Missing
prices and unavailable copies are explicitly excluded. Shipping and taxes are confirmed on
Discogs. Open each chosen listing to add it to the actual Discogs cart and complete the purchase.
Digga's shortlist is local and does not reserve a copy or synchronize a cart.

**Refresh shop** runs the existing seller import and preserves shopping decisions. Changed prices
are flagged against the last decision. Missing selected copies remain visible as no longer listed;
if the inventory is incomplete, their availability is unknown. Digga reads at most 10,000 listings
from another seller and displays the total so a partial intersection is never presented as complete.

## Implementation

- `src/server/queue/shopping.ts` joins active wantlist memberships to seller listings by release ID.
  Saved decisions are independent of the inventory rows that the importer replaces.
- Migration 25 creates `shopping_decisions`, keyed by seller and listing, with a saved copy/release
  snapshot and timestamp. A pending row records an undo so an older backup cannot resurrect it.
- `GET /api/shopping` lists saved sellers and counts. `GET /api/shopping/:seller` returns the
  matching copies and saved decisions. `PUT /api/shopping/:seller/:listing` validates and saves
  the shopping state. The server captures the snapshot; the client cannot choose its price or seller.
- `src/client/shopping/` owns asynchronous reads, import polling and ordered writes. The page
  reuses `TriagePlayer`, `PlayerPanel` and `Tracklist`; shopping playback does not skip heard tunes.
- Portable decisions backups include `shoppingDecision` records. Restore keeps newer decisions
  and creates unread seller placeholders, so restored snapshots never claim current availability.

SQL matching, refreshes, totals, restore and asynchronous failure/order behavior have unit tests.
The [shopping E2E scenarios](e2e/scenarios/shopping.md) cover discovery, both passes, persistence,
keyboard playback, accessibility and failed writes on web and Electron.
