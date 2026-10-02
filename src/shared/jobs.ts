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
const base = {
  id: z.string(),
  status: z.enum(JOB_STATUSES),
  error: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
};

const DumpDownloadProgressSchema = z.object({
  phase: z.enum(["finding", "downloading", "done"]),
  file: z.string().nullable(),
  receivedBytes: count,
  totalBytes: count.nullable(),
  alreadyDownloaded: z.boolean(),
  // Progress saved by older versions lacks it.
  checksumMismatches: count.default(0),
});
// Defaults read progress saved by older versions, which lacked these fields.
const DumpLoadProgressSchema = z.object({
  phase: z.enum(["scanning", "done"]).default("done"),
  scanned: count,
  matched: count,
  coverage: count.default(0),
  upserted: count,
  elapsedSeconds: z.number().nonnegative(),
  added: count.nullable().default(null),
  missing: count.nullable().default(null),
  bytesRead: count.nullable().default(null),
  totalBytes: count.nullable().default(null),
  latest: z
    .object({
      id: count,
      artist: z.string(),
      title: z.string(),
      label: z.string().nullable(),
      catno: z.string().nullable(),
      year: z.number().int().nullable(),
    })
    .nullable()
    .default(null),
  keptByYear: z.record(z.string(), count).default({}),
});

export const JobSchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("dump_download"),
    progress: DumpDownloadProgressSchema.nullable(),
  }),
  z.object({ ...base, type: z.literal("dump_load"), progress: DumpLoadProgressSchema.nullable() }),
  z.object({
    ...base,
    type: z.literal("dump_update"),
    progress: z
      .discriminatedUnion("step", [
        DumpDownloadProgressSchema.extend({ step: z.literal("download") }),
        DumpLoadProgressSchema.extend({ step: z.literal("load") }),
      ])
      .nullable(),
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
