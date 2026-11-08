#!/usr/bin/env node
/**
 * Generates src/integrations/db/types.ts from the live PostgreSQL schema.
 *
 *   DATABASE_URL=postgres://... node scripts/generate-db-types.mjs           # write file
 *   DATABASE_URL=postgres://... node scripts/generate-db-types.mjs --check   # CI: fail on drift
 *
 * Output keeps the `Database["public"]["Tables"|"Views"|"Functions"|"Enums"]`
 * shape plus the Tables<> / TablesInsert<> / TablesUpdate<> / Enums<> helpers
 * the app already uses, so regenerating never requires call-site changes.
 */
import postgres from "postgres";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "integrations", "db", "types.ts");
const SCHEMA = process.env.DB_TYPES_SCHEMA ?? "public";
const check = process.argv.includes("--check");

if (!process.env.DATABASE_URL) {
  if (check) {
    console.log("[db:types] DATABASE_URL not set — skipping drift check.");
    process.exit(0);
  }
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

const enums = await sql`
  select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as values
  from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = ${SCHEMA} group by t.typname order by t.typname`;
const enumNames = new Set(enums.map((e) => e.name));

const composites = await sql`
  select t.typname as name, a.attname as col, format_type(a.atttypid, a.atttypmod) as type, a.attnum
  from pg_type t join pg_namespace n on n.oid = t.typnamespace
  join pg_class c on c.oid = t.typrelid and c.relkind = 'c'
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where n.nspname = ${SCHEMA} order by t.typname, a.attnum`;

const columns = await sql`
  select c.relname as table, c.relkind as kind, a.attname as col, a.attnum,
         format_type(a.atttypid, a.atttypmod) as type, t.typname as udt, t.typcategory as cat,
         et.typname as elem_udt, not a.attnotnull as nullable,
         (ad.adbin is not null) as has_default, a.attidentity <> '' as is_identity, a.attgenerated <> '' as is_generated
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  join pg_type t on t.oid = a.atttypid
  left join pg_type et on et.oid = t.typelem and t.typcategory = 'A'
  left join pg_attrdef ad on ad.adrelid = c.oid and ad.adnum = a.attnum
  where n.nspname = ${SCHEMA} and c.relkind in ('r','p','v','m','f')
  order by c.relname, a.attname`;

const fks = await sql`
  select con.conname as name, c.relname as table, rc.relname as ref_table,
         array(select attname from pg_attribute where attrelid = con.conrelid and attnum = any(con.conkey) order by attnum) as cols,
         array(select attname from pg_attribute where attrelid = con.confrelid and attnum = any(con.confkey) order by attnum) as ref_cols,
         (select count(*) from pg_constraint u where u.conrelid = con.conrelid and u.contype in ('u','p') and u.conkey @> con.conkey and u.conkey <@ con.conkey) > 0 as one_to_one
  from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_class rc on rc.oid = con.confrelid
  join pg_namespace n on n.oid = c.relnamespace join pg_namespace rn on rn.oid = rc.relnamespace
  where con.contype = 'f' and n.nspname = ${SCHEMA} and rn.nspname = ${SCHEMA}
  order by c.relname, con.conname`;

const fns = await sql`
  select p.proname as name, p.oid, p.proretset as retset, p.pronargdefaults as ndefaults,
         coalesce(p.proargnames, '{}') as argnames,
         coalesce(p.proargmodes::text[], array_fill('i'::text, array[p.pronargs])) as argmodes,
         coalesce(p.proallargtypes::oid[], p.proargtypes::oid[]) as argtypes,
         p.prorettype as rettype, rt.typname as ret_udt, rt.typtype as ret_typtype, rt.typrelid as ret_relid
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type rt on rt.oid = p.prorettype
  where n.nspname = ${SCHEMA} and p.prokind = 'f' and rt.typname not in ('trigger', 'event_trigger')
  order by p.proname, p.oid`;

const typeRows = await sql`select oid, typname, typcategory, typelem, typrelid from pg_type`;
const typeByOid = new Map(typeRows.map((t) => [Number(t.oid), t]));
const relName = new Map((await sql`select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = ${SCHEMA}`).map((r) => [Number(r.oid), r.relname]));

function tsScalar(udt, cat) {
  if (enumNames.has(udt)) return `Database["${SCHEMA}"]["Enums"]["${udt}"]`;
  switch (udt) {
    case "int2": case "int4": case "int8": case "float4": case "float8": case "numeric": case "oid": case "money":
      return "number";
    case "bool": return "boolean";
    case "json": case "jsonb": return "Json";
    case "void": return "undefined";
    case "record": return "Record<string, unknown>";
    case "unknown": return "unknown";
  }
  if (cat === "S" || cat === "D" || cat === "T" || cat === "I" || cat === "U" || cat === "V" || cat === "B") return "string";
  return "unknown";
}
const tsFromOid = (oid) => {
  const t = typeByOid.get(Number(oid));
  if (!t) return "unknown";
  if (t.typcategory === "A") {
    const e = typeByOid.get(Number(t.typelem));
    return `${e ? tsScalar(e.typname, e.typcategory) : "unknown"}[]`;
  }
  return tsScalar(t.typname, t.typcategory);
};
const tsCol = (c) => (c.cat === "A" ? `${tsScalar(c.elem_udt, typeByOid.get([...typeByOid.values()].find((t) => t.typname === c.elem_udt)?.oid ?? 0)?.typcategory)}[]` : tsScalar(c.udt, c.cat));
const key = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));

