import { db } from "@/integrations/db/client";

/**
 * Ids of the restaurants that belong to a business. Tables such as branches, suppliers and
 * purchase_invoices are keyed by restaurant_id, which is not the business (tenant) id.
 */
export async function fetchTenantRestaurantIds(tenantId: string): Promise<string[]> {
  const { data, error } = await db.from("restaurants").select("id").eq("tenant_id", tenantId);
  if (error) throw error;
  return (data ?? []).map((r: { id: string }) => r.id);
}
