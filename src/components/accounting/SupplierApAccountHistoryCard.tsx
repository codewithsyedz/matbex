import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfDay, endOfDay } from "date-fns";
import { CalendarIcon, Download, History, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

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

const ACTION_OPTIONS = Object.keys(ACTION_LABEL);

function describeChange(row: AuditRow): string | null {
  const fields = row.changed_fields ?? {};
  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (key === "ap_account_id") continue;
    const from = value?.from === null || value?.from === undefined ? "—" : String(value.from);
    const to = value?.to === null || value?.to === undefined ? "—" : String(value.to);
    const label =
      key === "account_code" ? "Code" : key === "account_name" ? "Name" : key === "is_active" ? "Active" : key;
    parts.push(`${label}: ${from} → ${to}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

function csvCell(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

export function SupplierApAccountHistoryCard({ supplierId }: { supplierId?: string | null }) {
  const { tenant } = useAuth();
  const [showAll, setShowAll] = useState(false);
  const [selectedActions, setSelectedActions] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);

  const hasFilters = selectedActions.length > 0 || dateFrom || dateTo;

  const { data: rows = [], isLoading } = useQuery({
    queryKey: [
      "supplier-ap-account-audit",
      tenant?.id,
      supplierId ?? "all",
      selectedActions.sort().join(","),
      dateFrom?.toISOString(),
      dateTo?.toISOString(),
    ],
    enabled: !!tenant?.id,
    staleTime: 60_000,
    queryFn: async () => {
      let query = db
        .from("supplier_ap_account_audit")
        .select(
          "id, supplier_id, supplier_name, account_code, account_name, action, changed_fields, performed_by, created_at",
        )
        .eq("tenant_id", tenant!.id)
        .order("created_at", { ascending: false })
        .limit(250);
      if (supplierId) query = query.eq("supplier_id", supplierId);
      if (selectedActions.length > 0) query = query.in("action", selectedActions);
      if (dateFrom) query = query.gte("created_at", startOfDay(dateFrom).toISOString());
      if (dateTo) query = query.lte("created_at", endOfDay(dateTo).toISOString());
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as AuditRow[];
    },
  });

  const actorIds = Array.from(new Set(rows.map((r) => r.performed_by).filter(Boolean))) as string[];

  const { data: actors = {} } = useQuery({
    queryKey: ["supplier-ap-audit-actors", actorIds.sort().join(",")],
    enabled: actorIds.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await db
        .from("profiles")
        .select("id, full_name")
        .in("id", actorIds);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((p) => [p.id, p.full_name ?? "—"])) as Record<string, string>;
    },
  });

  const visible = showAll ? rows : rows.slice(0, 10);

  const handleExport = () => {
    if (rows.length === 0) {
      toast.error("Nothing to export yet.");
      return;
    }
    const header = [
      "Date",
      "Action",
      "Supplier",
      "Account code",
      "Account name",
      "Changes",
      "Performed by",
    ];
    const lines = rows.map((row) =>
      [
        new Date(row.created_at).toISOString(),
        ACTION_LABEL[row.action] ?? row.action,
        row.supplier_name ?? "",
        row.account_code ?? "",
        row.account_name ?? "",
        describeChange(row) ?? "",
        row.performed_by ? (actors[row.performed_by] ?? "User") : "System",
      ].map(csvCell).join(","),
    );
    const csv = `\uFEFF${[header.map(csvCell).join(","), ...lines].join("\r\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `payable-head-history-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} history ${rows.length === 1 ? "entry" : "entries"}.`);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            Payable head history
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={handleExport}
            disabled={isLoading || rows.length === 0}
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>
        <p className="text-xs font-light text-muted-foreground">
          Every creation, re-link and edit of supplier payable accounts in the Chart of Accounts.
        </p>
      </CardHeader>
      <CardContent>
        <div className="mb-3 space-y-2.5 rounded-lg border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Action:</span>
            {ACTION_OPTIONS.map((action) => {
              const active = selectedActions.includes(action);
              return (
                <button
                  key={action}
                  type="button"
                  onClick={() =>
                    setSelectedActions((prev) =>
                      active ? prev.filter((a) => a !== action) : [...prev, action],
                    )
                  }
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs transition-colors",
                    active
                      ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15"
                      : "border-border bg-card text-muted-foreground hover:bg-muted",
                  )}
                >
                  {ACTION_LABEL[action]}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Date range:</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-8 justify-start gap-1.5 text-xs font-normal",
                    !dateFrom && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {dateFrom ? format(dateFrom, "yyyy-MM-dd") : "From"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={dateFrom}
                  onSelect={setDateFrom}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-8 justify-start gap-1.5 text-xs font-normal",
                    !dateTo && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {dateTo ? format(dateTo, "yyyy-MM-dd") : "To"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={dateTo}
                  onSelect={setDateTo}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setSelectedActions([]);
                  setDateFrom(undefined);
                  setDateTo(undefined);
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
            )}
          </div>
          {hasFilters && (
            <p className="text-xs font-light text-muted-foreground">
              Showing {rows.length} result{rows.length === 1 ? "" : "s"} for the selected filters.
            </p>
          )}
        </div>
        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
          </div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-sm font-light text-muted-foreground">
            {hasFilters
              ? "No payable head changes match the selected filters."
              : "No payable head changes recorded yet."}
          </p>
        ) : (
          <ScrollArea className="max-h-[420px] pr-2">
            <ul className="space-y-2">
              {visible.map((row) => {
                const change = describeChange(row);
                return (
                  <li
                    key={row.id}
                    className="rounded-lg border bg-card/40 p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={ACTION_TONE[row.action] ?? ""}>
                        {ACTION_LABEL[row.action] ?? row.action}
                      </Badge>
                      <span className="font-medium">{row.supplier_name ?? "Unknown supplier"}</span>
                      {row.account_code && (
                        <span className="font-light text-muted-foreground">
                          {row.account_code} · {row.account_name}
                        </span>
                      )}
                    </div>
                    {change && (
                      <p className="mt-1 text-xs font-light text-muted-foreground">{change}</p>
                    )}
                    <p className="mt-1 text-xs font-light text-muted-foreground">
                      {new Date(row.created_at).toLocaleString()}
                      {" · "}
                      {row.performed_by ? (actors[row.performed_by] ?? "User") : "System"}
                    </p>
                  </li>
                );
              })}
            </ul>
            {rows.length > visible.length && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 h-8 w-full text-xs"
                onClick={() => setShowAll(true)}
              >
                Show {rows.length - visible.length} older entries
              </Button>
            )}
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}