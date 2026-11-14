import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
import { createClient } from "@matbex/client";
import { generateObject, NoObjectGeneratedError } from "ai";
import { AI_MODEL, aiConfigured, anthropicModel } from "../_runtime/ai.ts";
import { z } from "zod";
import { buildCorsHeaders, corsPreflight } from "../_shared/cors.ts";
import { requireUser, userHasTenantRole } from "../_shared/auth.ts";

const MODEL = AI_MODEL;
const PROMPT_VERSION = "income-account-v1";
const MIN_CONFIDENCE = 0.82;
const RUN_ID_HEADER = "X-AI-Run-ID";

const SuggestionSchema = z.object({
  account_id: z.string(),
  classification: z.string(),
  confidence: z.number(),
  rationale: z.string(),
});

type AuditInput = {
  tenant_id: string;
  branch_id: string | null;
  source_type: "daily_sales";
  source_id: string;
  requested_by: string;
  selected_account_id?: string | null;
  confidence?: number | null;
  classification?: string | null;
  rationale?: string | null;
  outcome: "posted" | "blocked" | "failed";
  error_message?: string | null;
  ledger_batch_id?: string | null;
};

function json(cors: Record<string, string>, payload: unknown, status = 200, runId?: string) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      ...(runId ? { [RUN_ID_HEADER]: runId, "Access-Control-Expose-Headers": `${RUN_ID_HEADER}, x-request-id` } : {}),
    },
  });
}

function errorDetails(error: unknown): { status: number; message: string; retryAfter: number | null } {
  const value = error as { statusCode?: number; message?: string; responseBody?: string; responseHeaders?: Record<string, string> };
  const status = Number(value?.statusCode) || 500;
  let message = value?.message || "AI income journal generation failed";
  if (value?.responseBody) {
    try {
      const parsed = JSON.parse(value.responseBody);
      message = parsed?.error?.message || parsed?.message || message;
    } catch { /* retain SDK message */ }
  }
  const retry = Number(value?.responseHeaders?.["retry-after"]);
  return { status, message, retryAfter: Number.isFinite(retry) && retry > 0 ? retry : null };
}

async function generateSuggestion(_key: string, initialRunId: string | undefined, prompt: string) {
  // Claude via the AI SDK; the run id is local and only used to correlate retries/audit rows.
  const runId = initialRunId ?? crypto.randomUUID();
  const { object } = await generateObject({
    model: anthropicModel(MODEL),
    schema: SuggestionSchema,
    prompt,
    maxRetries: 0,
  });
  return { output: object, runId };
}

