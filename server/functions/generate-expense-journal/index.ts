import { serve } from "../_runtime/serve.ts";
import { isSuperAdminSession } from "../_shared/superadmin.ts";
import { env } from "../_runtime/env.ts";
import { createClient } from "@matbex/client";
import Anthropic from "@anthropic-ai/sdk";
import { AI_MODEL, AiOutputError, aiConfigured, generateJson } from "../_runtime/ai.ts";
import { z } from "zod";
import { buildCorsHeaders, corsPreflight } from "../_shared/cors.ts";
import { requireUser, userHasTenantRole } from "../_shared/auth.ts";

const MODEL = AI_MODEL;
const PROMPT_VERSION = "expense-account-v1";
const MIN_CONFIDENCE = 0.82;
const RUN_ID_HEADER = "X-AI-Run-ID";

const SuggestionSchema = z.object({
  account_id: z.string(),
  classification: z.string(),
  confidence: z.number(),
  rationale: z.string(),
});

/** The same shape for structured outputs, so the model always answers with exactly these fields. */
const SUGGESTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    account_id: { type: "string", description: "id of the chosen account, copied from the catalogue" },
    classification: { type: "string" },
    confidence: { type: "number", description: "0 to 1" },
    rationale: { type: "string", description: "under 240 characters" },
  },
  required: ["account_id", "classification", "confidence", "rationale"],
  additionalProperties: false,
};

type AuditInput = {
  tenant_id: string;
  branch_id: string | null;
  expense_id: string;
  requested_by: string;
  selected_account_id?: string | null;
  confidence?: number | null;
  classification?: string | null;
  rationale?: string | null;
  outcome: "posted" | "blocked" | "failed";
  error_message?: string | null;
  ledger_transaction_id?: string | null;
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
  if (error instanceof AiOutputError) return { status: 422, message: error.message, retryAfter: null };
  if (error instanceof Anthropic.APIError) {
    const body = error.error as { error?: { message?: string } } | undefined;
    const retry = Number(error.headers?.get?.("retry-after"));
    return {
      status: Number(error.status) || 502,
      message: body?.error?.message || error.message || "AI journal generation failed",
      retryAfter: Number.isFinite(retry) && retry > 0 ? retry : null,
    };
  }
  return { status: 500, message: error instanceof Error ? error.message : "AI journal generation failed", retryAfter: null };
}

