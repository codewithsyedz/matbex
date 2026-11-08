/**
 * /storage/v1 — object storage.
 *
 * Authorization reuses the existing RLS policies on storage.objects: every
 * metadata read/write runs as the caller (asCaller), so a request succeeds
 * only if the same policies the app was built with allow it. Bytes live in
 * the configured driver under "<bucket>/<path>".
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { asCaller, sql, type DbClaims } from "../db.js";
import { badRequest, forbidden, HttpError, notFound } from "../lib/errors.js";
import { claimsFromHeader, sign, verify } from "../lib/jwt.js";
import { driver } from "./driver.js";

interface Bucket {
  id: string;
  public: boolean;
  file_size_limit: number | null;
  allowed_mime_types: string[] | null;
}

async function bucket(id: string): Promise<Bucket> {
  const [b] = await sql<Bucket[]>`select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = ${id}`;
  if (!b) throw notFound("Bucket not found", "NoSuchBucket");
  return b;
}

async function callerClaims(req: FastifyRequest): Promise<DbClaims> {
  try {
    return (await claimsFromHeader(req.headers.authorization)) as unknown as DbClaims;
  } catch {
    throw new HttpError(400, "invalid JWT", "InvalidJWT");
  }
}

const objectPath = (req: FastifyRequest) => decodeURIComponent((req.params as any)["*"] ?? "").replace(/^\/+/, "");

function mimeAllowed(allowed: string[] | null, type: string) {
  if (!allowed?.length) return true;
  return allowed.some((a) => a === type || (a.endsWith("/*") && type.startsWith(a.slice(0, -1))));
}

async function stream(reply: FastifyReply, key: string, meta: { mimetype?: string; cacheControl?: string } | null, download?: string) {
  const obj = await driver.get(key);
  if (!obj) throw notFound("Object not found", "NoSuchKey");
  reply.header("content-type", meta?.mimetype ?? "application/octet-stream");
  if (meta?.cacheControl) reply.header("cache-control", meta.cacheControl);
  if (obj.size !== undefined) reply.header("content-length", obj.size);
  if (download !== undefined) {
    const name = download || key.split("/").pop() || "download";
    reply.header("content-disposition", `attachment; filename="${encodeURIComponent(name)}"`);
  }
  return reply.send(obj.body);
}

export async function storageRoutes(app: FastifyInstance) {
  app.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: config.STORAGE_MAX_UPLOAD_MB * 1024 * 1024 }, (_r, body, done) => done(null, body));
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_r, body, done) => {
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch (e) {
      done(e as Error);
    }
  });

  // ---- upload (POST create / PUT update) ------------------------------------
  const upload = async (req: FastifyRequest<{ Params: { bucket: string } }>, upsertDefault: boolean) => {
    const b = await bucket(req.params.bucket);
    const name = objectPath(req);
    if (!name) throw badRequest("Object path required");
    let body = req.body as Buffer;
    const contentType = String(req.headers["content-type"] ?? "application/octet-stream").split(";")[0];
    if (contentType === "multipart/form-data") throw badRequest("Send the file as the raw request body");
    if (!Buffer.isBuffer(body)) body = Buffer.from(typeof body === "string" ? body : JSON.stringify(body ?? ""));
    if (b.file_size_limit && body.length > b.file_size_limit) throw new HttpError(413, "The object exceeded the maximum allowed size", "EntityTooLarge");
    if (!mimeAllowed(b.allowed_mime_types, contentType)) throw new HttpError(415, `mime type ${contentType} is not supported`, "InvalidMimeType");
    const upsert = String(req.headers["x-upsert"] ?? String(upsertDefault)) === "true";
    const cacheControl = (req.headers["cache-control"] as string | undefined) ?? "max-age=3600";
    const claims = await callerClaims(req);
    const metadata = { mimetype: contentType, size: body.length, cacheControl };

    const row = await asCaller(claims, async (tx) => {
      const owner = claims.sub || null;
      try {
        if (upsert) {
          const [r] = await tx<{ id: string }[]>`
            insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
            values (${b.id}, ${name}, ${owner}, ${owner}, ${tx.json(metadata)})
            on conflict (bucket_id, name) do update
              set metadata = excluded.metadata, updated_at = now(), owner = excluded.owner, owner_id = excluded.owner_id
            returning id`;
          return r;
        }
        const [r] = await tx<{ id: string }[]>`
          insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
          values (${b.id}, ${name}, ${owner}, ${owner}, ${tx.json(metadata)})
          returning id`;
        return r;
      } catch (e: any) {
        if (e?.code === "23505") throw new HttpError(409, "The resource already exists", "Duplicate");
        if (e?.code === "42501") throw forbidden("new row violates row-level security policy", "Unauthorized");
        throw e;
      }
    });

    await driver.put(`${b.id}/${name}`, body, contentType, cacheControl);
    return { Id: row.id, Key: `${b.id}/${name}`, id: row.id };
  };

  app.post<{ Params: { bucket: string } }>("/object/:bucket/*", (req) => upload(req, false));
  app.put<{ Params: { bucket: string } }>("/object/:bucket/*", (req) => upload(req, true));

  // ---- public read -------------------------------------------------------------
  app.get<{ Params: { bucket: string }; Querystring: { download?: string } }>("/object/public/:bucket/*", async (req, reply) => {
    const b = await bucket(req.params.bucket);
    if (!b.public) throw notFound("Object not found", "NoSuchKey");
    const name = objectPath(req);
    const [o] = await sql<{ metadata: any }[]>`select metadata from storage.objects where bucket_id = ${b.id} and name = ${name}`;
    reply.header("cache-control", "public, max-age=3600");
    return stream(reply, `${b.id}/${name}`, o?.metadata ?? null, req.query.download);
  });

  // ---- authenticated read --------------------------------------------------------
  const authedRead = async (req: FastifyRequest<{ Params: { bucket: string }; Querystring: { download?: string } }>, reply: FastifyReply) => {
    const name = objectPath(req);
    const claims = await callerClaims(req);
    const o = await asCaller(claims, async (tx) => {
      const [r] = await tx<{ metadata: any }[]>`select metadata from storage.objects where bucket_id = ${req.params.bucket} and name = ${name}`;
      return r;
    });
    if (!o) throw notFound("Object not found", "NoSuchKey");
    return stream(reply, `${req.params.bucket}/${name}`, o.metadata, req.query.download);
  };
  app.get("/object/authenticated/:bucket/*", authedRead as any);

  // ---- signed URLs ----------------------------------------------------------------
  app.post<{ Params: { bucket: string }; Body: { expiresIn?: number } }>("/object/sign/:bucket/*", async (req) => {
    const name = objectPath(req);
    const claims = await callerClaims(req);
    const visible = await asCaller(claims, async (tx) => {
      const [r] = await tx`select 1 from storage.objects where bucket_id = ${req.params.bucket} and name = ${name}`;
      return !!r;
    });
    if (!visible) throw notFound("Object not found", "NoSuchKey");
    const expiresIn = Math.max(1, Math.min(Number(req.body?.expiresIn ?? 60), 60 * 60 * 24 * 365));
    const token = await sign({ url: `${req.params.bucket}/${name}`, typ: "storage_sign" }, expiresIn);
    const encoded = name.split("/").map(encodeURIComponent).join("/");
    return { signedURL: `/object/sign/${req.params.bucket}/${encoded}?token=${token}` };
  });

  app.get<{ Params: { bucket: string }; Querystring: { token?: string; download?: string } }>("/object/sign/:bucket/*", async (req, reply) => {
    const name = objectPath(req);
    const payload = await verify<{ url: string; typ: string }>(String(req.query.token ?? "")).catch(() => null);
    if (!payload || payload.typ !== "storage_sign" || payload.url !== `${req.params.bucket}/${name}`) {
      throw new HttpError(400, "Invalid or expired signature", "InvalidSignature");
    }
    const [o] = await sql<{ metadata: any }[]>`select metadata from storage.objects where bucket_id = ${req.params.bucket} and name = ${name}`;
    return stream(reply, payload.url, o?.metadata ?? null, req.query.download);
  });

  // ---- delete ---------------------------------------------------------------------
  app.delete<{ Params: { bucket: string }; Body: { prefixes?: string[] } }>("/object/:bucket", async (req) => {
    const prefixes = (req.body?.prefixes ?? []).map((p) => p.replace(/^\/+/, ""));
    if (!prefixes.length) return [];
    const claims = await callerClaims(req);
    const removed = await asCaller(claims, (tx) =>
      tx<{ name: string; bucket_id: string }[]>`
        delete from storage.objects where bucket_id = ${req.params.bucket} and name = any(${prefixes})
        returning name, bucket_id`,
    );
    await driver.remove(removed.map((r) => `${r.bucket_id}/${r.name}`));
    return removed.map((r) => ({ name: r.name, bucket_id: r.bucket_id }));
  });

  // ---- list (folder-style) --------------------------------------------------------
  app.post<{ Params: { bucket: string }; Body: any }>("/object/list/:bucket", async (req: any) => {
    const prefix = String(req.body?.prefix ?? "").replace(/^\/+|\/+$/g, "");
    const limit = Math.min(Number(req.body?.limit ?? 100), 1000);
    const offset = Number(req.body?.offset ?? 0);
    const search = String(req.body?.search ?? "");
    const claims = await callerClaims(req);
    const like = prefix ? `${prefix}/%` : "%";
    const rows = await asCaller(claims, (tx) =>
      tx<{ id: string; name: string; metadata: any; created_at: Date; updated_at: Date; last_accessed_at: Date }[]>`
        select id, name, metadata, created_at, updated_at, last_accessed_at
        from storage.objects where bucket_id = ${req.params.bucket} and name like ${like}
        order by name`,
    );
    const seen = new Map<string, any>();
    for (const r of rows) {
      const rest = prefix ? r.name.slice(prefix.length + 1) : r.name;
      const [head, ...tail] = rest.split("/");
      if (search && !head.includes(search)) continue;
      if (tail.length) {
        if (!seen.has(head)) seen.set(head, { name: head, id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null });
      } else {
        seen.set(head, { name: head, id: r.id, updated_at: r.updated_at, created_at: r.created_at, last_accessed_at: r.last_accessed_at, metadata: r.metadata });
      }
    }
    return [...seen.values()].slice(offset, offset + limit);
  });

  // Legacy path used by some call sites: GET /object/<bucket>/<path> (authenticated).
  app.get("/object/:bucket/*", authedRead as any);
}
