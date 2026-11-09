#!/usr/bin/env node
/**
 * One-shot production move: hosted Supabase project → self-hosted Matbex stack.
 *
 *   npm --prefix server run migrate:from-supabase              # dry run: checks + plan, writes nothing
 *   npm --prefix server run migrate:from-supabase -- --yes     # do it
 *
 * Steps (in order; pick with --steps a,b or drop with --skip a,b):
 *   preflight  connectivity, permissions, schema drift, target already migrated, sizes
 *   auth       auth.users (bcrypt hashes kept) + verified/unverified TOTP factors
 *   data       every table in schema public, streamed with COPY
 *   sequences  public sequences + identity columns set to production's values
 *   storage    storage.buckets (upsert) + storage.objects rows
 *   files      object bytes: old Storage API → new S3/MinIO or local disk (skips files already copied)
 *   cron       cron.job rows (dashboard-created schedules), upserted by jobname
 *   urls       find stored absolute URLs pointing at the old host; rewrite them with --rewrite-urls
 *   verify     exact row counts, old vs new, for every copied table
 *
 * Every write runs with session_replication_role = replica, so no trigger fires: the
 * on_auth_user_created trigger does not create profiles, posting/ledger triggers do not
 * repost, and realtime NOTIFY stays quiet. Each table is copied in its own transaction,
 * so a failed run can be resumed: tables finished are recorded in the state file and
 * skipped next time (use --fresh to start over).
 *
 * Env (read from ../.env too):
 *   SOURCE_DATABASE_URL       old database. Use the direct connection or the session pooler
 *                             (port 5432), not the transaction pooler (6543).
 *   DATABASE_URL              new database, as the owner/superuser (same one db/migrate.mjs uses)
 *   SOURCE_SUPABASE_URL       https://<ref>.supabase.co      (files + urls steps)
 *   SOURCE_SERVICE_ROLE_KEY   old project's service_role key (files step)
 *   API_URL                   new public API URL, e.g. https://api.matbex.com (urls step)
 *   STORAGE_DRIVER, STORAGE_FS_ROOT, S3_*   where the new API keeps object bytes (as in .env)
 *
 * Options:
 *   --yes                 actually write (otherwise dry run)
 *   --fresh               ignore the state file and recopy everything
 *   --steps a,b / --skip a,b
 *   --exclude-table t,u   public tables to leave out of data + verify
 *   --rewrite-urls        in the urls step, replace the old host with API_URL (needs --yes)
 *   --allow-drift         continue when source columns/tables are missing in the target
 *   --concurrency N       parallel file copies (default 8)
 *   --report FILE         JSON report path (default migration-report-<time>.json)
 *   --state FILE          resume state path (default .migration-state.json)
 */
import postgres from "postgres";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

// ---------- env + args ---------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(resolve(here, "../../.env"));
} catch {
  /* no .env: rely on the environment */
}

const ALL_STEPS = ["preflight", "auth", "data", "sequences", "storage", "files", "cron", "urls", "verify"];
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = argv[i + 1];
  if (!v || v.startsWith("--")) throw new Error(`--${name} needs a value`);
  return v;
};
const list = (s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);

if (flag("help") || flag("h")) {
  const src = await readFile(fileURLToPath(import.meta.url), "utf8");
  console.log(src.slice(src.indexOf("/**") + 3, src.indexOf("*/")).replace(/^ \* ?/gm, ""));
  process.exit(0);
}

const WRITE = flag("yes");
const FRESH = flag("fresh");
const REWRITE_URLS = flag("rewrite-urls");
const ALLOW_DRIFT = flag("allow-drift");
const CONCURRENCY = Math.max(1, Number(opt("concurrency", "8")) || 8);
const EXCLUDE = new Set(list(opt("exclude-table", "")));
const REPORT_PATH = resolve(opt("report", `migration-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`));
const STATE_PATH = resolve(opt("state", ".migration-state.json"));

const wanted = list(opt("steps", "")) ;
const skipped = new Set(list(opt("skip", "")));
for (const s of [...wanted, ...skipped]) if (!ALL_STEPS.includes(s)) throw new Error(`unknown step "${s}" (steps: ${ALL_STEPS.join(", ")})`);
const STEPS = ALL_STEPS.filter((s) => (wanted.length ? wanted.includes(s) || s === "preflight" : true) && !skipped.has(s));

