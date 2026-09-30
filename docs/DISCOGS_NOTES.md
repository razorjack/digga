# Discogs notes

## The data dump

Monthly dumps are listed at https://data.discogs.com/ (CC0), one HTML page per year
(`?prefix=data%2F2026%2F`), each file served with `?download=data%2F2026%2F<file>`. There is no
JSON index, and the S3 bucket behind it refuses listing, so `dump download` reads the pages for
their links, and the size printed before each link (`10.5 GB`, in powers of 1024), which the
setup shows before downloading; a `HEAD` request carries no `Content-Length`, the download does.
Each month also has `discogs_YYYYMMDD_CHECKSUM.txt` with one SHA-256 per file. The
file is served whole: range requests are answered with the full file, so an interrupted download
starts over. Digga reads
`discogs_YYYYMMDD_releases.xml.gz` (~10 GB gzipped) as a stream: `fs.createReadStream ->
zlib.createGunzip -> saxes`. It never decompresses to disk and never enumerates through
`/database/search`. `dump load -` accepts already-decompressed XML on stdin
(`gzip -dc file | digga dump load -`).

The element shape below, encoded in `fixtures/releases-sample.xml` and `tools/dump/parse.ts`, is
verified against the 2026-09-01 dump. Its first records match it, and a full load of it scanned
19,417,067 releases and kept 71,699 with their tracklists, videos, labels and master ids. That
dump has no `status` attribute and no `<images>`, and it leaves out empty elements such as
`<anv>` or `<join>` instead of writing them empty; the parser treats all of them as optional.

```xml
<releases>
<release id="1">
  <artists><artist><id>1</id><name>Name (2)</name><anv>Name</anv><join>&amp;</join></artist></artists>  <!-- anv, join optional -->
  <title>...</title>
  <labels><label catno="RH 20" id="77" name="Renegade Hardware"/></labels>
  <extraartists>...</extraartists>                       <!-- ignored -->
  <formats><format name="Vinyl" qty="2" text=""><descriptions><description>12"</description></descriptions></format></formats>
  <genres><genre>Electronic</genre></genres>
  <styles><style>Drum n Bass</style></styles>
  <country>UK</country>
  <released>2000-05-01</released>                        <!-- or 2000, 2000-00-00, empty -->
  <notes/> <data_quality/>
  <master_id is_main_release="true">501</master_id>      <!-- absent for orphans -->
  <tracklist><track><position>A1</position><title>...</title><duration>6:12</duration><artists>...</artists></track></tracklist>
  <identifiers/>
  <videos><video src="https://www.youtube.com/watch?v=..." duration="372" embed="true"><title>...</title><description/></video></videos>
  <companies/>
</release>
</releases>
```

Parser rules: release-level `<artists>` and track-level `<artists>` are kept; `<extraartists>` are
ignored; `<sub_tracks>` are flattened into the tracklist; the `status` attribute is stored but not
filtered on. Style strings must match Discogs exactly (`Drum n Bass`, not `Drum & Bass`).

Load-time filter: any style in `universe.styles`, and, when `universe.loadYears` is set, the parsed
year inside the window or unknown. Format, country and the tight year range are query-time filters.
With `universe.coverage`, releases in other styles are kept too when a label or release artist of
theirs is one of a record the user wants or owns and at least a third of that label's or
artist's releases in the load window carry a style (`tools/dump/coverage.ts`). `--labels ids.txt`
/ `--artists ids.txt` add ids to that pass. Releases credit compilations to "Various" (194) and
self-releases to labels named "Not On Label ...", which never count.

The dump does not carry prices or have/want counts; `P` in Triage fetches them, with the current
videos, for the record on screen.

## The API

Base `https://api.discogs.com`, JSON, personal access token from Settings > Developer sent as
`Authorization: Discogs token=...`. Always send a descriptive `User-Agent`
(`Digga/0.1 (+https://github.com/razorjack/digga)`); Discogs throttles anonymous-looking clients.

