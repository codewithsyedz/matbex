#!/usr/bin/env node
/** Production build: bundles the API and every server function with esbuild into dist/. */
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist");
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "functions"), { recursive: true });

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  packages: "external",
  tsconfig: join(root, "tsconfig.json"),
  jsx: "automatic",
  logLevel: "warning",
  // @matbex/client is workspace source, not an installed package — bundle it.
  alias: { "@matbex/client": join(root, "..", "packages", "client", "src", "index.ts") },
};

await build({ ...common, entryPoints: [join(root, "src", "index.ts")], outfile: join(out, "index.mjs") });

const fnDir = join(root, "functions");
const names = readdirSync(fnDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("_") && existsSync(join(fnDir, d.name, "index.ts")))
  .map((d) => d.name);

await build({
  ...common,
  entryPoints: Object.fromEntries(names.map((n) => [n, join(fnDir, n, "index.ts")])),
  outdir: join(out, "functions"),
  outExtension: { ".js": ".mjs" },
  splitting: true,
  chunkNames: "_chunks/[name]-[hash]",
});

writeFileSync(join(out, "functions", "_manifest.json"), JSON.stringify(names, null, 2));
cpSync(join(fnDir, "functions.config.json"), join(out, "functions", "functions.config.json"));
console.log(`built API + ${names.length} functions → dist/`);
