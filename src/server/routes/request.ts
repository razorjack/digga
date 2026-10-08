import { parseInteger } from "../../shared/integer.ts";
import { type Context } from "hono";
import type { z } from "zod";
import { type ApiError } from "../../shared/api.ts";
import { claimAccount } from "../db/memberships.ts";
import { DiscogsApiError } from "../discogs/client.ts";
import type { AppContext } from "../context.ts";

export function badRequest(request: Context, message: string, issues?: unknown): Response {
  const body: ApiError = { error: message, issues };
  return request.json(body, 400);
}
export async function parseJson<T>(
  request: Context,
  schema: z.ZodType<T>,
): Promise<
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      response: Response;
    }
> {
  let raw: unknown = {};
  const text = await request.req.text();
  if (text.trim() !== "") {
    // A page on another site can send a text/plain body without asking the browser first.
    if (!request.req.header("content-type")?.startsWith("application/json"))
      return {
        ok: false,
        response: request.json(
          { error: "Send the body as application/json" } satisfies ApiError,
          415,
        ),
      };
    try {
      raw = JSON.parse(text);
    } catch {
      return { ok: false, response: badRequest(request, "Body is not valid JSON") };
    }
  }
  const result = schema.safeParse(raw);
  if (!result.success)
    return {
      ok: false,
      response: badRequest(request, "Invalid request body", result.error.issues),
    };
  return { ok: true, data: result.data };
}
export function parseId(raw: string): number | null {
  return parseInteger(raw, { min: 1 });
}
export function parseQuery<T>(
  request: Context,
  schema: z.ZodType<T>,
):
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      response: Response;
    } {
  const result = schema.safeParse(request.req.query());
  if (!result.success)
    return { ok: false, response: badRequest(request, "Invalid query", result.error.issues) };
  return { ok: true, data: result.data };
}
/**
 * What the API answers for a Discogs error: Discogs' own 401 or 403, a token it refused and will
 * refuse again, so a page does not try once more; 502 for anything else, which may pass.
 */
export function discogsErrorStatus(error: DiscogsApiError): 401 | 403 | 502 {
  if (error.status === 401 || error.status === 403) return error.status;
  return 502;
}

export function discogsErrorMessage(error: DiscogsApiError): string {
  if (error.status === 401 || error.status === 403)
    return `Discogs answered ${error.status}: check the Discogs token in Settings and that it belongs to your Discogs username`;
  return `Discogs answered ${error.status}`;
}
/**
 * The account a wantlist change goes to, which the library's Discogs data then comes from; a
 * response instead when the change cannot go there.
 */
export function wantlistAccount(
  request: Context,
  context: AppContext,
):
  | {
      username: string;
    }
  | {
      response: Response;
    } {
  const { username } = context.getConfig().discogs;
  if (username === "")
    return { response: badRequest(request, "Set your Discogs username in Settings first") };
  if (!context.getDiscogs().hasToken())
    return { response: badRequest(request, "Set your Discogs token in Settings first") };
  const conflict = claimAccount(context.db, username);
  if (conflict !== null)
    return { response: request.json({ error: conflict } satisfies ApiError, 409) };
  return { username };
}
