# First run

Status: built on 2026-09-30, except the Electron parts and the style picker in Settings. This is
the design of Digga's first launch, from an empty library to the first record playing in Triage,
without a terminal. The CLI keeps working as it does; this flow is for people who open the app.

Where the build differs from the design below:

- The setup's token form is its own component. Settings keeps its form, and both show the same
  "Every request Digga makes" list (`src/client/setup/RequestList.svelte`).
- The step is in the address (`#/setup/sound`), so a reload stays on it and the browser's Back
  goes a step back. Once the load runs, its screen stays; "Change your picks" leads back.
- "No token? Use your username" is built: it saves `discogs.username` and reads the public
  profile.
- The genres of the first picks come first in the style picker, and every genre starts closed.
- "Change your picks" cancels the load and calls `DELETE /api/setup/load`: the releases
  unfinished loads added leave the universe. Those with the user's data (a verdict, mark, note,
  listen, attached video or import) stay as stubs; the others are deleted.
- `tools/dev/fake-services.ts` serves a dump from disk at a set speed, as data.discogs.com
  does, with the end-to-end tests' fake Discogs API and oEmbed; `DIGGA_DUMPS_URL`,
  `DIGGA_DISCOGS_API_URL` and `DIGGA_YOUTUBE_OEMBED_URL` point Digga at it, to rehearse the
  setup.

## Goals

- A new user hears the first record a few minutes after opening Digga, and never needs a
  terminal or the README.
- Each step says in a sentence or two what it does, what it costs (disk, time, network) and
  what can be changed later.
- The waiting is visible and honest: sizes, speeds and times come from the running jobs, not
  from spinners.
- Keyboard-first like the rest of the app, and unchanged inside the Electron window.
- Some personality, in the copy and small details (see "Personality"). The design brief still
  applies: no motion that costs attention, ergonomics win every tie.

## What the first run involves

Measured on the owner's machine and library in September 2026.

| What                 | Measured                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------- |
| Newest releases dump | `discogs_20260901_releases.xml.gz`, 11,252,161,836 bytes (the listing page says 10.5 GB) |
| Finding it           | `newestReleasesDump()` reads data.discogs.com's listing pages already                    |
| Size before download | on the listing page, next to each file; a `HEAD` request has no `Content-Length`         |
| Download             | 7 min 45 s at about 24 MB/s, then checked against Discogs' `CHECKSUM.txt`                |
| Resume               | not possible: a range request gets `200` and the whole file                              |
| Load                 | 1,011 s (17 min): 19,417,067 releases read at about 11 MB/s, 71,699 kept                 |
| Library              | 136 MB for 71,699 releases, about 1.9 KB per release                                     |
| Free space needed    | the dump plus 1 GB to spare, 12.3 GB, then the library                                   |

The dump is ordered by release id, and Discogs catalogued old electronic records early, so the
releases a digger wants sit near the front of the file. With the owner's filters (Drum n Bass,
1998–2002, vinyl: 7,139 records), this share of the records was in the library after the load
had run for:

| Load time     | 7 s | 13 s | 40 s | 71 s | 130 s | 4 min | 7 min | 17 min |
| ------------- | --- | ---- | ---- | ---- | ----- | ----- | ----- | ------ |
| Records ready | 44% | 58%  | 78%  | 86%  | 91%   | 94%   | 97%   | 100%   |

Styles catalogued later arrive less front-loaded. Even an even spread gives a 7,000-record
selection 70 new records every 10 seconds, faster than anyone digs. The loader commits every 500
kept releases and at least once a second, and SQLite's WAL lets the server read while the loader's
worker writes, so the queue can be dug during the load. A verdict saved during the load waits for
the batch in progress to commit; better-sqlite3 waits up to 5 s for the lock.

## The flow

```
1 Fetch the catalogue -> 2 Bring your Discogs -> 3 Pick your sound -> 4 Fill the crate -> Dig
  the download starts       (optional)             the load starts       "Start digging" after
                                                                          500 records to dig
  '------------ the download runs behind steps 2 and 3 --------------'
```

