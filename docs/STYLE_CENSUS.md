# The style census

The style census counts how many releases each Discogs style has, per year, in one releases dump.
The setup's style picker reads it to list every style with its size, to suggest styles often
tagged together, to draw the year histogram and to estimate how big a library the picks make
(`docs/FIRST_RUN.md`).

## Where it comes from

- **Every complete dump load counts it.** The loader parses all 19 million releases anyway, so
  `StyleCensusTally` (`tools/dump/census.ts`) counts each release as it streams by. A load that
  reaches the end of the dump replaces the one row of the `style_census` table; a dry run or a
  load stopped by `--limit` leaves it alone.
- **Before the first load, the shipped census stands in:** `src/server/style-census.json`, written
  by `digga dump census` and committed. The first shipped census comes from the 1 September 2026
  dump.
- `GET /api/styles` answers with the stored census when there is one, else the shipped file
  (`readStyleCensus()` in `src/server/style-census.ts`).

## What it holds

`StyleCensus` in `src/shared/style-census.ts`, one JSON object:

- `dumpDate` and `releases`: the dump and how many releases it has, with a style or not.
- `styles`, by name, one per line in the file. Each has its `genre` (the one most of its releases
  carry), `releases` and `vinyl` counts, `firstYear` with per-year counts from that year on
  (`years`, `vinylYears`), the releases without a year (`undated`, `undatedVinyl`), and
  `together`: the eight styles most often on the same releases, with the releases they share.

A release counts once for each of its styles, so the counts of two styles add up to more than
their union; `together` says by how much. The September 2026 census is 548 KB, 181 KB gzipped.

## Refreshing the shipped census

Do this when Discogs' styles have changed noticeably, or before a release of Digga. It takes
about 15 minutes, most of it reading the dump, and needs about 11 GB of free space for the dump.

1. Get the newest releases dump. Either use one already in the dumps folder
   (`~/Library/Caches/Digga/dumps` on macOS; Settings lists it), or download it into a throwaway
   folder so the owner's library is not touched:

   ```sh
   DIGGA_DATA_DIR=/tmp/digga-census npm run digga -- dump download
   ```

   The dump is then `/tmp/digga-census/dumps/discogs_YYYYMMDD_releases.xml.gz`.

2. Count it into the shipped file. `DIGGA_DATA_DIR` keeps the command away from the owner's
   library, although the census only reads the dump:

   ```sh
   DIGGA_DATA_DIR=/tmp/digga-census npm run digga -- dump census /tmp/digga-census/dumps/discogs_YYYYMMDD_releases.xml.gz
   ```

   It logs every million releases, takes about 15 minutes, and ends with a line such as:

   ```
   style census: 757 styles in 19,417,067 releases (dump 2026-09-01), 548 KB written to .../src/server/style-census.json
   ```

   `--out FILE` writes it elsewhere, to compare first.

3. Check the result: `git diff --stat src/server/style-census.json` should show about as many
   lines as styles, and a few familiar styles should have plausible counts. In the September 2026
   dump, Drum n Bass has 181,449 releases, 56,091 of them on vinyl and 5,559 without a year:

   ```sh
   grep '"name":"Drum n Bass"' src/server/style-census.json | cut -c1-120
   ```

4. Run `vp run verify`. `tests/setup-http.test.ts` reads the shipped file.

5. Commit only the census, titled like "Refresh the style census from the YYYY-MM-DD dump", and
   update the dump date in "Where it comes from" above.

6. Delete the dump if it was downloaded only for this: `rm -rf /tmp/digga-census`.

The file is excluded from formatting (`fmt.ignorePatterns` in `vite.config.ts`), since the
formatter would put every number on its own line.
