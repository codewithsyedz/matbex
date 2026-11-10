/**
 * /api/v1: typed domain modules (strangler target, docs/self-hosting/ARCHITECTURE.md).
 *
 * Each module lives in src/modules/<domain>/ as
 *   <name>.schema.ts      request/response JSON schema (validated by Fastify/AJV) + TS types
 *   <name>.routes.ts      HTTP: auth, headers, status codes
 *   <name>.service.ts     business rules and the transaction (modules/shared/db.ts)
 *   <name>.repository.ts  Drizzle queries, always scoped by restaurant_id
 * and registers its routes here.
 */
import type { FastifyInstance } from "fastify";
import { posSalesRoutes } from "./pos/sales.routes.js";
import { posSalesAdminRoutes } from "./pos/sales-admin.routes.js";
import { creditRoutes } from "./credit/credit.routes.js";

export async function apiV1Routes(app: FastifyInstance) {
  await app.register(posSalesRoutes);
  await app.register(posSalesAdminRoutes);
  await app.register(creditRoutes);
}
