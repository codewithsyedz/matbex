import { env } from "../_runtime/env.ts";
import { serve } from "../_runtime/serve.ts";
import { createClient } from "@matbex/client";

import { buildCorsHeaders } from "../_shared/cors.ts";
import { guardCronCaller } from "../_shared/cronGuard.ts";

const APP_URL = "https://www.matbex.com";
const REPORT_PATH = "/reports/invoice-ledger-reconciliation";

const ISSUE_LABELS: Record<string, string> = {
  duplicate_lines: "Duplicated lines",
  total_mismatch: "Total <> lines",
  expense_mismatch: "Expense <> bill",
  ledger_mismatch: "Ledger <> bill",
  not_posted: "Not posted to ledger",
};

interface DivergenceRow {
  invoice_id: string;
  invoice_number: string | null;
  invoice_date: string;
  supplier_name: string | null;
  branch_id: string | null;
  invoice_total: number | string;
  lines_total: number | string;
  duplicate_amount: number | string;
  duplicate_line_count: number;
  expense_id: string | null;
  expense_amount: number | string | null;
  ledger_debit: number | string | null;
  issues: string[];
}

const num = (v: unknown) => Number(v ?? 0) || 0;
const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

function drilldownUrl(row: DivergenceRow, tenantSafe = true): string {
  const params = new URLSearchParams();
  if (row.invoice_number) params.set("invoice", row.invoice_number);
  if (row.branch_id) params.set("branch", row.branch_id);
  params.set("from", row.invoice_date);
  params.set("to", row.invoice_date);
  params.set("filter", "flagged");
  void tenantSafe;
  return `${APP_URL}${REPORT_PATH}?${params.toString()}`;
}

function buildCsv(rows: DivergenceRow[], tenantName: string, scanDate: string): string {
  const lines: string[] = [];
  lines.push(`Invoice-to-Ledger Mismatch Scan,${esc(tenantName)}`);
  lines.push(`Generated,${esc(scanDate)}`);
  lines.push(`Flagged invoices,${rows.length}`);
  lines.push("");
  lines.push(
    [
      "Invoice #",
      "Date",
      "Supplier",
      "Issues",
      "Bill total",
      "Lines total",
      "Duplicate amount",
      "Duplicate lines",
      "Expense amount",
      "Ledger debit",
      "Drilldown link",
    ].join(","),
  );
  for (const r of rows) {
    lines.push(
      [
        esc(r.invoice_number ?? ""),
        esc(r.invoice_date),
        esc(r.supplier_name ?? ""),
        esc((r.issues ?? []).map((i) => ISSUE_LABELS[i] ?? i).join(" | ")),
        num(r.invoice_total).toFixed(2),
        num(r.lines_total).toFixed(2),
        num(r.duplicate_amount).toFixed(2),
        String(r.duplicate_line_count ?? 0),
        r.expense_amount == null ? "" : num(r.expense_amount).toFixed(2),
        r.ledger_debit == null ? "" : num(r.ledger_debit).toFixed(2),
        esc(drilldownUrl(r)),
      ].join(","),
    );
  }
  return lines.join("\n");
}

