import { useMemo, useState } from "react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronsUpDown, Download, History, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { LockedFeatureScreen } from "@/components/LockedFeatureScreen";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type AuditRow = {
  id: string;
  supplier_id: string | null;
  supplier_name: string | null;
  account_code: string | null;
  account_name: string | null;
  action: string;
  changed_fields: Record<string, { from?: unknown; to?: unknown }> | null;
  performed_by: string | null;
  created_at: string;
};

const ACTION_LABEL: Record<string, string> = {
  created: "Head created",
  relinked: "Head re-linked",
  unlinked: "Head unlinked",
  modified: "Head edited",
  activated: "Head activated",
  deactivated: "Head deactivated",
};

const ACTION_TONE: Record<string, string> = {
  created: "border-emerald-500/40 text-emerald-600",
  activated: "border-emerald-500/40 text-emerald-600",
  relinked: "border-amber-500/40 text-amber-600",
  modified: "border-amber-500/40 text-amber-600",
  unlinked: "border-destructive/40 text-destructive",
  deactivated: "border-destructive/40 text-destructive",
};

const FIELD_LABEL: Record<string, string> = {
  ap_account_id: "Linked head",
  account_code: "Account code",
  account_name: "Account name",
  is_active: "Active",
  account_type: "Account type",
  parent_account_id: "Parent account",
};

const val = (v: unknown) =>
  v === null || v === undefined || v === "" ? "—" : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);

type SortKey = "created_at" | "supplier_name" | "action" | "account_code" | "performed_by";
type SortDir = "asc" | "desc";

export default function SupplierApHeadAudit() {
  const { tenant, hasFeature, loading } = useAuth();

  const [search, setSearch] = useState("");
  const [action, setAction] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data: rows = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ["supplier-ap-head-audit-page", tenant?.id],
    enabled: !!tenant?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await db
        .from("supplier_ap_account_audit")
        .select(
          "id, supplier_id, supplier_name, account_code, account_name, action, changed_fields, performed_by, created_at",
        )
        .eq("tenant_id", tenant!.id)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as unknown as AuditRow[];
    },
  });

  const actorIds = useMemo(
    () => Array.from(new Set(rows.map((r) => r.performed_by).filter(Boolean))) as string[],
    [rows],
  );

  const { data: actors = {} } = useQuery({
    queryKey: ["supplier-ap-audit-page-actors", actorIds.slice().sort().join(",")],
    enabled: actorIds.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await db.from("profiles").select("id, full_name").in("id", actorIds);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((p) => [p.id, p.full_name ?? "—"])) as Record<string, string>;
    },
  });

  const actorName = (id: string | null) => (id ? actors[id] ?? "User" : "System");

  const actionOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.action))).sort(),
    [rows],
  );

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (action !== "all" && r.action !== action) return false;
      if (!q) return true;
      return [r.supplier_name, r.account_code, r.account_name, actorName(r.performed_by)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
    const dir = sortDir === "asc" ? 1 : -1;
    return filtered.sort((a, b) => {
      const pick = (r: AuditRow) =>
        sortKey === "performed_by" ? actorName(r.performed_by) : (r[sortKey] ?? "");
      const av = String(pick(a));
      const bv = String(pick(b));
      return av.localeCompare(bv, undefined, { numeric: true }) * dir;
    });
  }, [rows, search, action, sortKey, sortDir, actors]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "created_at" ? "desc" : "asc");
    }
  };

  const SortHead = ({ label, keyName, className }: { label: string; keyName: SortKey; className?: string }) => (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => toggleSort(keyName)}
        className="inline-flex items-center gap-1 text-left hover:text-foreground"
      >
        {label}
        {sortKey === keyName ? (
          sortDir === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </TableHead>
  );

  const handleExportCsv = () => {
    const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      ["When", "Action", "Supplier", "AP Head Code", "AP Head Name", "Performed by", "Changes"].join(","),
    ];
    for (const r of visibleRows) {
      const diff = Object.entries(r.changed_fields ?? {})
        .map(([k, v]) => `${FIELD_LABEL[k] ?? k}: ${val(v?.from)} -> ${val(v?.to)}`)
        .join(" | ");
      lines.push(
        [
          esc(format(new Date(r.created_at), "yyyy-MM-dd HH:mm")),
          esc(ACTION_LABEL[r.action] ?? r.action),
          esc(r.supplier_name ?? "—"),
          esc(r.account_code ?? "—"),
          esc(r.account_name ?? "—"),
          esc(actorName(r.performed_by)),
          esc(diff),
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `supplier-ap-head-audit-${format(new Date(), "yyyyMMdd")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("Audit log exported");
  };

  if (!loading && !hasFeature("accounting")) {
    return (
      <LockedFeatureScreen
        featureName="Supplier AP Head Audit Log"
        description="Track every creation, re-link and edit of supplier payable accounts in the Chart of Accounts."
        featureKey="accounting"
      />
    );
  }

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <History className="h-7 w-7 text-primary" />
            Supplier AP Head Audit Log
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every creation, re-link, rename, re-code and activation change on supplier payable accounts,
            with the exact before/after values and who made them.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={visibleRows.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Change events</CardTitle>
          <CardDescription>
            {visibleRows.length} of {rows.length} event{rows.length === 1 ? "" : "s"}
          </CardDescription>
          <div className="flex flex-col gap-2 pt-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search supplier, account or user…"
                className="pl-8"
              />
            </div>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger className="sm:w-56">
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                {actionOptions.map((a) => (
                  <SelectItem key={a} value={a}>
                    {ACTION_LABEL[a] ?? a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : visibleRows.length === 0 ? (
            <p className="py-8 text-sm font-light text-muted-foreground">
              No payable head changes match the current filters.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortHead label="When" keyName="created_at" className="whitespace-nowrap" />
                    <SortHead label="Action" keyName="action" />
                    <SortHead label="Supplier" keyName="supplier_name" />
                    <SortHead label="AP head" keyName="account_code" />
                    <SortHead label="Performed by" keyName="performed_by" />
                    <TableHead>Changes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((r) => {
                    const entries = Object.entries(r.changed_fields ?? {});
                    return (
                      <TableRow key={r.id} className="align-top">
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {format(new Date(r.created_at), "yyyy-MM-dd HH:mm")}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={ACTION_TONE[r.action] ?? ""}>
                            {ACTION_LABEL[r.action] ?? r.action}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          {r.supplier_name ?? "Unknown supplier"}
                        </TableCell>
                        <TableCell className="text-sm font-light">
                          {r.account_code ? (
                            <>
                              <span className="font-mono">{r.account_code}</span>
                              <div className="text-xs text-muted-foreground">{r.account_name ?? "—"}</div>
                            </>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-sm font-light">{actorName(r.performed_by)}</TableCell>
                        <TableCell>
                          {entries.length === 0 ? (
                            <span className="text-xs text-muted-foreground">No field changes</span>
                          ) : (
                            <ul className="space-y-1">
                              {entries.map(([key, value]) => (
                                <li key={key} className="text-xs">
                                  <span className="text-muted-foreground">{FIELD_LABEL[key] ?? key}: </span>
                                  <span className="font-mono line-through opacity-60">{val(value?.from)}</span>
                                  <span className="mx-1">→</span>
                                  <span className="font-mono">{val(value?.to)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
