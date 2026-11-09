/**
 * Drizzle schema for /api/v1 modules, generated from the live database
 * (the database stays the source of truth; migrations remain plain SQL in db/migrations).
 *
 *   npm --prefix server run db:schema     # regenerate src/db/schema.ts
 *
 * Add a table to TABLES when a module starts using it.
 */
import { defineConfig } from "drizzle-kit";

export const TABLES = [
  "branches",
  "cash_events",
  "customers",
  "inventory_items",
  "inventory_usage",
  "menu_items",
  "pos_idempotency_keys",
  "recipe_ingredients",
  "reorder_requests",
  "restaurants",
  "sales_items",
  "sales_transactions",
  "shifts",
  "user_roles",
  "user_tenant_roles",
];

export default defineConfig({
  dialect: "postgresql",
  out: "./src/db/generated",
  schemaFilter: ["public"],
  tablesFilter: TABLES,
  introspect: { casing: "camel" },
  dbCredentials: { url: process.env.DATABASE_URL! },
});