serve(async (req) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;
  const cors = buildCorsHeaders(req);
  if (req.method !== "POST") return json(cors, { error: "Method not allowed" }, 405);

  let auditContext: AuditInput | null = null;
  let admin: ReturnType<typeof createClient> | null = null;
  let runId = req.headers.get(RUN_ID_HEADER)?.trim() || undefined;

  try {
    const auth = await requireUser(req);
    admin = auth.db;
    const body = await req.json().catch(() => ({}));
    const salesId = typeof body?.sales_id === "string" ? body.sales_id.trim() : "";
    const previewOnly = body?.preview_only === true;
    if (!salesId) return json(cors, { error: "sales_id is required" }, 400);

    const { data: sales, error: salesError } = await admin
      .from("daily_sales_summary")
      .select("id, tenant_id, restaurant_id, branch_id, sales_date, cash_sales, card_sales, delivery_sales, other_sales, total_sales, variance_notes, status, ledger_posted")
      .eq("id", salesId)
      .maybeSingle();
    if (salesError) throw salesError;
    if (!sales) return json(cors, { error: "Sales day not found" }, 404);

    auditContext = {
      tenant_id: sales.tenant_id,
      branch_id: sales.branch_id,
      source_type: "daily_sales",
      source_id: sales.id,
      requested_by: auth.userId,
      outcome: "blocked",
    };

    const isFinance = await userHasTenantRole(admin, auth.userId, sales.tenant_id, ["owner", "manager", "accountant"]);
    const { data: isSuperadmin } = await admin.rpc("is_superadmin", { _user_id: auth.userId });
    const { data: canAccess } = await auth.userClient.rpc("can_access_restaurant", { _restaurant_id: sales.restaurant_id });
    if ((!isFinance && !isSuperadmin) || canAccess !== true) return json(cors, { error: "Finance role and restaurant access are required" }, 403);
    if (!previewOnly && !["closed", "approved"].includes(sales.status)) return json(cors, { error: "Close the sales day before posting" }, 409);
    if (!previewOnly && sales.ledger_posted) return json(cors, { error: "Sales are already posted" }, 409);

    const { data: accounts, error: accountsError } = await admin
      .from("chart_of_accounts")
      .select("id, account_code, account_name, account_type, description, help_text")
      .eq("tenant_id", sales.tenant_id)
      .eq("is_active", true)
      .eq("account_type", "revenue")
      .order("account_code");
    if (accountsError) throw accountsError;

    const { data: visibility } = await admin
      .from("account_branch_visibility")
      .select("account_id, branch_id")
      .in("account_id", (accounts || []).map((account) => account.id));
    const restrictions = new Map<string, Set<string>>();
    for (const row of visibility || []) {
      const set = restrictions.get(row.account_id) || new Set<string>();
      set.add(row.branch_id);
      restrictions.set(row.account_id, set);
    }
    const eligibleAccounts = (accounts || []).filter((account) => {
      const allowed = restrictions.get(account.id);
      return !allowed?.size || (!!sales.branch_id && allowed.has(sales.branch_id));
    });
    if (!eligibleAccounts.length) return json(cors, { error: "No eligible revenue accounts are configured for this branch" }, 422);

    // A finance user explicitly confirmed an account after reviewing a low-confidence suggestion.
    const confirmedId = typeof body?.confirm_account_id === "string" ? body.confirm_account_id.trim() : "";
    if (confirmedId && !previewOnly) {
      const confirmed = eligibleAccounts.find((account) => account.id === confirmedId);
      if (!confirmed) return json(cors, { error: "The confirmed account is not an eligible revenue account for this branch" }, 422);
      const { data: txId, error: confirmError } = await auth.userClient.rpc("apply_ai_income_account_and_post", {
        p_sales_id: sales.id,
        p_account_id: confirmed.id,
      });
      if (confirmError) throw confirmError;
      await admin.from("ai_income_journal_audit").insert({
        ...auditContext, outcome: "posted", selected_account_id: confirmed.id, ledger_batch_id: txId,
        classification: "User-confirmed", rationale: "Posted after a finance user confirmed the suggested revenue account.",
        model: MODEL, prompt_version: PROMPT_VERSION,
      });
      return json(cors, {
        posted: true, ledger_batch_id: txId,
        account: { id: confirmed.id, code: confirmed.account_code, name: confirmed.account_name },
        confidence: 1, classification: "User-confirmed", rationale: "Confirmed by user",
      }, 200);
    }

    const prompt = `You are the revenue-account classification control in a Saudi restaurant accounting system. Choose exactly one revenue account for the standard (non-delivery) daily sales below from the supplied catalogue. Never invent an ID. The application deterministically controls gross amounts, payment-account debits, delivery receivables, VAT, branch routing, balancing, locking, permissions, and posting. Delivery revenue remains separately mapped by deterministic rules. If the sales context is ambiguous, lower confidence. Confidence must be between 0 and 1. Keep rationale under 240 characters.\n\nSales day:\n${JSON.stringify({ date: sales.sales_date, cash_sales: sales.cash_sales, card_sales: sales.card_sales, delivery_sales: sales.delivery_sales, other_sales: sales.other_sales, gross_total: sales.total_sales, notes: sales.variance_notes })}\n\nEligible revenue accounts:\n${JSON.stringify(eligibleAccounts)}`;

    // Without the AI (no key, or it fails after retries) End of Day must still post: suggest the
    // standard sales account (4000, else the first eligible revenue account) for a finance user
    // to confirm, through the same confirm flow as a low-confidence suggestion. Nothing posts
    // without that confirmation.
    const standardAccount = eligibleAccounts.find((account) => account.account_code === "4000") ?? eligibleAccounts[0];
    const confirmStandard = async (reason: string) => {
      auditContext.outcome = "blocked";
      auditContext.error_message = reason;
      await admin.from("ai_income_journal_audit").insert({ ...auditContext, selected_account_id: standardAccount.id, model: MODEL, prompt_version: PROMPT_VERSION });
      return json(cors, {
        posted: false,
        needs_review: true,
        message: reason,
        account: { id: standardAccount.id, code: standardAccount.account_code, name: standardAccount.account_name },
        confidence: 0,
        classification: "Standard sales account",
        rationale: `${reason}. Confirm to post to the standard sales account.`,
      }, 200, runId);
    };
    if (!aiConfigured()) {
      if (previewOnly) return json(cors, { error: "AI is not configured (ANTHROPIC_API_KEY)" }, 503);
      return await confirmStandard("AI account suggestion is unavailable");
    }
    const key = "anthropic";

    let suggestion: z.infer<typeof SuggestionSchema> | null = null;
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) {
        const details = errorDetails(lastError);
        const seconds = details.retryAfter ?? Math.min(2 ** attempt, 8);
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000 + Math.floor(Math.random() * 250)));
      }
      try {
        const generated = await generateSuggestion(key, runId, prompt);
        suggestion = generated.output;
        runId = generated.runId;
        break;
      } catch (error) {
        lastError = error;
        const details = errorDetails(error);
        if (details.status !== 429 && details.status < 500) break;
      }
    }
    if (!suggestion && !previewOnly) {
      return await confirmStandard(`AI account suggestion failed (${errorDetails(lastError).message})`);
    }
    if (!suggestion) {
      const details = errorDetails(lastError);
      auditContext.outcome = "failed";
      auditContext.error_message = details.message;
      await admin.from("ai_income_journal_audit").insert({ ...auditContext, model: MODEL, prompt_version: PROMPT_VERSION });
      return json(cors, { error: details.message, requires: details.status === 402 ? "top_up" : details.status === 403 ? "admin_action" : undefined }, details.status, runId);
    }

    const selected = eligibleAccounts.find((account) => account.id === suggestion?.account_id);
    const confidence = Math.max(0, Math.min(1, Number(suggestion.confidence) || 0));
    Object.assign(auditContext, {
      selected_account_id: selected?.id ?? null,
      confidence,
      classification: suggestion.classification.slice(0, 160),
      rationale: suggestion.rationale.slice(0, 500),
    });
    if (!selected) {
      auditContext.outcome = "blocked";
      auditContext.error_message = "AI selected an account outside the eligible catalogue";
      await admin.from("ai_income_journal_audit").insert({ ...auditContext, model: MODEL, prompt_version: PROMPT_VERSION });
      return json(cors, { error: auditContext.error_message }, 422, runId);
    }
    if (confidence < MIN_CONFIDENCE) {
      auditContext.outcome = "blocked";
      auditContext.error_message = `AI confidence ${Math.round(confidence * 100)}% is below the ${Math.round(MIN_CONFIDENCE * 100)}% automatic-posting threshold`;
      await admin.from("ai_income_journal_audit").insert({ ...auditContext, model: MODEL, prompt_version: PROMPT_VERSION });
      // Not an error: nothing is posted, the caller asks a finance user to confirm.
      return json(cors, {
        posted: false,
        needs_review: true,
        message: auditContext.error_message,
        account: { id: selected.id, code: selected.account_code, name: selected.account_name },
        confidence,
        classification: suggestion.classification,
        rationale: suggestion.rationale,
      }, 200, runId);
    }

    if (previewOnly) {
      return json(cors, {
        posted: false,
        preview: true,
        account: { id: selected.id, code: selected.account_code, name: selected.account_name },
        confidence,
        classification: suggestion.classification,
        rationale: suggestion.rationale,
      }, 200, runId);
    }

    const { data: transactionId, error: postError } = await auth.userClient.rpc("apply_ai_income_account_and_post", {
      p_sales_id: sales.id,
      p_account_id: selected.id,
    });
    if (postError) throw postError;

    auditContext.outcome = "posted";
    auditContext.ledger_batch_id = transactionId;
    await admin.from("ai_income_journal_audit").insert({ ...auditContext, model: MODEL, prompt_version: PROMPT_VERSION });
    return json(cors, {
      posted: true,
      ledger_batch_id: transactionId,
      account: { id: selected.id, code: selected.account_code, name: selected.account_name },
      confidence,
      classification: suggestion.classification,
      rationale: suggestion.rationale,
    }, 200, runId);
  } catch (error) {
    if (error instanceof Response) {
      const text = await error.text();
      return new Response(text, { status: error.status, headers: { ...cors, "Content-Type": "application/json" } });
    }
    const message = NoObjectGeneratedError.isInstance(error)
      ? "AI could not produce a valid account classification"
      : error instanceof Error ? error.message : "AI income journal posting failed";
    if (admin && auditContext) {
      await admin.from("ai_income_journal_audit").insert({ ...auditContext, outcome: "failed", error_message: message, model: MODEL, prompt_version: PROMPT_VERSION });
    }
    return json(cors, { error: message }, 500, runId);
  }
});
