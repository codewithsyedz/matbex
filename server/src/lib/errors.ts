export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    /** Extra machine-readable context returned to the client as `details`. */
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, code = "validation_failed") => new HttpError(400, msg, code);
export const unauthorized = (msg = "Unauthorized", code = "unauthorized") => new HttpError(401, msg, code);
export const forbidden = (msg = "Forbidden", code = "forbidden") => new HttpError(403, msg, code);
export const notFound = (msg = "Not found", code = "not_found") => new HttpError(404, msg, code);
