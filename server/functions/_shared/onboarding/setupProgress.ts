// Which first-week setup steps a business has done. Used by the trial emails (trial-nurture) and
// the SuperAdmin billing tab. Each step is checked from the business's own data.

// deno-lint-ignore no-explicit-any
type Db = any;

export interface SetupStep { key: string; title: string; how: string; path: string; done: boolean }

export async function setupProgress(db: Db, tenantId: string): Promise<SetupStep[]> {
  const { data: rests } = await db.from("restaurants").select("id").eq("tenant_id", tenantId);
  const ids: string[] = (rests ?? []).map((r: { id: string }) => r.id);
  const any = async (q: Promise<{ count: number | null }>) => ((await q).count ?? 0) > 0;
  const none = Promise.resolve({ count: 0 });
  const head = { count: "exact" as const, head: true };

  const [menu, stock, team, zatca, payments, sale] = await Promise.all([
    ids.length ? any(db.from("menu_items").select("id", head).in("restaurant_id", ids)) : any(none),
    ids.length ? any(db.from("inventory_items").select("id", head).in("restaurant_id", ids)) : any(none),
    db.from("user_tenant_roles").select("user_id", head).eq("tenant_id", tenantId).then((r: { count: number | null }) => (r.count ?? 0) > 1),
    any(db.from("zatca_settings").select("id", head).eq("tenant_id", tenantId).not("vat_registration_number", "is", null)),
    any(db.from("payment_gateway_configs").select("id", head).eq("tenant_id", tenantId).eq("enabled", true)),
    ids.length ? any(db.from("sales_transactions").select("id", head).in("restaurant_id", ids)) : any(none),
  ]);

  return [
    { key: "menu", title: "Add your menu", how: "Add your dishes and drinks with prices, or import them from a spreadsheet.", path: "/menu", done: menu },
    { key: "stock", title: "Add your stock items", how: "List the ingredients you buy so Matbex can track stock and food cost.", path: "/inventory", done: stock },
    { key: "team", title: "Invite your team", how: "Add cashiers, managers or your accountant, each with their own login.", path: "/team", done: team },
    { key: "zatca", title: "Set up ZATCA e-invoicing", how: "Enter your VAT number so receipts carry the ZATCA QR code.", path: "/settings?tab=zatca", done: zatca },
    { key: "payments", title: "Turn on card payments", how: "Connect your Moyasar account to take card and online payments.", path: "/settings?tab=payments", done: payments },
    { key: "sale", title: "Record your first sale", how: "Open a shift on the POS and ring up a sale.", path: "/record-sale", done: sale },
  ];
}
