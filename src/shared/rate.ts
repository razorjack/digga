export interface Session {
  start: number;
  end: number;
  count: number;
}

/** Splits decision timestamps into sessions separated by gaps longer than gapMinutes. */
export function sessionsFromTimes(times: string[], gapMinutes = 30): Session[] {
  const sessions: Session[] = [];
  const gap = gapMinutes * 60_000;
  for (const time of times) {
    const ms = Date.parse(time);
    if (Number.isNaN(ms)) continue;
    const current = sessions[sessions.length - 1];
    if (current && ms - current.end <= gap) {
      current.end = Math.max(current.end, ms);
      current.count += 1;
    } else {
      sessions.push({ start: ms, end: ms, count: 1 });
    }
  }
  return sessions;
}

/** Verdicts per hour over the last N sessions; a session shorter than a minute counts as one minute. */
export function verdictsPerHour(
  sessions: Session[],
  lastN = 5,
): { rate: number | null; sessions: number } {
  const recent = sessions.slice(-lastN);
  const count = recent.reduce((acc, s) => acc + s.count, 0);
  const hours = recent.reduce((acc, s) => acc + Math.max(s.end - s.start, 60_000), 0) / 3_600_000;
  if (count < 2 || hours <= 0) return { rate: null, sessions: recent.length };
  return { rate: count / hours, sessions: recent.length };
}

/** Rate and ETA as reported by /api/stats, rounded to one decimal. */
export function rateSummary(
  times: string[],
  remaining: number,
): { verdictsPerHour: number | null; sessions: number; etaHours: number | null } {
  const { rate, sessions } = verdictsPerHour(sessionsFromTimes(times));
  return {
    verdictsPerHour: rate === null ? null : Math.round(rate * 10) / 10,
    sessions,
    etaHours: rate === null ? null : Math.round((remaining / rate) * 10) / 10,
  };
}

/** Gap between Discogs requests; 1100 ms keeps an authenticated client under 60 a minute. */
export const DISCOGS_REQUEST_MS = 1100;

/** How long enriching this many records takes at the Discogs request rate. */
export function enrichHours(records: number): number {
  return (records * DISCOGS_REQUEST_MS) / 3_600_000;
}
