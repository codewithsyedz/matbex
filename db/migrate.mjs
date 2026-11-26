#!/usr/bin/env node
/**
 * Matbex database migration runner (plain PostgreSQL).
 *
 *   node db/migrate.mjs              apply platform bootstrap + pending migrations
 *   node db/migrate.mjs --baseline   mark every migration as applied without
 *                                    running it (use once after importing an
 *                                    existing production dump)
 *   node db/migrate.mjs --status     list pending migrations
 *   node db/migrate.mjs new <name>   create db/migrations/<timestamp>_<name>.sql
 *
 * Env:
 *   DATABASE_URL              superuser / owner connection string (required)
 *   AUTHENTICATOR_PASSWORD    password for the low-privilege `authenticator`
 *                             role PostgREST + the API connect as
 *   APP_SETTINGS_JSON         optional JSON of database GUCs, e.g.
 *                             {"app.settings.api_url":"https://api.matbex.com"}
 *
 * Every file runs in its own transaction. Files are applied in lexical order.
 */
import postgres from "postgres";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PLATFORM_DIR = join(here, "platform");
const MIGRATIONS_DIR = join(here, "migrations");

const args = process.argv.slice(2);
const cmd = args[0] ?? "up";

if (cmd === "new") {
  const name = (args[1] ?? "").replace(/[^a-z0-9_]+/gi, "_").toLowerCase();
  if (!name) throw new Error("usage: migrate.mjs new <name>");
  const ts = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const file = join(MIGRATIONS_DIR, `${ts}_${name}.sql`);
  writeFileSync(file, `-- ${name}\n`);
  console.log(`created ${file}`);
  process.exit(0);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });

/**
 * Hosted-platform extensions that are provided by db/platform instead.
 * Statements creating them are stripped before a migration runs.
 */
const PLATFORM_EXTENSIONS = /CREATE\s+EXTENSION\s+(IF\s+NOT\s+EXISTS\s+)?"?(pg_cron|pg_net|pg_graphql|pgsodium|supabase_vault|pgjwt)"?[^;]*;/gi;

function prepare(text) {
  return text.replace(PLATFORM_EXTENSIONS, "-- [matbex] platform extension provided by db/platform\n");
}

const checksum = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const listSql = (dir) => readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

async function runPlatform() {
  for (const f of listSql(PLATFORM_DIR)) {
    await sql.begin((tx) => tx.unsafe(readFileSync(join(PLATFORM_DIR, f), "utf8")));
  }
  if (process.env.AUTHENTICATOR_PASSWORD) {
    const pw = process.env.AUTHENTICATOR_PASSWORD.replace(/'/g, "''");
    await sql.unsafe(`ALTER ROLE authenticator WITH LOGIN PASSWORD '${pw}'`);
  }
  if (process.env.APP_SETTINGS_JSON) {
    const settings = JSON.parse(process.env.APP_SETTINGS_JSON);
    const [{ db }] = await sql`select current_database() as db`;
    for (const [k, v] of Object.entries(settings)) {
      if (!/^[a-z_]+\.[a-z_.]+$/i.test(k)) throw new Error(`bad setting name ${k}`);
      await sql.unsafe(`ALTER DATABASE "${db}" SET ${k} = '${String(v).replace(/'/g, "''")}'`);
    }
  }
}

async function applied() {
  const rows = await sql`select name, checksum from platform.schema_migrations`;
  return new Map(rows.map((r) => [r.name, r.checksum]));
}

async function main() {
  await runPlatform();
  const done = await applied();
  const files = listSql(MIGRATIONS_DIR);
  const pending = files.filter((f) => !done.has(f));

  if (cmd === "--status" || cmd === "status") {
    console.log(`${files.length - pending.length} applied, ${pending.length} pending`);
    pending.forEach((f) => console.log(`  pending  ${f}`));
    return;
  }

  if (cmd === "--baseline" || cmd === "baseline") {
    for (const f of pending) {
      const text = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
      await sql`insert into platform.schema_migrations (name, checksum) values (${f}, ${checksum(text)})`;
    }
    console.log(`baselined ${pending.length} migrations`);
  } else {
    for (const f of pending) {
      const text = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
      const started = Date.now();
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(prepare(text));
          await tx`insert into platform.schema_migrations (name, checksum) values (${f}, ${checksum(text)})`;
        });
      } catch (err) {
        console.error(`\n✗ ${f}\n  ${err.message}`);
        if (err.position) console.error(`  at character ${err.position}`);
        process.exitCode = 1;
        return;
      }
      console.log(`✓ ${f} (${Date.now() - started}ms)`);
    }
    console.log(`applied ${pending.length} migrations`);
  }

  const [{ n }] = await sql`select realtime.sync_triggers() as n`;
  console.log(`realtime: notify triggers on ${n} tables`);
  // Tell PostgREST to pick up schema changes without a restart.
  await sql`notify pgrst, 'reload schema'`;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
