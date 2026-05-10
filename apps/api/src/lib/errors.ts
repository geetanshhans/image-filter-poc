// Custom error class so handlers can throw with a status code and the global
// error middleware will translate it into the right HTTP response. Anything
// not a HttpError gets turned into a generic 500.

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const httpErrors = {
  badRequest: (code: string, message: string) => new HttpError(400, code, message),
  notFound: (code: string, message: string) => new HttpError(404, code, message),
  conflict: (code: string, message: string) => new HttpError(409, code, message),
  payloadTooLarge: (code: string, message: string) => new HttpError(413, code, message),
  unsupportedMediaType: (code: string, message: string) => new HttpError(415, code, message),
};