Rate limits: 60 requests/minute authenticated, 25 unauthenticated, reported in
`X-Discogs-Ratelimit`, `X-Discogs-Ratelimit-Used`, `X-Discogs-Ratelimit-Remaining`. The client keeps
a 1.1 s gap between requests, pauses 60 s when `Remaining` reaches 1 and honours `Retry-After` on
`429` (three retries).

Endpoints used:

- `GET /releases/{id}?curr_abbr=EUR`: `lowest_price`, `num_for_sale`, `community.have/want`,
  `videos[].uri/title/duration/embed`, `tracklist`. Median and highest sale prices are shown on the
  website only; the API does not expose them. `curr_abbr` accepts USD, GBP, EUR, CAD, AUD, JPY,
  CHF, MXN, BRL, NZD, SEK, ZAR; PLN is not supported, hence the EUR default.
- `GET /users/{u}/collection/folders/0/releases?per_page=100&page=N&sort=added&sort_order=desc`:
  `releases[].{id, instance_id, date_added, rating, notes[], basic_information}`.
- `GET /users/{u}/wants?per_page=100&page=N`: `wants[].{id, rating, notes, date_added, basic_information}`.
- `GET /users/{u}`: `{ id, username, num_for_sale, num_collection, num_wantlist, curr_abbr }`,
  the seller behind a shop read, and the collection and wantlist sizes and currency the setup
  shows; `404` for an unknown username.
- `GET /users/{u}/inventory?per_page=100&page=N`: `pagination` and
  `listings[].{id, status, release.id, seller.{id, username}}`. No token is needed for a public
  shop, which then lists For Sale items only; the seller's own token also returns drafts and sold
  items, which the import skips. Discogs reportedly refuses pages above 100 of someone else's
  inventory ("Pagination above 100 disabled for inventories besides your own"), so a shop read
  stops at 10,000 listings and reports how many the shop has. The API has no genre or style
  filter for inventories, so the whole shop is read and matched against the loaded releases.
- `GET /oauth/identity` for a token check: Settings shows whose token is set, since wantlist
  writes to `/users/{u}/...` fail when the token belongs to another account. Saving a token asks
  it first; `401` means Discogs refused the token, which is then not kept.
- `GET /users/{u}/lists?per_page=100&page=N`: `lists[].{id, name, public}`; private lists appear
  only with that user's token.
- `GET /lists/{id}`: `items[].{id, type, display_title, comment, uri}` with `type` in release,
  master, artist, label, and no pagination. Digga keeps releases and masters; a release outside
  the dump is looked up with `GET /releases/{id}`, a master with `GET /masters/{id}` and then its
  `main_release`, so each entry gets its triage key and a stub row.
- Lists are read-only in the API: there is no endpoint to create a list or to add, edit or remove
  items (checked against the maintained Python client, which models lists read-only, in September
  2026). The `M` verdict therefore leaves adding to the Discogs list to the user.
- `PUT /users/{u}/wants/{release_id}` adds a release (`201`), with optional `notes` and `rating`
  sent as JSON; `DELETE /users/{u}/wants/{release_id}` removes it (`204`, `404` when it was not
  there, which Digga treats as removed). Both need the user's token.
- Stub for later: `POST /users/{u}/collection/folders/{folder_id}/releases/{release_id}`.

`basic_information` has `id, master_id, title, year, artists, labels, formats (qty as string),
genres, styles`, enough for a stub release row.

## Discogs URLs in browser history

`src/shared/discogs-urls.ts` recognises `/release/{id}[-slug]`, `/master/{id}[-slug]`, the legacy
`/{Artist-Title}/release/{id}` and `/master/{id}`, localized prefixes (`/de/`, `/pl/`, ...) and
`/sell/release/{id}`. Artist, label, `/sell/item/` and API URLs are ignored.

## YouTube

Video ids are parsed from `watch?v=`, `youtu.be/`, `embed/`, `shorts/`. The IFrame Player API
requires an http(s) origin, which the localhost server provides; a custom Electron scheme would not.
The origin must be a host name: on `http://127.0.0.1:3456` YouTube refuses some videos with error
150 ("the uploader blocks embedding") that play on `http://localhost:3456`, so the app is always
opened on localhost.
`embed="false"` videos are stored with `embeddable = 0` so the UI can offer the search fallback.
