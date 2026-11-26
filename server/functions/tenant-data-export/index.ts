import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
// A business's full data export (PDPL right to portability), for its owners.
// POST { action: "request" }               owner: queue an export (one at a time, one per hour)
// POST { action: "download", export_id }   owner: a 1-hour link to the zip
// POST { action: "build", export_id }      background task only (cron secret): builds the zip of
//                                          CSV files, stores it privately for 7 days, emails the
//                                          owner, and removes expired exports
// Exported: sales, invoices, ledger and VAT, menu, customers, stock, team and the business's
// own settings. Never exported: credentials, keys, PINs, device secrets and sessions.

import { createClient } from "@matbex/client";
import { Zip, ZipDeflate, strToU8 } from "fflate";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { hasValidCronSecret } from "../_shared/cronSecret.ts";
import { enqueueTask } from "../../src/jobs/tasks.ts";
import { sendEmail } from "../../src/email/send.ts";

const BUCKET = "tenant-exports";
const KEEP_DAYS = 7;
const PAGE = 1000;

/** folder/file, table, and how rows belong to the business. */
const TABLES: { file: string; table: string; by: "tenant" | "restaurant" | "id" }[] = [
  { file: "business/restaurants.csv", table: "restaurants", by: "id" },
  { file: "business/branches.csv", table: "branches", by: "restaurant" },
  { file: "sales/sales_transactions.csv", table: "sales_transactions", by: "restaurant" },
  { file: "sales/sales_items.csv", table: "sales_items", by: "restaurant" },
  { file: "sales/daily_sales_summary.csv", table: "daily_sales_summary", by: "tenant" },
  { file: "sales/shifts.csv", table: "shifts", by: "restaurant" },
  { file: "sales/online_orders.csv", table: "online_orders", by: "restaurant" },
  { file: "sales/delivery_orders.csv", table: "delivery_orders", by: "tenant" },
  { file: "invoices/settlement_invoices.csv", table: "settlement_invoices", by: "restaurant" },
  { file: "invoices/settlement_payments.csv", table: "settlement_payments", by: "restaurant" },
  { file: "invoices/zatca_credit_notes.csv", table: "zatca_credit_notes", by: "tenant" },
  { file: "invoices/purchase_invoices.csv", table: "purchase_invoices", by: "restaurant" },
  { file: "invoices/expenses.csv", table: "expenses", by: "tenant" },
  { file: "invoices/supplier_payments.csv", table: "supplier_payments", by: "restaurant" },
  { file: "ledger/chart_of_accounts.csv", table: "chart_of_accounts", by: "tenant" },
  { file: "ledger/account_transactions.csv", table: "account_transactions", by: "tenant" },
  { file: "ledger/journal_entry_batches.csv", table: "journal_entry_batches", by: "tenant" },
  { file: "ledger/vat_returns.csv", table: "vat_returns", by: "tenant" },
  { file: "ledger/vat_remittances.csv", table: "vat_remittances", by: "tenant" },
  { file: "ledger/fixed_assets.csv", table: "fixed_assets", by: "tenant" },
  { file: "menu/menu_categories.csv", table: "menu_categories", by: "restaurant" },
  { file: "menu/menu_items.csv", table: "menu_items", by: "restaurant" },
  { file: "menu/recipe_ingredients.csv", table: "recipe_ingredients", by: "restaurant" },
  { file: "menu/combo_packages.csv", table: "combo_packages", by: "restaurant" },
  { file: "customers/customers.csv", table: "customers", by: "restaurant" },
  { file: "customers/customer_balance_adjustments.csv", table: "customer_balance_adjustments", by: "tenant" },
  { file: "customers/loyalty_transactions.csv", table: "loyalty_transactions", by: "restaurant" },
  { file: "customers/table_reservations.csv", table: "table_reservations", by: "tenant" },
  { file: "stock/inventory_items.csv", table: "inventory_items", by: "restaurant" },
  { file: "stock/inventory_categories.csv", table: "inventory_categories", by: "restaurant" },
  { file: "stock/suppliers.csv", table: "suppliers", by: "restaurant" },
  { file: "stock/purchases.csv", table: "purchases", by: "restaurant" },
  { file: "stock/stock_movements.csv", table: "stock_movements", by: "tenant" },
  { file: "stock/stocktakes.csv", table: "stocktakes", by: "restaurant" },
  { file: "team/staff.csv", table: "staff", by: "restaurant" },
  { file: "team/payroll_records.csv", table: "payroll_records", by: "restaurant" },
  { file: "team/staff_advances.csv", table: "staff_advances", by: "tenant" },
];

