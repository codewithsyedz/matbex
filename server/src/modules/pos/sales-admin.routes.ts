/**
 * Back-office sales routes (see sales-admin.service.ts for the rules).
 *
 * POST   /api/v1/pos/sales/summary               201 { transactions, receiptPrefix }
 * POST   /api/v1/pos/sales/:id/void              201 { void, cashRefunded, refundShiftId }
 * PATCH  /api/v1/pos/sales/:id                   200 { transaction }
 * PATCH  /api/v1/pos/sales/:id/lines/:lineId     200 { transaction, lineId }
 * DELETE /api/v1/pos/sales/:id/lines/:lineId?restaurantId=   200 { transaction }
 *
 * 400 validation, 401 no token, 403 role/restaurant, 404 sale or line not in this restaurant,
 * 409 already_voided | is_void | zatca_reported | in_settlement | has_lines | last_line | not_voidable
 */
import type { FastifyInstance } from "fastify";
import { requireUser } from "../shared/auth.js";
import {
  editBody, lineBody, lineParams, restaurantQuery, saleParams, summaryBody, voidBody,
  type EditInput, type LineInput, type SummaryInput, type VoidInput,
} from "./sales-admin.schema.js";
import { deleteLine, editLine, editSale, recordSummary, voidSale } from "./sales-admin.service.js";

export async function posSalesAdminRoutes(app: FastifyInstance) {
  const limit = { rateLimit: { max: 120, timeWindow: "1 minute" } };

  app.post<{ Body: SummaryInput }>("/pos/sales/summary", { schema: { body: summaryBody }, config: limit }, async (req, reply) =>
    reply.code(201).send(await recordSummary(req.body, await requireUser(req))),
  );

  app.post<{ Params: { id: string }; Body: VoidInput }>(
    "/pos/sales/:id/void",
    { schema: { params: saleParams, body: voidBody }, config: limit },
    async (req, reply) => reply.code(201).send(await voidSale(req.params.id, req.body, await requireUser(req))),
  );

  app.patch<{ Params: { id: string }; Body: EditInput }>(
    "/pos/sales/:id",
    { schema: { params: saleParams, body: editBody }, config: limit },
    async (req) => editSale(req.params.id, req.body, await requireUser(req)),
  );

  app.patch<{ Params: { id: string; lineId: string }; Body: LineInput }>(
    "/pos/sales/:id/lines/:lineId",
    { schema: { params: lineParams, body: lineBody }, config: limit },
    async (req) => editLine(req.params.id, req.params.lineId, req.body, await requireUser(req)),
  );

  app.delete<{ Params: { id: string; lineId: string }; Querystring: { restaurantId: string } }>(
    "/pos/sales/:id/lines/:lineId",
    { schema: { params: lineParams, querystring: restaurantQuery }, config: limit },
    async (req) => deleteLine(req.params.id, req.params.lineId, req.query.restaurantId, await requireUser(req)),
  );
}
