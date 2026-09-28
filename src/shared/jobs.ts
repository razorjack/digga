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

export const JobSchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("dump_load"),
    progress: z
      .object({
        phase: z.enum(["scanning", "done"]).default("done"),
        scanned: count,
        matched: count,
        upserted: count,
        elapsedSeconds: z.number().nonnegative(),
      })
      .nullable(),
  }),
  z.object({
    ...base,
    type: z.literal("enrich"),
    progress: z
      .object({
        done: count,
        total: count,
        failed: count,
        currentReleaseId: count.nullable(),
      })
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
]);