const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const body = await req.json().catch(() => ({})) as { action?: string; export_id?: string };
  const db = createClient(env("API_URL") ?? "", env("SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });

  // ---- background build (cron secret only) ----------------------------------------------
  if (body.action === "build") {
    if (!(await hasValidCronSecret(req))) return json({ error: "Not allowed" }, 403);
    if (typeof body.export_id !== "string") return json({ error: "export_id required" }, 400);
    return json(await build(db, body.export_id));
  }

  // ---- owner actions -----------------------------------------------------------------------
  let auth;
  try {
    auth = await requireUser(req);
  } catch (e) {
    if (e instanceof Response) return new Response(await e.text(), { status: e.status, headers: { ...cors, "Content-Type": "application/json" } });
    return json({ error: "Please sign in" }, 401);
  }
  const { data: profile } = await db.from("profiles").select("tenant_id").eq("id", auth.userId).maybeSingle();
  const tenantId = profile?.tenant_id as string | undefined;
  if (!tenantId) return json({ error: "Your account is not linked to a business" }, 400);
  const { data: owner } = await db.from("user_tenant_roles").select("role").eq("user_id", auth.userId).eq("tenant_id", tenantId).eq("role", "owner").limit(1);
  if (!owner?.length) return json({ error: "Only the business owner can export its data" }, 403);

  if (body.action === "request") {
    const { data: recent } = await db.from("data_exports").select("id, status, requested_at").eq("tenant_id", tenantId)
      .order("requested_at", { ascending: false }).limit(1).maybeSingle();
    if (recent && ["queued", "building"].includes(recent.status)) return json({ error: "An export is already being prepared" }, 409);
    if (recent && Date.now() - new Date(recent.requested_at).getTime() < 3600_000) return json({ error: "You can request one export per hour" }, 429);
    const { data: row, error } = await db.from("data_exports").insert({ tenant_id: tenantId, requested_by: auth.userId }).select("id").single();
    if (error || !row) return json({ error: error?.message ?? "Could not start the export" }, 500);
    await enqueueTask({ fn: "tenant-data-export", body: { action: "build", export_id: row.id } }, { jobId: `export-${row.id}` });
    return json({ ok: true, export_id: row.id });
  }

  if (body.action === "download") {
    const { data: x } = await db.from("data_exports").select("id, status, file_path, expires_at").eq("id", body.export_id ?? "").eq("tenant_id", tenantId).maybeSingle();
    if (!x || x.status !== "ready" || !x.file_path) return json({ error: "This export is not ready" }, 404);
    if (x.expires_at && new Date(x.expires_at).getTime() < Date.now()) return json({ error: "This export has expired; request a new one" }, 410);
    const { data: link, error } = await db.storage.from(BUCKET).createSignedUrl(x.file_path, 3600);
    if (error || !link?.signedUrl) return json({ error: error?.message ?? "Could not create the download link" }, 500);
    await db.from("data_exports").update({ downloaded_at: new Date().toISOString() }).eq("id", x.id);
    return json({ url: link.signedUrl });
  }

  return json({ error: "Unknown action" }, 400);
});

