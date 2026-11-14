#!/usr/bin/env node
/**
 * One-time codemod that converted the Deno edge functions to Node server
 * functions. Kept for reference / re-running on functions imported later:
 *
 *   node server/scripts/codemod-functions.mjs [dir]
 *
 * - URL / npm: specifiers  → bare package names (installed in server/package.json)
 * - @supabase/supabase-js  → @matbex/client
 * - Deno.serve / std serve → _runtime/serve.ts
 * - Deno.env.get           → env() from _runtime/env.ts (legacy names renamed)
 * - Deno.resolveDns        → _runtime/dns.ts
 * - Deno.test + std assert → node:test + node:assert
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..", "functions");
const runtimeDir = join(root, "_runtime");

const walk = (d) =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    if (statSync(p).isDirectory()) return f === "_runtime" || f === "node_modules" ? [] : walk(p);
    return /\.(ts|tsx)$/.test(f) ? [p] : [];
  });

function rewriteSpecifier(spec) {
  if (/@supabase\/supabase-js[^/]*\/cors$/.test(spec)) return { runtime: "cors" };
  if (/@supabase\/supabase-js/.test(spec)) return "@matbex/client";
  if (/deno\.land\/std[^/]*\/http\/server\.ts/.test(spec)) return { runtime: "serve" };
  if (/deno\.land\/std[^/]*\/assert\/mod\.ts/.test(spec)) return "node:assert/strict";
  let m = /^https:\/\/esm\.sh\/(@[^/@]+\/[^/@?]+|[^/@?]+)(?:@[^/?]*)?(\/[^?]*)?(\?.*)?$/.exec(spec);
  if (m) return m[1] + (m[2] ?? "");
  m = /^npm:(@[^/@]+\/[^/@]+|[^/@]+)(?:@[^/]*)?(\/.*)?$/.exec(spec);
  if (m) return m[1] + (m[2] ?? "");
  return spec;
}

let changed = 0;
for (const file of walk(root)) {
  let src = readFileSync(file, "utf8");
  const before = src;
  const needs = new Set();
  const rel = (name) => {
    let r = relative(dirname(file), join(runtimeDir, `${name}.ts`)).replace(/\\/g, "/");
    return r.startsWith(".") ? r : `./${r}`;
  };

  // static + dynamic import specifiers
  src = src.replace(/(from\s+|import\s*\(\s*)(['"])([^'"]+)\2/g, (all, pre, q, spec) => {
    const out = rewriteSpecifier(spec);
    if (typeof out === "object") return `${pre}${q}${rel(out.runtime)}${q}`;
    return `${pre}${q}${out}${q}`;
  });

  // assert/mod.ts named imports → node:assert equivalents
  if (src.includes("node:assert/strict")) {
    src = src.replace(/import\s*\{([^}]+)\}\s*from\s*(['"])node:assert\/strict\2;?/, (_m, names) => {
      const list = names.split(",").map((s) => s.trim()).filter(Boolean);
      const map = { assertEquals: "deepStrictEqual", assertStrictEquals: "strictEqual", assert: "ok", assertThrows: "throws", assertRejects: "rejects", assertNotEquals: "notDeepStrictEqual", assertMatch: "match" };
      return `import { ${list.map((n) => (map[n] ? `${map[n]} as ${n}` : n)).join(", ")} } from "node:assert/strict";`;
    });
  }
  if (/\bDeno\.test\(/.test(src)) {
    src = src.replace(/\bDeno\.test\(/g, "test(");
    src = `import { test } from "node:test";\n` + src;
  }

  if (/\bDeno\.serve\(/.test(src)) {
    src = src.replace(/\bDeno\.serve\(/g, "serve(");
    if (!/import\s*\{[^}]*\bserve\b[^}]*\}\s*from/.test(src)) needs.add("serve");
  }
  if (/\bDeno\.env\.get\(/.test(src)) {
    src = src.replace(/\bDeno\.env\.get\(/g, "env(");
    needs.add("env");
  }
  if (/\bDeno\.env\.toObject\(\)/.test(src)) {
    src = src.replace(/\bDeno\.env\.toObject\(\)/g, "envObject()");
    needs.add("envObject");
  }
  if (/\bDeno\.resolveDns\(/.test(src)) {
    src = src.replace(/\bDeno\.resolveDns\(/g, "resolveDns(");
    needs.add("resolveDns");
  }
  src = src
    .replace(/env\((['"])SUPABASE_URL\1\)/g, 'env("API_URL")')
    .replace(/env\((['"])SUPABASE_SERVICE_ROLE_KEY\1\)/g, 'env("SERVICE_ROLE_KEY")')
    .replace(/env\((['"])SUPABASE_(ANON|PUBLISHABLE)_KEY\1\)/g, 'env("ANON_KEY")');

  const imports = [];
  if (needs.has("serve")) imports.push(`import { serve } from "${rel("serve")}";`);
  const envNames = ["env", "envObject"].filter((n) => needs.has(n));
  if (envNames.length) imports.push(`import { ${envNames.join(", ")} } from "${rel("env")}";`);
  if (needs.has("resolveDns")) imports.push(`import { resolveDns } from "${rel("dns")}";`);
  if (imports.length) src = imports.join("\n") + "\n" + src;

  if (src !== before) {
    writeFileSync(file, src);
    changed++;
  }
}
console.log(`codemod: updated ${changed} files under ${root}`);