// ---------------------------------------------------------------- emit
const byTable = new Map();
for (const c of columns) {
  if (!byTable.has(c.table)) byTable.set(c.table, { kind: c.kind, cols: [] });
  byTable.get(c.table).cols.push(c);
}
const relsByTable = new Map();
for (const f of fks) {
  if (!relsByTable.has(f.table)) relsByTable.set(f.table, []);
  relsByTable.get(f.table).push(f);
}

const I = (n) => "  ".repeat(n);
let out = `// Generated by scripts/generate-db-types.mjs from the database schema. Do not edit by hand.
// Regenerate: npm run db:types

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  ${SCHEMA}: {
    Tables: {
`;
const rels = (t) => {
  const list = relsByTable.get(t) ?? [];
  if (!list.length) return "[]";
  return `[\n${list
    .map(
      (f) => `${I(6)}{\n${I(7)}foreignKeyName: "${f.name}"\n${I(7)}columns: [${f.cols.map((c) => `"${c}"`).join(", ")}]\n${I(7)}isOneToOne: ${f.one_to_one}\n${I(7)}referencedRelation: "${f.ref_table}"\n${I(7)}referencedColumns: [${f.ref_cols.map((c) => `"${c}"`).join(", ")}]\n${I(6)}},`,
    )
    .join("\n")}\n${I(5)}]`;
};

for (const [t, { kind, cols }] of byTable) {
  if (!["r", "p", "f"].includes(kind)) continue;
  out += `${I(3)}${key(t)}: {\n${I(4)}Row: {\n`;
  for (const c of cols) out += `${I(5)}${key(c.col)}: ${tsCol(c)}${c.nullable ? " | null" : ""}\n`;
  out += `${I(4)}}\n${I(4)}Insert: {\n`;
  for (const c of cols) {
    const opt = c.nullable || c.has_default || c.is_identity || c.is_generated;
    out += `${I(5)}${key(c.col)}${opt ? "?" : ""}: ${c.is_generated ? "never" : tsCol(c) + (c.nullable ? " | null" : "")}\n`;
  }
  out += `${I(4)}}\n${I(4)}Update: {\n`;
  for (const c of cols) out += `${I(5)}${key(c.col)}?: ${c.is_generated ? "never" : tsCol(c) + (c.nullable ? " | null" : "")}\n`;
  out += `${I(4)}}\n${I(4)}Relationships: ${rels(t)}\n${I(3)}}\n`;
}
out += `${I(2)}}\n${I(2)}Views: {\n`;
for (const [t, { kind, cols }] of byTable) {
  if (!["v", "m"].includes(kind)) continue;
  out += `${I(3)}${key(t)}: {\n${I(4)}Row: {\n`;
  for (const c of cols) out += `${I(5)}${key(c.col)}: ${tsCol(c)} | null\n`;
  out += `${I(4)}}\n${I(4)}Relationships: ${rels(t)}\n${I(3)}}\n`;
}
out += `${I(2)}}\n${I(2)}Functions: {\n`;

