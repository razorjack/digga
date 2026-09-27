/** Formatting for the UI. Fixed "en-GB" locale so the counters read the same everywhere. */

const counts = new Intl.NumberFormat("en-GB");

export function formatCount(n: number): string {
  return counts.format(n);
}

/** 372 -> "6:12", 3723 -> "1:02:03". */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}

/** Price in the currency Discogs reported; a plain number when the currency is unknown. */
export function formatPrice(amount: number, currency: string | null): string {
  if (currency !== null && /^[A-Z]{3}$/.test(currency)) {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(amount);
  }
  return amount.toFixed(2);
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
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? day : `${day} ${d.getFullYear()}`;
}

/**
 * Rotation of a hand-applied rubber stamp, in degrees: stable per id, between -4 and 3,
 * never quite straight.
 */
export function stampTilt(id: number): number {
  const h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  const tilt = ((h % 700) - 400) / 100;
  return Math.abs(tilt) < 0.6 ? tilt + (tilt < 0 ? -0.8 : 0.8) : tilt;
}
