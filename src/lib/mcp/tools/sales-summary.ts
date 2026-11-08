import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { jsonResult, notAuthenticated, queryError, supabaseForUser } from "../supabase";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export default defineTool({
  name: "sales_summary",
  title: "Daily sales summary",
  description:
    "Daily sales totals (cash, card, delivery, other) for a date range, optionally filtered to one branch, plus period totals.",
  inputSchema: {
    from_date: isoDate.describe("Start date (inclusive), YYYY-MM-DD."),
    to_date: isoDate.describe("End date (inclusive), YYYY-MM-DD."),
    branch_id: z.string().uuid().optional().describe("Optional branch id from list_branches."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ from_date, to_date, branch_id }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated();
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("daily_sales_summary")
      .select("sales_date,branch_id,cash_sales,card_sales,delivery_sales,other_sales,total_sales,status")
      .gte("sales_date", from_date)
      .lte("sales_date", to_date)
      .order("sales_date");
    if (branch_id) query = query.eq("branch_id", branch_id);

    const { data, error } = await query;
    if (error) return queryError(error.message);

    const rows = data ?? [];
    const sum = (key: "cash_sales" | "card_sales" | "delivery_sales" | "other_sales" | "total_sales") =>
      rows.reduce((acc, row) => acc + Number(row[key] ?? 0), 0);

    return jsonResult({
      from_date,
      to_date,
      branch_id: branch_id ?? null,
      days: rows.length,
      totals: {
        cash: sum("cash_sales"),
        card: sum("card_sales"),
        delivery: sum("delivery_sales"),
        other: sum("other_sales"),
        total: sum("total_sales"),
      },
      rows,
    });
  },
});