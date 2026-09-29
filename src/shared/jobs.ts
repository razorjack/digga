import { z } from "zod";
import { JOB_STATUSES } from "./types.ts";

const count = z.number().int().nonnegative();
const ImportProgressSchema = z.object({
  page: count,
  pages: count.nullable(),
  processed: count,
  stubs: count,
  verdictsWritten: count,
});
const EnrichProgressSchema = z.object({
  done: count,
  total: count,
  failed: count,
  currentReleaseId: count.nullable(),
});
const base = {
  id: z.string(),
  status: z.enum(JOB_STATUSES),
  error: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
};

export const JobSchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("dump_download"),
    progress: z
      .object({
        phase: z.enum(["finding", "downloading", "done"]),
        file: z.string().nullable(),
        receivedBytes: count,
        totalBytes: count.nullable(),
        alreadyDownloaded: z.boolean(),
      })
      .nullable(),
  }),
  z.object({
    ...base,
    type: z.literal("dump_load"),
    progress: z
      .object({
        phase: z.enum(["scanning", "done"]).default("done"),
        scanned: count,
        matched: count,
        coverage: count.default(0),
        upserted: count,
        elapsedSeconds: z.number().nonnegative(),
        bytesRead: count.nullable().default(null),
        totalBytes: count.nullable().default(null),
      })
      .nullable(),
  }),
  z.object({ ...base, type: z.literal("enrich"), progress: EnrichProgressSchema.nullable() }),
  z.object({
    ...base,
    type: z.literal("enrich_twelves"),
    progress: EnrichProgressSchema.nullable(),
  }),
  z.object({
    ...base,
    type: z.literal("import_history"),
    progress: z
      .object({
        files: count,
        urls: count,
        discogsUrls: count,
        keys: count,
        verdictsWritten: count,
      })
      .nullable(),
  }),
  z.object({
    ...base,
    type: z.literal("import_collection"),
    progress: ImportProgressSchema.nullable(),
  }),
  z.object({
    ...base,
    type: z.literal("import_wantlist"),
    progress: ImportProgressSchema.nullable(),
  }),
  z.object({ ...base, type: z.literal("import_list"), progress: ImportProgressSchema.nullable() }),
  z.object({
    ...base,
    type: z.literal("import_seller"),
    progress: z
      .object({
        username: z.string(),
        page: count,
        pages: count.nullable(),
        listings: count.nullable(),
        read: count,
        records: count.nullable(),
      })
      .nullable(),
  }),
]);
