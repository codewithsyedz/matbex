import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import type { CapitalMovement } from "@/hooks/useOwnerCapital";

/** Untyped client: this table is newer than the generated types. */
export type MatchStatus = "unmatched" | "matched" | "ignored";

export interface CapitalStatementLine {
  id: string;
  tenant_id: string;
  capital_account_id: string;
  branch_id: string | null;
  statement_date: string;
  description: string | null;
  reference: string | null;
  amount: number;
  /** credit = money into the bank account, debit = money out. */
  direction: "credit" | "debit";
  match_status: MatchStatus;
  matched_movement_id: string | null;
  matched_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface StatementLineInput {
  capitalAccountId: string;
  branchId?: string | null;
  statementDate: string;
  description?: string | null;
  reference?: string | null;
  amount: number;
  direction: "credit" | "debit";
}

interface Args {
  capitalAccountId?: string | null;
  from?: string;
  to?: string;
}

/** A statement line paired with its best candidate movements. */
export interface SuggestedMatch {
  movement: CapitalMovement;
  /** 0-100 confidence. */
  score: number;
  reasons: string[];
}

const DAY = 86_400_000;

export function scoreCandidate(
  line: CapitalStatementLine,
  movement: CapitalMovement,
): SuggestedMatch | null {
  // Direction must agree: money in = injection, money out = withdrawal.
  const expected = line.direction === "credit" ? "injection" : "withdrawal";
  if (movement.movement_type !== expected) return null;
  if (movement.is_reversed) return null;
  if (movement.capital_account_id !== line.capital_account_id) return null;

  const reasons: string[] = [];
  const diff = Math.abs(Number(movement.amount || 0) - Number(line.amount || 0));
  if (diff > 0.5) return null;
  reasons.push(diff < 0.005 ? "Exact amount" : "Amount within ﷼0.50");

  const days = Math.abs(
    (new Date(line.statement_date).getTime() - new Date(movement.movement_date).getTime()) / DAY,
  );
  if (days > 7) return null;
  reasons.push(days === 0 ? "Same date" : `${Math.round(days)} day(s) apart`);

  const ref = (line.reference ?? "").trim().toLowerCase();
  const mref = (movement.reference_number ?? "").trim().toLowerCase();
  const refMatch = !!ref && !!mref && (ref === mref || ref.includes(mref) || mref.includes(ref));
  if (refMatch) reasons.push("Reference matches");

  let score = 60;
  if (diff < 0.005) score += 15;
  if (days === 0) score += 15;
  else if (days <= 2) score += 8;
  if (refMatch) score += 10;

  return { movement, score: Math.min(100, score), reasons };
}

export function useCapitalStatementMatch({ capitalAccountId, from, to }: Args = {}) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const qc = useQueryClient();
  const accountKey = capitalAccountId && capitalAccountId !== "all" ? capitalAccountId : null;

  const linesQuery = useQuery({
    queryKey: ["capital-statement-lines", tenantId, accountKey, from ?? null, to ?? null],
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 2,
    queryFn: async (): Promise<CapitalStatementLine[]> => {
      let q = db
        .from("capital_statement_lines")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("statement_date", { ascending: false });
      if (accountKey) q = q.eq("capital_account_id", accountKey);
      if (from) q = q.gte("statement_date", from);
      if (to) q = q.lte("statement_date", to);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CapitalStatementLine[];
    },
  });

  const lines = linesQuery.data ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["capital-statement-lines"] });
  };

  const addLines = useMutation({
    mutationFn: async (rows: StatementLineInput[]) => {
      const payload = rows.map((r) => ({
        tenant_id: tenantId,
        capital_account_id: r.capitalAccountId,
        branch_id: r.branchId ?? null,
        statement_date: r.statementDate,
        description: r.description ?? null,
        reference: r.reference ?? null,
        amount: r.amount,
        direction: r.direction,
        imported_by: profile?.id ?? null,
      }));
      const { error } = await db.from("capital_statement_lines").insert(payload);
      if (error) throw error;
      return payload.length;
    },
    onSuccess: invalidate,
  });

  const linkLine = useMutation({
    mutationFn: async (input: { lineId: string; movementId: string }) => {
      const { error } = await db
        .from("capital_statement_lines")
        .update({
          matched_movement_id: input.movementId,
          match_status: "matched",
          matched_by: profile?.id ?? null,
          matched_at: new Date().toISOString(),
        })
        .eq("id", input.lineId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const unlinkLine = useMutation({
    mutationFn: async (lineId: string) => {
      const { error } = await db
        .from("capital_statement_lines")
        .update({
          matched_movement_id: null,
          match_status: "unmatched",
          matched_by: null,
          matched_at: null,
        })
        .eq("id", lineId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const setIgnored = useMutation({
    mutationFn: async (input: { lineId: string; ignored: boolean; notes?: string | null }) => {
      const { error } = await db
        .from("capital_statement_lines")
        .update({
          match_status: input.ignored ? "ignored" : "unmatched",
          matched_movement_id: null,
          notes: input.notes ?? null,
        })
        .eq("id", input.lineId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const deleteLine = useMutation({
    mutationFn: async (lineId: string) => {
      const { error } = await db.from("capital_statement_lines").delete().eq("id", lineId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return {
    lines,
    isLoading: linesQuery.isLoading,
    error: linesQuery.error,
    addLines,
    linkLine,
    unlinkLine,
    setIgnored,
    deleteLine,
  };
}

/** Builds the reconciliation view: lines with suggestions + unmatched movements. */
export function useReconciliation(lines: CapitalStatementLine[], movements: CapitalMovement[]) {
  return useMemo(() => {
    const takenMovementIds = new Set(
      lines.filter((l) => l.matched_movement_id).map((l) => l.matched_movement_id as string),
    );

    const withSuggestions = lines.map((line) => {
      if (line.match_status !== "unmatched") return { line, suggestions: [] as SuggestedMatch[] };
      const suggestions = movements
        .filter((m) => !takenMovementIds.has(m.id))
        .map((m) => scoreCandidate(line, m))
        .filter((s): s is SuggestedMatch => !!s)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      return { line, suggestions };
    });

    const unmatchedMovements = movements.filter(
      (m) => !takenMovementIds.has(m.id) && !m.is_reversed,
    );

    const matchedLines = lines.filter((l) => l.match_status === "matched");
    const totals = {
      lines: lines.length,
      matched: matchedLines.length,
      unmatched: lines.filter((l) => l.match_status === "unmatched").length,
      ignored: lines.filter((l) => l.match_status === "ignored").length,
      statementIn: lines
        .filter((l) => l.direction === "credit" && l.match_status !== "ignored")
        .reduce((s, l) => s + Number(l.amount || 0), 0),
      statementOut: lines
        .filter((l) => l.direction === "debit" && l.match_status !== "ignored")
        .reduce((s, l) => s + Number(l.amount || 0), 0),
      unmatchedMovementCount: unmatchedMovements.length,
      unmatchedMovementValue: unmatchedMovements.reduce((s, m) => s + Number(m.amount || 0), 0),
    };

    return { withSuggestions, unmatchedMovements, totals };
  }, [lines, movements]);
}
