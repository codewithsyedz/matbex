import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listBranchesTool from "./tools/list-branches";
import salesSummaryTool from "./tools/sales-summary";
import listExpensesTool from "./tools/list-expenses";
import lowStockItemsTool from "./tools/low-stock-items";

// Must be the direct Supabase host, built from the project ref (inlined at build time).
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "matbex",
  title: "Matbex",
  version: "0.1.0",
  instructions:
    "Read-only tools for Matbex, a restaurant back-office platform. Use `list_branches` first to resolve branch ids, then `sales_summary` for daily revenue, `list_expenses` for spend, and `low_stock_items` for inventory that needs reordering. All data is scoped to the signed-in user's workspace.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listBranchesTool, salesSummaryTool, listExpensesTool, lowStockItemsTool],
});