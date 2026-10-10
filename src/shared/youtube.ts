/** Extracts the 11-character video id from watch, short, embed, YouTube Music and youtu.be links. */
export function youtubeIdFromUrl(src: string): string | null {
  let url: URL;
  try {
    url = new URL(src.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(?:www|m|music)\./, "");
  const valid = (id: string | null | undefined): string | null =>
    id && /^[\w-]{11}$/.test(id) ? id : null;
  if (host === "youtu.be") return valid(url.pathname.split("/")[1]);
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const videoId = url.searchParams.get("v");
    if (videoId) return valid(videoId);
    const match = /^\/(?:embed|shorts|v|live)\/([\w-]{11})/.exec(url.pathname);
    if (match) return valid(match[1]);
  }
  return null;
}

export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function youtubeSearchUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}
