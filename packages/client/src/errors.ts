/** Error shape returned by the data API (PostgREST-compatible). */
export interface DbError {
  message: string;
  details: string | null;
  hint: string | null;
  code: string;
}

export class DbRequestError extends Error implements DbError {
  details: string | null;
  hint: string | null;
  code: string;
  constructor(e: DbError) {
    super(e.message);
    this.name = "DbRequestError";
    this.details = e.details;
    this.hint = e.hint;
    this.code = e.code;
  }
  toJSON() {
    return { message: this.message, details: this.details, hint: this.hint, code: this.code };
  }
}

export class AuthError extends Error {
  status?: number;
  code?: string;
  __isAuthError = true;
  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

export class StorageError extends Error {
  statusCode?: string;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "StorageError";
    this.statusCode = statusCode != null ? String(statusCode) : undefined;
  }
}

export class FunctionsError extends Error {
  context: any;
  constructor(message: string, name = "FunctionsError", context?: any) {
    super(message);
    this.name = name;
    this.context = context;
  }
}
/** Non-2xx from a function. `context` is the raw Response (call .json()/.text()). */
export class FunctionsHttpError extends FunctionsError {
  constructor(context: Response) {
    super("Function returned a non-2xx status code", "FunctionsHttpError", context);
  }
}
export class FunctionsFetchError extends FunctionsError {
  constructor(context: unknown) {
    super("Failed to send a request to the function", "FunctionsFetchError", context);
  }
}
export class FunctionsRelayError extends FunctionsError {
  constructor(context: unknown) {
    super("Relay error invoking the function", "FunctionsRelayError", context);
  }
}

export const isAuthError = (e: unknown): e is AuthError =>
  typeof e === "object" && e !== null && "__isAuthError" in e;
