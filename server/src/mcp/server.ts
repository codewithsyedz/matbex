/**
 * /mcp — Model Context Protocol endpoint (Streamable HTTP, stateless).
 *
 * Read-only tools over the caller's workspace. Authenticate with a Matbex
 * access token: `Authorization: Bearer <jwt>`. Every query runs through the
 * data API as that user, so RLS scopes results exactly like the web app.
 */
import type { FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createClient } from "@matbex/client";
import { config } from "../config.js";
import { bearer, verify } from "../lib/jwt.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const json = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  structuredContent: payload as Record<string, unknown>,
});
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });
const readOnly = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };

function buildServer(token: string) {
  const db = createClient(config.API_URL, undefined, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const server = new McpServer(
    { name: "matbex", title: "Matbex", version: "1.0.0" },
    {
      instructions:
        "Read-only tools for Matbex, a restaurant back-office platform. Use `list_branches` first to resolve branch ids, then `sales_summary` for daily revenue, `list_expenses` for spend, and `low_stock_items` for inventory that needs reordering. All data is scoped to the signed-in user's workspace.",
    },
  );

  server.registerTool(
    "list_branches",
    { title: "List branches", description: "Active branches the user can access, with city, timezone and VAT rate.", inputSchema: {}, annotations: readOnly },
    async () => {
      const { data, error } = await db
        .from("branches")
        .select("id,name,code,city,timezone,vat_rate,is_primary,is_active")
        .is("deleted_at", null)
        .eq("is_active", true)
        .order("is_primary", { ascending: false })
        .order("name");
      return error ? fail(error.message) : json({ branches: data ?? [] });
    },
  );

  server.registerTool(
    "sales_summary",
    {
      title: "Daily sales summary",
      description: "Daily sales totals (cash, card, delivery, other) for a date range, optionally for one branch, plus period totals.",
      inputSchema: { from_date: isoDate, to_date: isoDate, branch_id: z.string().uuid().optional() },
      annotations: readOnly,
    },
    async ({ from_date, to_date, branch_id }) => {
      let q = db
        .from("daily_sales_summary")
        .select("sales_date,branch_id,cash_sales,card_sales,delivery_sales,other_sales,total_sales,status")
        .gte("sales_date", from_date)
        .lte("sales_date", to_date)
        .order("sales_date");
      if (branch_id) q = q.eq("branch_id", branch_id);
      const { data, error } = await q;
      if (error) return fail(error.message);
      const rows = (data ?? []) as Record<string, unknown>[];
      const sum = (k: string) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
      return json({
        from_date,
        to_date,
        branch_id: branch_id ?? null,
        days: rows.length,
        totals: { cash: sum("cash_sales"), card: sum("card_sales"), delivery: sum("delivery_sales"), other: sum("other_sales"), total: sum("total_sales") },
        rows,
      });
    },
  );

  server.registerTool(
    "list_expenses",
    {
      title: "List expenses",
      description: "Recorded expenses for a date range with amount, description, payment method, VAT and paid amount.",
      inputSchema: {
        from_date: isoDate,
        to_date: isoDate,
        branch_id: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      },
      annotations: readOnly,
    },
    async ({ from_date, to_date, branch_id, limit }) => {
      let q = db
        .from("expenses")
        .select("id,expense_date,description,amount,paid_amount,vat_amount,payment_method,status,approval_status,branch_id")
        .is("deleted_at", null)
        .gte("expense_date", from_date)
        .lte("expense_date", to_date)
        .order("expense_date", { ascending: false })
        .limit(limit ?? 50);
      if (branch_id) q = q.eq("branch_id", branch_id);
      const { data, error } = await q;
      if (error) return fail(error.message);
      const rows = (data ?? []) as Record<string, unknown>[];
      return json({
        from_date,
        to_date,
        branch_id: branch_id ?? null,
        count: rows.length,
        total_amount: rows.reduce((a, r) => a + Number(r.amount ?? 0), 0),
        expenses: rows,
      });
    },
  );

  server.registerTool(
    "low_stock_items",
    {
      title: "Low stock items",
      description: "Inventory items at or below their reorder level, optionally for one branch.",
      inputSchema: { branch_id: z.string().uuid().optional(), limit: z.number().int().min(1).max(200).default(50) },
      annotations: readOnly,
    },
    async ({ branch_id, limit }) => {
      let q = db
        .from("inventory_items")
        .select("id,name,unit,stock_unit,current_stock,reorder_level,unit_cost,category,branch_id")
        .eq("is_active", true)
        .order("name");
      if (branch_id) q = q.eq("branch_id", branch_id);
      const { data, error } = await q;
      if (error) return fail(error.message);
      const low = ((data ?? []) as Record<string, unknown>[])
        .filter((i) => Number(i.current_stock ?? 0) <= Number(i.reorder_level ?? 0))
        .slice(0, limit ?? 50);
      return json({ branch_id: branch_id ?? null, count: low.length, items: low });
    },
  );

  return server;
}

export async function mcpRoutes(app: FastifyInstance) {
  app.post("/", async (req, reply) => {
    const token = bearer(req.headers.authorization);
    const claims = token ? await verify(token).catch(() => null) : null;
    if (!token || claims?.role !== "authenticated") {
      return reply
        .code(401)
        .header("WWW-Authenticate", 'Bearer realm="matbex"')
        .send({ jsonrpc: "2.0", error: { code: -32001, message: "Sign in to Matbex and pass your access token as a Bearer token." }, id: null });
    }
    const server = buildServer(token);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    reply.hijack();
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });

  const notAllowed = { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server)" }, id: null };
  app.get("/", async (_req, reply) => reply.code(405).send(notAllowed));
  app.delete("/", async (_req, reply) => reply.code(405).send(notAllowed));
}