const SOURCE_URL = process.env.SOURCE_DATABASE_URL;
const TARGET_URL = process.env.DATABASE_URL;
const OLD_HOST = (process.env.SOURCE_SUPABASE_URL ?? "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SOURCE_SERVICE_ROLE_KEY ?? "";
const NEW_URL = (process.env.API_URL ?? "").replace(/\/+$/, "");

if (!SOURCE_URL || !TARGET_URL) {
  console.error("SOURCE_DATABASE_URL (old) and DATABASE_URL (new) are required. Run with --help for details.");
  process.exit(1);
}

// row_security=off makes the source error out instead of silently hiding rows RLS would filter.
const src = postgres(SOURCE_URL, { max: 4, onnotice: () => {}, connection: { application_name: "matbex-migrate", row_security: "off" } });
const dst = postgres(TARGET_URL, { max: 4, onnotice: () => {}, connection: { application_name: "matbex-migrate" } });

// ---------- report + logging -----------------------------------------------------
const report = {
  startedAt: new Date().toISOString(),
  mode: WRITE ? "write" : "dry-run",
  steps: {},
  warnings: [],
  errors: [],
};
const warn = (m) => {
  report.warnings.push(m);
  console.warn(`  ! ${m}`);
};
const log = (m) => console.log(`  ${m}`);
const fmtMs = (ms) => (ms < 1000 ? `${ms}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`);
const fmtBytes = (n) => (n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`);

class Abort extends Error {}

// ---------- catalog helpers -------------------------------------------------------
const q = (id) => `"${String(id).replace(/"/g, '""')}"`;
const rel = (schema, table) => `${q(schema)}.${q(table)}`;

async function tablesIn(sql, schema) {
  const rows = await sql`
    select c.relname as name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = ${schema} and c.relkind in ('r', 'p') and not c.relispartition
    order by c.relname`;
  return rows.map((r) => r.name);
}

async function columnsOf(sql, schema, table) {
  return sql`
    select a.attname as name, format_type(a.atttypid, a.atttypmod) as type,
           a.attgenerated <> '' as generated, a.attnotnull as notnull,
           (a.atthasdef or a.attidentity <> '') as has_default
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = ${schema} and c.relname = ${table} and a.attnum > 0 and not a.attisdropped
    order by a.attnum`;
}

async function count(sql, schema, table, where = "") {
  const [r] = await sql.unsafe(`select count(*)::bigint as n from ${rel(schema, table)} ${where}`);
  return Number(r.n);
}

/** Columns both sides have and the target can be written to (generated columns excluded). */
async function sharedColumns(schema, table) {
  const [s, d] = await Promise.all([columnsOf(src, schema, table), columnsOf(dst, schema, table)]);
  const dmap = new Map(d.map((c) => [c.name, c]));
  return s.filter((c) => !c.generated && dmap.has(c.name) && !dmap.get(c.name).generated).map((c) => c.name);
}

/*
 * COPY ... TO STDOUT runs on its own single connection, never the shared pool.
 * postgres.js 3.4.x pauses the socket when a copy chunk fills the stream buffer; if the
 * end-of-copy message arrives in the same packet the stream ends while the socket stays
 * paused, and the next query on that connection never gets its reply. After each copy we
 * call the stream's read hook (which resumes the socket) and health-check the connection,
 * replacing it if it is still stuck.
 */
const copyClient = () => postgres(SOURCE_URL, { max: 1, onnotice: () => {}, connection: { application_name: "matbex-migrate-copy", row_security: "off" } });
let srcCopy = copyClient();

