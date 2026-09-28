import type { FormatRef } from "./types.ts";

export function isVinyl(formats: FormatRef[]): boolean {
  return formats.some((format) => format.name === "Vinyl");
}

/** '2 x Vinyl (12", 33 RPM), CD' style one-liner for lists and the release header. */
export function formatSummary(formats: FormatRef[]): string {
  return formats
    .map((format) => {
      const qty = format.qty > 1 ? `${format.qty} x ` : "";
      const desc = format.descriptions.length > 0 ? ` (${format.descriptions.join(", ")})` : "";
      const text = format.text !== "" ? ` ${format.text}` : "";
      return `${qty}${format.name}${desc}${text}`;
    })
    .join(", ");
}