// deno-lint-ignore no-explicit-any
async function build(db: any, exportId: string) {
  const { data: x } = await db.from("data_exports").select("*").eq("id", exportId).maybeSingle();
  if (!x || !["queued", "failed"].includes(x.status)) return { skipped: true };
  await db.from("data_exports").update({ status: "building", error: null }).eq("id", exportId);
  try {
    const { data: tenant } = await db.from("tenants").select("id, name").eq("id", x.tenant_id).single();
    const { data: rests } = await db.from("restaurants").select("id").eq("tenant_id", x.tenant_id);
    const restIds: string[] = (rests ?? []).map((r: { id: string }) => r.id);

    const chunks: Uint8Array[] = [];
    let done!: () => void;
    let failed!: (e: unknown) => void;
    const finished = new Promise<void>((res, rej) => { done = res; failed = rej; });
    const zip = new Zip((err, data, final) => {
      if (err) return failed(err);
      chunks.push(data);
      if (final) done();
    });

    const counts: Record<string, number> = {};
    for (const t of TABLES) {
      if (t.by !== "tenant" && !restIds.length) { counts[t.table] = 0; continue; }
      const entry = new ZipDeflate(t.file, { level: 6 });
      zip.add(entry);
      let header: string[] | null = null;
      let n = 0;
      for (let from = 0; ; from += PAGE) {
        let q = db.from(t.table).select("*").range(from, from + PAGE - 1);
        q = t.by === "tenant" ? q.eq("tenant_id", x.tenant_id) : t.by === "id" ? q.in("id", restIds) : q.in("restaurant_id", restIds);
        let { data, error } = await q.order("id");
        if (error && /id/.test(error.message)) ({ data, error } = await q); // a table without an id column
        if (error) throw new Error(`${t.table}: ${error.message}`);
        const rows = (data ?? []) as Record<string, unknown>[];
        if (!header) {
          header = rows.length ? Object.keys(rows[0]) : [];
          entry.push(strToU8(header.join(",") + "\n"));
        }
        if (rows.length) entry.push(strToU8(rows.map((r) => header!.map((h) => csvCell(r[h])).join(",")).join("\n") + "\n"));
        n += rows.length;
        if (rows.length < PAGE) break;
      }
      entry.push(new Uint8Array(0), true);
      counts[t.table] = n;
    }

    const readme = new ZipDeflate("README.txt");
    zip.add(readme);
    readme.push(strToU8([
      `Matbex data export for ${tenant?.name ?? ""}`,
      `Created ${new Date().toISOString()} (UTC).`,
      "",
      "Each file is a CSV (comma-separated, UTF-8) with a header row. Amounts are in the business's currency.",
      "Folders: business, sales, invoices, ledger (accounts, journals, VAT), menu, customers, stock, team.",
      "Credentials, API keys, PINs and device secrets are never included.",
      "",
      "Rows per file:",
      ...TABLES.map((t) => `  ${t.file}: ${counts[t.table] ?? 0}`),
    ].join("\n")), true);
    zip.end();
    await finished;

    const size = chunks.reduce((s, c) => s + c.length, 0);
    const bytes = new Uint8Array(size);
    let o = 0;
    for (const c of chunks) { bytes.set(c, o); o += c.length; }
    const stamp = new Date().toISOString().slice(0, 10);
    const path = `${x.tenant_id}/${exportId}/matbex-export-${stamp}.zip`;
    const { error: upErr } = await db.storage.from(BUCKET).upload(path, new Blob([bytes], { type: "application/zip" }), { contentType: "application/zip", upsert: true });
    if (upErr) throw new Error(`upload: ${upErr.message}`);

    const expires = new Date(Date.now() + KEEP_DAYS * 86_400_000).toISOString();
    await db.from("data_exports").update({
      status: "ready", file_path: path, file_size: size, row_counts: counts, completed_at: new Date().toISOString(), expires_at: expires,
    }).eq("id", exportId);

    // Tell the owner who asked.
    const { data: u } = await db.auth.admin.getUserById(x.requested_by);
    if (u?.user?.email) {
      const site = (env("SITE_URL") ?? "https://matbex.com").replace(/\/$/, "");
      await sendEmail({
        to: u.user.email,
        subject: "Your Matbex data export is ready",
        html: `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;color:#111"><h2>Your data export is ready</h2>
          <p>The full export of <b>${String(tenant?.name ?? "").replace(/[<>&]/g, "")}</b> (${(size / 1_048_576).toFixed(1)} MB) can be downloaded until ${expires.slice(0, 10)}.</p>
          <p><a href="${site}/settings?tab=data" style="display:inline-block;background:#1f5135;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Download it in Settings</a></p></div>`,
        template: "data-export-ready",
        idempotencyKey: `data-export-${exportId}`,
        metadata: { tenant_id: x.tenant_id, export_id: exportId },
      }).catch(() => undefined);
    }

    // Housekeeping: files of expired exports (any business).
    const { data: old } = await db.from("data_exports").select("id, file_path").eq("status", "ready").lt("expires_at", new Date().toISOString()).limit(50);
    if (old?.length) {
      await db.storage.from(BUCKET).remove(old.map((r: { file_path: string }) => r.file_path).filter(Boolean));
      await db.from("data_exports").update({ status: "expired" }).in("id", old.map((r: { id: string }) => r.id));
    }
    return { ok: true, size, counts };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.from("data_exports").update({ status: "failed", error: msg.slice(0, 500), completed_at: new Date().toISOString() }).eq("id", exportId);
    throw e;
  }
}
