/**
 * Customer credit routes (rules in credit.service.ts). Every response that changes what a
 * customer owes returns the recomputed `balance`.
 *
 * 400 validation/overpayment, 401 no token, 403 role/restaurant, 404 not in this restaurant,
 * 409 nothing_to_invoice | invoice_paid | invoice_has_payments | in_settlement |
 *     not_open_credit | not_write_off | already_reverted | sale_voided
 */
import type { FastifyInstance } from "fastify";
import { requireUser } from "../shared/auth.js";
import {
  adjustmentBody, createInvoiceBody, editInvoiceBody, idParams, paymentBody, restaurantQuery, revertBody, writeOffBody,
  type AdjustmentInput, type CreateInvoiceInput, type EditInvoiceInput, type PaymentInput, type WriteOffInput,
} from "./credit.schema.js";
import {
  addAdjustment, createInvoice, deleteInvoice, editInvoice, payInvoice, paySale, revertWriteOff, writeOffSale,
} from "./credit.service.js";

type Id = { Params: { id: string } };

export async function creditRoutes(app: FastifyInstance) {
  const config = { rateLimit: { max: 120, timeWindow: "1 minute" } };

  app.post<{ Body: CreateInvoiceInput }>("/credit/settlement-invoices", { schema: { body: createInvoiceBody }, config },
    async (req, reply) => reply.code(201).send(await createInvoice(req.body, await requireUser(req))));

  app.patch<Id & { Body: EditInvoiceInput }>("/credit/settlement-invoices/:id", { schema: { params: idParams, body: editInvoiceBody }, config },
    async (req) => editInvoice(req.params.id, req.body, await requireUser(req)));

  app.delete<Id & { Querystring: { restaurantId: string } }>("/credit/settlement-invoices/:id", { schema: { params: idParams, querystring: restaurantQuery }, config },
    async (req) => deleteInvoice(req.params.id, req.query.restaurantId, await requireUser(req)));

  app.post<Id & { Body: PaymentInput }>("/credit/settlement-invoices/:id/payments", { schema: { params: idParams, body: paymentBody }, config },
    async (req, reply) => reply.code(201).send(await payInvoice(req.params.id, req.body, await requireUser(req))));

  app.post<Id & { Body: PaymentInput }>("/credit/sales/:id/payments", { schema: { params: idParams, body: paymentBody }, config },
    async (req, reply) => reply.code(201).send(await paySale(req.params.id, req.body, await requireUser(req))));

  app.post<Id & { Body: WriteOffInput }>("/credit/sales/:id/write-off", { schema: { params: idParams, body: writeOffBody }, config },
    async (req, reply) => reply.code(201).send(await writeOffSale(req.params.id, req.body, await requireUser(req))));

  app.post<{ Body: AdjustmentInput }>("/credit/adjustments", { schema: { body: adjustmentBody }, config },
    async (req, reply) => reply.code(201).send(await addAdjustment(req.body, await requireUser(req))));

  app.post<Id & { Body: { restaurantId: string } }>("/credit/adjustments/:id/revert", { schema: { params: idParams, body: revertBody }, config },
    async (req, reply) => reply.code(201).send(await revertWriteOff(req.params.id, req.body.restaurantId, await requireUser(req))));
}