function buildHtml(rows: DivergenceRow[], tenantName: string, scanDate: string): string {
  const top = rows.slice(0, 15);
  const body = top
    .map(
      (r) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee;">
          <a href="${drilldownUrl(r)}" style="color:#00A859;text-decoration:none;font-weight:600;">${r.invoice_number ?? r.invoice_id.slice(0, 8)}</a>
          <div style="color:#888;font-size:12px;">${r.invoice_date}${r.supplier_name ? ` · ${r.supplier_name}` : ""}</div>
        </td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px;">${(r.issues ?? [])
          .map((i) => ISSUE_LABELS[i] ?? i)
          .join(", ")}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${num(r.invoice_total).toFixed(2)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${
          r.ledger_debit == null ? "—" : num(r.ledger_debit).toFixed(2)
        }</td>
      </tr>`,
    )
    .join("");

  return `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#222;background:#f6f7f9;padding:24px;">
  <div style="max-width:680px;margin:0 auto;background:#fff;border:1px solid #eee;border-radius:12px;overflow:hidden;">
    <div style="padding:20px 24px;border-bottom:1px solid #eee;">
      <h2 style="margin:0;font-size:18px;">Invoice-to-ledger mismatches</h2>
      <p style="margin:6px 0 0;color:#666;font-size:13px;">${tenantName} · scan of ${scanDate}</p>
    </div>
    <div style="padding:20px 24px;">
      <p style="margin:0 0 16px;font-size:14px;"><strong>${rows.length}</strong> invoice(s) failed the ledger check. The attached CSV lists every flagged bill with a direct drilldown link.</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr>
          <th style="text-align:left;padding:8px;border-bottom:2px solid #eee;">Invoice</th>
          <th style="text-align:left;padding:8px;border-bottom:2px solid #eee;">Issues</th>
          <th style="text-align:right;padding:8px;border-bottom:2px solid #eee;">Bill</th>
          <th style="text-align:right;padding:8px;border-bottom:2px solid #eee;">Ledger</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
      ${rows.length > top.length ? `<p style="color:#666;font-size:12px;margin-top:12px;">+ ${rows.length - top.length} more in the CSV.</p>` : ""}
      <p style="margin-top:24px;">
        <a href="${APP_URL}${REPORT_PATH}" style="background:#00A859;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px;">Open reconciliation report</a>
      </p>
    </div>
  </div>
</body></html>`;
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const unauthorized = await guardCronCaller(req, corsHeaders, { allowAnyUser: true });
  if (unauthorized) return unauthorized;

  try {
    const resendApiKey = env("RESEND_API_KEY");
    if (!resendApiKey) throw new Error("RESEND_API_KEY not configured");
    const { Resend } = await import("resend");
    const resend = new Resend(resendApiKey);

    const db = createClient(
      env("API_URL")!,
      env("SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    let payload: Record<string, unknown> = {};
    try {
      payload = await req.json();
    } catch (_e) {
      payload = {};
    }
    const onlyTenant = (payload.tenant_id as string | undefined) ?? null;
    const lookbackDays = Number(payload.lookback_days ?? 180);
    const dryRun = payload.dry_run === true;

    const from = new Date(Date.now() - lookbackDays * 86400000).toISOString().slice(0, 10);
    const scanDate = new Date().toISOString().slice(0, 10);

    let tenantQuery = db.from("tenants").select("id, name, status");
    if (onlyTenant) tenantQuery = tenantQuery.eq("id", onlyTenant);
    const { data: tenants, error: tenantsError } = await tenantQuery;
    if (tenantsError) throw tenantsError;

    const results: Array<Record<string, unknown>> = [];

    for (const tenant of tenants ?? []) {
      if (!onlyTenant && tenant.status && tenant.status !== "active") continue;

      const { data: rows, error: scanError } = await db.rpc(
        "detect_invoice_ledger_divergence_for_tenant",
        { p_tenant_id: tenant.id, p_branch_id: null, p_from: from, p_to: scanDate },
      );
      if (scanError) {
        console.error(`scan failed for tenant ${tenant.id}:`, scanError.message);
        results.push({ tenant: tenant.id, error: scanError.message });
        continue;
      }

      const flagged = (rows ?? []) as DivergenceRow[];
      if (flagged.length === 0) {
        results.push({ tenant: tenant.id, flagged: 0, emailed: 0 });
        continue;
      }

      // Recipients: tenant owners.
      const { data: owners } = await db
        .from("user_roles")
        .select("user_id")
        .eq("restaurant_id", tenant.id)
        .eq("role", "owner");

      const recipients: string[] = [];
      for (const o of owners ?? []) {
        const { data: u } = await db.auth.admin.getUserById(o.user_id);
        const email = u?.user?.email;
        if (email && !recipients.includes(email)) recipients.push(email);
      }

      if (recipients.length === 0 || dryRun) {
        results.push({ tenant: tenant.id, flagged: flagged.length, emailed: 0, dryRun });
        continue;
      }

      const csv = buildCsv(flagged, tenant.name ?? "", scanDate);
      const { error: sendError } = await resend.emails.send({
        from: "Matbex Accounting <accounting@matbex.com>",
        to: recipients,
        subject: `${flagged.length} invoice-to-ledger mismatch${flagged.length === 1 ? "" : "es"} — ${scanDate}`,
        html: buildHtml(flagged, tenant.name ?? "", scanDate),
        attachments: [
          {
            filename: `invoice-ledger-mismatches-${scanDate}.csv`,
            content: btoa(unescape(encodeURIComponent(csv))),
          },
        ],
      });
      if (sendError) {
        console.error("resend error", sendError);
        results.push({ tenant: tenant.id, flagged: flagged.length, error: String(sendError) });
        continue;
      }

      await db.from("email_send_log").insert({
        message_id: `invoice-ledger-scan-${tenant.id}-${scanDate}`,
        template_name: "invoice-ledger-mismatch-scan",
        recipient_email: recipients[0],
        status: "sent",
        metadata: { flagged: flagged.length, recipients, scan_date: scanDate },
      });

      results.push({ tenant: tenant.id, flagged: flagged.length, emailed: recipients.length });
    }

    return new Response(JSON.stringify({ ok: true, scanDate, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("nightly-invoice-ledger-scan failed", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
