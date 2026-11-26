#!/usr/bin/env node
/**
 * Copy storage files from the old (Lovable Cloud / Supabase) project into the new stack
 * WITHOUT the old service-role key, which Lovable Cloud does not expose.
 *
 *   node scripts/copy-supabase-files.mjs                          # dry run: what would be copied
 *   node scripts/copy-supabase-files.mjs --yes                    # public buckets only
 *   node scripts/copy-supabase-files.mjs --yes --email you@x.com  # + private files that account can read
 *
 * The file list comes from the NEW database (storage.objects, copied by migrate-from-supabase.mjs),
 * so no connection to the old database is needed.
 *   - public buckets: downloaded from /storage/v1/object/public/... (no login)
 *   - private buckets: with --email, signs in to the old project with the public (anon) key and
 *     the password typed at a hidden prompt (never stored or printed), then downloads with that
 *     user's token. What it can read is decided by the old project's storage policies: a
 *     superadmin reads every expense receipt, other buckets only for that user's restaurants.
 * Files already present with the same size are skipped, so it can be rerun (e.g. with another
 * account for the files the first one could not read). Supabase answers 400/404 both for a
 * missing file and for one the account may not read; those are listed as "not readable".
 *
 * Env: DATABASE_URL (new database), SOURCE_SUPABASE_URL, SOURCE_ANON_KEY (old public key),
 *      STORAGE_DRIVER / STORAGE_FS_ROOT / S3_* (where the new API keeps files, as in .env).
 * Options: --yes, --email <address>, --bucket a,b, --concurrency N (default 6), --report FILE
 */
import postgres from "postgres";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const here = dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(resolve(here, "../../.env"));
} catch {
  /* rely on the environment */
}

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
const WRITE = flag("yes");
const EMAIL = opt("email", "");
const BUCKETS = (opt("bucket", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
const CONCURRENCY = Number(opt("concurrency", "6"));
const REPORT = opt("report", `files-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const OLD = (process.env.SOURCE_SUPABASE_URL ?? "").replace(/\/+$/, "");
const ANON = process.env.SOURCE_ANON_KEY ?? "";
if (!process.env.DATABASE_URL || !OLD) {
  console.error("Needs DATABASE_URL (new database) and SOURCE_SUPABASE_URL.");
  process.exit(2);
}
if (EMAIL && !ANON) {
  console.error("--email needs SOURCE_ANON_KEY (the old project's public/anon key).");
  process.exit(2);
}

const fmtBytes = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${(n / 1024).toFixed(1)} kB` : `${n} B`);
const enc = (name) => name.split("/").map(encodeURIComponent).join("/");

// ---- where the new API keeps files (same layout as the API: <bucket>/<name>) -------------
async function storageTarget() {
  if (process.env.STORAGE_DRIVER === "s3") {
    const { S3Client, HeadObjectCommand, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const Bucket = process.env.S3_BUCKET ?? "matbex";
    const s3 = new S3Client({
      region: process.env.S3_REGION ?? "us-east-1",
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: !/^(false|0|no)$/i.test(process.env.S3_FORCE_PATH_STYLE ?? "true"),
      credentials: process.env.S3_ACCESS_KEY_ID ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } : undefined,
    });
    return {
      label: `s3://${Bucket}`,
      async size(Key) {
        try {
          return (await s3.send(new HeadObjectCommand({ Bucket, Key }))).ContentLength ?? 0;
        } catch (e) {
          if (e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404) return null;
          throw e;
        }
      },
      put: (Key, Body, ContentType) => s3.send(new PutObjectCommand({ Bucket, Key, Body, ContentType })),
    };
  }
  const root = resolve(here, "..", process.env.STORAGE_FS_ROOT ?? "./.data/storage");
  const path = (key) => {
    const p = resolve(join(root, key));
    if (!p.startsWith(root + "/")) throw new Error(`invalid object key ${key}`);
    return p;
  };
  return {
    label: root,
    async size(key) {
      try {
        return (await stat(path(key))).size;
      } catch {
        return null;
      }
    },
    async put(key, body) {
      await mkdir(dirname(path(key)), { recursive: true });
      await writeFile(path(key), body);
    },
  };
}

// ---- sign-in to the old project (password at a hidden prompt) -----------------------------
function askHidden(question) {
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.includes(question)) rl.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      done(answer);
    });
  });
}

