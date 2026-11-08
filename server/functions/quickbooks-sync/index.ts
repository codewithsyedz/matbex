import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
// Authenticated edge function. Performs a QuickBooks Online sync action for the
// calling owner's tenant.
// Actions: "test", "company_info", "pull_chart_of_accounts", "push_daily_journal", "set_environment"
import { createClient } from "@matbex/client";
import { buildCorsHeaders } from "../_shared/cors.ts";

// Request-scoped CORS headers (assigned per request; helpers below spread them).
let corsHeaders: Record<string, string> = buildCorsHeaders(new Request("https://matbex.com"));

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

function apiBase(sandbox: boolean): string {
  return sandbox
    ? "https://sandbox-quickbooks.api.intuit.com/v3/company"
    : "https://quickbooks.api.intuit.com/v3/company";
}

function isSandbox(integration: any): boolean {
  return Boolean((integration.settings ?? {}).sandbox);
}

async function ensureFreshToken(db: any, integration: any) {
  const exp = integration.token_expires_at ? new Date(integration.token_expires_at).getTime() : 0;
  if (exp - 60_000 > Date.now() && integration.access_token) return integration.access_token;
  if (!integration.refresh_token) throw new Error("No refresh token; please reconnect QuickBooks");

  const basic = btoa(`${integration.client_id}:${integration.client_secret}`);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: integration.refresh_token,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    await db.from("accounting_integrations")
      .update({ status: "expired", last_error: data.error_description ?? data.error ?? "refresh_failed" })
      .eq("id", integration.id);
    throw new Error(`Token refresh failed: ${data.error_description ?? data.error ?? "unknown"}`);
  }
  const expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString();
  await db.from("accounting_integrations")
    .update({
      access_token: data.access_token,
      // Intuit rotates refresh tokens; always persist the newest one.
      refresh_token: data.refresh_token ?? integration.refresh_token,
      token_expires_at: expiresAt,
      status: "connected",
    })
    .eq("id", integration.id);
  return data.access_token;
}