The download needs no choices, so it starts on the first screen, with consent, and runs while
the user connects Discogs and picks styles. The load needs the styles, so it starts at the end of
step 3, and reads the part of the dump already downloaded while the rest arrives (see "Reading a
dump while it downloads").

On the owner's connection that makes:

| Time  | What happens                                                                       |
| ----- | ---------------------------------------------------------------------------------- |
| 0:00  | "Fetch the catalogue": the download starts                                         |
| 0:30  | Discogs connected; the collection and wantlist import behind it, about 1 s per 100 |
| 2:00  | Styles and years confirmed; the load starts on the 2.9 GB downloaded so far        |
| 2:10  | 500 records to dig: "Start digging" lights up                                      |
| 4:00  | 90% of the records are in                                                          |
| 8:00  | Download finished and checked                                                      |
| 19:00 | Load finished                                                                      |

Without reading during the download, the load would start at 8:00 and the first records would
come at about 8:10. On a connection slower than the load (about 90 Mbit/s), the download sets the
pace either way.

## When the setup appears

- The setup shows while the library has no finished dump load (`dump_loads.finished_at`). That
  covers a new library, a first load that was interrupted and a deleted database. A library that
  has finished a load, however it was started, never sees it.
- It lives at `#/setup`, outside the page keys. Until the load starts, the header holds only the
  wordmark and the step list; the page links appear once there is something to dig.
- Once the load has started, or a load that stopped has left records to dig, `T`, `W` and `,`
  work again, and `#/setup` shows the loading screen until the load finishes. After that `#/setup` goes to Triage; monthly updates stay in Settings.
- Nothing is chosen twice. Styles, years and formats go to `digga.config.json` when step 3 is
  confirmed, with `setup.picksConfirmed`, which tells them apart from the defaults a new config
  starts with; the token goes to the library, and the download, imports and load are jobs in the
  database. Closing Digga at any point and opening it again resumes at the first step that is
  not done, with the earlier answers filled in: step 3 starts from the confirmed picks, not from
  the suggestions, and a setup whose picks are confirmed but whose load has not started resumes
  there.

## Step 1: Fetch the catalogue

Says what Digga is and what setup will do, and starts the one long download.

```
digga                                                          1 2 3 4

  Dig every record in your styles, by ear.

  Digga plays a few seconds of each track on every record in the styles
  and years you pick. One key per record: skip, want, maybe, grail. What
  you want lands in Twelves, and on your Discogs wantlist if you like.

  Setting up takes about 20 minutes, mostly waiting. You can start
  digging after the first few.

  1  Fetch the catalogue   Discogs publishes every release in one file
                           a month. Digga downloads the newest, from
                           1 September 2026: 10.5 GB, into
                           ~/Library/Caches/Digga/dumps (182 GB free).
                           Digga reads releases from this file, not
                           from Discogs' API.
  2  Bring your Discogs    Optional. Leaves out what you own and want.
  3  Pick your sound       Styles and years.
  4  Fill the crate        Digga keeps what matches. Dig while it works.

  [ Fetch the catalogue  Enter ]
```

- The dump's date, size, folder and the free space come from `GET /api/setup` when the page
  opens. Nothing downloads before the button: the size is stated first, for metered connections.
- The dump is in the dumps folder already (an earlier attempt, or put there by hand): "Digga has
  the 1 September 2026 catalogue already", and the button reads "Continue". The existing
  `alreadyDownloaded` path does the rest.
- Not enough space: the button is disabled, and the text says what is needed, where and how much
  is free. "Check again" rechecks. In the browser version the text also says how to put the
  catalogue on another disk: `DIGGA_DUMPS_DIR` in `.env`, then start Digga again. The desktop app
  says "Free some space, or choose a folder on another disk." and offers "Choose a folder…", a
  folder dialog (built on 2026-10-08, decision 169). The chosen folder is the dumps folder from
  then on, also for the CLI and after a restart, and step 1 reads its free space again. While
  `DIGGA_DUMPS_DIR` names the folder the app says what the browser says, since the variable wins;
  while a download or load runs the server refuses.
- data.discogs.com unreachable: the reason and "Try again (Enter)".
- In the desktop app, "Use a dump file I have" opens a file dialog for a releases dump the user
  has, anywhere, under any name ending in `.xml.gz` (built on 2026-10-08, decision 168). It is
  offered whatever the listing says, unless the download has begun. The setup saves the file in
  `setup.dumpFile`, moves on to step 2 and loads it in step 4 as it would load a download, reading
  it where it is; nothing downloads. Step 1 then names the file, with "Continue" and "Choose
  another file". Cancelling the dialog leaves step 1 as it was.
- From step 2 on, a download strip stays at the foot of the screen: "Fetching the catalogue · 2.9
  of 10.5 GB · 5 min left", a native `<progress>`.

## Step 2: Bring your Discogs (optional)

Connects the account, so Digga leaves out what the user owns or wants and can suggest their
styles in step 3.

```
  Bring your Discogs                                   optional

  With a Discogs token Digga can:
    - leave records you own or already want out of the queue
    - put a record on your wantlist when you press A (Z takes it back)
    - ask for the lowest price when you press P

  Digga reads the catalogue from the file it downloaded, not through
  your account. It uses the token only for things you do: the ones
  above, and showing your account in Settings. One request at a time,
  within Discogs' rate limit.
  > Every request Digga makes

  The token stays on this computer. Get one on discogs.com under
  Settings > Developers > Generate new token.   [ Open discogs.com ]

  Token  [ ************************ ]  [ Connect ]

  Connected as razorjack: 312 in your collection, 1,204 wants.
  [x] Read my collection and wantlist            about 20 s
  Prices in [ EUR v ]

  [ Continue  Enter ]   Skip
```

- The token form is the one in Settings, extracted into a component. "Connect" checks the token
  with `/oauth/identity` before saving it; a token Discogs refuses shows its answer on the field
  (`setCustomValidity`, `aria-invalid`). The identity gives the username, so the user never
  types it.
- A setup opened again with a saved token shows its step at once and the account as "Checking your
  Discogs account…" until Discogs answers: the server sends Discogs one request at a time, so
  `/oauth/identity` can wait behind a running import's page, for 15 s with a large wantlist.
- The profile (`GET /users/{username}`) gives the collection and wantlist counts and the currency
  (`curr_abbr`). It becomes `discogs.currency` when the API prices in it, else EUR as today (the
  API has no PLN, for example); the select changes it.
- "No token? Use your username" is a secondary link. With the username alone, a public collection
  and wantlist can still be imported, at 25 requests a minute instead of 60. `A` and `C` then keep
  the want in Digga only, and Twelves marks it as missing from the Discogs wantlist, as it does
  today.
- The paragraph above the token field answers the question someone has before pasting a
  credential: what will this app do with my account? "Every request Digga makes" is a
  `<details>` that lists them, so the claim can be checked:
  - Your account: when you connect, and each time you open Settings, which shows whose token is
    saved and offers your lists for the Maybe list. About two requests a visit.
  - Your collection and wantlist: one request per 100 records, when you import them.
  - The Maybe list: when you import it, or press `I` in Twelves.
  - A want: one request when you press `A` or `C`, and one more when `Z` takes it back. In Twelves,
    when you re-judge a want onto or off the wantlist.
  - A price: one request when you press `P`, for the record on screen.
  - A seller's shop: one request per 100 listings, when you read it.

  It ends: "Digga leaves 1.1 s between requests, which keeps it under Discogs' limit of 60 a
  minute. It pauses when Discogs says the limit is nearly used, and waits as long as Discogs asks
  when it says too many. Nothing runs in the background. Digga never changes your collection or
  lists, and never reads orders or messages. A Discogs token cannot be limited to some actions,
  so Digga saves it only on this computer and sends it only to api.discogs.com. You can revoke it
  on discogs.com at any time."

- Settings keeps asking Discogs when it opens. Asking only when the Maybe list select opens would
  cost more than it saves: a native `<select>` has no event before it shows its options, so it
  would open empty or need an extra "Load lists" click, and the chosen list could show only its
  id. Without the account check on open, a revoked token or one for another account would
  surface only when a want fails to reach Discogs. About two read requests per visit are nothing
  next to the limit, so the text states them instead.
- The same list, under a shorter paragraph, appears in Settings' Discogs tab, and in the README
  as "Digga and the Discogs API".
- Digga does not read browser history (decision 171), so the step offers no history import.
- "Continue" starts the chosen imports as jobs and moves on at once; they finish while the user
  picks styles. "Skip" moves on with nothing connected; Settings has all of it later.

## Step 3: Pick your sound

Chooses what the load keeps, and what Triage digs.

```
  Pick your sound

  Digga keeps the releases in these styles and years. You can change
  both later in Settings and load again.

  Your wantlist is mostly   [+ Drum n Bass 812]  [+ Jungle 203]  [+ Breakbeat 96]

  Styles   [ find a style...                    ]
           Picked: [Drum n Bass x]  [Jungle x]
           Often tagged with these:  [+ Breakbeat]  [+ Downtempo]
           > Electronic (146)   > Hip Hop (58)   > Rock (160)   ...

  Years    from [ 1994 ]  to [ 2008 ]
            .:|||||||||||||||:..        no year |
           1990            2010

           [x] Vinyl only

  About 76,000 releases, 145 MB. The load reads all 19 million releases
  whatever you pick, so it takes 15 to 20 minutes either way.

  [ Fill the crate  Enter ]
```

- **Styles** come from the style census (below), so every name is one Discogs uses: no typos,
  unlike the comma-separated field in Settings today. Each style shows its release count.
- Several styles can be picked, and a release with any of them is kept, as `universe.styles`
  works already. Picked styles show as stamps with a remove button.
- The search field filters the list across genres; Enter in it picks the top match and clears
  it. With the field empty, genres are `<details>` groups ordered by size, with checkbox labels
  inside `<fieldset>`s.
- "Your wantlist is mostly" appears when step 2 imported something. It counts the styles on the
  imported releases (the stubs keep the styles and year Discogs sends). Those styles are picked
  already, and the years default to the span holding the middle 80% of the imported ones.
- "Often tagged with these" suggests styles that share many releases with the picks. For Drum n
  Bass that is Jungle: 11,217 of the owner's 71,699 releases carry both.
- **Years** are two number inputs, bounded by the census, over a histogram of the picked styles'
  releases per year, with the chosen span in ink and releases without a year as their own bar.
  Without imports, the years default to the span holding the middle 80% of the picks' releases.
- The chosen span becomes the digging filter (`filters.yearFrom`/`yearTo`). The load keeps three
  years more on each side (`universe.loadYears`), so the span can be widened later without loading
  again; a disclosure under the years says so and allows changing it. Releases without a year are
  always kept, as today.
- **Vinyl only** sets `filters.formats` to `["Vinyl"]`, or `[]` when cleared.
- **The estimate** (a `role="status"` line) sums the census counts for the picks and years,
  counts shared releases once, and multiplies by 1.9 KB for the size. It says "about", since the
  census comes from an earlier dump. It also says that the load time barely depends on the picks.
- Validation is native: at least one style (`setCustomValidity` on the search field), and the
  "from" year at most the "to" year.
- "Fill the crate" saves the settings and starts the load, after the imports from step 2 finish
  (see step 4).

## Step 4: Fill the crate

Shows the load, and lets the user start digging as soon as there is enough to dig.

```
  Fill the crate

  Digga reads every release on Discogs and keeps the ones in your sound.

  Download   ||||||||||||||||||||.........   6.1 of 10.5 GB · 3 min left
  Read       ||||||||.....................   27% · 12 min left
             41,230 releases kept · 5,594 records to dig

   .:|||||||||||||||:..     the histogram from step 3: census in outline,
  1994            2008      loaded releases filling it in

  Just pulled   UDFRLP04   Stakka And Skynet - Clockwork   2001

  [ Start digging  T ]

  Keys while you dig:  Space listen   R skip   A want   C grail   N next   Z undo   ? all
```

- Two `<progress>` rows with text beside them: the download (received of total bytes) and the
  read (`bytesRead / totalBytes` of the dump, which the load reports today). Each ETA comes from
  its rate over the last minute. While the read waits for the download, its ETA is the download's
  plus a few seconds.
- "Records to dig" is `Stats.remaining` under the chosen filters, polled every few seconds.
- "Start digging" is enabled once 500 records wait. At 20 seconds a record, that is close to
  three hours of digging, longer than the load takes, so the queue cannot run dry while the load
  continues. On the owner's data the load had 3,126 records after 7 seconds; a selection of 7,000
  records that arrives evenly reaches 500 a fourteenth of the way in, after about 70 seconds. A
  load that ends with fewer enables it anyway. One that kept no release says "Nothing in the
  catalogue matches these picks" with "Change your picks" instead, which returns to step 3 with
  the picks; the finished load stays recorded, so a reload goes to Triage, which says no releases
  are loaded.
- The histogram from step 3 fills in: the census estimate as an outline, the kept releases per
  year in ink. The load reports its per-year tally with its progress.
- "Just pulled" is the last release the load kept, set as a catalogue-number stamp and replaced
  every few seconds. It is not a live region, so screen readers are not flooded.
- If the imports from step 2 are still running, the read waits for them: the coverage pass reads
  the labels and artists of wanted and owned records when the load starts. The screen says
  "Reading your wantlist first (page 9 of 13), so the load also keeps other records on your
  labels", with "Start without it".
- The last sentence of the screen says that closing the page does not stop the load while the
  server runs. In the desktop app it says that quitting Digga stops the load and asks first.
- After a load of a file the user chose, the crate names the file and says Digga leaves it where
  it is: there is no "Delete it", and the setup never deletes it.
- "Change your picks" cancels the load, takes the releases it added out of the universe (keeping
  those with the user's data as stubs), and returns to step 3 with the picks as they were
  confirmed. The download continues.

### Digging for real

**Start digging** digs for real: verdicts are kept from the first one. With a token, the line
above it reads "A want goes on your Discogs wantlist when you press A. Z takes it off again."

## Digging during the load

- **Header:** after the counters, a "loading 41%" link to `#/setup` with a thin `<progress>` along
  the bottom edge of the header. The "to go" count reads "5,594 to go so far"; the ETA is hidden
  until the load finishes, since it would grow every second. The same indicator shows for any
  dump job, so a monthly update started in Settings gets it too.
- **Queue:** each refill queries the database again, so new records join as they arrive. While a
  load runs, an empty refill does not end the queue: the session asks again every 10 seconds, and
  the end screen reads "You've dug everything loaded so far. 41% of the catalogue read; records
  join as they arrive." The next record shows when one arrives.
- **Label sweep:** a label's releases can arrive after the sweep passed the label. They join the
  next refill, so the sweep returns to that label once for them. After the load the order is
  exact again. With most records arriving in the first two minutes, this is rare in practice.
- **Coverage releases** (other styles on the user's labels) arrive at the very end, in one step,
  because the coverage pass needs the whole dump.
- **When the load finishes,** the header's status region says once: "The catalogue is in: 71,699
  releases, 7,139 records to dig." The indicator goes away. On the setup screen a large stamp
  reads READY TO DIG, in the style of the ALL DUG stamp.
- **The catalogue file** stays in the dumps folder after the load. The READY TO DIG screen says
  what it is for and offers to delete it: "The catalogue file uses 10.5 GB in
  ~/Library/Caches/Digga/dumps. Keep it to change your styles without downloading again this
  month." with "Delete it". Keeping it is the default; Settings lists it later too.
- Twelves, Settings and `P` work as usual during the load.

## Failure and resume

| Situation                         | The user sees                                                                                                                                                                                                                                                               | Digga does                                                                                                                 |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| data.discogs.com unreachable      | The reason and "Try again"                                                                                                                                                                                                                                                  | Nothing has started                                                                                                        |
| Not enough space                  | Needed, free, and the folder                                                                                                                                                                                                                                                | "Fetch" stays disabled; "Check again" rechecks                                                                             |
| The download stops                | "The download stopped at 4.1 GB of 10.5 GB: reason. Discogs does not allow resuming, so it starts again." and "Start again"                                                                                                                                                 | The load reading it stops too. The releases loaded so far stay, and can be dug                                             |
| The checksum does not match       | "The download does not match Discogs' checksum"                                                                                                                                                                                                                             | Downloads once more by itself, then asks                                                                                   |
| Digga closed during download/load | "The catalogue stopped loading when Digga closed" and "Pick up"; after a quit, "The catalogue stopped loading."; after a quit before any load, step 1 says "The download stopped at 4.1 GB of 10.5 GB when Digga quit. Discogs does not allow resuming, so it starts over." | A crash leaves the jobs interrupted; a quit cancels them. The download starts over; the load reads the dump from the start |
| The picks match nothing           | "Nothing in the catalogue matches these picks" and "Change your picks"                                                                                                                                                                                                      | Back to step 3                                                                                                             |
| An import fails (token, Discogs)  | The error on the import's line, with "Try again"                                                                                                                                                                                                                            | The load does not wait for a failed import                                                                                 |

Verdicts made during an interrupted load stay: their keys are Discogs ids, and reloading upserts
the same releases. A finished load takes over the rows of unfinished ones (`dump_loads`).

A stopped download says so wherever the user is: at the foot of steps 2 and 3, where the strip
was, and in the crate, which keeps "Change your picks". A download that stopped before any of it
arrived, such as one the disk had no room for, gives only the reason: "The download stopped:
reason." "Fill the crate" after a stop downloads again before the load starts, and a setup opened
again after a stop resumes at step 2. Once the library has records to dig, the page keys and
links work again, so the releases a stopped load kept can be dug; the app still opens on the
setup until a load finishes.

## Personality

In the voice of the verdict copy, never at the cost of reading speed.

- The steps are named like digging: fetch the catalogue, bring your Discogs, pick your sound,
  fill the crate.
- "Just pulled" stamps the last kept release's catalogue number, like a white label.
- The histogram fills with ink as the load runs, over the census outline.
- "Your wantlist is mostly Drum n Bass" greets someone who connected Discogs.
- Honest numbers: "5,594 records to dig. At 20 seconds a record, that is 31 hours. Pace
  yourself." The rate is the default until the user's own rate exists (`src/shared/rate.ts`).
- READY TO DIG when the load finishes.

## Keyboard and accessibility

- Each step is a `<form>`; Enter submits it, and the primary button shows its key. Back is a
  link to the previous step. The step list is an `<ol>` with `aria-current="step"`.
- Each step sets the document title: "Pick your sound – Digga setup".
- Progress uses native `<progress>` elements with visible text beside them. A `role="status"`
  region announces milestones only: download finished, a quarter of the dump read, ready to dig,
  load finished.
- The histogram is `aria-hidden`; the year inputs and the estimate carry the information.
- The style stamps' remove buttons are named "Remove Jungle".

## What changes in the code

### Server

- `parseDumpListing()` also reads each file's size from the listing page.
- `GET /api/setup`: whether the setup is needed, the newest dump (date, file, size; cached for an
  hour), whether it is in the dumps folder, the dumps folder and its free space, the space needed,
  and the style and year tally of imported releases.
- `GET /api/styles`: the style census (below).
- The Discogs account response adds the profile's collection and wantlist counts and currency.
- The loader reports progress every second instead of every 100,000 releases. The progress gains
  `latest` (catalogue number, label, artist, title and year of the last kept release) and
  `keptByYear`.
- A load can read a dump while it downloads (below). `refuseWhileDumpJobRuns` lets a load start
  while the only running dump job downloads the same file. `dump_update` (Settings' "Update from
  the newest dump") runs its download and load together too, so its progress holds both; older
  job rows keep parsing.

### Reading a dump while it downloads

The download writes `<file>.part` and renames it to `<file>` once the checksum matches. The load
opens the `.part` file and reads it like a growing log:

- At the end of the data, it waits a moment and reads again.
- When `<file>.part` is gone and `<file>` exists, the download was verified; the open descriptor
  still points at the same file, so the load reads to its end and finishes.
- When both are gone, the download failed or was cancelled, and the load fails with the
  download's reason.

The load does not need the download's cooperation, and each job keeps its own cancellation.
Windows needs checking: renaming a file another handle has open works only when that handle
allows it (libuv opens files with `FILE_SHARE_DELETE`, which should cover it). A dump from an
earlier download has no `.part` and loads as today.

If the checksum fails after the load has read everything, the load is not recorded as finished,
so the next finished load takes its rows over. The download job then downloads once more by
itself and counts the mismatch in its progress (`checksumMismatches`); a load reading the
rejected file sees the count change and stops, before it could take the second download's
"done" for its own file, and the setup starts a new load on the new download. A second mismatch
fails the download job, and the setup asks.

### The style census

Every load parses all 19 million releases to find the matching ones, so it can tally the whole
catalogue at little extra cost. Per style and year, it counts releases and vinyl releases; per
style, its genre (the one most often on its releases) and the styles most often on the same
releases, with shared counts. A complete load writes the tally to a new `style_census` table
(migration 6) with the dump date.

Before the first load there is no table, so Digga ships a census from a recent dump: a JSON
file that a new `digga dump census <file>` writes and that is regenerated when Digga is released.
`GET /api/styles` answers from the table once there is one, else from the shipped file. Only the
setup, and later the Settings style picker, fetch it. Its size needs measuring; the target is
under 150 KB gzipped.

### Client

- `#/setup` and `pages/Setup.svelte`, with a `setup/` folder: the step state derived from
  `GET /api/setup` and the jobs, one component per step, the style picker, the year range with
  its histogram, and the crate screen.
- Pure helpers, tested: the estimate from the census, the suggested styles and years, the
  default year span, and the ETA from a rate.
- `App.svelte` sends a library that needs setup to `#/setup`, and shows the load indicator in the
  header while a dump job runs.
- The triage session keeps asking while a load runs, instead of treating an empty refill as the
  end of the queue.
- Later: the style picker replaces the Styles text field in Settings.

## Electron

The flow is the same web page. The shell adds:

- Load progress on the Dock icon or taskbar button (`BrowserWindow.setProgressBar`), built on
  2026-10-08: how far the load has read while one runs, else how much of the download has
  arrived, indeterminate while the size is unknown, and none once neither runs.
- A system notification when the load finishes or fails and no window of the app is focused:
  "The catalogue is in" with the releases kept, or "The catalogue stopped loading" with the
  reason. A load the setup starts again after a checksum mismatch, and a cancelled one, say
  nothing. Clicking it shows the window.
- `powerSaveBlocker.start("prevent-app-suspension")` while a download or load runs, so a
  sleeping laptop does not break the download; it stops however they end.
- Quitting during the download or load asks first, since the download starts over (built on
  2026-10-08, decision 166): the question says where the download stands, that Discogs does not
  resume it, how far the load has read and that the releases it kept stay. Cancel keeps both
  running. Closing the window asks the same.
- "Use a dump file I have" in step 1, with a file dialog (built on 2026-10-08, see step 1).
- A folder picker for the dumps when the disk is short of space (built on 2026-10-08, see step 1).
- The token in `safeStorage` (built on 2026-10-06, decision 152 in `DECISIONS.md`).

## Build order

1. **Server groundwork:** listing sizes, `GET /api/setup`, the profile counts, progress every
   second with `latest` and `keptByYear`, the census tally, table, shipped file and
   `GET /api/styles`.
2. **The setup screens**, with the load starting after the download: the four steps, the header
   indicator and digging during the load. Early digging already works here, eight minutes in
   instead of two.
3. **Reading a dump while it downloads**, for the setup and for "Update from the newest dump".
4. **The style picker in Settings**, and the Electron parts with the shell.

Tests: the census tally and estimate, suggestions from imported releases, reading a growing file
(finished, failed and cancelled downloads, over a fixture written in chunks), the session asking
again during a load, and the setup state for each resume point.

## Decisions

Confirmed by the owner on 2026-09-30.

1. **Load window:** the dug years plus three on each side, changeable in the disclosure.
2. **Sandbox:** the setup turns it off, with the practice round as the opt-in way to try things.
   The schema default stays on, for configs created by the CLI. The practice round was removed
   later (decision 149 in `DECISIONS.md`), and the sandbox after it (decision 150).
3. **Shipped census:** a generated JSON file in the repo, regenerated for releases.
4. **Reading during the download** is part of the first version: steps 1 to 3 of the build order.
5. **"Start digging" threshold:** 500 records to dig.
6. **The catalogue file after the first load:** kept, with "Delete it" on the READY TO DIG screen.
7. **Too little space in the browser version:** the message explains `DIGGA_DUMPS_DIR`; a folder
   picker comes with Electron.
8. **The first shipped census** comes from the 1 September 2026 dump. `docs/STYLE_CENSUS.md` says
   how to refresh it.
