/**
 * Open checks / running tabs (docs/plans/open-checks.md). All routes need a user token with
 * the owner, manager, cashier or waiter role in the restaurant.
 *
 * GET    /api/v1/pos/checks?restaurantId&branchId         open checks with totals
 * GET    /api/v1/pos/checks/:id?restaurantId              check, lines, rounds, totals
 * POST   /api/v1/pos/checks                               open (table or name; optional lines, send)
 * POST   /api/v1/pos/checks/:id/lines                     add lines (optional send)
 * PATCH  /api/v1/pos/checks/:id/lines/:lineId             change quantity / note of an unsent line
 * POST   /api/v1/pos/checks/:id/lines/:lineId/void        remove a line or some units (sent: manager/PIN + reason, waste)
 * POST   /api/v1/pos/checks/:id/send                      send unsent lines to the kitchen (one round)
 * POST   /api/v1/pos/checks/:id/void                      void a check (sent items: manager/PIN + reason, waste)
 * POST   /api/v1/pos/checks/:id/move                      move to another free table
 * POST   /api/v1/pos/checks/:id/merge                     merge another open check into this one
 * POST   /api/v1/pos/checks/:id/prebill                   guest bill before payment; table → billing
 * POST   /api/v1/pos/checks/:id/service-charge            waive (manager/PIN + reason) or restore it
 * GET    /api/v1/pos/checks/report?restaurantId&branchId&day   owners/managers: open, paid, voids, waste
 * POST   /api/v1/pos/checks/:id/pay                       pay: payments (one sale) or parts (split bill);
 *                                                          Idempotency-Key like POST /pos/sales
 *
 * Writes take expectedVersion: 409 check_changed when another terminal changed the check.
 * Other errors: 404 check_not_found / line_not_found, 409 check_closed, table_has_open_check,
 * line_sent, check_sent, price_changed; 400 as for sales.
 */
import type { FastifyInstance } from "fastify";
import { requireUser } from "../shared/auth.js";
import {
  addLinesBody, checkParams, editLineBody, getQuery, lineParams, listQuery, mergeBody, moveBody, openBody, payBody, reportQuery, restaurantBody,
  serviceChargeBody, voidBody,
  type AddLinesInput, type EditLineInput, type OpenCheckInput, type PayCheckInput, type VoidInput,
} from "./checks.schema.js";
import {
  addLines, checksReport, editLine, getCheck, listOpenChecks, mergeChecks, moveCheck, openCheck, payCheck, prebill, sendCheck, setServiceCharge, voidCheck, voidLine,
} from "./checks.service.js";

const limit = { rateLimit: { max: 240, timeWindow: "1 minute" } };

export async function posChecksRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { restaurantId: string; branchId?: string } }>(
    "/pos/checks",
    { schema: { querystring: listQuery }, config: limit },
    async (req) => ({ checks: await listOpenChecks(req.query, await requireUser(req)) }),
  );

  app.get<{ Querystring: { restaurantId: string; branchId?: string; day?: string } }>(
    "/pos/checks/report",
    { schema: { querystring: reportQuery }, config: limit },
    async (req) => checksReport(req.query, await requireUser(req)),
  );

  app.get<{ Params: { id: string }; Querystring: { restaurantId: string } }>(
    "/pos/checks/:id",
    { schema: { params: checkParams, querystring: getQuery }, config: limit },
    async (req) => getCheck(req.params.id, req.query.restaurantId, await requireUser(req)),
  );

  app.post<{ Body: OpenCheckInput }>(
    "/pos/checks",
    { schema: { body: openBody }, config: limit },
    async (req, reply) => reply.code(201).send(await openCheck(req.body, await requireUser(req))),
  );

  app.post<{ Params: { id: string }; Body: AddLinesInput }>(
    "/pos/checks/:id/lines",
    { schema: { params: checkParams, body: addLinesBody }, config: limit },
    async (req) => addLines(req.params.id, req.body, await requireUser(req)),
  );

  app.patch<{ Params: { id: string; lineId: string }; Body: EditLineInput }>(
    "/pos/checks/:id/lines/:lineId",
    { schema: { params: lineParams, body: editLineBody }, config: limit },
    async (req) => editLine(req.params.id, req.params.lineId, req.body, await requireUser(req)),
  );

  app.post<{ Params: { id: string; lineId: string }; Body: VoidInput }>(
    "/pos/checks/:id/lines/:lineId/void",
    { schema: { params: lineParams, body: voidBody }, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req) => voidLine(req.params.id, req.params.lineId, req.body, await requireUser(req)),
  );

  app.post<{ Params: { id: string }; Body: { restaurantId: string; expectedVersion?: number } }>(
    "/pos/checks/:id/send",
    { schema: { params: checkParams, body: restaurantBody }, config: limit },
    async (req) => sendCheck(req.params.id, req.body, await requireUser(req)),
  );

  app.post<{ Params: { id: string }; Body: VoidInput }>(
    "/pos/checks/:id/void",
    { schema: { params: checkParams, body: voidBody }, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req) => voidCheck(req.params.id, req.body, await requireUser(req)),
  );

  app.post<{ Params: { id: string }; Body: PayCheckInput }>(
    "/pos/checks/:id/pay",
    { schema: { params: checkParams, body: payBody }, config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const key = req.headers["idempotency-key"];
      const terminal = req.headers["x-terminal-id"];
      const result = await payCheck(req.params.id, req.body, {
        claims: await requireUser(req),
        idempotencyKey: typeof key === "string" && key.length <= 200 ? key : null,
        terminal: typeof terminal === "string" ? terminal.slice(0, 120) : null,
      });
      if (result.replayed) reply.header("Idempotent-Replayed", "true");
      return reply.code(result.replayed ? 200 : 201).send(result);
    },
  );

  // Admin-PIN routes are limited harder: a PIN is short.
  const pinLimit = { rateLimit: { max: 30, timeWindow: "1 minute" } };

  app.post<{ Params: { id: string }; Body: { restaurantId: string; expectedVersion?: number; tableId: string } }>(
    "/pos/checks/:id/move",
    { schema: { params: checkParams, body: moveBody }, config: limit },
    async (req) => moveCheck(req.params.id, req.body, await requireUser(req)),
  );

  app.post<{ Params: { id: string }; Body: { restaurantId: string; expectedVersion?: number; fromCheckId: string } }>(
    "/pos/checks/:id/merge",
    { schema: { params: checkParams, body: mergeBody }, config: limit },
    async (req) => mergeChecks(req.params.id, req.body, await requireUser(req)),
  );

  app.post<{ Params: { id: string }; Body: { restaurantId: string; expectedVersion?: number } }>(
    "/pos/checks/:id/prebill",
    { schema: { params: checkParams, body: restaurantBody }, config: limit },
    async (req) => prebill(req.params.id, req.body, await requireUser(req)),
  );

  app.post<{ Params: { id: string }; Body: { restaurantId: string; expectedVersion?: number; waived: boolean; reason?: string | null; adminPin?: string | null } }>(
    "/pos/checks/:id/service-charge",
    { schema: { params: checkParams, body: serviceChargeBody }, config: pinLimit },
    async (req) => setServiceCharge(req.params.id, req.body, await requireUser(req)),
  );
}
