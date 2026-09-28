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

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet (planned for a later session)`);
    this.name = "NotImplementedError";
  }
}
