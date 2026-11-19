/**
 * POST /api/v1/zatca/sales/:id/chain      201 { uuid, icv, pih, invoiceHash, deviceId, replayed }
 * POST /api/v1/zatca/sales/:id/documents  200 { written: ("snapshot" | "pdf" | "xml")[] }
 * 400 validation / foreign link, 403 role, 404 sale or device, 409 voided | device_revoked
 */
import type { FastifyInstance } from "fastify";
import { requireUser } from "../shared/auth.js";
import { chainBody, documentsBody, idParams, type ChainInput, type DocumentsInput } from "./zatca.schema.js";
import { recordDocuments, stampChain } from "./zatca.service.js";

export async function zatcaRoutes(app: FastifyInstance) {
  const config = { rateLimit: { max: 240, timeWindow: "1 minute" } };
  app.post<{ Params: { id: string }; Body: ChainInput }>("/zatca/sales/:id/chain", { schema: { params: idParams, body: chainBody }, config },
    async (req, reply) => {
      const r = await stampChain(req.params.id, req.body, await requireUser(req));
      return reply.code(r.replayed ? 200 : 201).send(r);
    });
  app.post<{ Params: { id: string }; Body: DocumentsInput }>("/zatca/sales/:id/documents", { schema: { params: idParams, body: documentsBody }, config },
    async (req) => recordDocuments(req.params.id, req.body, await requireUser(req)));
}
