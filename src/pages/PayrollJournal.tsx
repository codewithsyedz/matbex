import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { BookOpenCheck, CheckCircle2, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { LockedFeatureScreen } from "@/components/LockedFeatureScreen";

interface JournalRow {
  id: string;
  staff_id: string;
  amount: number;
  advance_recovered: number | null;
  fines_deducted: number | null;
  deductions: number | null;
  bonus: number | null;
  payment_date: string;
  period_start: string;
  period_end: string;
  branch_id: string | null;
  ledger_posted: boolean | null;
  ledger_transaction_id: string | null;
  notes: string | null;
  staff?: { id: string; name: string; role: string; assigned_branch_id: string | null } | null;
}

export default function PayrollJournal() {
  const { restaurant, hasFeature, loading: authLoading } = useAuth();
  const { branches, activeBranchId, pinnedBranchId } = useBranch();
  const { format: fmt } = useCurrency();
  const queryClient = useQueryClient();

  const [branchId, setBranchId] = useState<string>(pinnedBranchId ?? activeBranchId ?? "all");
  const [status, setStatus] = useState<"all" | "posted" | "unposted">("unposted");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [postingId, setPostingId] = useState<string | null>(null);

  const { data: records = [], isLoading } = useQuery({
    queryKey: ["payroll-journal", restaurant?.id, from, to],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { supabase } = await import("@/integrations/supabase/client");
      let q = supabase
        .from("payroll_records")
        .select(
          "id, staff_id, amount, advance_recovered, fines_deducted, deductions, bonus, payment_date, period_start, period_end, branch_id, ledger_posted, ledger_transaction_id, notes, staff:staff_id(id, name, role, assigned_branch_id)"
        )
        .eq("restaurant_id", restaurant.id);
      if (from) q = q.gte("period_end", from);
      if (to) q = q.lte("period_end", to);
      const { data, error } = await q.order("payment_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as JournalRow[];
    },
    enabled: !!restaurant?.id,
  });

  const rows = useMemo(() => {
    return records.filter((r) => {
      if (status === "posted" && !r.ledger_posted) return false;
      if (status === "unposted" && r.ledger_posted) return false;
      if (branchId && branchId !== "all") {
        const rb = r.branch_id ?? r.staff?.assigned_branch_id ?? null;
        if (rb !== branchId) return false;
      }
      return true;
    });
  }, [records, status, branchId]);

  const netOf = (r: JournalRow) =>
    Math.max(
      0,
      Number(r.amount ?? 0) - Number(r.advance_recovered ?? 0) - Number(r.fines_deducted ?? 0)
    );

  const unposted = rows.filter((r) => !r.ledger_posted);
  const totalGross = rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const totalNet = rows.reduce((s, r) => s + netOf(r), 0);
  const unpostedTotal = unposted.reduce((s, r) => s + netOf(r), 0);

  const postOne = useMutation({
    mutationFn: async (id: string) => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { error } = await supabase.rpc("post_payroll_to_ledger", { p_payroll_id: id });
      if (error) throw error;
    },
    onMutate: (id: string) => setPostingId(id),
    onSettled: () => setPostingId(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-journal"] });
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
      toast.success("Payroll posted to ledger");
    },
    onError: (error: Error) => toast.error("Posting failed", { description: error.message }),
  });

  const postAll = useMutation({
    mutationFn: async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      let posted = 0;
      const failures: string[] = [];
      for (const r of unposted) {
        const { error } = await supabase.rpc("post_payroll_to_ledger", { p_payroll_id: r.id });
        if (error) failures.push(`${r.staff?.name ?? "Staff"}: ${error.message}`);
        else posted += 1;
      }
      return { posted, failures };
    },
    onSuccess: ({ posted, failures }) => {
      queryClient.invalidateQueries({ queryKey: ["payroll-journal"] });
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
      if (failures.length > 0) {
        toast.warning(`${posted} posted, ${failures.length} failed`, {
          description: failures.slice(0, 3).join(" · "),
        });
      } else {
        toast.success(`${posted} payroll record(s) posted to ledger`);
      }
    },
    onError: (error: Error) => toast.error("Bulk posting failed", { description: error.message }),
  });

  const branchName = (r: JournalRow) => {
    const id = r.branch_id ?? r.staff?.assigned_branch_id ?? null;
    if (!id) return "Unassigned";
    return branches.find((b) => b.id === id)?.name ?? "Unknown";
  };

  if (!authLoading && !hasFeature("payroll")) {
    return (
      <LockedFeatureScreen
        featureName="Payroll Journal"
        description="Review payroll records and post each salary run to the general ledger."
        featureKey="payroll"
      />
    );
  }

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between min-h-[56px]">
        <div className="min-w-[240px] flex-1">
          <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <BookOpenCheck className="h-7 w-7 text-primary" />
            Payroll Journal
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Post each payroll record to the general ledger — DR Wages, CR Cash, with advance and fine
            recoveries handled automatically.
          </p>
        </div>

        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="h-9 w-[180px]">
              <SelectValue placeholder="Branch" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All branches</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger className="h-9 w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unposted">Unposted</SelectItem>
              <SelectItem value="posted">Posted</SelectItem>
              <SelectItem value="all">All records</SelectItem>
            </SelectContent>
          </Select>

          <Button
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => postAll.mutate()}
            disabled={postAll.isPending || unposted.length === 0}
          >
            {postAll.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Post all ({unposted.length})
          </Button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Records in view", value: String(rows.length) },
          { label: "Gross wages", value: fmt(totalGross) },
          { label: "Net payable", value: fmt(totalNet) },
          { label: "Awaiting posting", value: fmt(unpostedTotal) },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="pt-6">
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle className="text-base font-medium">Payroll records</CardTitle>
            <CardDescription>
              Posting is idempotent — an already-posted record cannot be posted twice.
            </CardDescription>
          </div>
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="from" className="text-xs text-muted-foreground">
                Period end from
              </Label>
              <Input
                id="from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-9 w-[150px]"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="to" className="text-xs text-muted-foreground">
                To
              </Label>
              <Input
                id="to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-9 w-[150px]"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No payroll records match these filters.
            </p>
          ) : (
            <ScrollArea className="w-full">
              <div className="min-w-max">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[180px]">Employee</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead>Payment date</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">Advance</TableHead>
                      <TableHead className="text-right">Fines</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                      <TableHead className="text-right">Ledger</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <div className="font-medium">{r.staff?.name ?? "Unknown"}</div>
                          <div className="text-xs capitalize text-muted-foreground">
                            {r.staff?.role ?? "—"}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{branchName(r)}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {format(new Date(r.period_start), "dd MMM")} –{" "}
                          {format(new Date(r.period_end), "dd MMM yyyy")}
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {format(new Date(r.payment_date), "dd MMM yyyy")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmt(Number(r.amount ?? 0))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {fmt(Number(r.advance_recovered ?? 0))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {fmt(Number(r.fines_deducted ?? 0))}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {fmt(netOf(r))}
                        </TableCell>
                        <TableCell className="text-right">
                          {r.ledger_posted ? (
                            <Badge variant="outline" className="gap-1">
                              <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Posted
                            </Badge>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 gap-1.5"
                              onClick={() => postOne.mutate(r.id)}
                              disabled={postOne.isPending}
                            >
                              {postingId === r.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Send className="h-3.5 w-3.5" />
                              )}
                              Post
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
