/**
 * Manual journal entry routes (rules in ledger.service.ts).
 *
 * 400 validation/unbalanced/line_*, 401 no token, 403 role/restaurant/branch, 404 not in this business,
 * 409 period_locked | already_voided | already_reversed | not_manual_entry | entry_protected | entry_not_posted
 */
import type { FastifyInstance } from "fastify";
import { requireUser } from "../shared/auth.js";
import { createJournalBody, idParams, reverseBody, voidBody, type CreateJournalInput, type ReverseInput, type VoidInput } from "./ledger.schema.js";
import { createJournalEntry, reverseJournalEntry, voidJournalEntry } from "./ledger.service.js";

type Id = { Params: { id: string } };

export async function ledgerRoutes(app: FastifyInstance) {
  const config = { rateLimit: { max: 60, timeWindow: "1 minute" } };

  app.post<{ Body: CreateJournalInput }>("/ledger/journal-entries", { schema: { body: createJournalBody }, config },
    async (req, reply) => reply.code(201).send(await createJournalEntry(req.body, await requireUser(req))));

  app.post<Id & { Body: VoidInput }>("/ledger/journal-entries/:id/void", { schema: { params: idParams, body: voidBody }, config },
    async (req) => voidJournalEntry(req.params.id, req.body, await requireUser(req)));

  app.post<Id & { Body: ReverseInput }>("/ledger/journal-entries/:id/reverse", { schema: { params: idParams, body: reverseBody }, config },
    async (req, reply) => reply.code(201).send(await reverseJournalEntry(req.params.id, req.body, await requireUser(req))));
}
