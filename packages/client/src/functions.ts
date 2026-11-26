/** Server functions client: POST {api}/functions/v1/{name}. */
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "./errors";

type AuthedFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface InvokeOptions {
  body?: unknown;
  headers?: Record<string, string>;
  method?: "POST" | "GET" | "PUT" | "PATCH" | "DELETE";
}

export class FunctionsClient {
  constructor(private base: string, private f: AuthedFetch) {}

  async invoke<T = any>(name: string, opts: InvokeOptions = {}): Promise<{ data: T | null; error: any }> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    let body: BodyInit | undefined;
    const b = opts.body;
    if (b !== undefined && b !== null) {
      if (
        typeof b === "string" ||
        (typeof Blob !== "undefined" && b instanceof Blob) ||
        b instanceof ArrayBuffer ||
        (typeof FormData !== "undefined" && b instanceof FormData) ||
        (typeof ReadableStream !== "undefined" && b instanceof ReadableStream)
      ) {
        body = b as BodyInit;
        if (typeof b === "string" && !headers["Content-Type"]) headers["Content-Type"] = "text/plain";
      } else {
        body = JSON.stringify(b);
        if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
      }
    }

    let res: Response;
    try {
      res = await this.f(`${this.base}/${name}`, { method: opts.method ?? "POST", headers, body });
    } catch (e) {
      return { data: null, error: new FunctionsFetchError(e) };
    }
    if (res.headers.get("x-relay-error") === "true") return { data: null, error: new FunctionsRelayError(res) };
    if (!res.ok) return { data: null, error: new FunctionsHttpError(res) };

    const type = (res.headers.get("Content-Type") ?? "text/plain").split(";")[0].trim();
    let data: any;
    if (type === "application/json") data = await res.json();
    else if (type === "application/octet-stream" || type === "application/pdf" || type.startsWith("image/")) data = await res.blob();
    else if (type === "text/event-stream") data = res;
    else if (type === "multipart/form-data") data = await res.formData();
    else data = await res.text();
    return { data, error: null };
  }
}
