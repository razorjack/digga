import { DEFAULT_USER_AGENT } from "./transport.ts";

/**
 * data.discogs.com lists the monthly dumps as HTML pages, one per year, and serves each file
 * with ?download=. There is no JSON index and the bucket behind it refuses listing, so the
 * pages are read for their links.
 */
const DEFAULT_BASE_URL = "https://data.discogs.com/";

const YEAR_LINK = /href="\?prefix=data%2F(\d{4})%2F"/g;
const RELEASES_LINK =
  /href="\?download=data%2F\d{4}%2F(discogs_(\d{4})(\d{2})(\d{2})_releases\.xml\.gz)"/g;

export interface DataDump {
  /** YYYY-MM-DD */
  date: string;
  /** discogs_YYYYMMDD_releases.xml.gz */
  file: string;
}

export interface DataDumpDownload {
  body: AsyncIterable<Uint8Array>;
  /** From Content-Length; null when the server does not say. */
  bytes: number | null;
}

export interface DataDumpClient {
  /** The newest releases dump Discogs lists. */
  newestReleasesDump(signal?: AbortSignal): Promise<DataDump>;
  /** The SHA-256 Discogs publishes for the dump, in hex. */
  checksum(dump: DataDump, signal?: AbortSignal): Promise<string>;
  download(dump: DataDump, signal?: AbortSignal): Promise<DataDumpDownload>;
}

export interface DataDumpClientOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export class DataDumpError extends Error {}

/** The years a listing page links to, and the releases dumps it offers, newest first. */
export function parseDumpListing(html: string): { years: number[]; dumps: DataDump[] } {
  const years = [...html.matchAll(YEAR_LINK)].map((match) => Number(match[1]));
  const dumps = [...html.matchAll(RELEASES_LINK)].map((match) => ({
    date: `${match[2]}-${match[3]}-${match[4]}`,
    file: match[1]!,
  }));
  return {
    years: years.sort((left, right) => right - left),
    dumps: dumps.sort((left, right) => right.date.localeCompare(left.date)),
  };
}

/** The checksum listed for `file` in a CHECKSUM.txt ("<sha256> <file>" per line). */
export function checksumFor(text: string, file: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const [sum, name] = line.trim().split(/\s+/);
    if (name === file && sum && /^[0-9a-f]{64}$/i.test(sum)) return sum.toLowerCase();
  }
  return null;
}

export function createDataDumpClient(options: DataDumpClientOptions = {}): DataDumpClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const get = async (query: string, signal?: AbortSignal): Promise<Response> => {
    const url = new URL(query, baseUrl);
    const response = await fetchImpl(url, {
      headers: { "User-Agent": DEFAULT_USER_AGENT },
      signal,
    });
    if (!response.ok) throw new DataDumpError(`${url.host} answered ${response.status}`);
    return response;
  };
  const listing = async (prefix: string, signal?: AbortSignal) =>
    parseDumpListing(await (await get(`?prefix=${encodeURIComponent(prefix)}`, signal)).text());
  const fileQuery = (dump: DataDump, file: string) =>
    `?download=${encodeURIComponent(`data/${dump.date.slice(0, 4)}/${file}`)}`;

  return {
    async newestReleasesDump(signal) {
      const { years } = await listing("data/", signal);
      // A new year's page can exist before its first dump does.
      for (const year of years.slice(0, 2)) {
        const newest = (await listing(`data/${year}/`, signal)).dumps[0];
        if (newest) return newest;
      }
      throw new DataDumpError("data.discogs.com lists no releases dump");
    },
    async checksum(dump, signal) {
      const file = dump.file.replace("_releases.xml.gz", "_CHECKSUM.txt");
      const text = await (await get(fileQuery(dump, file), signal)).text();
      const sum = checksumFor(text, dump.file);
      if (!sum) throw new DataDumpError(`${file} has no checksum for ${dump.file}`);
      return sum;
    },
    async download(dump, signal) {
      const response = await get(fileQuery(dump, dump.file), signal);
      if (!response.body) throw new DataDumpError(`${dump.file} came without a body`);
      const length = Number(response.headers.get("content-length"));
      return { body: response.body, bytes: Number.isFinite(length) && length > 0 ? length : null };
    },
  };
}
