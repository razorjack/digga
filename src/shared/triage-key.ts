/**
 * The only place that decides how releases are grouped for triage:
 * releases sharing a master are one item (m:{master_id}); orphans are r:{release_id}.
 */
export function triageKeyFor(release: { id: number; masterId: number | null }): string {
  return release.masterId !== null && release.masterId > 0
    ? `m:${release.masterId}`
    : `r:${release.id}`;
}

export function masterKey(masterId: number): string {
  return `m:${masterId}`;
}

export function releaseKey(releaseId: number): string {
  return `r:${releaseId}`;
}

export function parseTriageKey(key: string): { kind: "master" | "release"; id: number } | null {
  const match = /^(m|r):(\d+)$/.exec(key);
  if (!match) return null;
  return { kind: match[1] === "m" ? "master" : "release", id: Number.parseInt(match[2]!, 10) };
}

export const TRIAGE_KEY_PATTERN = /^(m|r):\d+$/;
