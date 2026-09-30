import { z } from "zod";

/**
 * How many releases each Discogs style has, per year, in one releases dump. Every complete load
 * counts it; before the first load the setup reads the census shipped with Digga
 * (docs/STYLE_CENSUS.md).
 */
const count = z.number().int().nonnegative();

export const CensusStyleSchema = z.object({
  name: z.string().min(1),
  /** The genre most of its releases carry. */
  genre: z.string(),
  releases: count,
  vinyl: count,
  /** The year of `years[0]`; null when none of its releases has a year. */
  firstYear: z.number().int().nullable(),
  /** Releases per year from firstYear, and the vinyl ones among them. */
  years: z.array(count),
  vinylYears: z.array(count),
  /** Releases without a year, and the vinyl ones among them. */
  undated: count,
  undatedVinyl: count,
  /** The styles most often on the same releases, with the releases they share, most first. */
  together: z.array(z.tuple([z.string(), count])),
});

export const StyleCensusSchema = z.object({
  /** The dump it counted, YYYY-MM-DD. */
  dumpDate: z.string().nullable(),
  /** Every release in the dump, with a style or not. */
  releases: count,
  /** By name. */
  styles: z.array(CensusStyleSchema),
});

export type CensusStyle = z.infer<typeof CensusStyleSchema>;
export type StyleCensus = z.infer<typeof StyleCensusSchema>;

/**
 * The file's text: the header, then one style per line, so a refreshed census reads well as a
 * diff.
 */
export function formatStyleCensus(census: StyleCensus): string {
  const styles = census.styles.map((style) => `    ${JSON.stringify(style)}`).join(",\n");
  return `{\n  "dumpDate": ${JSON.stringify(census.dumpDate)},\n  "releases": ${census.releases},\n  "styles": [\n${styles}\n  ]\n}\n`;
}
