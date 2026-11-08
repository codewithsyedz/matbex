import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BranchBadge } from "@/components/branch/BranchBadge";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  CheckCircle2,
  FileClock,
  Receipt,
  ShieldAlert,
  SkipForward,
  Wallet,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

type Props = {
  expenseId: string | null;
  expenseDescription?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type Leg = {
  id: string;
  account_id: string;
  transaction_date: string;
  debit: number | null;
  credit: number | null;
  description: string | null;
  branch_id: string | null;
  batch_id: string | null;
  is_voided: boolean | null;
  void_reason: string | null;
  created_at: string;
};

type Attempt = {
  id: string;
  action: string;
  outcome: string;
  reason_code: string;
  reason_detail: string | null;
  batch_id: string | null;
  transaction_ids: string[] | null;
  dr_total: number | null;
  cr_total: number | null;
  trigger_source: string;
  branch_id: string | null;
  created_at: string;
};

const OUTCOME_META: Record<
  string,
  { label: string; icon: typeof CheckCircle2; tone: string; badge: "default" | "secondary" | "outline" | "destructive" }
> = {
  success: { label: "Succeeded", icon: CheckCircle2, tone: "text-emerald-600", badge: "secondary" },
  failed: { label: "Failed", icon: AlertTriangle, tone: "text-destructive", badge: "destructive" },
  blocked: { label: "Blocked", icon: ShieldAlert, tone: "text-amber-600", badge: "outline" },
  needs_manual_review: { label: "Needs review", icon: ShieldAlert, tone: "text-amber-600", badge: "outline" },
};

const ACTION_LABEL: Record<string, string> = {
  post: "Posting attempt",
  reconcile: "Settlement attempt",
  skip: "Posting skipped",
  void: "Void / reversal",
};

const SOURCE_LABEL: Record<string, string> = {
  manual: "Manual",
  bulk: "Bulk run",
  auto_trigger: "Automatic",
  reconcile_job: "Reconcile job",
};

const money = (n: number) => `${n.toFixed(2)} SAR`;

function eventKind(reference: string | null, entryType: string | null) {
  const ref = reference ?? "";
  if (ref.startsWith("EXPPAYREV-")) return { label: "Payment reversed", icon: ArrowUpRight, tone: "text-amber-600" };
  if (ref.startsWith("EXPPAY-")) return { label: "Payment / settlement", icon: Wallet, tone: "text-emerald-600" };
  if (ref.startsWith("EXP-")) return { label: "Original posting", icon: Receipt, tone: "text-muted-foreground" };
  return { label: entryType ? `${entryType} entry` : "Ledger entry", icon: ArrowDownLeft, tone: "text-muted-foreground" };
}

export function ExpenseSettlementTimeline({ expenseId, expenseDescription, open, onOpenChange }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["expense-settlement-timeline", expenseId],
    enabled: !!expenseId && open,
    queryFn: async () => {
      const { data: legs, error } = await supabase
        .from("account_transactions")
        .select(
          "id, account_id, transaction_date, debit, credit, description, branch_id, batch_id, is_voided, void_reason, created_at"
        )
        .eq("reference_type", "expense")
        .eq("reference_id", expenseId!)
        .order("transaction_date", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;

      const rows = (legs || []) as Leg[];

      const { data: auditRows, error: auditError } = await supabase
        .from("expense_posting_audit")
        .select(
          "id, action, outcome, reason_code, reason_detail, batch_id, transaction_ids, dr_total, cr_total, trigger_source, branch_id, created_at"
        )
        .eq("expense_id", expenseId!)
        .order("created_at", { ascending: true });
      if (auditError) throw auditError;
      const attempts = (auditRows || []) as Attempt[];

      const accountIds = Array.from(new Set(rows.map((r) => r.account_id).filter(Boolean)));
      const batchIds = Array.from(
        new Set([
          ...(rows.map((r) => r.batch_id).filter(Boolean) as string[]),
          ...(attempts.map((a) => a.batch_id).filter(Boolean) as string[]),
        ])
      );

      const [accountsRes, batchesRes, branchesRes] = await Promise.all([
        accountIds.length
          ? supabase.from("chart_of_accounts").select("id, account_code, account_name").in("id", accountIds)
          : Promise.resolve({ data: [], error: null } as any),
        batchIds.length
          ? supabase
              .from("journal_entry_batches")
              .select("id, reference_number, entry_type, batch_date, description")
              .in("id", batchIds)
          : Promise.resolve({ data: [], error: null } as any),
        supabase.from("branches").select("id, name"),
      ]);

      const accounts: Record<string, { code: string; name: string }> = {};
      (accountsRes.data || []).forEach((a: any) => {
        accounts[a.id] = { code: a.account_code, name: a.account_name };
      });
      const batches: Record<string, any> = {};
      (batchesRes.data || []).forEach((b: any) => (batches[b.id] = b));
      const branches: Record<string, string> = {};
      (branchesRes.data || []).forEach((b: any) => (branches[b.id] = b.name));

      return { rows, attempts, accounts, batches, branches };
    },
  });

  const groups = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, Leg[]>();
    data.rows.forEach((r) => {
      const key = r.batch_id ?? `no-batch-${r.id}`;
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    });
    return Array.from(map.entries()).map(([key, legs]) => {
      const batch = data.batches[key];
      const active = legs.filter((l) => !l.is_voided);
      return {
        key,
        batch,
        legs,
        date: legs[0]?.transaction_date ?? batch?.batch_date ?? "",
        debit: active.reduce((s, l) => s + (Number(l.debit) || 0), 0),
        credit: active.reduce((s, l) => s + (Number(l.credit) || 0), 0),
        allVoided: legs.length > 0 && legs.every((l) => l.is_voided),
      };
    });
  }, [data]);

  const events = useMemo(() => {
    const ledgerEvents = groups.map((g) => ({
      kind: "ledger" as const,
      key: `ledger-${g.key}`,
      at: g.legs[0]?.created_at ?? g.date,
      group: g,
    }));
    const attemptEvents = (data?.attempts ?? []).map((a) => ({
      kind: "attempt" as const,
      key: `attempt-${a.id}`,
      at: a.created_at,
      attempt: a,
    }));
    return [...ledgerEvents, ...attemptEvents].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  }, [groups, data]);

  const attemptStats = useMemo(() => {
    const list = data?.attempts ?? [];
    return {
      total: list.length,
      failed: list.filter((a) => a.outcome !== "success").length,
    };
  }, [data]);

  // Running payable balance: credits minus debits on 2000-series accounts.
  const payableOutstanding = useMemo(() => {
    if (!data) return 0;
    return data.rows
      .filter((r) => !r.is_voided && data.accounts[r.account_id]?.code?.startsWith("2000"))
      .reduce((s, r) => s + (Number(r.credit) || 0) - (Number(r.debit) || 0), 0);
  }, [data]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Payment & settlement timeline</DialogTitle>
          <DialogDescription className="truncate">
            {expenseDescription || "Every debit and credit recorded against this expense."}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : events.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            This expense has not been posted to the ledger yet.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Button asChild size="sm" variant="outline" className="ml-auto order-last gap-1.5">
                <Link to={`/reports/ap-audit-trail?expenseId=${expenseId}`}>
                  <FileClock className="h-3.5 w-3.5" /> Full audit trail
                </Link>
              </Button>
              <span className="text-muted-foreground">Outstanding payable:</span>
              <Badge variant={payableOutstanding > 0.005 ? "outline" : "secondary"} className="font-mono">
                {money(Math.max(payableOutstanding, 0))}
              </Badge>
              <span className="text-muted-foreground">
                {payableOutstanding > 0.005 ? "· still owed to supplier" : "· fully settled"}
              </span>
              {attemptStats.total > 0 && (
                <span className="text-muted-foreground">
                  · {attemptStats.total} attempt{attemptStats.total === 1 ? "" : "s"}
                  {attemptStats.failed > 0 ? ` (${attemptStats.failed} unsuccessful)` : ""}
                </span>
              )}
            </div>

            <ScrollArea className="max-h-[60vh] pr-3">
              <ol className="relative space-y-4 border-l pl-6">
                {events.map((ev) => {
                  if (ev.kind === "attempt") {
                    const a = ev.attempt;
                    const meta = OUTCOME_META[a.outcome] ?? OUTCOME_META.failed;
                    const AIcon = a.action === "skip" ? SkipForward : meta.icon;
                    const ref = a.batch_id ? data?.batches[a.batch_id]?.reference_number : null;
                    return (
                      <li key={ev.key} className="relative">
                        <span className="absolute -left-[31px] flex h-6 w-6 items-center justify-center rounded-full border bg-background">
                          <AIcon className={`h-3.5 w-3.5 ${meta.tone}`} />
                        </span>
                        <div className="rounded-lg border border-dashed p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="flex items-center gap-2 text-sm font-medium">
                                {ACTION_LABEL[a.action] ?? a.action}
                                <Badge variant={meta.badge} className="text-[10px]">
                                  {meta.label}
                                </Badge>
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {new Date(a.created_at).toLocaleString()} ·{" "}
                                {SOURCE_LABEL[a.trigger_source] ?? a.trigger_source}
                                {a.reason_code ? ` · ${a.reason_code}` : ""}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {a.branch_id && (
                                <BranchBadge
                                  branchId={a.branch_id}
                                  name={data?.branches[a.branch_id] ?? null}
                                  size="sm"
                                />
                              )}
                              {Number(a.dr_total ?? 0) > 0 && (
                                <span className="font-mono text-sm">{money(Number(a.dr_total))}</span>
                              )}
                            </div>
                          </div>

                          {(ref || a.transaction_ids?.length) && (
                            <p className="mt-2 text-xs">
                              <span className="text-muted-foreground">GL entry: </span>
                              <span className="font-mono">{ref ?? a.batch_id?.slice(0, 8) ?? "—"}</span>
                              {a.transaction_ids?.length ? (
                                <span className="text-muted-foreground">
                                  {" "}
                                  · {a.transaction_ids.length} line
                                  {a.transaction_ids.length === 1 ? "" : "s"}
                                </span>
                              ) : null}
                            </p>
                          )}

                          {a.reason_detail && (
                            <p className="mt-1 text-xs text-muted-foreground">{a.reason_detail}</p>
                          )}
                        </div>
                      </li>
                    );
                  }

                  const g = ev.group;
                  const kind = eventKind(g.batch?.reference_number ?? null, g.batch?.entry_type ?? null);
                  const Icon = kind.icon;
                  return (
                    <li key={ev.key} className="relative">
                      <span className="absolute -left-[31px] flex h-6 w-6 items-center justify-center rounded-full border bg-background">
                        <Icon className={`h-3.5 w-3.5 ${kind.tone}`} />
                      </span>
                      <div className="rounded-lg border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="flex items-center gap-2 text-sm font-medium">
                              {kind.label}
                              {g.allVoided && (
                                <Badge variant="outline" className="gap-1 text-muted-foreground">
                                  <Ban className="h-3 w-3" /> Voided
                                </Badge>
                              )}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {g.date}
                              {g.batch?.reference_number ? ` · ${g.batch.reference_number}` : ""}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {g.legs[0]?.branch_id && (
                              <BranchBadge
                                branchId={g.legs[0].branch_id}
                                name={data?.branches[g.legs[0].branch_id!] ?? null}
                                size="sm"
                              />
                            )}
                            <span className="font-mono text-sm">{money(g.debit)}</span>
                          </div>
                        </div>

                        <div className="mt-2 space-y-1">
                          {g.legs.map((l) => {
                            const acc = data?.accounts[l.account_id];
                            return (
                              <div
                                key={l.id}
                                className={`flex items-center justify-between gap-3 text-xs ${
                                  l.is_voided ? "text-muted-foreground line-through" : ""
                                }`}
                              >
                                <span className="min-w-0 truncate">
                                  <span className="font-mono text-muted-foreground">{acc?.code ?? "—"}</span>{" "}
                                  {acc?.name ?? l.account_id.slice(0, 8)}
                                </span>
                                <span className="shrink-0 font-mono">
                                  {Number(l.debit) > 0 ? `DR ${money(Number(l.debit))}` : ""}
                                  {Number(l.credit) > 0 ? `CR ${money(Number(l.credit))}` : ""}
                                </span>
                              </div>
                            );
                          })}
                        </div>

                        {g.legs.some((l) => l.is_voided && l.void_reason) && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            {g.legs.find((l) => l.void_reason)?.void_reason}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </ScrollArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
