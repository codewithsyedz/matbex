/**
 * Database access for /api/v1 modules.
 *
 * Modules run their writes in one owner-level transaction with the caller's JWT claims set,
 * so database triggers that read auth.uid() (branch stamping, audit columns, notifications)
 * still see who acted. RLS does not apply to the owner role, so every module MUST check
 * tenant/restaurant access itself (requireRestaurantRole) and scope every query by
 * restaurant_id. That keeps business rules and multi-table writes in one transaction instead
 * of many browser round trips.
 *
 * Modules use their own connection pool: Drizzle rewrites the client's type parsers (dates
 * and timestamps come back as ISO strings, JSON is passed through), which must not leak into
 * the shared pool the rest of the API uses (src/db.ts).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../../config.js";
import type { DbClaims, Tx } from "../../db.js";
import * as schema from "../../db/generated/schema.js";

export type Db = PostgresJsDatabase<typeof schema>;

export interface ServiceTx {
  /** Drizzle on the transaction (typed queries). */
  db: Db;
  /** Raw tagged SQL on the same transaction (functions, locking, bulk statements). */
  tx: Tx;
}

export const moduleSql = postgres(config.DATABASE_URL, {
  max: config.MODULE_DB_POOL,
  onnotice: () => {},
  connection: { application_name: "matbex-api-modules" },
});
// Lets Drizzle apply its parser settings to this pool once.
drizzle(moduleSql, { schema });

/**
 * Database tests only: while a test runs inside `withTestTransaction`, every inServiceTx call
 * becomes a savepoint of the test's transaction, which the test rolls back. Never set in the API.
 */
const testTransaction = new AsyncLocalStorage<postgres.TransactionSql>();
export function withTestTransaction<T>(tx: postgres.TransactionSql, fn: () => Promise<T>) {
  return testTransaction.run(tx, fn);
}

export async function inServiceTx<T>(claims: DbClaims, fn: (t: ServiceTx) => Promise<T>): Promise<T> {
  const run = async (tx: postgres.TransactionSql) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
    // A postgres.js transaction has no .options; Drizzle needs the pool's (already configured).
    (tx as unknown as { options: unknown }).options ??= (moduleSql as unknown as { options: unknown }).options;
    const db = drizzle(tx as unknown as postgres.Sql, { schema });
    return fn({ db, tx: tx as unknown as Tx });
  };
  const outer = testTransaction.getStore();
  if (outer) return outer.savepoint((sp) => run(sp as unknown as postgres.TransactionSql)) as Promise<T>;
  return moduleSql.begin(run) as Promise<T>;
}

export async function closeModuleDb() {
  await moduleSql.end({ timeout: 5 });
}
