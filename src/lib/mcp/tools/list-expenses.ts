import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { jsonResult, notAuthenticated, queryError, supabaseForUser } from "../supabase";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export default defineTool({
  name: "list_expenses",
  title: "List expenses",
  description:
    "List recorded expenses for a date range with amount, description, payment method, VAT and paid amount. Optionally filter by branch.",
  inputSchema: {
    from_date: isoDate.describe("Start date (inclusive), YYYY-MM-DD."),
    to_date: isoDate.describe("End date (inclusive), YYYY-MM-DD."),
    branch_id: z.string().uuid().optional().describe("Optional branch id from list_branches."),
    limit: z.number().int().min(1).max(200).default(50).describe("Maximum rows to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ from_date, to_date, branch_id, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated();
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("expenses")
      .select(
        "id,expense_date,description,amount,paid_amount,vat_amount,payment_method,status,approval_status,branch_id",
      )
      .is("deleted_at", null)
      .gte("expense_date", from_date)
      .lte("expense_date", to_date)
      .order("expense_date", { ascending: false })
      .limit(limit ?? 50);
    if (branch_id) query = query.eq("branch_id", branch_id);

    const { data, error } = await query;
    if (error) return queryError(error.message);

    const rows = data ?? [];
    return jsonResult({
      from_date,
      to_date,
      branch_id: branch_id ?? null,
      count: rows.length,
      total_amount: rows.reduce((acc, row) => acc + Number(row.amount ?? 0), 0),
      expenses: rows,
    });
  },
});