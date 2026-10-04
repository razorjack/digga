/**
 * The ISO time of a checkpoint, whose file names the time with `:` and `.` written as `-`
 * ("2026-10-04T17-27-56-315Z"); null for a name in another form.
 */
export function checkpointTime(stamp: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(stamp);
  if (!match) return null;
  const [, day, hours, minutes, seconds, milliseconds] = match;
  return `${day}T${hours}:${minutes}:${seconds}.${milliseconds}Z`;
}
