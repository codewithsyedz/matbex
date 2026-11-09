/**
 * POST /api/v1/pos/sales
 *
 * Headers: Authorization: Bearer <user token>; Idempotency-Key: <client-generated id>
 * (recommended: the terminal retries with the same key after a timeout and gets the first
 * response instead of a second sale); X-Terminal-Id: <terminal uid> (optional, for audit).
 *
 * 201 { transaction, receiptNumber, salesItems, lowStock }   new sale
 * 200 same body + header Idempotent-Replayed: true            replay of an earlier request
 * 400 validation / business rule, 401 no or bad token, 403 no access, 409 key reused
 */
import type { FastifyInstance } from "fastify";
import { requireUser } from "../shared/auth.js";
import { createSaleBody, type CreateSaleInput } from "./sales.schema.js";
import { createSale } from "./sales.service.js";

export async function posSalesRoutes(app: FastifyInstance) {
  app.post<{ Body: CreateSaleInput }>(
    "/pos/sales",
    {
      schema: { body: createSaleBody },
      // Generous: a busy till rings a few sales a minute; this only stops runaway clients.
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const claims = await requireUser(req);
      const key = req.headers["idempotency-key"];
      const terminal = req.headers["x-terminal-id"];
      const { result, replayed } = await createSale(req.body, {
        claims,
        idempotencyKey: typeof key === "string" && key.length <= 200 ? key : null,
        terminal: typeof terminal === "string" ? terminal.slice(0, 120) : null,
      });
      if (replayed) reply.header("Idempotent-Replayed", "true");
      return reply.code(replayed ? 200 : 201).send(result);
    },
  );
}
