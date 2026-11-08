#!/usr/bin/env node
/**
 * CI guard: fails when `src/integrations/supabase/types.ts` is out of sync
 * with the live database schema. Catches the class of bug where a migration
 * lands but generated types are not committed — TS compiles green, runtime
 * blows up on field access.
 *
 * Usage (CI):  SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_ID=... npm run lint:types-drift
 *
 * Local-dev safe: exits 0 with a notice when SUPABASE_ACCESS_TOKEN is absent,
 * since contributors don't carry the management token.
 */
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const TYPES_PATH = path.join(__dirname, "..", "src", "integrations", "supabase", "types.ts");
const PROJECT_ID = process.env.SUPABASE_PROJECT_ID || "tlkyubkbbqwmzjaogavb";

if (!process.env.SUPABASE_ACCESS_TOKEN) {
  console.log("[types-drift] SUPABASE_ACCESS_TOKEN not set — skipping (local dev).");
  process.exit(0);
}

let fresh;
try {
  fresh = execSync(
    `npx --yes supabase@latest gen types typescript --project-id ${PROJECT_ID} --schema public`,
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
  );
} catch (e) {
  console.error("[types-drift] Failed to generate types:", e.message);
  process.exit(2);
}

const committed = fs.readFileSync(TYPES_PATH, "utf8");

// Normalize trailing whitespace / line endings so cosmetic-only diffs do not
// produce false positives.
const norm = (s) => s.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trimEnd();

if (norm(fresh) !== norm(committed)) {
  console.error("\n[types-drift] ❌ src/integrations/supabase/types.ts is stale.");
  console.error("Regenerate with: supabase gen types typescript --project-id " + PROJECT_ID + " --schema public > src/integrations/supabase/types.ts");
  process.exit(1);
}

console.log("[types-drift] ✅ Supabase types are in sync.");