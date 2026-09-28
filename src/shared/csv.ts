export type CsvValue = string | number | null;

/** RFC 4180 CSV: CRLF line ends, fields quoted when they hold a quote, comma or line break. */
export function toCsv(header: string[], rows: CsvValue[][]): string {
  return [header, ...rows].map((row) => row.map(csvField).join(",")).join("\r\n") + "\r\n";
}

function csvField(value: CsvValue): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