const fnGroups = new Map();
for (const f of fns) {
  if (!fnGroups.has(f.name)) fnGroups.set(f.name, []);
  fnGroups.get(f.name).push(f);
}
const colsOfRel = (relname) => byTable.get(relname)?.cols ?? [];
for (const [name, overloads] of fnGroups) {
  const variants = overloads.map((f) => {
    const ins = [];
    const outs = [];
    f.argtypes.forEach((oid, i) => {
      const mode = f.argmodes[i] ?? "i";
      const n = f.argnames[i] || `arg${i}`;
      if (mode === "i" || mode === "b" || mode === "v") ins.push({ n, t: tsFromOid(oid) });
      if (mode === "o" || mode === "b" || mode === "t") outs.push({ n, t: tsFromOid(oid) });
    });
    const firstDefault = ins.length - Number(f.ndefaults);
    const args = ins.length
      ? `{ ${ins.map((a, i) => `${key(a.n)}${i >= firstDefault ? "?" : ""}: ${a.t}`).join("; ")} }`
      : "never";
    let ret;
    if (outs.length) {
      ret = `{\n${outs.map((o) => `${I(5)}${key(o.n)}: ${o.t}`).join("\n")}\n${I(4)}}${f.retset ? "[]" : ""}`;
    } else if (f.ret_typtype === "c" && relName.has(Number(f.ret_relid))) {
      const cs = colsOfRel(relName.get(Number(f.ret_relid)));
      ret = `{\n${cs.map((c) => `${I(5)}${key(c.col)}: ${tsCol(c)}${c.nullable ? " | null" : ""}`).join("\n")}\n${I(4)}}${f.retset ? "[]" : ""}`;
    } else {
      ret = `${tsFromOid(f.rettype)}${f.retset ? "[]" : ""}`;
    }
    return `{\n${I(4)}Args: ${args}\n${I(4)}Returns: ${ret}\n${I(3)}}`;
  });
  out += `${I(3)}${key(name)}:\n${I(3)}  | ${variants.join(`\n${I(3)}  | `)}\n`;
}
out += `${I(2)}}\n${I(2)}Enums: {\n`;
for (const e of enums) out += `${I(3)}${key(e.name)}: ${e.values.map((v) => JSON.stringify(v)).join(" | ")}\n`;
out += `${I(2)}}\n${I(2)}CompositeTypes: {\n`;
const compGroups = new Map();
for (const c of composites) {
  if (!compGroups.has(c.name)) compGroups.set(c.name, []);
  compGroups.get(c.name).push(c);
}
for (const [n, cs] of compGroups) {
  out += `${I(3)}${key(n)}: {\n${cs.map((c) => `${I(4)}${key(c.col)}: unknown | null`).join("\n")}\n${I(3)}}\n`;
}
out += `${I(2)}}\n  }\n}

type DefaultSchema = Database["${SCHEMA}"]

export type Tables<T extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])> =
  (DefaultSchema["Tables"] & DefaultSchema["Views"])[T] extends { Row: infer R } ? R : never

export type TablesInsert<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T] extends { Insert: infer I } ? I : never

export type TablesUpdate<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T] extends { Update: infer U } ? U : never

export type Enums<T extends keyof DefaultSchema["Enums"]> = DefaultSchema["Enums"][T]

export type CompositeTypes<T extends keyof DefaultSchema["CompositeTypes"]> = DefaultSchema["CompositeTypes"][T]

export const Constants = {
  ${SCHEMA}: {
    Enums: {
${enums.map((e) => `      ${key(e.name)}: [${e.values.map((v) => JSON.stringify(v)).join(", ")}],`).join("\n")}
    },
  },
} as const
`;

await sql.end();

if (check) {
  const current = readFileSync(OUT, "utf8");
  if (current !== out) {
    console.error("[db:types] src/integrations/db/types.ts is out of date. Run: npm run db:types");
    process.exit(1);
  }
  console.log("[db:types] types are up to date.");
} else {
  writeFileSync(OUT, out);
  console.log(`[db:types] wrote ${OUT} (${byTable.size} relations, ${fnGroups.size} functions, ${enums.length} enums)`);
}