async function generateSuggestion(_key: string, initialRunId: string | undefined, prompt: string) {
  // Claude with structured outputs; the run id is local and only used to correlate retries/audit rows.
  const runId = initialRunId ?? crypto.randomUUID();
  const output = await generateJson({
    prompt,
    schema: SUGGESTION_JSON_SCHEMA,
    parse: (v) => SuggestionSchema.parse(v),
    effort: "medium",
    maxTokens: 8000,
  });
  return { output, runId };
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
    const expenseId = typeof body?.expense_id === "string" ? body.expense_id.trim() : "";
    const previewOnly = body?.preview_only === true;
    if (!expenseId) return json(cors, { error: "expense_id is required" }, 400);

    const { data: expense, error: expenseError } = await admin
      .from("expenses")
      .select("id, tenant_id, restaurant_id, branch_id, description, amount, net_amount, vat_amount, vat_rate, vat_inclusive, expense_date, status, approval_status, ledger_posted, category_id, supplier_id, project_id, payment_method, payment_account_id, capital_account_id")
      .eq("id", expenseId)
      .maybeSingle();
    if (expenseError) throw expenseError;
    if (!expense) return json(cors, { error: "Expense not found" }, 404);

    auditContext = {
      tenant_id: expense.tenant_id,
      branch_id: expense.branch_id,
      expense_id: expense.id,
      requested_by: auth.userId,
      outcome: "blocked",
    };

    const isFinance = await userHasTenantRole(admin, auth.userId, expense.tenant_id, ["owner", "manager", "accountant"]);
    const isSuperadmin = await isSuperAdminSession(req, auth.userId);
    const { data: canAccess } = await auth.userClient.rpc("can_access_restaurant", { _restaurant_id: expense.restaurant_id });
    if ((!isFinance && !isSuperadmin) || canAccess !== true) return json(cors, { error: "Finance role and restaurant access are required" }, 403);
    if (!previewOnly && expense.approval_status !== "approved") return json(cors, { error: "Only approved expenses can be posted" }, 409);
    if (!previewOnly && expense.ledger_posted) return json(cors, { error: "Expense is already posted" }, 409);
    if (!expense.description?.trim()) return json(cors, { error: "Add an expense description before using AI journal posting" }, 422);
    if (!previewOnly && expense.status === "paid" && !expense.payment_account_id && !expense.capital_account_id) {
      return json(cors, { error: "Select Cash in Hand, Cash in Bank, Petty Cash, or a capital account before posting" }, 422);
    }

    const accountQuery = admin
      .from("chart_of_accounts")
      .select("id, account_code, account_name, account_type, description, help_text, vat_applicable, requires_cost_center, is_fixed_asset_account")
      .eq("tenant_id", expense.tenant_id)
      .eq("is_active", true)
      .in("account_type", ["expense", "asset", "liability", "cogs"])
      .order("account_code");
    const { data: accounts, error: accountsError } = await accountQuery;
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
      return !allowed?.size || (!!expense.branch_id && allowed.has(expense.branch_id));
    });
    if (!eligibleAccounts.length) return json(cors, { error: "No eligible accounts are configured for this branch" }, 422);

    const prompt = `You are the classification control in a Saudi restaurant accounting system. Choose exactly one debit-side account for the expense below from the supplied account catalogue. Never invent an ID. The application deterministically handles cash/bank/AP credits, input VAT, branch routing, balancing, approvals, and immutable posting. Choose COGS only for consumption; purchases of stock belong to an inventory asset account when available. Choose a fixed asset for capital expenditure. If the description is ambiguous, lower confidence. Confidence must be between 0 and 1. Keep rationale under 240 characters.\n\nExpense:\n${JSON.stringify({ description: expense.description, gross_amount: expense.amount, net_amount: expense.net_amount, vat_amount: expense.vat_amount, vat_rate: expense.vat_rate, date: expense.expense_date, payment_status: expense.status, payment_method: expense.payment_method, has_supplier: !!expense.supplier_id, has_project: !!expense.project_id })}\n\nEligible accounts:\n${JSON.stringify(eligibleAccounts)}`;

    if (!aiConfigured()) return json(cors, { error: "AI is not configured (ANTHROPIC_API_KEY)" }, 500);
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
    if (!suggestion) {
      const details = errorDetails(lastError);
      auditContext.outcome = "failed";
      auditContext.error_message = details.message;
      await admin.from("ai_expense_journal_audit").insert({ ...auditContext, model: MODEL, prompt_version: PROMPT_VERSION });
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
      await admin.from("ai_expense_journal_audit").insert({ ...auditContext, model: MODEL, prompt_version: PROMPT_VERSION });
      return json(cors, { error: auditContext.error_message }, 422, runId);
    }
    if (confidence < MIN_CONFIDENCE) {
      auditContext.outcome = "blocked";
      auditContext.error_message = `AI confidence ${Math.round(confidence * 100)}% is below the ${Math.round(MIN_CONFIDENCE * 100)}% automatic-posting threshold`;
      await admin.from("ai_expense_journal_audit").insert({ ...auditContext, model: MODEL, prompt_version: PROMPT_VERSION });
      return json(cors, { error: auditContext.error_message, suggestion: { ...suggestion, account_code: selected.account_code, account_name: selected.account_name } }, 422, runId);
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

    const { data: transactionId, error: postError } = await auth.userClient.rpc("apply_ai_expense_account_and_post", {
      p_expense_id: expense.id,
      p_account_id: selected.id,
    });
    if (postError) throw postError;

    auditContext.outcome = "posted";
    auditContext.ledger_transaction_id = transactionId;
    await admin.from("ai_expense_journal_audit").insert({ ...auditContext, model: MODEL, prompt_version: PROMPT_VERSION });
    return json(cors, {
      posted: true,
      ledger_transaction_id: transactionId,
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
    const message = error instanceof AiOutputError
      ? "AI could not produce a valid account classification"
      : error instanceof Error ? error.message : "AI journal posting failed";
    if (admin && auditContext) {
      await admin.from("ai_expense_journal_audit").insert({ ...auditContext, outcome: "failed", error_message: message, model: MODEL, prompt_version: PROMPT_VERSION });
    }
    return json(cors, { error: message }, 500, runId);
  }
});