const withTimeout = (p, ms, what) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000}s`)), ms).unref())]);

async function settleCopyConnection(reader) {
  try {
    reader._read?.();
  } catch {
    /* stream already gone */
  }
  try {
    await withTimeout(srcCopy`select 1`, 15_000, "source copy connection check");
  } catch {
    const stuck = srcCopy;
    srcCopy = copyClient();
    stuck.end({ timeout: 0 }).catch(() => {});
  }
}

/**
 * Streams one table old → new with COPY, in one target transaction with triggers off.
 * `clear` deletes the target rows first (inside the same transaction).
 */
async function copyTable(schema, table, { where = "", clear = false } = {}) {
  const cols = await sharedColumns(schema, table);
  if (!cols.length) throw new Error(`${schema}.${table}: no shared columns`);
  const colList = cols.map(q).join(", ");
  const t0 = Date.now();
  let reader;
  try {
    await dst.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      if (clear) await tx.unsafe(`delete from ${rel(schema, table)}`);
      reader = await srcCopy.unsafe(`copy (select ${colList} from ${rel(schema, table)} ${where}) to stdout`).readable();
      const writer = await tx.unsafe(`copy ${rel(schema, table)} (${colList}) from stdin`).writable();
      await pipeline(reader, writer);
    });
  } finally {
    if (reader) await settleCopyConnection(reader);
  }
  return Date.now() - t0;
}

async function readState() {
  if (FRESH) return { done: {} };
  try {
    return JSON.parse(await readFile(STATE_PATH, "utf8"));
  } catch {
    return { done: {} };
  }
}
async function markDone(state, key) {
  state.done[key] = new Date().toISOString();
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}

let publicTables = []; // decided in preflight

// ---------- steps -------------------------------------------------------------------
const steps = {
  async preflight() {
    const out = {};
    const [[sv], [dv]] = await Promise.all([
      src`select current_setting('server_version') as v, current_database() as db, current_user as u`,
      dst`select current_setting('server_version') as v, current_database() as db, current_user as u`,
    ]);
    log(`source: PostgreSQL ${sv.v}, db ${sv.db}, user ${sv.u}`);
    log(`target: PostgreSQL ${dv.v}, db ${dv.db}, user ${dv.u}`);
    out.source = sv;
    out.target = dv;

    // Never copy a database onto itself.
    const ident = async (sql) => {
      try {
        const [r] = await sql`select system_identifier::text as id from pg_control_system()`;
        return r.id;
      } catch {
        return null;
      }
    };
    const [sid, did] = await Promise.all([ident(src), ident(dst)]);
    if ((sid && did && sid === did && sv.db === dv.db) || SOURCE_URL === TARGET_URL) {
      throw new Abort("SOURCE_DATABASE_URL and DATABASE_URL point at the same database.");
    }

    if (/:6543(\/|$|\?)/.test(SOURCE_URL)) {
      warn("SOURCE_DATABASE_URL uses port 6543 (transaction pooler). Use the direct connection or session pooler on 5432.");
    }

    const [role] = await src`select rolsuper or rolbypassrls as ok from pg_roles where rolname = current_user`;
    if (!role?.ok) {
      warn(`source user ${sv.u} neither is superuser nor has BYPASSRLS; tables with FORCE RLS will fail to read (they will not be silently partial).`);
    }

    const [mig] = await dst`select to_regclass('platform.schema_migrations') is not null as ok`;
    if (!mig.ok) throw new Abort("Target has no schema yet. Run `npm run db:migrate` (or `docker compose run --rm migrate`) first.");
    const [{ n: applied }] = await dst`select count(*)::int as n from platform.schema_migrations`;
    log(`target has ${applied} migrations applied`);
    if (applied === 0) throw new Abort("Target has no migrations applied. Run the migrations first.");

    try {
      await dst.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
      });
    } catch (e) {
      throw new Abort(`Target user cannot disable triggers (session_replication_role): ${e.message}. Connect as the database superuser/owner.`);
    }

    // ---- schema drift (public) ----
    const [srcTables, dstTables] = await Promise.all([tablesIn(src, "public"), tablesIn(dst, "public")]);
    const dstSet = new Set(dstTables);
    const missingTables = srcTables.filter((t) => !dstSet.has(t) && !EXCLUDE.has(t));
    const drift = { missingTables, missingColumns: [], requiredColumnsWithoutSource: [], extraTargetTables: dstTables.filter((t) => !srcTables.includes(t)) };
    publicTables = srcTables.filter((t) => dstSet.has(t) && !EXCLUDE.has(t));

    for (const t of publicTables) {
      const [s, d] = await Promise.all([columnsOf(src, "public", t), columnsOf(dst, "public", t)]);
      const dmap = new Map(d.map((c) => [c.name, c]));
      const smap = new Set(s.map((c) => c.name));
      for (const c of s) if (!c.generated && !dmap.has(c.name)) drift.missingColumns.push(`${t}.${c.name}`);
      for (const c of d) if (c.notnull && !c.has_default && !c.generated && !smap.has(c.name)) drift.requiredColumnsWithoutSource.push(`${t}.${c.name}`);
    }
    out.drift = drift;
    log(`public tables to copy: ${publicTables.length}${EXCLUDE.size ? ` (excluded: ${[...EXCLUDE].join(", ")})` : ""}`);
    if (drift.extraTargetTables.length) log(`tables only in target (left as migrated): ${drift.extraTargetTables.length}`);
    const driftMsgs = [];
    if (missingTables.length) driftMsgs.push(`tables missing in target: ${missingTables.join(", ")}`);
    if (drift.missingColumns.length) driftMsgs.push(`columns missing in target (their data would be dropped): ${drift.missingColumns.join(", ")}`);
    if (drift.requiredColumnsWithoutSource.length) driftMsgs.push(`NOT NULL target columns with no default and no source column: ${drift.requiredColumnsWithoutSource.join(", ")}`);
    for (const m of driftMsgs) warn(m);
    if (driftMsgs.length && !ALLOW_DRIFT) {
      throw new Abort("Schema drift between production and the new schema (above). Add a migration, exclude the table, or pass --allow-drift.");
    }

    // ---- sizes + target state ----
    const [size] = await src`
      select coalesce(sum(pg_total_relation_size(c.oid)), 0)::bigint as bytes, coalesce(sum(greatest(c.reltuples, 0)), 0)::bigint as rows
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')`;
    out.sourcePublicBytes = Number(size.bytes);
    log(`source public schema: ~${fmtBytes(Number(size.bytes))}, ~${Number(size.rows).toLocaleString()} rows (estimate)`);
    try {
      const [o] = await src`select count(*)::bigint as n, coalesce(sum((metadata->>'size')::bigint), 0)::bigint as bytes from storage.objects`;
      out.sourceObjects = { count: Number(o.n), bytes: Number(o.bytes) };
      log(`source storage: ${Number(o.n).toLocaleString()} objects, ${fmtBytes(Number(o.bytes))}`);
    } catch (e) {
      warn(`could not read source storage.objects: ${e.message}`);
    }
    const [{ n: users }] = await src`select count(*)::int as n from auth.users`;
    log(`source users: ${users}`);

    const nonEmpty = [];
    for (const t of publicTables) {
      const [r] = await dst.unsafe(`select exists (select 1 from ${rel("public", t)}) as e`);
      if (r.e) nonEmpty.push(t);
    }
    out.targetNonEmptyTables = nonEmpty;
    if (nonEmpty.length) log(`target tables that already have rows (seed data or an earlier run; replaced during copy): ${nonEmpty.length}`);

    if (STEPS.includes("files") && (!OLD_HOST || !SERVICE_KEY)) {
      throw new Abort("The files step needs SOURCE_SUPABASE_URL and SOURCE_SERVICE_ROLE_KEY (or pass --skip files).");
    }
    if (STEPS.includes("urls") && !OLD_HOST) throw new Abort("The urls step needs SOURCE_SUPABASE_URL (or pass --skip urls).");
    if (REWRITE_URLS && !NEW_URL) throw new Abort("--rewrite-urls needs API_URL (the new public API URL).");
    if (STEPS.includes("files")) log(`files go to: ${storageTargetLabel()}`);
    return out;
  },

  async auth() {
    // Users: every column both sides share (bcrypt hashes come across unchanged).
    const users = await count(src, "auth", "users");
    if (!WRITE) return { users, planned: true };
    const ms = await copyTable("auth", "users", { clear: true });
    log(`auth.users: ${users} rows in ${fmtMs(ms)}`);
    // TOTP factors with a secret. Sessions/refresh tokens are not copied: everyone signs in once.
    const where = `where factor_type::text = 'totp' and secret is not null`;
    let factors = 0;
    try {
      factors = await count(src, "auth", "mfa_factors", where);
      await copyTable("auth", "mfa_factors", { where, clear: true });
      log(`auth.mfa_factors: ${factors} TOTP factors`);
    } catch (e) {
      warn(`MFA factors not copied: ${e.message}`);
    }
    return { users, factors, ms };
  },

  async data() {
    const state = await readState();
    const todo = publicTables.filter((t) => !state.done[`public.${t}`]);
    const resumed = publicTables.length - todo.length;
    if (resumed) log(`resuming: ${resumed} tables already copied (state file ${STATE_PATH}); use --fresh to recopy`);
    if (!WRITE) return { planned: todo.length };

    // Fresh run: clear all target tables in one TRUNCATE (FKs between them are fine because they're all listed).
    let clearPerTable = resumed > 0;
    if (!resumed && todo.length) {
      try {
        await dst.unsafe(`truncate ${todo.map((t) => rel("public", t)).join(", ")}`);
      } catch (e) {
        warn(`bulk TRUNCATE failed (${e.message}); clearing table by table instead`);
        clearPerTable = true;
      }
    }

    const tables = {};
    let i = 0;
    for (const t of todo) {
      i++;
      const n = await count(src, "public", t);
      const ms = await copyTable("public", t, { clear: clearPerTable });
      tables[t] = { rows: n, ms };
      await markDone(state, `public.${t}`);
      if (n > 0 || ms > 2000) log(`[${i}/${todo.length}] ${t}: ${n.toLocaleString()} rows in ${fmtMs(ms)}`);
    }
    const slow = Object.entries(tables).sort((a, b) => b[1].ms - a[1].ms).slice(0, 5);
    if (slow.length) log(`slowest: ${slow.map(([t, v]) => `${t} ${fmtMs(v.ms)}`).join(", ")}`);
    return { copied: todo.length, resumed, tables };
  },

  async sequences() {
    const seqs = await src`
      select sequencename as name, last_value::text as last_value
      from pg_sequences where schemaname = 'public'`;
    const existing = new Set((await dst`select sequencename as name from pg_sequences where schemaname = 'public'`).map((r) => r.name));
    let set = 0;
    const missing = [];
    for (const s of seqs) {
      if (!existing.has(s.name)) {
        missing.push(s.name);
        continue;
      }
      if (!WRITE) continue;
      const name = rel("public", s.name);
      if (s.last_value === null) await dst`select setval(${name}::regclass, 1, false)`;
      else await dst`select setval(${name}::regclass, ${s.last_value}::bigint, true)`;
      set++;
    }
    if (missing.length) warn(`sequences missing in target: ${missing.join(", ")}`);
    log(`${WRITE ? "set" : "would set"} ${WRITE ? set : seqs.length - missing.length} sequences`);
    return { set, missing };
  },

  async storage() {
    const buckets = await src`select * from storage.buckets order by id`;
    const objects = await count(src, "storage", "objects");
    if (!WRITE) {
      log(`would upsert ${buckets.length} buckets and copy ${objects.toLocaleString()} object rows`);
      return { buckets: buckets.length, objects, planned: true };
    }
    const cols = await sharedColumns("storage", "buckets");
    for (const b of buckets) {
      const row = Object.fromEntries(cols.map((c) => [c, b[c]]));
      const updates = cols.filter((c) => c !== "id");
      await dst.unsafe(
        `insert into storage.buckets (${cols.map(q).join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})
         on conflict (id) do update set ${updates.map((c) => `${q(c)} = excluded.${q(c)}`).join(", ")}`,
        cols.map((c) => row[c]),
      );
    }
    log(`storage.buckets: ${buckets.length} upserted (${buckets.map((b) => `${b.id}${b.public ? " (public)" : ""}`).join(", ")})`);
    const ms = await copyTable("storage", "objects", { clear: true });
    log(`storage.objects: ${objects.toLocaleString()} rows in ${fmtMs(ms)}`);
    return { buckets: buckets.length, objects, ms };
  },

  async files() {
    const rows = await src`
      select bucket_id, name, metadata->>'mimetype' as mimetype, metadata->>'cacheControl' as cache_control,
             nullif(metadata->>'size', '')::bigint as size
      from storage.objects where name is not null order by bucket_id, name`;
    const total = rows.reduce((a, r) => a + Number(r.size ?? 0), 0);
    log(`${rows.length.toLocaleString()} objects, ${fmtBytes(total)} → ${storageTargetLabel()}`);
    if (!WRITE) return { objects: rows.length, bytes: total, planned: true };

    const store = await storageTarget();
    const result = { copied: 0, skipped: 0, bytes: 0, missingAtSource: [], failed: [] };
    const t0 = Date.now();
    let done = 0;
    let lastLog = Date.now();

    const work = async (r) => {
      const key = `${r.bucket_id}/${r.name}`;
      try {
        const have = await store.size(key);
        if (have !== null && (r.size === null || Number(r.size) === have)) {
          result.skipped++;
          return;
        }
        const url = `${OLD_HOST}/storage/v1/object/${encodeURIComponent(r.bucket_id)}/${r.name.split("/").map(encodeURIComponent).join("/")}`;
        const res = await fetchRetry(url, { headers: { authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY } });
        if (res.status === 404 || res.status === 400) {
          result.missingAtSource.push(key);
          await res.body?.cancel();
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const body = Buffer.from(await res.arrayBuffer());
        await store.put(key, body, r.mimetype || res.headers.get("content-type") || "application/octet-stream", r.cache_control ? `max-age=${r.cache_control}` : undefined);
        result.copied++;
        result.bytes += body.length;
      } catch (e) {
        result.failed.push({ key, error: e.message });
      } finally {
        done++;
        if (Date.now() - lastLog > 10_000) {
          lastLog = Date.now();
          log(`files: ${done}/${rows.length} (${fmtBytes(result.bytes)} copied, ${result.failed.length} failed)`);
        }
      }
    };
    await pool(rows, CONCURRENCY, work);
    result.ms = Date.now() - t0;
    log(`files: ${result.copied} copied (${fmtBytes(result.bytes)}), ${result.skipped} already there, ${result.missingAtSource.length} missing at source, ${result.failed.length} failed, in ${fmtMs(result.ms)}`);
    if (result.missingAtSource.length) warn(`${result.missingAtSource.length} objects have a row but no bytes at the source (see report)`);
    if (result.failed.length) {
      report.errors.push(`${result.failed.length} files failed to copy; rerun with --steps files to retry`);
      for (const f of result.failed.slice(0, 5)) warn(`file failed: ${f.key}: ${f.error}`);
    }
    return result;
  },

  async cron() {
    let jobs;
    try {
      jobs = await src`select jobid, jobname, schedule, command, active from cron.job order by jobid`;
    } catch (e) {
      warn(`could not read source cron.job: ${e.message}`);
      return { jobs: 0 };
    }
    for (const j of jobs) {
      const target = /functions\/v1\/([a-z0-9-_]+)/i.exec(j.command)?.[1];
      log(`${j.active ? "on " : "off"} ${j.schedule.padEnd(14)} ${j.jobname ?? `(job ${j.jobid}, unnamed)`}${target ? ` → ${target}` : ""}`);
    }
    if (!WRITE) return { jobs: jobs.length, planned: true };
    let upserted = 0;
    let added = 0;
    for (const j of jobs) {
      if (j.jobname) {
        await dst`
          insert into cron.job (jobname, schedule, command, active) values (${j.jobname}, ${j.schedule}, ${j.command}, ${j.active})
          on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command, active = excluded.active`;
        upserted++;
      } else {
        const r = await dst`
          insert into cron.job (schedule, command, active)
          select ${j.schedule}, ${j.command}, ${j.active}
          where not exists (select 1 from cron.job where schedule = ${j.schedule} and command = ${j.command})
          returning jobid`;
        added += r.length;
      }
    }
    await dst`select setval(pg_get_serial_sequence('cron.job', 'jobid'), greatest((select max(jobid) from cron.job), 1))`;
    log(`cron.job: ${upserted} named jobs upserted, ${added} unnamed added. Function calls are dispatched in-process with the new service key.`);
    return { jobs: jobs.length, upserted, added };
  },

  async urls() {
    const hits = [];
    const cols = await dst`
      select c.table_name as t, c.column_name as c, c.data_type as type
      from information_schema.columns c
      join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
      where c.table_schema = 'public' and c.data_type in ('text', 'character varying', 'jsonb', 'json')
        and c.is_generated = 'NEVER'
      order by 1, 2`;
    const byTable = new Map();
    for (const r of cols) {
      if (!publicTables.includes(r.t)) continue;
      if (!byTable.has(r.t)) byTable.set(r.t, []);
      byTable.get(r.t).push(r);
    }
    const needle = `%${OLD_HOST.replace(/^https?:\/\//, "").replace(/[\\%_]/g, "\\$&")}%`;
    for (const [t, cs] of byTable) {
      const sel = cs.map((c, i) => `count(*) filter (where ${q(c.c)}::text like $1) as c${i}`).join(", ");
      const [r] = await dst.unsafe(`select ${sel} from ${rel("public", t)}`, [needle]);
      cs.forEach((c, i) => {
        const n = Number(r[`c${i}`]);
        if (n) hits.push({ table: t, column: c.c, type: c.type, rows: n });
      });
    }
    for (const h of hits) log(`${h.table}.${h.column}: ${h.rows} rows mention ${OLD_HOST}`);
    if (!hits.length) log(`no stored values mention ${OLD_HOST}`);

    if (!REWRITE_URLS || !WRITE) {
      if (hits.length) log(`rerun with --steps urls --rewrite-urls --yes to replace ${OLD_HOST} with ${NEW_URL || "$API_URL"}`);
      return { hits, rewritten: false };
    }
    const oldNoSlash = OLD_HOST;
    let updated = 0;
    await dst.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      for (const h of hits) {
        const expr = h.type === "jsonb" || h.type === "json" ? `replace(${q(h.column)}::text, $1, $2)::${h.type}` : `replace(${q(h.column)}, $1, $2)`;
        const r = await tx.unsafe(`update ${rel("public", h.table)} set ${q(h.column)} = ${expr} where ${q(h.column)}::text like $3`, [oldNoSlash, NEW_URL, needle]);
        updated += r.count;
      }
    });
    log(`rewrote ${updated} values: ${OLD_HOST} → ${NEW_URL}`);
    return { hits, rewritten: true, updated };
  },

  async verify() {
    const checks = [
      ...publicTables.map((t) => ({ schema: "public", table: t })),
      { schema: "auth", table: "users" },
      { schema: "auth", table: "mfa_factors", where: `where factor_type::text = 'totp' and secret is not null`, dstWhere: "" },
      { schema: "storage", table: "objects" },
    ];
    const rows = [];
    for (const c of checks) {
      const [s, d] = await Promise.all([count(src, c.schema, c.table, c.where ?? ""), count(dst, c.schema, c.table, c.dstWhere ?? c.where ?? "")]);
      rows.push({ table: `${c.schema}.${c.table}`, source: s, target: d, ok: s === d });
    }
    // Buckets: every production bucket must exist; the target may have extra ones from migrations.
    const [sb, db] = await Promise.all([src`select id from storage.buckets`, dst`select id from storage.buckets`]);
    const dbs = new Set(db.map((r) => r.id));
    const missingBuckets = sb.map((r) => r.id).filter((id) => !dbs.has(id));
    // Named cron jobs must exist.
    let missingJobs = [];
    try {
      const [sj, dj] = await Promise.all([src`select jobname from cron.job where jobname is not null`, dst`select jobname from cron.job where jobname is not null`]);
      const djs = new Set(dj.map((r) => r.jobname));
      missingJobs = sj.map((r) => r.jobname).filter((n) => !djs.has(n));
    } catch {
      /* no cron on source */
    }

    const bad = rows.filter((r) => !r.ok);
    const totalSrc = rows.reduce((a, r) => a + r.source, 0);
    log(`${rows.length - bad.length}/${rows.length} tables match (${totalSrc.toLocaleString()} rows in total)`);
    for (const r of bad) log(`MISMATCH ${r.table}: source ${r.source}, target ${r.target}`);
    if (missingBuckets.length) log(`MISSING buckets: ${missingBuckets.join(", ")}`);
    if (missingJobs.length) log(`MISSING cron jobs: ${missingJobs.join(", ")}`);
    if (!WRITE) log("(dry run: differences above are expected until the copy has run)");
    else if (bad.length || missingBuckets.length || missingJobs.length) {
      report.errors.push(`verify: ${bad.length} table count mismatches, ${missingBuckets.length} missing buckets, ${missingJobs.length} missing cron jobs`);
    }
    return { tables: rows, mismatches: bad.length, missingBuckets, missingJobs };
  },
};

