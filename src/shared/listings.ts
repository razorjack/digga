import type { ReleaseDetail, ShopListing } from "./api.ts";
import type { QueueScope } from "./scope.ts";

/** Discogs's grades below VG+, as abbreviated in its condition names. */
const WORN_GRADES = new Set(["VG", "G+", "G", "F", "P"]);

/** How a grade reads at a glance: mint or near mint, worn from VG down, or neither. */
export type GradeTone = "top" | "fair" | "worn";

/** The copies of the record on screen in the shop Triage digs. */
export interface SellerCopies {
  username: string;
  listings: ShopListing[];
}

/** In a seller scope, the seller's copies of the release; null outside one. */
export function sellerCopies(
  scope: QueueScope | null,
  detail: ReleaseDetail | null,
): SellerCopies | null {
  if (scope?.kind !== "seller" || !detail) return null;
  return {
    username: scope.name,
    listings: detail.listings.filter((listing) => listing.seller.id === scope.id),
  };
}

/** A copy's grading as a stamp shows it, "NM / VG+", and as it reads out. */
export interface ListingGrade {
  text: string;
  spoken: string;
  /** From the record's grade; null when it is not one of Discogs's. */
  tone: GradeTone | null;
}

export function listingGrade(listing: ShopListing): ListingGrade {
  const media = listing.mediaCondition;
  const sleeve = listing.sleeveCondition;
  const mediaText = media === null ? "ungraded" : shortGrade(media);
  const text = sleeve === null ? mediaText : `${mediaText} / ${shortGrade(sleeve)}`;
  const record = `record ${media ?? "ungraded"}`;
  const spoken = sleeve === null ? record : `${record}, sleeve ${sleeve}`;
  return { text, spoken, tone: media === null ? null : gradeTone(shortGrade(media)) };
}

/**
 * "Near Mint (NM or M-)" -> "NM", "Very Good Plus (VG+)" -> "VG+". Sleeve conditions without a
 * grade, such as "Generic" or "No Cover", stay as they are.
 */
function shortGrade(condition: string): string {
  return /\(([^)\s]+)/.exec(condition)?.[1] ?? condition;
}

function gradeTone(grade: string): GradeTone | null {
  if (grade === "M" || grade === "NM") return "top";
  if (grade === "VG+") return "fair";
  return WORN_GRADES.has(grade) ? "worn" : null;
}
