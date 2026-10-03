/**
 * The time as Digga stores it: UTC with `Z`, so SQL can order timestamps as text. Discogs dates a
 * want or a collection item with its own offset ("2026-09-22T14:48:52-07:00") and fixtures use
 * bare dates. Text that names no time is returned as it is.
 */
export function toUtcTimestamp(text: string): string {
  const time = Date.parse(text);
  return Number.isNaN(time) ? text : new Date(time).toISOString();
}