let session = null; // { access_token, refresh_token, expires_at }
async function signIn() {
  if (!process.stdin.isTTY) throw new Error("--email needs an interactive terminal for the password prompt (docker run -it, ssh -t)");
  const password = await askHidden(`Password for ${EMAIL} on the old project: `);
  const res = await fetch(`${OLD}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`sign-in failed: ${body.error_description ?? body.msg ?? res.status}`);
  session = { ...body, expires_at: Math.floor(Date.now() / 1000) + (body.expires_in ?? 3600) };
  if (body.user?.factors?.some?.((f) => f.status === "verified")) {
    console.log("  note: this account has two-factor auth; private files may need an aal2 session.");
  }
}
let refreshing = null;
async function token() {
  if (session && session.expires_at - Math.floor(Date.now() / 1000) < 120) {
    refreshing ??= (async () => {
      const res = await fetch(`${OLD}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { apikey: ANON, "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      });
      const body = await res.json();
      if (!res.ok || !body.access_token) throw new Error(`token refresh failed: ${res.status}`);
      session = { ...body, expires_at: Math.floor(Date.now() / 1000) + (body.expires_in ?? 3600) };
    })().finally(() => (refreshing = null));
    await refreshing;
  }
  return session?.access_token;
}

async function fetchRetry(url, init, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, init);
      if (res.status >= 500 && i < tries) {
        await res.body?.cancel();
        throw new Error(`HTTP ${res.status}`);
      }
      return res;
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
}

// ---- main -------------------------------------------------------------------------------
const db = postgres(process.env.DATABASE_URL, { max: 2, onnotice: () => {} });
const rows = await db`
  select o.bucket_id, o.name, b.public, nullif(o.metadata->>'size', '')::bigint as size, o.metadata->>'mimetype' as mimetype
  from storage.objects o join storage.buckets b on b.id = o.bucket_id
  where o.name is not null ${BUCKETS.length ? db`and o.bucket_id = any(${BUCKETS})` : db``}
  order by o.bucket_id, o.name`;
await db.end();

const store = await storageTarget();
const perBucket = {};
for (const r of rows) {
  const b = (perBucket[r.bucket_id] ??= { public: r.public, files: 0, bytes: 0 });
  b.files++;
  b.bytes += Number(r.size ?? 0);
}
console.log(`${WRITE ? "Copying" : "Dry run:"} ${rows.length} files from ${OLD} → ${store.label}`);
for (const [b, v] of Object.entries(perBucket)) {
  console.log(`  ${b.padEnd(22)} ${v.public ? "public " : "private"} ${String(v.files).padStart(6)} files ${fmtBytes(v.bytes).padStart(10)}${!v.public && !EMAIL ? "  (skipped: needs --email)" : ""}`);
}
if (!WRITE) process.exit(0);
if (EMAIL && rows.some((r) => !r.public)) await signIn();

const result = { copied: 0, skipped: 0, bytes: 0, notReadable: [], failed: [], skippedPrivate: 0 };
let done = 0;
let last = Date.now();
const queue = [...rows];
const t0 = Date.now();
async function worker() {
  for (let r = queue.shift(); r; r = queue.shift()) {
    const key = `${r.bucket_id}/${r.name}`;
    try {
      if (!r.public && !EMAIL) {
        result.skippedPrivate++;
        continue;
      }
      const have = await store.size(key);
      if (have !== null && (r.size === null || Number(r.size) === have)) {
        result.skipped++;
        continue;
      }
      const url = r.public
        ? `${OLD}/storage/v1/object/public/${encodeURIComponent(r.bucket_id)}/${enc(r.name)}`
        : `${OLD}/storage/v1/object/authenticated/${encodeURIComponent(r.bucket_id)}/${enc(r.name)}`;
      const headers = r.public ? {} : { authorization: `Bearer ${await token()}`, apikey: ANON };
      const res = await fetchRetry(url, { headers });
      if ([400, 403, 404].includes(res.status)) {
        result.notReadable.push(key);
        await res.body?.cancel();
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = Buffer.from(await res.arrayBuffer());
      await store.put(key, body, r.mimetype || res.headers.get("content-type") || "application/octet-stream");
      result.copied++;
      result.bytes += body.length;
    } catch (e) {
      result.failed.push({ key, error: e.message });
    } finally {
      done++;
      if (Date.now() - last > 10_000) {
        last = Date.now();
        console.log(`  ${done}/${rows.length} (${fmtBytes(result.bytes)} copied, ${result.notReadable.length} not readable, ${result.failed.length} failed)`);
      }
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
result.ms = Date.now() - t0;
console.log(
  `copied ${result.copied} (${fmtBytes(result.bytes)}), ${result.skipped} already there, ` +
    `${result.notReadable.length} not readable (missing or no access), ${result.skippedPrivate} private skipped, ${result.failed.length} failed, in ${(result.ms / 1000).toFixed(1)} s`,
);
const nr = {};
for (const k of result.notReadable) nr[k.split("/")[0]] = (nr[k.split("/")[0]] ?? 0) + 1;
if (result.notReadable.length) console.log("  not readable per bucket:", JSON.stringify(nr));
for (const f of result.failed.slice(0, 5)) console.log(`  failed: ${f.key}: ${f.error}`);
await writeFile(REPORT, JSON.stringify({ at: new Date().toISOString(), source: OLD, email: EMAIL || null, perBucket, ...result }, null, 2));
console.log(`report: ${REPORT}`);
process.exit(result.failed.length ? 1 : 0);
