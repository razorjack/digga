# First run (`#/setup`) [`empty`, fake data.discogs.com serving the bulk dump]

Read this when working on first run coverage. Follow the [E2E rules](../../E2E_TESTING.md#rules-for-agents-writing-e2e-tests)
and [authoring guidance](../AUTHORING.md). [Scenario conventions and other families](README.md).

## SETUP-01

Priority: **P0**.

The first run from the default config: fetch, connect with `e2e-token-dj`, keep the suggested
styles, fill the crate; with the transfer held at `600-to-dig` and its count shown, "Start digging" opens Triage on a
record; the first verdict is in `/api/export/decisions.json`. Triage reads its queue again when it
is shown (decision 112). A second test pauses the clock before the picks are saved, which keeps
Triage from looking again at the end of its queue, and opens Triage with `T` at `100-to-dig`: it
shows a record

## SETUP-02

Priority: **P1**.

An empty library opens `#/setup/catalogue`; the toolbar has no links; `T`, `W` and `,` do
nothing; the step list marks step 1; the title is "Fetch the catalogue – Digga setup"

## SETUP-03

Priority: **P1**.

Step 1 shows the dump's date, listed size, folder and free space; the fake logged no download before
the button

## SETUP-04

Priority: **P1**.

data.discogs.com answers `503` for every request (fake `set({ unavailableStatus: 503 })`): step 1
reads "Digga can't reach data.discogs.com: … answered 503." with Try again and no Fetch; once the
fake recovers, Try again shows the dump and enables Fetch

## SETUP-05

Priority: **P1**.

The listing says 900 TB, set before the page opens: an alert, in the page before its text, with the
space needed (the size and 1 GB to spare), the folder and `DIGGA_DUMPS_DIR`; Fetch is disabled;
"Check again" reads the setup again and still finds too little

## SETUP-06

Priority: **P1**.

The dump is already in the dumps folder (the listed September dump in `diggaOptions.dumpFiles`):
step 1 says "Digga has the 1 September 2026 catalogue already", and Continue moves on without a
download. Until the setup's steps 1 to 3 slice the setup opened step 2 instead (see its results)

## SETUP-07

Priority: **P1**.

Enter starts the download; the download strip shows on steps 2 and 3 with a `<progress>`; the step
is in the address; a reload stays on it; the step's Back goes a step back, to step 1 with "The
catalogue is downloading."; the fake sent one transfer over the reloads. The browser's Back is
SHELL-10

## SETUP-08

Priority: **P1**.

A token Discogs accepts: "Connected as dj: 1 in your collection, 2 wants." in a status region that
was in the page before; the username is adopted (`/api/settings`); the currency comes from the
profile (GBP, not the default EUR), and Continue without the imports saves it

## SETUP-09

Priority: **P1**.

`e2e-token-refused`: the step's alert, in the page before its text, shows Discogs' refusal; nothing
is saved, the username stays empty; the field has `aria-invalid` and references the alert after its
hint until it is edited (markup item 3)

## SETUP-10

Priority: **P2**.

"No token? Use your username": the public profile is read (one `GET /users/dj` without a token);
the collection and wantlist are imported by username; a later want stays in Digga, its push fails
with the declared `400` ("Set your Discogs token in Settings first") and is not tried again (a
refusal will not pass later, `mayPassLater` in `triage/session.svelte.ts`: one push request after
the clock has run past the first retry delay, and nothing reaches the fake's wantlist); the slip
says "Saved, but not on the Discogs wantlist.", the flash "<artist> – <title> is not on the
Discogs wantlist: Set your Discogs token in Settings first. A in Twelves tries again.", and
Twelves marks it "not on your Discogs wantlist" on the Want shelf, which counts 1 such record

## SETUP-11

Priority: **P1**.

Skip moves to step 3 with nothing connected: no suggestions and no picks, no Discogs request and no
import job

## SETUP-12

Retired: the browser history import was removed (decision 171 in `docs/DECISIONS.md`).

## SETUP-13

Priority: **P1**.

Continue starts the collection and wantlist imports as jobs and moves on at once: with the wantlist
page held at the fake, step 3 shows while that import runs; released, both end `done`, and the fake
logged one page of each for `dj`

## SETUP-14

Priority: **P1**.

Step 3 with imports: the account's styles that the census knows are picked ("mostly Drum n Bass";
the fixture's Techstep is not a Discogs style); with 3 imported releases the years default to the
middle 80% of the census's releases for the picks; the estimate is a `status` line with the census's
count

## SETUP-15

Priority: **P1**.

Style picker: "jung" then Enter picks Jungle; "Often tagged with" adds Drum n Bass; "Remove Jungle"
removes it; a genre opens as `<details>` with its styles as checkboxes (Electronic: Drum n Bass
checked, Breakbeat picked); Vinyl only changes the estimate; the load-years disclosure shows the
span widened by 3 years each side, and a change shows in its summary

## SETUP-16

Priority: **P1**.

Validation: with no style, Fill the crate sends nothing, and the search field gets `aria-invalid`
and references "Pick at least one style" after its hint until a style is picked (markup item 3);
"from" is capped by "to" (`max`), and a "from" past it blocks the submit

## SETUP-17

Priority: **P1**.

"Fill the crate" saves styles, years, formats and load years (read back through
`/api/settings`), and starts the load

## SETUP-18

Priority: **P1**.

Held at `100-to-dig`, once its count shows: the Download and Read `<progress>` rows have values,
releases kept and records to dig are counted, "Just pulled" names a release; the header shows
"loading N%" and the page keys work again

## SETUP-19

Priority: **P1**.

Held at `100-to-dig`: the records to dig reach the checkpoint's count while the download is held, so
the load read the growing file

## SETUP-20

Priority: **P2**.

Imports slower than the load's start (the wantlist pages held at the fake): "Reading your collection
and wantlist first, so the load also keeps other records on your labels." and "Start without it",
with no load job yet; "Start without it" starts the load while the wantlist import still runs, and
once released the imports end `done` and the catalogue is in

## SETUP-21

Priority: **P1**.

Held at `100-to-dig`: "Start digging" is disabled and "ready at 500 records" shows; released to
`600-to-dig`: enabled once its count shows; Enter and the button open Triage
(the page; SETUP-01 checks its first record). `T` is also the page key, which works during the load
whatever the count (`docs/FIRST_RUN.md`)

## SETUP-22

Retired: the practice round was removed (decision 149 in `docs/DECISIONS.md`).

## SETUP-23

Priority: **P1**.

The load finishes: the "ready to dig" stamp and the `h1` "The catalogue is in: …", which names the
crate's region (markup item 1); the header status says "The catalogue is in: …" once, the indicator
goes. "Delete it" with its request aborted shows the reason in the crate's alert, in the page
before its text (markup item 4); again, it deletes the dump (`/api/dumps` is empty), says "The
catalogue file is deleted." and clears the alert

## SETUP-24

Priority: **P1**.

Picks made by hand (Drum n Bass and Jungle, 1997–2003, Vinyl only off), the crate held at
`100-to-dig`, one record judged in Triage: "Change your picks" cancels the load and returns to step
3 with those picks and no suggestion; releases the load added without a verdict are gone, the judged
release and its verdict stay; a reload then opens the load's screen with "The catalogue stopped
loading", whose "Change your picks" brings back the same picks

## SETUP-25

Priority: **P1**.

The download drops its connection where the transfer is held at `100-to-dig`, once every byte sent
is on disk. Under the load: the crate's alert, in the page before its text, reads "The download
stopped at 6 KB of 79 KB: reason. Discogs does not allow resuming, so it starts again." with "Start
again" and "Change your picks"; the 100 records loaded stay, and Triage digs them; "Start again"
downloads and loads to READY TO DIG. On steps 2 and 3: the same sentence at the foot instead of the
strip; "Start again" brings the strip back, and "Fill the crate" after a stop downloads again before
the load starts

## SETUP-26

Priority: **P2**.

Wrong checksum (fake `set({ wrongChecksums })`), the first transfer held at `100-to-dig` while the
load reads it, then the second (`holdAt(name, { transfer: 2 })`). Once: the crate's alert, in the
page before its text, reads "The download does not match Discogs' checksum, so Digga downloads it
once more."; the load that read the rejected file fails with that reason, a second load reads the
new download, and the catalogue is in after two transfers. Twice: "The download does not match
Discogs' checksum. Digga downloaded it twice." with "Start again", which downloads a third time

## SETUP-27

Priority: **P1**.

A crash during the load (`relaunch({ crash: true })`), the first transfer held at `100-to-dig`: the
download and the load are marked failed as interrupted; the crate says "The catalogue stopped
loading when Digga closed." (docs/FIRST_RUN.md, "Failure and resume"; it said "…: interrupted."
until this scenario was built) and offers Pick up, which downloads again (two transfers) and reads
the dump from the start: the new load scans all 1,500 releases

## SETUP-28

Priority: **P1**.

A new page resumes at the first step not done: step 1 before anything is fetched, whatever the
address asks; step 2 while the catalogue comes, or step 3 when the address asks; the account a
username connected comes back on step 2; with the picks confirmed and the load waiting for the
imports (the wantlist page held at the fake), step 3 with those picks; the load's screen once a load
exists. With a saved token and the wantlist page held, a new page opens step 2 at once: the account
reads "Checking your Discogs account…" without the token field while `/oauth/identity` waits
behind the held page, and "Connected as dj" once the page is released. A catalogue that was in the
dumps folder before any download is SETUP-06

## SETUP-29

Priority: **P2**.

Picks that match nothing (Jungle, which the all-Drum n Bass bulk catalogue lacks), the transfer held
at `100-to-dig` until the crate shows: once the load ends having kept nothing, the crate's heading
is "Nothing in the catalogue matches these picks" with "Change your picks", and neither "Start
digging" nor "ready at 500 records"; "Change your picks" returns to step 3 with Jungle picked; Drum
n Bass then loads to READY TO DIG

## SETUP-30

Priority: **P1**.

A library with a finished load never shows the setup; `#/setup` goes to Triage [`small`]

## SETUP-31

Priority: **P1**.

Digging during the load, held at `100-to-dig`, with Drum n Bass from 1998 alone picked, so 18
records are to dig: once N has passed them, the end of the queue says "You have dug everything
loaded so far."; the clock paused, the transfer released to `600-to-dig`, and `/api/stats` counting
its 108 records to dig, `runFor(10_000)` makes Triage look again and a record not passed shows

## SETUP-32

Priority: **P2**.

The listing says 2 MB and the transfer's `Content-Length` 900 TB (`set({ contentLength })`): the
download job fails for lack of space before it writes a byte, and step 2 says "The download stopped:
The dump needs … free in …, counting 1 GB to spare; it has …." in an alert that was in the page
before; the dumps folder stays empty

## SETUP-33

Priority: **P1**.

A load that finishes with fewer than 500 records to dig enables "Start digging": Drum n Bass from
1998 alone keeps 305 of the bulk records to dig, and "ready at 500 records" does not show

## Completion contracts

- The setup's actions end the same way (`pages/setup.ts`). A step change ends once the address,
  the step list's `aria-current="step"` and the step's heading show the new step. Fetch ends once
  `POST /api/jobs/dump-download` has answered and step 2 shows; Continue on step 2 once a
  `POST /api/jobs/import/<kind>` has answered for each import it starts and step 3 shows; Connect
  once `PUT /api/discogs/token` and the `GET /api/discogs/profile` after it have answered and
  Continue is enabled again, which happens only when the step's work, the settings read included,
  is done; a refused token once the `PUT` has answered `400` and Connect is enabled again; Try
  again and Check again once `GET /api/setup` has answered; "Fill the crate" once
  `PUT /api/settings` and `POST /api/jobs/dump-load` have answered and the crate shows. "Fill the
  crate" with no style picked sends nothing and ends once the search field has `aria-invalid`. A
  year ends once Tab has left its field, which commits it (`change`), and the field shows it.
- "Pick up" ends once `POST /api/jobs/dump-download` and
  `POST /api/jobs/dump-load` have answered and the button has gone. "Start without it" ends once `POST /api/jobs/dump-load` has
  answered and the notice has gone. The finished load ends once
  the crate's `h1` reads "The catalogue is in: …" (`waitForCatalogue()`).
