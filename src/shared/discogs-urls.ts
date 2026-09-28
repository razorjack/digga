export interface DiscogsRef {
  kind: "release" | "master";
  id: number;
}

/**
 * Recognises the Discogs URL shapes that show up in browser history:
 *   discogs.com/release/123[-slug]        discogs.com/master/123[-slug]
 *   discogs.com/Artist-Title/release/123  discogs.com/Artist-Title/master/123   (legacy)
 *   discogs.com/de/release/123, /pl/...   (localized prefixes, also with legacy slugs)
 *   discogs.com/sell/release/123          (marketplace listing for a release)
 * Anything else (artist, label, sell/item, api) returns null.
 */
export function parseDiscogsUrl(input: string): DiscogsRef | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "discogs.com" && !host.endsWith(".discogs.com")) return null;
  if (host.startsWith("api.")) return null;
  const segments = url.pathname.split("/").filter((s) => s !== "");
  for (let index = 0; index < segments.length - 1; index += 1) {
    const seg = segments[index]!.toLowerCase();
    if (seg !== "release" && seg !== "master") continue;
    const match = /^(\d+)(?:-|$)/.exec(segments[index + 1]!);
    if (!match) continue;
    const id = Number.parseInt(match[1]!, 10);
    if (id <= 0) continue;
    return { kind: seg, id };
  }
  return null;
}

export function discogsReleaseUrl(id: number): string {
  return `https://www.discogs.com/release/${id}`;
}

export function discogsMasterUrl(id: number): string {
  return `https://www.discogs.com/master/${id}`;
}
