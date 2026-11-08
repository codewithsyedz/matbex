import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { jsonResult, notAuthenticated, queryError, supabaseForUser } from "../supabase";

export default defineTool({
  name: "low_stock_items",
  title: "Low stock items",
  description: "Inventory items whose current stock is at or below their reorder level, optionally scoped to one branch.",
  inputSchema: {
    branch_id: z.string().uuid().optional().describe("Optional branch id from list_branches."),
    limit: z.number().int().min(1).max(200).default(50).describe("Maximum rows to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ branch_id, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated();
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("inventory_items")
      .select("id,name,unit,stock_unit,current_stock,reorder_level,unit_cost,category,branch_id")
      .eq("is_active", true)
      .order("name");
    if (branch_id) query = query.eq("branch_id", branch_id);

    const { data, error } = await query;
    if (error) return queryError(error.message);

    const low = (data ?? [])
      .filter((item) => Number(item.current_stock ?? 0) <= Number(item.reorder_level ?? 0))
      .slice(0, limit ?? 50);

    return jsonResult({ branch_id: branch_id ?? null, count: low.length, items: low });
  },
});