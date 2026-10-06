/**
 * Where a URL the window is asked to open leads: the app's own pages, an http(s) page elsewhere,
 * which the user's browser opens, or anything else (file:, javascript:, other schemes), which
 * nothing opens.
 */
export type LinkTarget = "app" | "external" | "other";

export function linkTarget(url: string, appOrigin: string): LinkTarget {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "other";
  }
  if (parsed.origin === appOrigin) return "app";
  if (parsed.protocol === "http:" || parsed.protocol === "https:") return "external";
  return "other";
}
