import { useQuery, useQueries } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";

export type PreviewLineKind = "original" | "correction" | "adjustment" | "planned";

export interface PreviewLine {
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
  description?: string | null;
  transaction_date?: string | null;
  batch_reference?: string | null;
  reference_type?: string | null;
  line_kind?: PreviewLineKind;
}

export interface PreviewWarning {
  level: "info" | "warning" | "error";
  message: string;
}

export interface ApSettlementPreview {
  ok: boolean;
  reason_code?: string;
  message?: string;
  expense_id?: string;
  amount: number;
  open_payable?: number;
  payment_method?: string | null;
  funding_source?: string | null;
  existing_lines: PreviewLine[];
  planned_lines: PreviewLine[];
  warnings: PreviewWarning[];
}

function normalize(raw: any): ApSettlementPreview {
  return {
    ok: Boolean(raw?.ok),
    reason_code: raw?.reason_code,
    message: raw?.message,
    expense_id: raw?.expense_id,
    amount: Number(raw?.amount ?? 0),
    open_payable: Number(raw?.open_payable ?? 0),
    payment_method: raw?.payment_method ?? null,
    funding_source: raw?.funding_source ?? null,
    existing_lines: (raw?.existing_lines ?? []).map((l: any) => ({
      ...l,
      debit: Number(l.debit ?? 0),
      credit: Number(l.credit ?? 0),
      line_kind: (l.line_kind ?? "original") as PreviewLineKind,
    })),
    planned_lines: (raw?.planned_lines ?? []).map((l: any) => ({
      ...l,
      debit: Number(l.debit ?? 0),
      credit: Number(l.credit ?? 0),
      line_kind: "planned" as PreviewLineKind,
    })),
    warnings: raw?.warnings ?? [],
  };
}

async function fetchPreview(expenseId: string): Promise<ApSettlementPreview> {
  const { data, error } = await (db as any).rpc("preview_ap_settlement", {
    p_expense_id: expenseId,
  });
  if (error) throw error;
  return normalize(data);
}

/** Read-only before/after posting preview for a single AP settlement. */
export function useApSettlementPreview(expenseId?: string | null, enabled = true) {
  return useQuery({
    queryKey: ["ap-settlement-preview", expenseId],
    queryFn: () => fetchPreview(expenseId as string),
    enabled: Boolean(expenseId) && enabled,
    staleTime: 30_000,
  });
}

/** Previews for a batch of expenses about to be marked paid together. */
export function useApSettlementPreviews(expenseIds: string[], enabled = true) {
  return useQueries({
    queries: expenseIds.map((id) => ({
      queryKey: ["ap-settlement-preview", id],
      queryFn: () => fetchPreview(id),
      enabled,
      staleTime: 30_000,
    })),
  });
}
