import { useMemo, useState } from "react";
import { format as formatDate, startOfMonth, subMonths } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download, Gavel, RotateCcw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useViolationTypes, type FineStatus } from "@/hooks/useEmployeeFines";
import { useFinesHistory, type FineHistoryFilters } from "@/hooks/useFinesHistory";
import type { FineHistoryRow } from "@/hooks/useFinesHistory";
import { FineDetailDrawer } from "@/components/staff/fines/FineDetailDrawer";
import { LockedFeatureScreen } from "@/components/LockedFeatureScreen";

const STATUSES: (FineStatus | "all")[] = [
  "all",
  "draft",
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "applied",
  "cancelled",
];

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  submitted: "secondary",
  under_review: "secondary",
  approved: "default",
  applied: "default",
  rejected: "destructive",
  cancelled: "destructive",
};

const ALL = "__all__";

function ts(value?: string | null) {
  return value ? formatDate(new Date(value), "dd MMM yyyy HH:mm") : "—";
}

export default function FinesHistory() {
  const { restaurant, hasFeature, loading } = useAuth();
  const { branches } = useBranch();
  const { format: money } = useCurrency();
  const { violationTypes } = useViolationTypes();

  const defaultFilters: FineHistoryFilters = {
    status: "all",
    from: formatDate(startOfMonth(subMonths(new Date(), 5)), "yyyy-MM-dd"),
    to: formatDate(new Date(), "yyyy-MM-dd"),
  };
  const [filters, setFilters] = useState<FineHistoryFilters>(defaultFilters);
  const patch = (p: Partial<FineHistoryFilters>) => setFilters((f) => ({ ...f, ...p }));
  const [selected, setSelected] = useState<FineHistoryRow | null>(null);

  const { data: staff = [] } = useQuery({
    queryKey: ["fines-history-staff", restaurant?.id],
    queryFn: async () => {
      const { data, error } = await db
        .from("staff")
        .select("id, name, role, branch_id")
        .eq("restaurant_id", restaurant!.id)
        .order("name");
      if (error) throw error;
      return data as { id: string; name: string; role: string; branch_id: string | null }[];
    },
    enabled: !!restaurant?.id,
  });

  const departments = useMemo(
    () => Array.from(new Set(staff.map((s) => s.role).filter(Boolean))).sort(),
    [staff]
  );

  const { data: rows = [], isLoading } = useFinesHistory(filters);

  const totals = useMemo(() => {
    const applied = rows.filter((r) => r.status === "applied");
    return {
      count: rows.length,
      amount: rows.reduce((s, r) => s + Number(r.amount || 0), 0),
      appliedAmount: applied.reduce((s, r) => s + Number(r.amount || 0), 0),
      pending: rows.filter((r) => ["draft", "submitted", "under_review"].includes(r.status)).length,
    };
  }, [rows]);

  const branchName = (id: string | null) =>
    branches.find((b) => b.id === id)?.name ?? "Unassigned";

  const exportCsv = () => {
    const head = [
      "Fine #","Employee","Department","Branch","Violation date","Payroll month","Violation type",
      "Amount","Original amount","Status","Created by","Created at","Submitted at","Reviewed by",
      "Reviewed at","Approved by","Approved at","Applied at","Reason",
    ];
    const body = rows.map((r) => [
      r.fine_number ?? "", r.staff?.name ?? "", r.staff?.role ?? "", branchName(r.branch_id),
      r.violation_date, r.payroll_month, r.violation_type?.name_en ?? "",
      r.amount, r.original_amount ?? "", r.status, r.createdByName ?? "", ts(r.created_at),
      ts(r.submitted_at), r.reviewedByName ?? "", ts(r.reviewed_at), r.approvedByName ?? "",
      ts(r.approved_at), ts(r.applied_at),
      r.rejection_reason || r.cancellation_reason || r.description || "",
    ]);
    const csv = [head, ...body]
      .map((line) => line.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `fines-history-${formatDate(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!loading && !hasFeature("payroll")) {
    return (
      <LockedFeatureScreen
        featureName="Fines & Deductions History"
        description="Review every employee fine with full audit provenance."
        featureKey="payroll"
      />
    );
  }

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <header className="fade-slide-in mb-6 flex flex-wrap items-end justify-between gap-3 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Gavel className="h-5 w-5 text-primary" /> Fines &amp; Deductions History
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Complete register of employee fines with approval and payroll audit trail.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setFilters(defaultFilters)}>
            <RotateCcw className="h-4 w-4 mr-1.5" /> Reset
          </Button>
          <Button size="sm" onClick={exportCsv} disabled={!rows.length}>
            <Download className="h-4 w-4 mr-1.5" /> Export CSV
          </Button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-4">
        {[
          { label: "Fines in range", value: String(totals.count) },
          { label: "Total value", value: money(totals.amount) },
          { label: "Applied to payroll", value: money(totals.appliedAmount) },
          { label: "Awaiting approval", value: String(totals.pending) },
        ].map((k) => (
          <Card key={k.label} className="border-border/40">
            <CardContent className="pt-6">
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p className="text-lg font-semibold mt-1">{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-border/40 mb-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-1.5">
            <Label className="text-xs">Employee</Label>
            <Select
              value={filters.staffId ?? ALL}
              onValueChange={(v) => patch({ staffId: v === ALL ? undefined : v })}
            >
              <SelectTrigger><SelectValue placeholder="All employees" /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={ALL}>All employees</SelectItem>
                {staff.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">Branch</Label>
            <Select
              value={filters.branchId ?? ALL}
              onValueChange={(v) => patch({ branchId: v === ALL ? undefined : v })}
            >
              <SelectTrigger><SelectValue placeholder="All branches" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All branches</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">Department / role</Label>
            <Select
              value={filters.department ?? ALL}
              onValueChange={(v) => patch({ department: v === ALL ? undefined : v })}
            >
              <SelectTrigger><SelectValue placeholder="All departments" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All departments</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">Violation type</Label>
            <Select
              value={filters.violationTypeId ?? ALL}
              onValueChange={(v) => patch({ violationTypeId: v === ALL ? undefined : v })}
            >
              <SelectTrigger><SelectValue placeholder="All types" /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={ALL}>All types</SelectItem>
                {violationTypes.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.name_en}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">Status</Label>
            <Select
              value={filters.status ?? "all"}
              onValueChange={(v) => patch({ status: v as FineStatus | "all" })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s === "all" ? "All statuses" : s.replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">Violation date from</Label>
            <Input
              type="date"
              value={filters.from ?? ""}
              onChange={(e) => patch({ from: e.target.value || undefined })}
            />
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">Violation date to</Label>
            <Input
              type="date"
              value={filters.to ?? ""}
              onChange={(e) => patch({ to: e.target.value || undefined })}
            />
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">Payroll month</Label>
            <Input
              type="month"
              value={filters.payrollMonth ? filters.payrollMonth.slice(0, 7) : ""}
              onChange={(e) =>
                patch({ payrollMonth: e.target.value ? `${e.target.value}-01` : undefined })
              }
            />
          </div>

          <div className="grid gap-1.5 sm:col-span-2 lg:col-span-4">
            <Label className="text-xs">Search (fine #, employee, description)</Label>
            <Input
              value={filters.search ?? ""}
              onChange={(e) => patch({ search: e.target.value || undefined })}
              placeholder="Search…"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">
            History &amp; audit trail {isLoading ? "" : `(${rows.length})`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="w-full">
            <div className="min-w-[1400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fine #</TableHead>
                    <TableHead>Employee</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Violation</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Payroll month</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Original</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created by</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead>Reviewed by</TableHead>
                    <TableHead>Approved by</TableHead>
                    <TableHead>Applied</TableHead>
                    <TableHead>Reason / note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={16} className="text-center text-sm text-muted-foreground py-10">
                        Loading history…
                      </TableCell>
                    </TableRow>
                  ) : rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={16} className="text-center text-sm text-muted-foreground py-10">
                        No fines match these filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((r) => (
                      <TableRow
                        key={r.id}
                        onClick={() => setSelected(r)}
                        className="cursor-pointer"
                      >
                        <TableCell className="font-mono text-xs">{r.fine_number ?? "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.staff?.name ?? "—"}</TableCell>
                        <TableCell className="capitalize text-xs">{r.staff?.role ?? "—"}</TableCell>
                        <TableCell className="text-xs">{branchName(r.branch_id)}</TableCell>
                        <TableCell className="text-xs">{r.violation_type?.name_en ?? "—"}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {formatDate(new Date(r.violation_date), "dd MMM yyyy")}
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {formatDate(new Date(r.payroll_month), "MMM yyyy")}
                        </TableCell>
                        <TableCell className="text-right font-medium">{money(Number(r.amount))}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {r.original_amount != null && Number(r.original_amount) !== Number(r.amount)
                            ? money(Number(r.original_amount))
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[r.status] ?? "outline"} className="capitalize">
                            {r.status.replace("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.createdByName ?? "—"}
                          <div className="text-muted-foreground">{ts(r.created_at)}</div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{ts(r.submitted_at)}</TableCell>
                        <TableCell className="text-xs">
                          {r.reviewedByName ?? "—"}
                          <div className="text-muted-foreground">{ts(r.reviewed_at)}</div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.approvedByName ?? "—"}
                          <div className="text-muted-foreground">{ts(r.approved_at)}</div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{ts(r.applied_at)}</TableCell>
                        <TableCell className="text-xs max-w-[240px] truncate">
                          {r.rejection_reason || r.cancellation_reason || r.description || "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <FineDetailDrawer
        fine={selected}
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        branchName={branchName}
        requiresEvidence={
          !!violationTypes.find((t) => t.id === selected?.violation_type?.id)?.requires_evidence
        }
      />
    </div>
  );
}
