/** Object storage client for the Matbex API (/storage/v1). */
import { StorageError } from "./errors";

type R<T> = { data: T; error: StorageError | null };
type AuthedFetch = (input: string, init?: RequestInit) => Promise<Response>;

const encodePath = (p: string) => p.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");

async function fail(res: Response): Promise<StorageError> {
  let msg = res.statusText;
  try {
    const j = await res.json();
    msg = j.message ?? j.error ?? msg;
  } catch { /* not json */ }
  return new StorageError(msg, res.status);
}

export class BucketApi {
  constructor(private base: string, private bucket: string, private f: AuthedFetch) {}

  async upload(
    path: string,
    body: Blob | File | ArrayBuffer | ArrayBufferView | FormData | string,
    opts: { upsert?: boolean; contentType?: string; cacheControl?: string } = {},
  ): Promise<R<{ id: string; path: string; fullPath: string } | null>> {
    return this.write("POST", path, body, opts);
  }

  async update(
    path: string,
    body: Blob | File | ArrayBuffer | ArrayBufferView | FormData | string,
    opts: { contentType?: string; cacheControl?: string } = {},
  ) {
    return this.write("PUT", path, body, { ...opts, upsert: true });
  }

  private async write(
    method: string,
    path: string,
    body: any,
    opts: { upsert?: boolean; contentType?: string; cacheControl?: string },
  ): Promise<R<{ id: string; path: string; fullPath: string } | null>> {
    const headers: Record<string, string> = { "x-upsert": String(!!opts.upsert) };
    if (opts.cacheControl) headers["cache-control"] = `max-age=${opts.cacheControl}`;
    const type = opts.contentType ?? (typeof Blob !== "undefined" && body instanceof Blob ? body.type : undefined);
    if (type) headers["content-type"] = type;
    else if (!(typeof FormData !== "undefined" && body instanceof FormData)) headers["content-type"] = "application/octet-stream";
    try {
      const res = await this.f(`${this.base}/object/${this.bucket}/${encodePath(path)}`, { method, headers, body });
      if (!res.ok) return { data: null, error: await fail(res) };
      const j = await res.json();
      return { data: { id: j.id, path, fullPath: j.Key ?? `${this.bucket}/${path}` }, error: null };
    } catch (e: any) {
      return { data: null, error: new StorageError(e?.message ?? "upload failed") };
    }
  }

  async download(path: string): Promise<R<Blob | null>> {
    try {
      const res = await this.f(`${this.base}/object/authenticated/${this.bucket}/${encodePath(path)}`);
      if (!res.ok) return { data: null, error: await fail(res) };
      return { data: await res.blob(), error: null };
    } catch (e: any) {
      return { data: null, error: new StorageError(e?.message ?? "download failed") };
    }
  }

  getPublicUrl(path: string, opts: { download?: boolean | string } = {}) {
    const q = opts.download ? `?download=${opts.download === true ? "" : encodeURIComponent(opts.download)}` : "";
    return { data: { publicUrl: `${this.base}/object/public/${this.bucket}/${encodePath(path)}${q}` } };
  }

  async createSignedUrl(path: string, expiresIn: number, opts: { download?: boolean | string } = {}): Promise<R<{ signedUrl: string } | null>> {
    try {
      const res = await this.f(`${this.base}/object/sign/${this.bucket}/${encodePath(path)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expiresIn }),
      });
      if (!res.ok) return { data: null, error: await fail(res) };
      const j = await res.json();
      const dl = opts.download ? `&download=${opts.download === true ? "" : encodeURIComponent(opts.download)}` : "";
      return { data: { signedUrl: `${this.base}${j.signedURL}${dl}` }, error: null };
    } catch (e: any) {
      return { data: null, error: new StorageError(e?.message ?? "sign failed") };
    }
  }

  async createSignedUrls(paths: string[], expiresIn: number): Promise<R<{ path: string; signedUrl: string; error: string | null }[] | null>> {
    const out = await Promise.all(paths.map((p) => this.createSignedUrl(p, expiresIn)));
    return {
      data: out.map((r, i) => ({ path: paths[i], signedUrl: r.data?.signedUrl ?? "", error: r.error?.message ?? null })),
      error: null,
    };
  }

  async remove(paths: string[]): Promise<R<{ name: string }[] | null>> {
    try {
      const res = await this.f(`${this.base}/object/${this.bucket}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prefixes: paths }),
      });
      if (!res.ok) return { data: null, error: await fail(res) };
      return { data: await res.json(), error: null };
    } catch (e: any) {
      return { data: null, error: new StorageError(e?.message ?? "remove failed") };
    }
  }

  async list(prefix = "", opts: { limit?: number; offset?: number; search?: string; sortBy?: { column: string; order: string } } = {}): Promise<R<any[] | null>> {
    try {
      const res = await this.f(`${this.base}/object/list/${this.bucket}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prefix, limit: opts.limit ?? 100, offset: opts.offset ?? 0, search: opts.search, sortBy: opts.sortBy }),
      });
      if (!res.ok) return { data: null, error: await fail(res) };
      return { data: await res.json(), error: null };
    } catch (e: any) {
      return { data: null, error: new StorageError(e?.message ?? "list failed") };
    }
  }
}

export class StorageClient {
  constructor(private base: string, private f: AuthedFetch) {}
  from(bucket: string) {
    return new BucketApi(this.base, bucket, this.f);
  }
}
