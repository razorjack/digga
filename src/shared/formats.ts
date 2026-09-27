import type { FormatRef } from "./types.ts";

export function isVinyl(formats: FormatRef[]): boolean {
  return formats.some((f) => f.name === "Vinyl");
}

/** '2 x Vinyl (12", 33 RPM), CD' style one-liner for lists and the release header. */
export function formatSummary(formats: FormatRef[]): string {
  return formats
    .map((f) => {
      const qty = f.qty > 1 ? `${f.qty} x ` : "";
      const desc = f.descriptions.length > 0 ? ` (${f.descriptions.join(", ")})` : "";
      const text = f.text !== "" ? ` ${f.text}` : "";
      return `${qty}${f.name}${desc}${text}`;
    })
    .join(", ");
}
