export class DiscogsApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, message?: string) {
    super(message ?? `Discogs API ${status}: ${body.slice(0, 200)}`);
    this.name = "DiscogsApiError";
    this.status = status;
    this.body = body;
  }
}

/** Discogs has no user of the name, as after a profile rename; it answers 404 for it. */
export class DiscogsUserNotFoundError extends DiscogsApiError {
  constructor(username: string, body: string) {
    super(
      404,
      body,
      `Discogs has no user named ${username}: check the Discogs username in Settings`,
    );
    this.name = "DiscogsUserNotFoundError";
  }
}
