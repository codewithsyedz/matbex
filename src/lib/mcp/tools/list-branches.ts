import { defineTool } from "@lovable.dev/mcp-js";
import { jsonResult, notAuthenticated, queryError, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_branches",
  title: "List branches",
  description: "List the active branches (locations) the signed-in user can access, with city, timezone and VAT rate.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated();
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("branches")
      .select("id,name,code,city,timezone,vat_rate,is_primary,is_active")
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("is_primary", { ascending: false })
      .order("name");
    if (error) return queryError(error.message);
    return jsonResult({ branches: data ?? [] });
  },
});