async function qboFetch(integration: any, accessToken: string, path: string, init: RequestInit = {}) {
  const url = `${apiBase(isSandbox(integration))}/${integration.organization_id}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`QuickBooks API ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "unauthorized" }, 401);

    const dbUser = createClient(
      env("API_URL")!,
      env("ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await dbUser.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "unauthorized" }, 401);

    const db = createClient(
      env("API_URL")!,
      env("SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const action: string = body.action ?? "test";
    const integrationId: string | undefined = body.integration_id;
    if (!integrationId) return json({ error: "integration_id required" }, 400);

    const { data: integration, error: intErr } = await db
      .from("accounting_integrations")
      .select("*").eq("id", integrationId).eq("provider", "quickbooks").maybeSingle();
    if (intErr || !integration) return json({ error: "integration_not_found" }, 404);

    const { data: isOwner } = await dbUser.rpc("has_tenant_role", {
      _user_id: user.id, _tenant_id: integration.tenant_id, _role: "owner",
    });
    if (!isOwner) return json({ error: "forbidden" }, 403);

    const logSync = async (entry: Record<string, unknown>) => {
      await db.from("accounting_sync_log").insert({
        tenant_id: integration.tenant_id,
        integration_id: integration.id,
        provider: integration.provider,
        ...entry,
      });
    };

    if (action === "set_environment") {
      const sandbox = Boolean(body.sandbox);
      await db.from("accounting_integrations")
        .update({ settings: { ...(integration.settings ?? {}), sandbox } })
        .eq("id", integration.id);
      return json({ ok: true, sandbox });
    }

    const accessToken = await ensureFreshToken(db, integration);

    if (!integration.organization_id) {
      return json({ error: "no_company_selected" }, 400);
    }

    if (action === "test" || action === "company_info") {
      const data = await qboFetch(integration, accessToken, `/companyinfo/${integration.organization_id}`);
      const info = data?.CompanyInfo ?? {};
      if (info.CompanyName && info.CompanyName !== integration.organization_name) {
        await db.from("accounting_integrations")
          .update({ organization_name: info.CompanyName, last_error: null })
          .eq("id", integration.id);
      }
      return json({
        ok: true,
        company_name: info.CompanyName ?? null,
        country: info.Country ?? null,
        realm_id: integration.organization_id,
        sandbox: isSandbox(integration),
      });
    }

    if (action === "pull_chart_of_accounts") {
      const query = encodeURIComponent("select Id, Name, AccountType, AccountSubType, Classification, Active from Account maxresults 1000");
      const data = await qboFetch(integration, accessToken, `/query?query=${query}`);
      const accounts = (data?.QueryResponse?.Account ?? []).map((a: any) => ({
        id: String(a.Id),
        name: a.Name,
        type: a.AccountType,
        sub_type: a.AccountSubType,
        classification: a.Classification,
        active: a.Active !== false,
      }));
      await logSync({
        entity_type: "chart_of_accounts", direction: "pull",
        status: "success", payload: { count: accounts.length },
      });
      return json({ accounts });
    }

    if (action === "push_daily_journal") {
      const journalDate: string = body.date ?? new Date().toISOString().slice(0, 10);
      const lineItems = body.line_items;
      if (!Array.isArray(lineItems) || lineItems.length < 2) {
        return json({ error: "line_items[] (>=2) required" }, 400);
      }

      const lines = lineItems.map((li: any) => {
        const amount = Number(li.amount ?? li.debit ?? li.credit ?? 0);
        const postingType = li.posting_type
          ? String(li.posting_type)
          : Number(li.debit ?? 0) > 0 ? "Debit" : "Credit";
        if (!li.account_id) throw new Error("Each line item needs an account_id (QuickBooks account Id)");
        if (!(amount > 0)) throw new Error("Each line item needs a positive amount");
        return {
          DetailType: "JournalEntryLineDetail",
          Amount: Number(amount.toFixed(2)),
          Description: li.description ?? undefined,
          JournalEntryLineDetail: {
            PostingType: postingType === "Debit" ? "Debit" : "Credit",
            AccountRef: { value: String(li.account_id) },
          },
        };
      });

      const debits = lines.filter((l) => l.JournalEntryLineDetail.PostingType === "Debit")
        .reduce((s, l) => s + l.Amount, 0);
      const credits = lines.filter((l) => l.JournalEntryLineDetail.PostingType === "Credit")
        .reduce((s, l) => s + l.Amount, 0);
      if (Math.abs(debits - credits) > 0.01) {
        return json({ error: `unbalanced_journal: debits ${debits.toFixed(2)} vs credits ${credits.toFixed(2)}` }, 400);
      }

      const payload = {
        TxnDate: journalDate,
        DocNumber: `MATBEX-${journalDate}`.slice(0, 21),
        PrivateNote: body.notes ?? `Matbex daily summary ${journalDate}`,
        Line: lines,
      };

      try {
        const data = await qboFetch(integration, accessToken, `/journalentry?minorversion=70`, {
          method: "POST", body: JSON.stringify(payload),
        });
        await logSync({
          entity_type: "journal", direction: "push", status: "success",
          external_id: String(data?.JournalEntry?.Id ?? ""), payload,
        });
        await db.from("accounting_integrations")
          .update({ last_sync_at: new Date().toISOString(), last_error: null })
          .eq("id", integration.id);
        return json({ ok: true, journal: data?.JournalEntry });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await logSync({ entity_type: "journal", direction: "push", status: "error", error_message: msg, payload });
        await db.from("accounting_integrations").update({ last_error: msg }).eq("id", integration.id);
        return json({ error: msg }, 500);
      }
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("quickbooks-sync error:", msg);
    return json({ error: msg }, 500);
  }
});