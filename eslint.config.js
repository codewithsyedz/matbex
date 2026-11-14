import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "server/dist", "**/node_modules", "src/integrations/db/types.ts", "tailwind.config.ts"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // ~1,900 existing `any`s are typing debt, not defects: reported as warnings so CI fails on
      // rules that catch real bugs (hooks order, unreachable code, ...). Do not add new ones.
      "@typescript-eslint/no-explicit-any": "warn",
      // `cond ? a() : b()` and `ok ? n++ : m++` are deliberate shorthand here, not lost values.
      "@typescript-eslint/no-unused-expressions": ["error", { allowTernary: true, allowShortCircuit: true }],
      // Best-effort parsing / storage access deliberately ignores failures.
      "no-empty": ["error", { allowEmptyCatch: true }],
      // shadcn/ui components declare `interface XProps extends Y {}` on purpose.
      "@typescript-eslint/no-empty-object-type": ["error", { allowInterfaces: "with-single-extends" }],
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-ignore": "allow-with-description" }],
    },
  },
  {
    // API server, server functions and the shared client run on Node.
    files: ["server/**/*.{ts,tsx}", "packages/**/*.ts"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      // request bodies / third-party payloads at the network boundary
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
