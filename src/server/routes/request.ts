import { parseInteger } from "../../shared/integer.ts";
import { type Context } from "hono";
import type { z } from "zod";
import { type ApiError } from "../../shared/api.ts";
import { claimAccount } from "../db/memberships.ts";
import { DiscogsApiError, DiscogsUserNotFoundError } from "../discogs/client.ts";
import type { AppContext } from "../context.ts";

export function badRequest(c: Context, message: string, issues?: unknown): Response {
  const body: ApiError = { error: message, issues };
  return c.json(body, 400);
}
export async function parseJson<T>(
  c: Context,
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
  const text = await c.req.text();
  if (text.trim() !== "") {
    // A page on another site can send a text/plain body without asking the browser first.
    if (!c.req.header("content-type")?.startsWith("application/json"))
      return {
        ok: false,
        response: c.json({ error: "Send the body as application/json" } satisfies ApiError, 415),
      };
    try {
      raw = JSON.parse(text);
    } catch {
      return { ok: false, response: badRequest(c, "Body is not valid JSON") };
    }
  }
  const result = schema.safeParse(raw);
  if (!result.success)
    return {
      ok: false,
      response: badRequest(c, "Invalid request body", result.error.issues),
    };
  return { ok: true, data: result.data };
}
/** The id in the route's `name` parameter; null when it is not a positive integer. */
export function paramId(c: Context, name: string): number | null {
  return parseInteger(c.req.param(name) ?? "", { min: 1 });
}
export function parseQuery<T>(
  c: Context,
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
  const result = schema.safeParse(c.req.query());
  if (!result.success)
    return { ok: false, response: badRequest(c, "Invalid query", result.error.issues) };
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
  if (error instanceof DiscogsUserNotFoundError) return error.message;
  if (error.status === 401 || error.status === 403)
    return `Discogs answered ${error.status}: check the Discogs token in Settings and that it belongs to your Discogs username`;
  return `Discogs answered ${error.status}`;
}
/**
 * The account a wantlist change goes to, which the library's Discogs data then comes from; a
 * response instead when the change cannot go there.
 */
export function wantlistAccount(
  c: Context,
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
    return { response: badRequest(c, "Set your Discogs username in Settings first") };
  if (!context.getDiscogs().hasToken())
    return { response: badRequest(c, "Set your Discogs token in Settings first") };
  const conflict = claimAccount(context.db, username);
  if (conflict !== null) return { response: c.json({ error: conflict } satisfies ApiError, 409) };
  return { username };
}
