import postgres from "postgres";
import { config } from "./config.js";

/** Owner/service connection pool. Bypasses RLS: only use for trusted server work. */
export const sql = postgres(config.DATABASE_URL, {
  max: 20,
  idle_timeout: 30,
  onnotice: () => {},
  transform: { undefined: null },
});

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- postgres.js default type map
export type Tx = postgres.TransactionSql<{}>;

export interface DbClaims {
  sub?: string;
  role: "anon" | "authenticated" | "service_role";
  [k: string]: unknown;
}

const ROLES = new Set(["anon", "authenticated", "service_role"]);

/**
 * Run `fn` inside a transaction that behaves exactly like a data API request
 * from this caller: role switched and JWT claims visible to auth.uid() and RLS.
 */
export async function asCaller<T>(claims: DbClaims, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const role = ROLES.has(claims.role) ? claims.role : "anon";
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
    await tx.unsafe(`set local role ${role}`);
    return fn(tx);
  }) as Promise<T>;
}
