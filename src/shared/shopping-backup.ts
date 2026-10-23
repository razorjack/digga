import { z } from "zod";
import { ShoppingStateSchema } from "./shopping.ts";

const id = z.number().int().positive();
const text = z.string().nullable();
const number = z.number().nullable();

/** Validate snapshots on restore before the shopping reader uses their JSON. */
export const ShoppingSnapshotSchema = z.object({
  listing: z.object({
    id,
    seller: z.object({ id, username: z.string() }),
    mediaCondition: text,
    sleeveCondition: text,
    price: number,
    currency: text,
    comments: z.string(),
    postedAt: text,
  }),
  release: z.object({
    id,
    triageKey: z.string(),
    masterId: id.nullable(),
    title: z.string(),
    artistDisplay: z.string(),
    labelId: id.nullable(),
    labelName: text,
    catno: text,
    year: number,
    country: text,
    formatSummary: z.string(),
    styles: z.array(z.string()),
    videoCount: z.number(),
    communityWant: number,
    communityHave: number,
    ratingAverage: number,
    ratingCount: number,
    numForSale: number,
    lowestPrice: number,
    currency: text,
    enrichedAt: text,
  }),
});

export const ShoppingRowSchema = z
  .object({
    listingId: id,
    sellerId: id,
    state: ShoppingStateSchema,
    snapshot: z.string(),
    updatedAt: z.iso.datetime(),
  })
  .refine((row) => {
    try {
      const snapshot = ShoppingSnapshotSchema.parse(JSON.parse(row.snapshot));
      return snapshot.listing.id === row.listingId && snapshot.listing.seller.id === row.sellerId;
    } catch {
      return false;
    }
  }, "Invalid shopping snapshot");

export type ShoppingRow = z.infer<typeof ShoppingRowSchema>;