// ---------- storage target (mirrors server/src/storage/driver.ts key layout: <bucket>/<name>) ----
function storageTargetLabel() {
  return process.env.STORAGE_DRIVER === "s3"
    ? `s3://${process.env.S3_BUCKET ?? "matbex"}${process.env.S3_ENDPOINT ? ` at ${process.env.S3_ENDPOINT}` : ""}`
    : `local disk ${resolve(here, "..", process.env.STORAGE_FS_ROOT ?? "./.data/storage")}`;
}

async function storageTarget() {
  if (process.env.STORAGE_DRIVER === "s3") {
    const { S3Client, HeadObjectCommand, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const Bucket = process.env.S3_BUCKET ?? "matbex";
    const s3 = new S3Client({
      region: process.env.S3_REGION ?? "us-east-1",
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: !/^(false|0|no)$/i.test(process.env.S3_FORCE_PATH_STYLE ?? "true"),
      credentials:
        process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
          : undefined,
    });
    return {
      async size(Key) {
        try {
          const h = await s3.send(new HeadObjectCommand({ Bucket, Key }));
          return h.ContentLength ?? 0;
        } catch (e) {
          if (e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404) return null;
          throw e;
        }
      },
      async put(Key, Body, ContentType, CacheControl) {
        await s3.send(new PutObjectCommand({ Bucket, Key, Body, ContentType, CacheControl }));
      },
    };
  }
  // The API resolves STORAGE_FS_ROOT relative to its working directory (server/ in dev).
  const root = resolve(here, "..", process.env.STORAGE_FS_ROOT ?? "./.data/storage");
  const path = (key) => {
    const p = resolve(join(root, key));
    if (!p.startsWith(root + "/")) throw new Error(`invalid object key ${key}`);
    return p;
  };
  return {
    async size(key) {
      try {
        return (await stat(path(key))).size;
      } catch {
        return null;
      }
    },
    async put(key, body) {
      const p = path(key);
      await mkdir(dirname(p), { recursive: true });
      const tmp = `${p}.part`;
      await pipeline(Readable.from(body), createWriteStream(tmp));
      await import("node:fs/promises").then((fs) => fs.rename(tmp, p)).catch(async (e) => {
        await rm(tmp, { force: true });
        throw e;
      });
    },
  };
}

async function fetchRetry(url, init, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
      if ((res.status >= 500 || res.status === 429) && i < tries) {
        await res.body?.cancel();
        await new Promise((r) => setTimeout(r, 500 * 2 ** i));
        continue;
      }
      return res;
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
}

async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

// ---------- main --------------------------------------------------------------------
let exitCode = 0;
const t0 = Date.now();
console.log(`Matbex production move — ${WRITE ? "WRITE MODE" : "dry run (nothing is written; add --yes to copy)"}`);
console.log(`steps: ${STEPS.join(" → ")}\n`);
try {
  for (const name of STEPS) {
    console.log(`▸ ${name}`);
    const s0 = Date.now();
    const result = await steps[name]();
    const ms = Date.now() - s0;
    report.steps[name] = { ms, ...result };
    console.log(`  done in ${fmtMs(ms)}\n`);
  }
} catch (e) {
  exitCode = 1;
  report.errors.push(e.message);
  console.error(`\n✗ ${e instanceof Abort ? "" : "failed: "}${e.message}`);
  if (!(e instanceof Abort) && e.stack) console.error(e.stack.split("\n").slice(1, 4).join("\n"));
} finally {
  report.finishedAt = new Date().toISOString();
  report.totalMs = Date.now() - t0;
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
  await Promise.allSettled([src.end({ timeout: 5 }), srcCopy.end({ timeout: 5 }), dst.end({ timeout: 5 })]);
}
if (report.errors.length) exitCode = 1;
console.log(`${exitCode ? "✗ finished with problems" : "✓ finished"} in ${fmtMs(report.totalMs)} — report: ${REPORT_PATH}`);
if (!WRITE && !exitCode) console.log("Dry run only. Rerun with --yes to copy.");
process.exit(exitCode);
