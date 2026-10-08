/** Formatting for the UI. Fixed "en-GB" locale so the counters read the same everywhere. */

const counts = new Intl.NumberFormat("en-GB");
const plurals = new Intl.PluralRules("en-GB");

export function formatCount(count: number): string {
  return counts.format(count);
}

/**
 * The noun for a count: "record" for 1, "records" otherwise. A plural other than the noun and
 * "s" is given, as is a phrase whose verb agrees ("record is", "records are").
 */
export function nounFor(count: number, singular: string, plural = `${singular}s`): string {
  return plurals.select(count) === "one" ? singular : plural;
}

/** "1 record", "1,204 records". */
export function formatCounted(count: number, singular: string, plural?: string): string {
  return `${formatCount(count)} ${nounFor(count, singular, plural)}`;
}

/** 372 -> "6:12", 3723 -> "1:02:03". */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "";
  const wholeSeconds = Math.floor(seconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const rest = String(wholeSeconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** 30000 -> "30 s", 300000 -> "5 min". */
export function formatWait(ms: number): string {
  if (ms >= 60_000) return `${Math.round(ms / 60_000)} min`;
  if (ms >= 1000) return `${Math.round(ms / 1000)} s`;
  return `${ms} ms`;
}

/** Price in the currency Discogs reported; a plain number when the currency is unknown. */
export function formatPrice(amount: number, currency: string | null): string {
  if (currency !== null && /^[A-Z]{3}$/.test(currency)) {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(amount);
  }
  return amount.toFixed(2);
}

/**
 * 950 -> "950 B", 129_000_000 -> "123 MB", 11_252_161_836 -> "10.5 GB": binary units, whole
 * numbers above 10 except gigabytes, which keep their tenths as data.discogs.com shows them.
 */
export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || (value >= 10 && units[unit] !== "GB") ? 0 : 1;
  return `${value.toFixed(digits).replace(/\.0$/, "")} ${units[unit]}`;
}

/** "~40 min", "~31 h", "~6 days". */
export function formatEta(hours: number | null): string | null {
  if (hours === null || !Number.isFinite(hours) || hours < 0) return null;
  if (hours < 1) return `~${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 72) return `~${Math.round(hours)} h`;
  return `~${Math.round(hours / 24)} days`;
}

// ICU versions disagree on short month names ("Sep" vs "Sept"), so they are fixed here.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "27 Sep" within the given year, "27 Sep 2025" otherwise. */
export function formatDay(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const day = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear() ? day : `${day} ${date.getFullYear()}`;
}

/** "19:23", "07:05": the local time of day on a 24-hour clock. */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const ages = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
const AGE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86_400],
  ["month", 30 * 86_400],
  ["day", 86_400],
  ["hour", 3600],
  ["minute", 60],
];

/** "just now", "5 minutes ago", "yesterday", "3 days ago", "2 months ago". */
export function formatAge(iso: string, now: Date = new Date()): string {
  const seconds = (now.getTime() - new Date(iso).getTime()) / 1000;
  if (Number.isNaN(seconds)) return "";
  for (const [unit, unitSeconds] of AGE_UNITS)
    if (seconds >= unitSeconds) return ages.format(-Math.floor(seconds / unitSeconds), unit);
  return "just now";
}

/**
 * Rotation of a hand-applied rubber stamp, in degrees: stable per id, between -4 and 3,
 * never quite straight.
 */
export function stampTilt(id: number): number {
  const hash = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  const tilt = ((hash % 700) - 400) / 100;
  return Math.abs(tilt) < 0.6 ? tilt + (tilt < 0 ? -0.8 : 0.8) : tilt;
}
