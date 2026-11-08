/**
 * Standalone eslint config for module-boundary enforcement.
 *
 * Why separate from eslint.config.js?
 *   The main lint run is wired into CI as a hard fail. The boundaries plugin
 *   will produce hundreds of warnings on day 1 because no enforcement existed
 *   before. Keeping it isolated lets us:
 *     1. Surface violations without blocking PRs (`npm run lint:boundaries`).
 *     2. Hard-fail only on net-new violations via lint-staged on changed files.
 *     3. Promote rules to the main config once the warning count hits zero.
 *
 * Install (CI / contributor opt-in):
 *   bun add -D eslint-plugin-boundaries
 *
 * Element types:
 *   - app:         App.tsx, main.tsx, route table
 *   - page:        src/pages/**
 *   - feature:     src/components/{feature-folder}/**
 *   - shared:      src/components/ui/**, src/lib/**, src/hooks/** (common)
 *   - context:     src/contexts/**
 *   - integration: src/integrations/**
 */
import boundaries from "eslint-plugin-boundaries";
import tseslint from "typescript-eslint";

export default tseslint.config({
  files: ["src/**/*.{ts,tsx}"],
  plugins: { boundaries },
  settings: {
    "boundaries/elements": [
      { type: "app", pattern: ["src/App.tsx", "src/main.tsx", "src/routes/**"] },
      { type: "page", pattern: "src/pages/*" },
      { type: "feature", pattern: "src/components/*", mode: "folder" },
      { type: "shared", pattern: ["src/components/ui/**", "src/lib/**", "src/hooks/**"] },
      { type: "context", pattern: "src/contexts/**" },
      { type: "integration", pattern: "src/integrations/**" },
    ],
    "boundaries/ignore": ["**/*.test.{ts,tsx}", "**/__tests__/**"],
  },
  rules: {
    "boundaries/element-types": [
      "warn", // start as warn; flip to "error" once baseline reaches zero
      {
        default: "disallow",
        rules: [
          { from: "app", allow: ["page", "feature", "shared", "context", "integration"] },
          { from: "page", allow: ["feature", "shared", "context", "integration"] },
          // Features may NOT import sibling features. This is the rule that
          // protects accounting ↔ POS ↔ web-builder from accidental coupling.
          { from: "feature", allow: ["shared", "context", "integration", ["feature", { elementName: "${from.elementName}" }]] },
          { from: "shared", allow: ["shared", "integration"] },
          { from: "context", allow: ["shared", "integration", "context"] },
          { from: "integration", allow: ["integration"] },
        ],
      },
    ],
    "boundaries/no-private": "warn",
  },
});